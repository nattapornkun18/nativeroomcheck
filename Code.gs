/*  บันทึกตรวจซิลิโคนขอบอ่าง — Google Apps Script
 *  วางไฟล์นี้ใน Apps Script ที่ผูกกับ Google Sheet แล้ว Deploy เป็น Web App
 *  ตั้งค่า: Execute as = Me, Who has access = Anyone
 *
 *  สำคัญ: ทุกครั้งที่แก้ไฟล์นี้ ต้อง Deploy → Manage deployments → ไอคอนดินสอ
 *  → Version: New version → Deploy ไม่งั้นลิงก์ /exec จะยังเสิร์ฟโค้ดเวอร์ชันเก่า
 */

const SHEET_NAME = 'บันทึกตรวจ';   // ชื่อแท็บในชีต

const HEAD = ['วันที่ตรวจ','ชั้น','ห้อง','ขอบเขตงาน','สีที่ใช้','ระยะขอบ','ตัดขอบ',
              'ฟองอากาศ','กินผนัง','สภาพผนัง','เกรด','หมายเหตุ','ผู้ตรวจ','บันทึกเมื่อ'];

/* ตัวเลือกของแต่ละคอลัมน์ — ใช้ทั้งทำดรอปดาวน์ในชีต และส่งให้หน้าเว็บผ่าน ?action=options
 * ต้องตรงกับ OPTS / scopeOptions ใน index.html เป๊ะ ๆ */
const CHOICES = {
  'ขอบเขตงาน': ['ยิงครบทุกด้าน','ยิงขอบบนแค่ขอบบน (01&12)','ยิงด้านข้างมาด้วย',
                'ยิงไม่ครบสามด้าน','ยังไม่ได้ยิง','-'],
  'สีที่ใช้':   ['แมตช์','เงา','ยังไม่ได้ยิง','-'],
  'ระยะขอบ':   ['เท่ากันทุกด้าน','มีด้านใดด้านหนึ่งหนากว่าผิดปกติ','-'],
  'ตัดขอบ':    ['เรียบร้อย','เก็บไม่เรียบฝั่งซ้าย','เก็บไม่เรียบฝั่งขวา','เก็บไม่เรียบรอบด้าน','-'],
  'ฟองอากาศ':  ['ไม่พบ','มี 1 จุด','มีหลายจุด','-'],
  'กินผนัง':    ['ไม่พบ','ฝั่งซ้าย','ฝั่งขวา','สองฝั่ง','-'],
  'สภาพผนัง':  ['ปกติ','ถลอก - ต้องแตะสี','-'],
  'เกรด':      ['ผ่าน','เกือบผ่าน','ไม่ผ่าน','ไม่ได้ตรวจ']
};

/* คำเก่า → คำใหม่ ใช้ตอนแปลงข้อมูลที่บันทึกไว้ก่อนเปลี่ยนชื่อตัวเลือก */
const RENAMED = {
  'ครบสามด้าน':      'ยิงครบทุกด้าน',
  'ขอบบนอย่างเดียว': 'ยิงขอบบนแค่ขอบบน (01&12)'
};

const GRADE_COLOR = {
  'ผ่าน':       {bg:'#E2F0E9', fg:'#1B7A4B'},
  'เกือบผ่าน':  {bg:'#F7EEDC', fg:'#8A5D14'},
  'ไม่ผ่าน':     {bg:'#F7E2DF', fg:'#B23C31'},
  'ไม่ได้ตรวจ': {bg:'#E7ECEB', fg:'#6B7877'}
};

/* แจ้งเตือน LINE: 'fail' = เฉพาะห้องที่ไม่ผ่าน, 'all' = ทุกห้องที่บันทึก, 'off' = ปิด */
const LINE_NOTIFY_ON = 'fail';

/* =============== ส่วนกลาง =============== */

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('สคริปต์ไม่ได้ผูกกับชีต — ต้องเปิดจากเมนู ส่วนขยาย → Apps Script ในชีต');
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
  }
  return sh;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function colOf_(name) { return HEAD.indexOf(name) + 1; }

/* =============== Web App =============== */

