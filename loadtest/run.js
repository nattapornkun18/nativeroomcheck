/* รันชุดการทดสอบโหลด — node loadtest/run.js */
'use strict';

const CM = require('./cost-model');
const { runScenario } = require('./sim');

const BASE = {
  profile: 'typical',
  topicsPerSave: 6,        // "อัปเดตทุกหมวด" ในห้องเดียว
  inspectMs: 4 * 60000,    // ตรวจห้องครบ 6 หมวด ~4 นาที
  durationMs: 60 * 60000,  // จำลอง 1 ชั่วโมง
  startRows: 400,          // แถวสะสมต่อหมวด ณ ตอนเริ่ม
  burst: false,
  burstSpreadMs: 5000,
  seed: 20260808,
};

function line(n) { return '─'.repeat(n); }
function f(x, d) { return Number(x).toFixed(d === undefined ? 1 : d); }

/* ================= 1. ต้นทุนของหนึ่งครั้งที่กดบันทึก ================= */
console.log('\n' + line(78));
console.log('1) หนึ่งครั้งที่กดบันทึก (6 หมวดในห้องเดียว) ใช้เวลาเท่าไร และถือล็อกนานแค่ไหน');
console.log(line(78));
console.log('โปรไฟล์   | เวลาถือล็อก | รวมทั้ง request | เรียก Sheets API | ความจุสูงสุดทั้งระบบ');
console.log(line(78));
for (const name of ['fast', 'typical', 'slow']) {
  const p = CM.PROFILES[name];
  const c = CM.costPost(p, 6, 400);
  console.log(
    name.padEnd(9) + ' | ' +
    (f(c.inLock / 1000) + ' วิ').padStart(11) + ' | ' +
    (f(c.total / 1000) + ' วิ').padStart(15) + ' | ' +
    String(c.calls).padStart(16) + ' | ' +
    (f(60000 / c.inLock) + ' ครั้ง/นาที').padStart(20)
  );
}

/* แยกให้เห็นว่าเวลาไปอยู่ตรงไหน */
console.log('\nเวลาในล็อกไปอยู่ตรงไหน (โปรไฟล์ typical, 6 หมวด):');
{
  const p = CM.PROFILES.typical;
  const entry = CM.costPerEntry(p, 400);
  const summary = CM.costSummary(p, 400);
  const line1 = p.urlFetch;
  const total = entry.ms * 6 + line1 + summary.ms;
  const rows = [
    ['เขียน 6 หมวด (findLatest_ อ่านทั้งแท็บ + appendRow + copyTo + ระบายสี)', entry.ms * 6, entry.calls * 6],
    ['ยิงแจ้งเตือน LINE (UrlFetchApp)', line1, 1],
    ['buildSummary_ — อ่านครบ 6 แท็บใหม่ แล้ววาด Summary ใหม่ทั้งหน้า', summary.ms, summary.calls],
  ];
  for (const [label, ms, calls] of rows) {
    console.log('  ' + (f(ms / 1000) + ' วิ').padStart(8) +
      ('  (' + f(ms / total * 100, 0) + '%)').padEnd(9) +
      '  ' + String(calls).padStart(3) + ' calls  ' + label);
  }
  console.log('  ' + ('ในนั้น buildSummary_ เสียกับการ "แต่งหน้า" ล้วน ๆ ' +
    summary.decorateCalls + ' calls = ' + f(summary.decorateCalls * p.call / 1000) + ' วิ').padStart(0));
}

/* ================= 2. 40 คนทำงานต่อเนื่อง 1 ชั่วโมง ================= */
console.log('\n' + line(78));
console.log('2) 40 คนตรวจห้องต่อเนื่อง 1 ชั่วโมง (คนละ ~4 นาที/ห้อง อัปเดตครบ 6 หมวด)');
console.log(line(78));

const main = [];
for (const profile of ['fast', 'typical', 'slow']) {
  main.push(runScenario('40 คน · ' + profile, Object.assign({}, BASE, { users: 40, profile })));
}
for (const r of main) {
  console.log('\n▸ ' + r.name);
  console.log('   งานที่เข้ามา         ' + f(r.demandPerMin) + ' ครั้ง/นาที');
  console.log('   ระบบรับไหว           ' + f(r.capacityPerMin) + ' ครั้ง/นาที   (ล็อกถูกถือครั้งละ ' + f(r.avgHoldSec) + ' วิ)');
  console.log('   ทำได้จริง            ' + f(r.savesPerMin) + ' ครั้ง/นาที   (' + r.saved + ' ครั้งใน 60 นาที)');
  console.log('   ล็อกไม่ว่างเลย       ' + f(r.lockUtil * 100, 0) + '% ของเวลา');
  console.log('   รอตั้งแต่กดจนสำเร็จ  กลาง ' + f(r.waitP50) + ' วิ · 90% ไม่เกิน ' + f(r.waitP90) + ' วิ · แย่สุด ' + f(r.waitMax) + ' วิ');
  console.log('   กดแล้วเด้ง error      ' + r.lockTimeouts + ' ครั้ง (waitLock 30 วิ หมดเวลา)');
  console.log('   ชนโควตา 30 execution ' + r.overloads + ' ครั้ง  (สูงสุดที่วิ่งพร้อมกัน ' + r.peakConcurrent + ')');
  console.log('   ต้องส่งซ้ำ            ' + r.retriedJobs + '/' + r.totalPresses + ' ครั้งที่กด · ตกไปอยู่ในคิวออฟไลน์ ' + r.queuedJobs + ' ครั้ง');
  console.log('   ยังไม่สำเร็จตอนจบ    ' + r.stuckJobs + ' ครั้ง');
  console.log('   ข้อความ LINE         ' + r.lineMessages + ' ข้อความ/ชั่วโมง');
}

