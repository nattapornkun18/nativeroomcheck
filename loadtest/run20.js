/* เจาะเฉพาะกรณี 20 คน — node loadtest/run20.js
 *
 * 20 คนอยู่พอดีเส้นความจุ ผลจึงพลิกได้ตามสองอย่างที่ยังไม่รู้แน่:
 *   1. ตรวจห้องหนึ่งใช้เวลากี่นาที (ยิ่งเร็ว งานยิ่งถี่)
 *   2. กดบันทึกทีเดียว 6 หมวด หรือกดทีละหมวด
 * จึงกวาดทั้งสองแกน แทนที่จะตอบจากค่าเดียว
 */
'use strict';

const CM = require('./cost-model');
const { runScenario } = require('./sim');

const BASE = {
  profile: 'typical',
  topicsPerSave: 6,
  inspectMs: 4 * 60000,
  durationMs: 60 * 60000,
  startRows: 400,
  burst: false,
  burstSpreadMs: 5000,
  seed: 20260808,
};

const L = (n) => '─'.repeat(n);
const f = (x, d) => Number(x).toFixed(d === undefined ? 1 : d);

/* เกณฑ์ผ่าน — ต้องผ่านครบทั้งสี่ข้อ
   1. ทำได้ >= 90% ของที่ควรได้ตอนไม่มีคิว (คิวไม่ถ่วงงาน)
   2. รอ 90% ไม่เกิน 45 วิ  — เกินนี้หน้าเว็บ abort เอง (T_POST, index.html:1029)
   3. ไม่มีงานตกไปคิวออฟไลน์ — ผู้ใช้ไม่เคยเห็น "ส่งไม่สำเร็จ"
   4. เด้ง error เฉลี่ยไม่เกิน 1 ครั้ง/คน/ชั่วโมง

   หมายเหตุ: เปอร์เซ็นไทล์เวลารอนับเฉพาะครั้งที่ "สำเร็จ" ตอนระบบตันหนัก ๆ
   ตัวเลขนี้จะดูดีเกินจริง เพราะครั้งที่แย่ที่สุดยังไม่สำเร็จเลยไม่ถูกนับ */
function verdict(r) {
  const quick   = r.waitP90 <= 45;                    // ไม่ชน T_POST 45 วิ
  const noQueue = r.queuedJobs === 0;                 // ไม่มีใครเห็น "ส่งไม่สำเร็จ"
  const rareErr = r.lockTimeouts <= r.users * 0.5;    // <= 1 ครั้ง ต่อ 2 คน ต่อชั่วโมง
  if (quick && noQueue && rareErr) return '✅ ไหว';
  if (r.waitP90 <= 90 && r.queuedJobs <= r.users * 0.1) return '🟡 ไหวแบบเสียว';
  return '❌ ไม่ไหว';
}

/* งานเดินช้าลงกี่ % เทียบกับตอนไม่มีใครแย่งล็อกเลย */
function slow(r) { return (r.idealPerMin / r.savesPerMin - 1) * 100; }

function row(label, r) {
  return label.padEnd(30) + ' ' +
    f(r.savesPerMin).padStart(7) + ' ' +
    ('+' + f(slow(r), 0) + '%').padStart(7) + ' ' +
    (f(r.lockUtil * 100, 0) + '%').padStart(6) + ' ' +
    (f(r.waitP50) + 'ว').padStart(7) + ' ' +
    (f(r.waitP90) + 'ว').padStart(8) + ' ' +
    String(r.lockTimeouts).padStart(9) + ' ' +
    String(r.queuedJobs).padStart(7) + '  ' + verdict(r);
}
const HEAD = 'สถานการณ์'.padEnd(30) + ' ทำได้/น  ช้าลง  ล็อก   รอกลาง   รอ90%  เด้งerror  ค้างคิว  สรุป';

/* ============ 1. 20 คน ตรวจเร็ว-ช้าต่างกัน ============ */
console.log('\n' + L(100));
console.log('1) 20 คน · กดบันทึกทีเดียวครบ 6 หมวด · ต่างกันที่ความเร็วในการตรวจห้อง');
console.log(L(100));
console.log(HEAD);
console.log(L(100));
for (const mins of [3, 4, 5, 6, 8, 10]) {
  const r = runScenario('x', Object.assign({}, BASE, { users: 20, inspectMs: mins * 60000 }));
  console.log(row('ตรวจห้องละ ' + mins + ' นาที', r));
}