/* อ่านข้อมูลทั้งหมด — ?action=options จะได้รายการตัวเลือกแทน */
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'list';
    if (action === 'options') return json_({ ok: true, choices: CHOICES });

    const sh = getSheet_();
    const values = sh.getDataRange().getValues();
    if (values.length < 2) return json_({ ok: true, rows: [] });

    const head = values[0].map(String);
    const roomCol = head.indexOf('ห้อง');
    const rows = values.slice(1)
      .filter(function (r) { return String(r[roomCol]).trim() !== ''; })   // ต้องมีเลขห้อง
      .map(function (r) {
        const o = {};
        head.forEach(function (h, i) { o[h] = r[i] === '' ? '' : String(r[i]); });
        return o;
      });

    return json_({ ok: true, rows: rows });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* เพิ่มบันทึกใหม่ 1 แถว */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json_({ ok: false, error: 'ชีตกำลังถูกเขียนอยู่ ลองใหม่อีกครั้ง' });
  }
  try {
    const sh = getSheet_();
    const p = (e && e.parameter) ? e.parameter : {};

    if (!p['ห้อง']) throw new Error('ไม่ได้ระบุเลขห้อง');

    if (!p['บันทึกเมื่อ']) {
      p['บันทึกเมื่อ'] = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm');
    }

    const row = HEAD.map(function (h) { return p[h] || ''; });
    sh.appendRow(row);
    paintGrade_(sh, sh.getLastRow());
    notifySave_(p);

    return json_({ ok: true, room: p['ห้อง'], grade: p['เกรด'] || '' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* =============== เมนูในชีต =============== */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ซิลิโคน')
    .addItem('ตั้งค่าชีต (ดรอปดาวน์ + สีเกรด + แปลงคำเก่า)', 'setupSheet')
    .addItem('แปลงคำเก่าให้ตรงกับหน้าเว็บ', 'migrateLabels')
    .addSeparator()
    .addItem('ทดสอบส่ง LINE', 'testLine')
    .addToUi();
}

/* ตั้งค่าชีตให้กรอกมือได้โดยไม่พิมพ์ผิด — รันซ้ำได้ไม่มีผลเสีย */
function setupSheet() {
  const sh = getSheet_();
  const rows = 2000;

  migrateLabels_(sh);
  sh.setFrozenRows(1);

  Object.keys(CHOICES).forEach(function (h) {
    const col = colOf_(h);
    if (col < 1) return;
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(CHOICES[h], true)
      .setAllowInvalid(false)
      .setHelpText('เลือกจากรายการเท่านั้น เพื่อให้ตรงกับหน้าเว็บ')
      .build();
    sh.getRange(2, col, rows, 1).setDataValidation(rule);
  });

  const gradeCol = colOf_('เกรด');
  const range = sh.getRange(2, gradeCol, rows, 1);
  const rules = Object.keys(GRADE_COLOR).map(function (g) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(g)
      .setBackground(GRADE_COLOR[g].bg)
      .setFontColor(GRADE_COLOR[g].fg)
      .setRanges([range])
      .build();
  });
  sh.setConditionalFormatRules(rules);

  SpreadsheetApp.getActive().toast('ตั้งค่าชีตเรียบร้อย', 'ซิลิโคน', 5);
}

/* แปลงค่าคำเก่าในคอลัมน์ขอบเขตงานให้เป็นคำใหม่ */
function migrateLabels() {
  const n = migrateLabels_(getSheet_());
  SpreadsheetApp.getActive().toast('แปลงแล้ว ' + n + ' ช่อง', 'ซิลิโคน', 5);
}

function migrateLabels_(sh) {
  const col = colOf_('ขอบเขตงาน');
  const last = sh.getLastRow();
  if (last < 2) return 0;

  const range = sh.getRange(2, col, last - 1, 1);
  const values = range.getValues();
  let changed = 0;
  const out = values.map(function (r) {
    const v = String(r[0]);
    if (RENAMED[v]) { changed++; return [RENAMED[v]]; }
    return [r[0]];
  });
  if (changed) range.setValues(out);
  return changed;
}

/* ระบายสีช่องเกรดของแถวที่เพิ่งเพิ่ม — แถวเก่าใช้ conditional format จาก setupSheet */
function paintGrade_(sh, row) {
  const c = GRADE_COLOR[String(sh.getRange(row, colOf_('เกรด')).getValue())];
  if (c) sh.getRange(row, colOf_('เกรด')).setBackground(c.bg).setFontColor(c.fg);
}

/* =============== แจ้งเตือน LINE =============== */
/*  ใช้ LINE Messaging API (LINE Notify ปิดบริการไปแล้วตั้งแต่ มี.ค. 2025)
 *  เก็บ token ไว้ใน Script Properties ไม่ฝังในไฟล์ เผื่อไฟล์นี้ถูกแชร์
 *  ตั้งค่าครั้งเดียว: แก้ค่าสองบรรทัดใน saveLineConfig() แล้วกดรันฟังก์ชันนั้น
 */

function saveLineConfig() {
  const TOKEN = 'วาง Channel access token ตรงนี้';
  const TO    = 'วาง User ID หรือ Group ID ตรงนี้';
  PropertiesService.getScriptProperties()
    .setProperties({ LINE_TOKEN: TOKEN, LINE_TO: TO });
}

function pushLine_(text) {
  const p = PropertiesService.getScriptProperties();
  const token = p.getProperty('LINE_TOKEN'), to = p.getProperty('LINE_TO');
  if (!token || !to) return false;   // ยังไม่ได้ตั้งค่า — ข้ามไปเงียบ ๆ

  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: text }] }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    console.error('LINE ส่งไม่สำเร็จ: ' + res.getContentText());
    return false;
  }
  return true;
}