/* ================= 3. หาจุดที่เริ่มพัง ================= */
console.log('\n' + line(78));
console.log('3) กี่คนถึงเริ่มพัง (โปรไฟล์ typical, ตรวจครบ 6 หมวด, 1 ชั่วโมง)');
console.log(line(78));
console.log(' คน | เข้ามา/นาที | ทำได้/นาที | ล็อกใช้ไป | รอกลาง | รอ 90% | เด้ง error | ค้างคิว');
console.log(line(78));
for (const users of [3, 5, 8, 10, 15, 20, 30, 40, 60]) {
  const r = runScenario('n', Object.assign({}, BASE, { users }));
  console.log(
    String(users).padStart(3) + ' | ' +
    f(r.demandPerMin).padStart(11) + ' | ' +
    f(r.savesPerMin).padStart(10) + ' | ' +
    (f(r.lockUtil * 100, 0) + '%').padStart(9) + ' | ' +
    (f(r.waitP50) + 'ว').padStart(6) + ' | ' +
    (f(r.waitP90) + 'ว').padStart(6) + ' | ' +
    String(r.lockTimeouts).padStart(10) + ' | ' +
    String(r.queuedJobs).padStart(7)
  );
}

/* ================= 4. ทุกคนกดพร้อมกัน ================= */
console.log('\n' + line(78));
console.log('4) กรณีเลวร้าย — 40 คนกดบันทึกพร้อมกันภายใน 5 วินาที (เช่น เข้างานเช้าพร้อมกัน)');
console.log(line(78));
{
  const r = runScenario('burst', Object.assign({}, BASE, {
    users: 40, burst: true, burstSpreadMs: 5000, inspectMs: 4 * 60000, durationMs: 20 * 60000,
  }));
  console.log('   สำเร็จใน 20 นาทีแรก   ' + r.saved + ' ครั้ง');
  console.log('   รอตั้งแต่กดจนสำเร็จ   กลาง ' + f(r.waitP50) + ' วิ · 90% ไม่เกิน ' + f(r.waitP90) + ' วิ · แย่สุด ' + f(r.waitMax) + ' วิ');
  console.log('   เด้ง error ให้ผู้ใช้เห็น ' + r.lockTimeouts + ' ครั้ง · คิวหน้าล็อกยาวสุด ' + r.peakLockQueue + ' คน');
  console.log('   ชนโควตา 30 execution   ' + r.overloads + ' ครั้ง (สูงสุดวิ่งพร้อมกัน ' + r.peakConcurrent + ')');
  console.log('   ตกไปคิวออฟไลน์         ' + r.queuedJobs + ' ครั้ง');
}

/* ================= 5. ถ้าแก้คอขวด ================= */
console.log('\n' + line(78));
console.log('5) ถ้าแก้คอขวด — 40 คน 1 ชั่วโมง โปรไฟล์ typical');
console.log(line(78));
const variants = [
  ['ตอนนี้ (buildSummary_ ทุกครั้ง + ยิง LINE ในล็อก)', {}],
  ['ย้าย buildSummary_ ออกจากทางบันทึก', { skipSummary: true }],
  ['ย้าย LINE ออกจากล็อกด้วย', { skipSummary: true, skipLine: true }],
];
console.log('                                              ทำได้/นาที  รอกลาง  เด้ง error  ค้างคิว');
console.log(line(78));
for (const [label, extra] of variants) {
  const r = runScenario(label, Object.assign({}, BASE, { users: 40 }, extra));
  console.log(
    label.padEnd(45) + ' ' +
    f(r.savesPerMin).padStart(9) + ' ' +
    (f(r.waitP50) + 'ว').padStart(8) + ' ' +
    String(r.lockTimeouts).padStart(10) + ' ' +
    String(r.queuedJobs).padStart(8)
  );
}

/* ================= 6. ขนาดข้อมูลที่ดึงทุกครั้ง ================= */
console.log('\n' + line(78));
console.log('6) ?action=list ดึงทุกแถวของทุกหมวดทุกครั้ง — โตขึ้นเรื่อย ๆ ไม่มีเพดาน');
console.log(line(78));
console.log(' แถวสะสม/หมวด | ขนาดที่ส่งกลับ | เวลาฝั่งเซิร์ฟเวอร์ | 40 เครื่องดึงครบหนึ่งรอบ');
console.log(line(78));
for (const rows of [216, 500, 1000, 2000, 4000]) {
  const c = CM.costGetList(CM.PROFILES.typical, rows);
  console.log(
    String(rows).padStart(13) + ' | ' +
    (f(c.bytes / 1024, 0) + ' KB').padStart(14) + ' | ' +
    (f(c.ms / 1000) + ' วิ').padStart(18) + ' | ' +
    (f(c.bytes * 40 / 1024 / 1024) + ' MB').padStart(24)
  );
}
console.log('\nหนึ่งห้องตรวจครบ 6 หมวด = 6 แถวใหม่ · ตรวจครบตึก 216 ห้อง = 216 แถว/หมวด');
console.log('ตรวจซ้ำรอบสอง/สาม หรือแก้ผลตรวจ = แถวเพิ่มอีกเท่าตัว (โค้ดใช้ appendRow_ อย่างเดียว ไม่เคยทับแถวเดิม)');
console.log('');
