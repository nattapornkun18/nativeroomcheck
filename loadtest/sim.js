/* จำลองการใช้งานพร้อมกันหลายคน — ฝั่งเซิร์ฟเวอร์ Apps Script + ฝั่งหน้าเว็บ
 *
 * ฝั่งเซิร์ฟเวอร์จำลองตาม Code.gs:
 *   - LockService.getScriptLock() เป็นล็อกเดียวของทั้งสคริปต์ → doPost ทุกคนต่อคิวเดียว
 *   - lock.waitLock(30000) รอเกิน 30 วิ = โยน error "ชีตกำลังถูกเขียนอยู่ ลองใหม่อีกครั้ง"
 *   - โควตา Apps Script: รันพร้อมกันได้สูงสุด 30 execution ต่อสคริปต์
 *   - doGet ไม่ถือล็อก แต่กินสล็อต execution เหมือนกัน
 *
 * ฝั่งหน้าเว็บจำลองตาม index.html:
 *   - apiPost → withRetry(..., 3) ถอยหลัง 1.2s, 2.4s (index.html:1066)
 *   - error ที่เข้าเงื่อนไข /ลองใหม่|กำลังถูกเขียน/ = soft → ลองซ้ำ (index.html:1059)
 *   - หมดสามครั้ง → เก็บลง outbox แล้วตั้งเวลาลองใหม่ 4/8/15/30/60 วิ (index.html:1097)
 *   - บันทึกสำเร็จ → pull(true) ดึงข้อมูลทั้งหมดใหม่หนึ่งรอบ (index.html:1714)
 *   - อยู่ในห้องจะไม่ poll ตามรอบ 25 วิ (index.html:1153)
 */

'use strict';

const CM = require('./cost-model');

/* ---------- คิวเหตุการณ์ ---------- */
class Sim {
  constructor() { this.t = 0; this.q = []; this.seq = 0; }
  at(time, fn) { this.q.push({ time, seq: this.seq++, fn }); }
  after(dt, fn) { this.at(this.t + dt, fn); }
  run(until) {
    while (this.q.length) {
      this.q.sort((a, b) => a.time - b.time || a.seq - b.seq);
      const e = this.q.shift();
      if (e.time > until) break;
      this.t = e.time;
      e.fn();
    }
    this.t = Math.min(this.t, until);
  }
}

/* ---------- สุ่มแบบมีเมล็ด (รันซ้ำได้ผลเดิม) ---------- */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function jitter(rnd, base, spread) { return base * (1 - spread + rnd() * spread * 2); }

/* ---------- เซิร์ฟเวอร์ Apps Script ---------- */
const MAX_CONCURRENT = 30;      // โควตาของ Apps Script
const LOCK_TIMEOUT = 30000;     // Code.gs:462

class AppsScript {
  constructor(sim, profile, opts) {
    this.sim = sim;
    this.p = profile;
    this.opts = opts;
    this.running = 0;                 // execution ที่กำลังวิ่ง
    this.lockHeld = false;
    this.lockQueue = [];              // {enqueuedAt, onGrant, onTimeout}
    this.rowsPerTopic = opts.startRows;
    this.stats = {
      postOk: 0, postLockTimeout: 0, postOverload: 0,
      getOk: 0, getOverload: 0,
      lineMessages: 0, peakConcurrent: 0, peakLockQueue: 0,
      lockBusyMs: 0, lockHoldSamples: [],
    };
  }

  _enter() {
    if (this.running >= MAX_CONCURRENT) return false;
    this.running++;
    this.stats.peakConcurrent = Math.max(this.stats.peakConcurrent, this.running);
    return true;
  }
  _exit() { this.running--; }

  _acquireLock(onGrant) {
    const entry = { enqueuedAt: this.sim.t, onGrant, timedOut: false };
    this.lockQueue.push(entry);
    this.stats.peakLockQueue = Math.max(this.stats.peakLockQueue, this.lockQueue.length);
    // นาฬิกาจับเวลา waitLock ของแต่ละคน
    this.sim.after(LOCK_TIMEOUT, () => {
      if (entry.granted) return;
      entry.timedOut = true;
      const i = this.lockQueue.indexOf(entry);
      if (i !== -1) this.lockQueue.splice(i, 1);
      entry.onGrant(false);
    });
    this._pump();
  }
  _pump() {
    if (this.lockHeld || !this.lockQueue.length) return;
    const entry = this.lockQueue.shift();
    if (entry.timedOut) return this._pump();
    entry.granted = true;
    this.lockHeld = true;
    entry.onGrant(true);
  }
  _releaseLock(heldMs) {
    this.lockHeld = false;
    this.stats.lockBusyMs += heldMs;
    this.stats.lockHoldSamples.push(heldMs);
    this._pump();
  }

  /** POST — บันทึกหนึ่งครั้ง (nTopics หมวด) */
  post(nTopics, done) {
    if (!this._enter()) {
      this.stats.postOverload++;
      return this.sim.after(200, () => done({ ok: false, kind: 'overload' }));
    }
    const p = this.p;
    this.sim.after(p.startup, () => {
      this._acquireLock((granted) => {
        if (!granted) {
          this.stats.postLockTimeout++;
          this._exit();
          return done({ ok: false, kind: 'lockTimeout' });
        }
        const c = CM.costPost(p, nTopics, this.rowsPerTopic, this.opts);
        const held = c.inLock;
        this.sim.after(held, () => {
          this.rowsPerTopic += nTopics / CM.TOPICS;   // ทุกบันทึก = แถวใหม่ (ไม่เคยทับแถวเดิม)
          if (!this.opts.skipLine) this.stats.lineMessages++;
          this.stats.postOk++;
          this._releaseLock(held);
          this._exit();
          done({ ok: true, serviceMs: p.startup + held });
        });
      });
    });
  }

