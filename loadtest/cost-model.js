/* แบบจำลองต้นทุนเวลาของ Apps Script — นับจำนวนการเรียก Sheets API จริงจาก Code.gs
 *
 * Apps Script คิดเวลาเป็น "จำนวนครั้งที่คุยกับ Sheets" เป็นหลัก ไม่ใช่ปริมาณข้อมูล
 * การเรียกแต่ละครั้งวิ่งข้ามเครือข่ายไปหา Google Sheets backend เสมอ
 * แม้แต่ .setFontSize() ต่อท้าย .setFontWeight() ก็นับเป็นสองครั้ง
 *
 * ตัวเลขในไฟล์นี้เป็น "ช่วงที่พบได้จริง" ของ Apps Script ไม่ใช่ค่าที่วัดจากชีตของโครงการนี้
 * จึงรันสามโปรไฟล์ (fast / typical / slow) เพื่อดูว่าข้อสรุปเปลี่ยนตามสมมติฐานหรือไม่
 */

'use strict';

/* ---------- โปรไฟล์ความเร็วของ Apps Script ---------- */
const PROFILES = {
  fast:    { call: 18,  bigReadBase: 45,  bigReadPerCell: 0.0035, append: 90,  copyTo: 70,  clear: 110, setValues: 80,  urlFetch: 200,  startup: 250 },
  typical: { call: 35,  bigReadBase: 80,  bigReadPerCell: 0.0090, append: 160, copyTo: 130, clear: 200, setValues: 150, urlFetch: 450,  startup: 500 },
  slow:    { call: 70,  bigReadBase: 160, bigReadPerCell: 0.0200, append: 300, copyTo: 260, clear: 400, setValues: 300, urlFetch: 1100, startup: 950 },
};

/* ---------- ขนาดของงานจริง ---------- */
const TOPICS = 6;              // 6 หมวด
const FLOORS = 18;             // ชั้น 3–20
const ROOMS_PER_FLOOR = 12;
const TOTAL_ROOMS = FLOORS * ROOMS_PER_FLOOR;   // 216
const SHEETS_IN_FILE = 8;      // 6 หมวด + Summary + เผื่อแท็บอื่น
const COLS_PER_TOPIC = 15;     // ซ้าย 3 + คอลัมน์ของหมวด + ขวา 3 (เฉลี่ย)
const SUMMARY_ROWS = 3 + 1 + TOPICS + 1 + 3 + FLOORS + 3 + 60;  // ~110 แถว

/* ---------- ตัวช่วย ---------- */
function bigRead(p, rows, cols) {
  return p.bigReadBase + rows * cols * p.bigReadPerCell;
}

/* =======================================================================
 * doPost — หนึ่งครั้งที่กดบันทึก
 * =======================================================================
 * โครงสร้างจาก Code.gs:449
 *   parseBody_            → ฟรี (ไม่แตะชีต)
 *   doneReply_            → CacheService (เร็ว)
 *   lock.waitLock(30000)  → **ล็อกทั้งสคริปต์** ทุกคนต่อคิวเดียวกัน
 *   entries.forEach(...)  → ต่อหนึ่งหมวด
 *   notifySave_           → UrlFetchApp ยิง LINE
 *   buildSummary_         → อ่านทุกแท็บใหม่หมด แล้ววาด Summary ใหม่ทั้งหน้า
 *   lock.releaseLock()
 */

/** ต้นทุนของหนึ่ง entry (หนึ่งหมวด) ใน doPost — Code.gs:480–509 */
function costPerEntry(p, rowsInTopicSheet) {
  let t = 0;
  let calls = 0;

  // sheetOf_ → adoptSheet_ (Code.gs:287)
  t += p.call;                       calls += 1;   // ss.getSheets()
  t += p.call * SHEETS_IN_FILE;      calls += SHEETS_IN_FILE;   // s.getName() ทุกแท็บ
  t += p.call;                       calls += 1;   // keep.getLastRow()

  // headOfSheet_ (Code.gs:313)
  t += p.call;                       calls += 1;   // getLastColumn()
  t += bigRead(p, 1, COLS_PER_TOPIC); calls += 1;  // อ่านหัวตาราง

  // findLatest_ (Code.gs:582) — อ่านทั้งแท็บทุกครั้ง
  t += p.call;                       calls += 1;   // getLastRow()
  t += bigRead(p, rowsInTopicSheet, COLS_PER_TOPIC); calls += 1;

  // appendRow_ (Code.gs:560)
  t += p.append;                     calls += 1;   // sh.appendRow()
  t += p.call;                       calls += 1;   // getLastRow()
  t += p.copyTo;                     calls += 1;   // styleRow_ copyTo formatOnly
  t += p.call;                       calls += 1;   // setNumberFormat

  // อ่านวันที่กลับมา (Code.gs:501)
  t += p.call;                       calls += 1;   // getRange().getValue()

  // paintGrade_ (Code.gs:837)
  t += p.call * 3;                   calls += 3;   // getRange + setBackground + setFontColor

  return { ms: t, calls };
}