function notifySave_(p) {
  if (LINE_NOTIFY_ON === 'off') return;
  const grade = p['เกรด'] || '';
  if (LINE_NOTIFY_ON === 'fail' && grade !== 'ไม่ผ่าน') return;

  const icon = grade === 'ผ่าน' ? '✅' : grade === 'ไม่ผ่าน' ? '❌' :
               grade === 'เกือบผ่าน' ? '⚠️' : '⬜';
  const lines = [
    icon + ' ห้อง ' + p['ห้อง'] + ' — ' + grade,
    'ขอบเขต: ' + (p['ขอบเขตงาน'] || '-'),
    'สี: ' + (p['สีที่ใช้'] || '-') + ' · ระยะขอบ: ' + (p['ระยะขอบ'] || '-'),
    'ตัดขอบ: ' + (p['ตัดขอบ'] || '-') + ' · ฟองอากาศ: ' + (p['ฟองอากาศ'] || '-'),
    'กินผนัง: ' + (p['กินผนัง'] || '-')
  ];
  if (p['หมายเหตุ']) lines.push('หมายเหตุ: ' + p['หมายเหตุ']);
  if (p['ผู้ตรวจ'])  lines.push('ผู้ตรวจ: ' + p['ผู้ตรวจ']);
  pushLine_(lines.join('\n'));
}

/* สรุปประจำวัน — ผูกกับ Trigger แบบ Time-driven ถ้าอยากให้ส่งทุกเย็น */
function dailySummary() {
  const sh = getSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return;

  const head = values[0].map(String);
  const iDate = head.indexOf('วันที่ตรวจ'), iRoom = head.indexOf('ห้อง'), iGrade = head.indexOf('เกรด');
  const today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');

  const cnt = {'ผ่าน':0,'เกือบผ่าน':0,'ไม่ผ่าน':0,'ไม่ได้ตรวจ':0};
  const failed = [];
  values.slice(1).forEach(function (r) {
    if (String(r[iDate]).indexOf(today) !== 0) return;
    const g = String(r[iGrade]);
    if (cnt[g] !== undefined) cnt[g]++;
    if (g === 'ไม่ผ่าน') failed.push(String(r[iRoom]));
  });

  const total = cnt['ผ่าน'] + cnt['เกือบผ่าน'] + cnt['ไม่ผ่าน'] + cnt['ไม่ได้ตรวจ'];
  if (!total) return;   // วันนี้ไม่มีบันทึก ไม่ต้องส่ง

  const msg = ['📋 สรุปตรวจซิลิโคน ' + today,
    'ตรวจไป ' + total + ' ห้อง',
    '✅ ผ่าน ' + cnt['ผ่าน'] + ' · ⚠️ เกือบผ่าน ' + cnt['เกือบผ่าน'],
    '❌ ไม่ผ่าน ' + cnt['ไม่ผ่าน'] + ' · ⬜ ไม่ได้ตรวจ ' + cnt['ไม่ได้ตรวจ']];
  if (failed.length) msg.push('ห้องที่ต้องแก้: ' + failed.join(', '));
  pushLine_(msg.join('\n'));
}

function testLine() {
  const ok = pushLine_('ทดสอบจากชีตบันทึกตรวจซิลิโคน — เชื่อมต่อสำเร็จ');
  SpreadsheetApp.getActive().toast(
    ok ? 'ส่งแล้ว ไปเช็คในไลน์' : 'ส่งไม่สำเร็จ — ยังไม่ได้ตั้งค่า token หรือ token ผิด',
    'ซิลิโคน', 6);
}