/* ============ 2. กดทีละหมวด vs กดทีเดียวครบ ============ */
console.log('\n' + L(100));
console.log('2) 20 คน ตรวจห้องละ 4 นาที · กดบันทึกทีเดียวครบ 6 หมวด vs แยกกดทีละหมวด');
console.log(L(100));
console.log(HEAD);
console.log(L(100));
{
  // กดทีเดียวครบ 6 หมวด: 1 request/ห้อง
  const a = runScenario('x', Object.assign({}, BASE, { users: 20, topicsPerSave: 6, inspectMs: 4 * 60000 }));
  console.log(row('กดทีเดียว 6 หมวด', a));
  // กดทีละหมวด: 6 request/ห้อง → เวลาระหว่างกด = 4 นาที / 6
  const b = runScenario('x', Object.assign({}, BASE, { users: 20, topicsPerSave: 1, inspectMs: 4 * 60000 / 6 }));
  console.log(row('แยกกดทีละหมวด (6 ครั้ง)', b));
  // ครึ่งทาง: กดทีละ 2 หมวด
  const c = runScenario('x', Object.assign({}, BASE, { users: 20, topicsPerSave: 2, inspectMs: 4 * 60000 / 3 }));
  console.log(row('กดทีละ 2 หมวด (3 ครั้ง)', c));
}
console.log('\nหมายเหตุ: ทุกครั้งที่กดบันทึกจ่ายค่า buildSummary_ เต็มราคา (~6.9 วิ) ไม่ว่าจะบันทึกกี่หมวด');
console.log('แยกกดทีละหมวดจึงแพงกว่ามาก ทั้งที่ข้อมูลเท่ากัน');

/* ============ 3. เผื่อเซิร์ฟเวอร์ช้ากว่าที่คิด ============ */
console.log('\n' + L(100));
console.log('3) 20 คน ตรวจห้องละ 4 นาที · ถ้า Apps Script ช้ากว่าที่ประมาณไว้');
console.log(L(100));
console.log(HEAD);
console.log(L(100));
for (const profile of ['fast', 'typical', 'slow']) {
  const r = runScenario('x', Object.assign({}, BASE, { users: 20, profile }));
  console.log(row('โปรไฟล์ ' + profile, r));
}

/* ============ 4. แถวสะสมเยอะขึ้นตามการใช้งาน ============ */
console.log('\n' + L(100));
console.log('4) 20 คน · ยิ่งใช้ไปนาน แถวยิ่งสะสม (findLatest_ กับ buildSummary_ อ่านทั้งแท็บทุกครั้ง)');
console.log(L(100));
console.log(HEAD);
console.log(L(100));
for (const rows of [216, 500, 1000, 2000]) {
  const r = runScenario('x', Object.assign({}, BASE, { users: 20, startRows: rows }));
  console.log(row('แถวสะสม ' + rows + '/หมวด', r));
}

/* ============ 5. ถ้าแก้คอขวดก่อน ============ */
console.log('\n' + L(100));
console.log('5) 20 คน ตรวจห้องละ 4 นาที · ถ้าย้ายของหนักออกจากล็อก');
console.log(L(100));
console.log(HEAD);
console.log(L(100));
{
  const v = [
    ['ตอนนี้', {}],
    ['ย้าย buildSummary_ ออก', { skipSummary: true }],
    ['ย้าย buildSummary_ + LINE ออก', { skipSummary: true, skipLine: true }],
  ];
  for (const [label, extra] of v) {
    console.log(row(label, runScenario('x', Object.assign({}, BASE, { users: 20 }, extra))));
  }
}

/* ============ 6. เพดานคนที่รับได้จริง ============ */
console.log('\n' + L(100));
console.log('6) รับได้กี่คน (ตรวจห้องละ 4 นาที ครบ 6 หมวด) — ไล่หาเส้นแบ่ง');
console.log(L(100));
console.log(HEAD);
console.log(L(100));
for (const users of [8, 10, 12, 14, 16, 18, 20, 22]) {
  console.log(row(users + ' คน', runScenario('x', Object.assign({}, BASE, { users }))));
}
console.log('');

/* ============ 7. ปริมาณ LINE ต่อวัน ============ */
console.log(L(100));
console.log('7) ข้อความ LINE ที่ 20 คนสร้าง');
console.log(L(100));
{
  const r = runScenario('x', Object.assign({}, BASE, { users: 20 }));
  const perHour = r.lineMessages;
  console.log('   บันทึกสำเร็จ ' + perHour + ' ครั้ง/ชั่วโมง → LINE ' + perHour + ' ข้อความ/ชั่วโมง');
  console.log('   ทำงาน 8 ชั่วโมง = ' + perHour * 8 + ' ข้อความ/วัน · 22 วันทำการ = ' +
              (perHour * 8 * 22).toLocaleString() + ' ข้อความ/เดือน');
  console.log('   ถ้า LINE_TO เว้นว่าง โค้ดใช้ broadcast (Code.gs:631) → คูณจำนวนคนที่ตาม OA อีกที');
  console.log('');
}