/** buildSummary_ (Code.gs:1231) — เรียกทุกครั้งที่มีคนกดบันทึก */
function costSummary(p, rowsPerTopic) {
  let t = 0;
  let calls = 0;

  // adoptSheet_ ของแท็บ Summary
  t += p.call * (1 + SHEETS_IN_FILE + 1);  calls += 2 + SHEETS_IN_FILE;

  // latestByRoom_ ทั้ง 6 หมวด → rowsOf_ → อ่านทั้งแท็บใหม่หมด (Code.gs:371)
  for (let i = 0; i < TOPICS; i++) {
    t += p.call * (1 + SHEETS_IN_FILE + 1);          calls += 2 + SHEETS_IN_FILE;  // sheetOf_
    t += p.call;                                     calls += 1;   // getLastColumn
    t += bigRead(p, 1, COLS_PER_TOPIC);              calls += 1;   // หัวตาราง
    t += p.call;                                     calls += 1;   // getLastRow
    t += bigRead(p, rowsPerTopic, COLS_PER_TOPIC);   calls += 1;   // ทั้งแท็บ
  }

  // เขียนลงชีต (Code.gs:1316–1322)
  t += p.call;                                calls += 1;   // getMaxRows
  t += p.clear;                               calls += 1;   // sh.clear()
  t += p.call;                                calls += 1;   // clearConditionalFormatRules
  t += p.call;                                calls += 1;   // getBandings
  t += p.setValues;                           calls += 1;   // setValues(rows x 9)

  /* แต่งหน้า (Code.gs:1324–1374) — เมธอดที่ต่อกันด้วยจุดนับเป็นคนละครั้ง
     A1 3 · A2 2 · หัวสามบล็อก 3x7 · หัวข้อสองบรรทัด 2x3 · setFrozenRows 1
     setColumnWidth 9 · จัดกึ่งกลาง/ตัวเลข/แถวรวม 8 · setBorder 3
     ระบายสีบล็อกนับ 8 · setBackgrounds+setFontColors 2 · setConditionalFormatRules 1 */
  const decorate = 3 + 2 + 3 * 7 + 2 * 3 + 1 + 9 + 8 + 3 + 8 + 2 + 1;   // = 64
  t += p.call * decorate;                     calls += decorate;
  t += p.setValues * 0.4;                     // setValues ของสี (setBackgrounds)

  return { ms: t, calls, decorateCalls: decorate };
}

/** ต้นทุนรวมของหนึ่ง POST ที่บันทึก nTopics หมวด */
function costPost(p, nTopics, rowsPerTopic, opts) {
  opts = opts || {};
  const entry = costPerEntry(p, rowsPerTopic);
  const summary = opts.skipSummary ? { ms: 0, calls: 0 } : costSummary(p, rowsPerTopic);
  const line = opts.skipLine ? 0 : p.urlFetch;

  const inLock = entry.ms * nTopics + line + summary.ms;
  return {
    startup: p.startup,
    inLock,                                   // เวลาที่ "ถือล็อก" — คนอื่นรอตรงนี้
    total: p.startup + inLock,
    calls: entry.calls * nTopics + summary.calls + (opts.skipLine ? 0 : 1),
  };
}

/** doGet action=list (Code.gs:428) — อ่านทุกแท็บ ไม่ถือล็อก */
function costGetList(p, rowsPerTopic) {
  let t = p.startup;
  let calls = 0;
  for (let i = 0; i < TOPICS; i++) {
    t += p.call * (1 + SHEETS_IN_FILE + 1);          calls += 2 + SHEETS_IN_FILE;
    t += p.call;                                     calls += 1;
    t += bigRead(p, 1, COLS_PER_TOPIC);              calls += 1;
    t += p.call;                                     calls += 1;
    t += bigRead(p, rowsPerTopic, COLS_PER_TOPIC);   calls += 1;
  }
  // JSON.stringify + ส่งกลับ
  const bytes = rowsPerTopic * TOPICS * COLS_PER_TOPIC * 22;   // ไทยเฉลี่ย ~3 ไบต์/ตัว
  t += bytes / 1024 * 0.35;
  return { ms: t, calls, bytes };
}

module.exports = {
  PROFILES, TOPICS, TOTAL_ROOMS, COLS_PER_TOPIC, SUMMARY_ROWS,
  costPerEntry, costSummary, costPost, costGetList,
};