  /** GET action=list — ไม่ถือล็อก แต่กินสล็อต execution */
  getList(done) {
    if (!this._enter()) {
      this.stats.getOverload++;
      return this.sim.after(200, () => done({ ok: false, kind: 'overload' }));
    }
    const c = CM.costGetList(this.p, this.rowsPerTopic);
    this.sim.after(c.ms, () => {
      this.stats.getOk++;
      this._exit();
      done({ ok: true, serviceMs: c.ms, bytes: c.bytes });
    });
  }
}

/* ---------- ฝั่งหน้าเว็บ ---------- */
const RETRY_WAIT = [4000, 8000, 15000, 30000, 60000];   // index.html:1097
const T_POST = 45000;                                    // index.html:1029

class Client {
  constructor(sim, server, id, rnd, cfg) {
    this.sim = sim; this.server = server; this.id = id; this.rnd = rnd; this.cfg = cfg;
    this.outbox = [];
    this.failStreak = 0;
    this.saves = 0;
    this.log = [];        // {pressedAt, doneAt, attempts, queued}
  }

  /** เดินงานหนึ่งรอบ: ตรวจห้อง → กดบันทึก */
  start(delay) { this.sim.after(delay, () => this.inspect()); }

  inspect() {
    const think = jitter(this.rnd, this.cfg.inspectMs, 0.45);
    this.sim.after(think, () => this.press());
  }

  press() {
    const job = { pressedAt: this.sim.t, attempts: 0, queued: false };
    this.log.push(job);
    this.send(job, 0);
  }

  /* withRetry(fn, 3) — index.html:1066,1089 */
  send(job, attempt) {
    job.attempts++;
    const started = this.sim.t;
    this.server.post(this.cfg.topicsPerSave, (res) => {
      const elapsed = this.sim.t - started;
      if (res.ok && elapsed <= T_POST) {
        this.failStreak = 0;
        this.saves++;
        job.doneAt = this.sim.t;
        job.waitMs = job.doneAt - job.pressedAt;
        // สำเร็จแล้วดึงข้อมูลใหม่ทั้งชุด (index.html:1714)
        this.server.getList(() => {});
        return this.inspect();
      }
      /* error ของล็อกเป็น soft → ลองซ้ำได้ (index.html:1059) */
      const soft = res.kind === 'lockTimeout' || res.kind === 'overload' || elapsed > T_POST;
      if (soft && attempt < 2) {
        return this.sim.after(1200 * Math.pow(2, attempt), () => this.send(job, attempt + 1));
      }
      // หมดสามครั้ง → เก็บลง outbox แล้วตั้งเวลาลองใหม่ (index.html:1717)
      job.queued = true;
      this.failStreak++;
      const wait = RETRY_WAIT[Math.min(this.failStreak - 1, RETRY_WAIT.length - 1)];
      this.sim.after(wait, () => this.send(job, 0));
    });
  }
}

/* ---------- รันหนึ่งสถานการณ์ ---------- */
function runScenario(name, cfg) {
  const sim = new Sim();
  const p = CM.PROFILES[cfg.profile];
  const server = new AppsScript(sim, p, {
    startRows: cfg.startRows,
    skipSummary: !!cfg.skipSummary,
    skipLine: !!cfg.skipLine,
  });
  const rnd = rng(cfg.seed || 12345);
  const clients = [];
  for (let i = 0; i < cfg.users; i++) {
    const c = new Client(sim, server, i, rng((cfg.seed || 12345) + i * 7919), cfg);
    clients.push(c);
    c.start(cfg.burst ? rnd() * cfg.burstSpreadMs : rnd() * cfg.inspectMs);
  }
  sim.run(cfg.durationMs);

  /* ---- สรุปผล ---- */
  const jobs = [].concat(...clients.map(c => c.log));
  const doneJobs = jobs.filter(j => j.doneAt !== undefined);
  const waits = doneJobs.map(j => j.waitMs).sort((a, b) => a - b);
  const pct = (arr, q) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * q))] : 0;
  const stuck = jobs.filter(j => j.doneAt === undefined);
  const holds = server.stats.lockHoldSamples;
  const avgHold = holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length : 0;

  return {
    name, cfg,
    users: cfg.users,
    minutes: cfg.durationMs / 60000,
    saved: server.stats.postOk,
    savesPerMin: server.stats.postOk / (cfg.durationMs / 60000),
    demandPerMin: cfg.users / (cfg.inspectMs / 60000),
    avgHoldSec: avgHold / 1000,
    capacityPerMin: avgHold ? 60000 / avgHold : 0,
    lockUtil: server.stats.lockBusyMs / cfg.durationMs,
    waitP50: pct(waits, 0.5) / 1000,
    waitP90: pct(waits, 0.9) / 1000,
    waitMax: (waits[waits.length - 1] || 0) / 1000,
    lockTimeouts: server.stats.postLockTimeout,
    overloads: server.stats.postOverload + server.stats.getOverload,
    peakConcurrent: server.stats.peakConcurrent,
    peakLockQueue: server.stats.peakLockQueue,
    retriedJobs: jobs.filter(j => j.attempts > 1).length,
    queuedJobs: jobs.filter(j => j.queued).length,
    stuckJobs: stuck.length,
    totalPresses: jobs.length,
    lineMessages: server.stats.lineMessages,
    finalRows: Math.round(server.rowsPerTopic),
    listPayloadKB: Math.round(CM.costGetList(p, server.rowsPerTopic).bytes / 1024),
  };
}

module.exports = { runScenario, Sim, AppsScript, Client };
