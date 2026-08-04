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

/* ==================== แจ้งเตือนเข้า LINE ====================
   ตั้งค่าครั้งเดียว (วิธีทำอยู่ใน SETUP.md หัวข้อ "แจ้งเตือนเข้า LINE")
   เว้น LINE_TOKEN ว่างไว้ = ไม่ส่งแจ้งเตือน ระบบอื่นทำงานปกติทุกอย่าง       */

/** Channel access token (long-lived) จาก LINE Developers
 *  วางเฉพาะในหน้าต่าง Apps Script เท่านั้น อย่า commit ขึ้น GitHub
 *  ถ้าเว้นว่าง จะไปอ่านจาก Script Properties ชื่อ LINE_TOKEN ให้แทน */
var LINE_TOKEN = '';

/** เว้นว่าง = ส่งหาทุกคนที่เป็นเพื่อนกับ LINE OA นี้ (broadcast)
 *  ใส่ userId / groupId ถ้าอยากส่งเจาะจงคนเดียวหรือกลุ่มเดียว */
var LINE_TO = '';

/** จะแจ้งตอนไหน
 *  'all'    = ทุกครั้งที่กดบันทึก — ตรวจครั้งแรกก็แจ้ง แก้ไขก็แจ้งพร้อมบอกที่เปลี่ยน ← ค่าเริ่มต้น
 *  'update' = เฉพาะตอนแก้ไขห้องที่เคยบันทึกไว้แล้ว และมีอะไรเปลี่ยนจริง
 *  'defect' = เฉพาะห้องที่ผลออกมามีปัญหา (ไม่ผ่าน / เกือบผ่าน)
 *  'off'    = ไม่แจ้งเลย
 *  ทุกโหมด: บันทึกทับด้วยค่าเดิมเป๊ะ ๆ จะไม่ส่ง กันข้อความกวน */
var NOTIFY_WHEN = 'all';

/* ช่องที่ถือว่าเป็น "ผลตรวจ" ใช้เทียบว่าการบันทึกซ้ำมีอะไรเปลี่ยนไหม
   ไม่รวมวันที่ ผู้ตรวจ และเวลาบันทึก เพราะเปลี่ยนทุกครั้งอยู่แล้ว */
const COMPARE = ['ขอบเขตงาน','สีที่ใช้','ระยะขอบ','ตัดขอบ','ฟองอากาศ',
                 'กินผนัง','สภาพผนัง','เกรด','หมายเหตุ'];

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

    const prev = findLatest_(sh, p['ห้อง']);   // ต้องหาก่อนเขียนแถวใหม่

    const row = HEAD.map(function (h) { return p[h] || ''; });
    sh.appendRow(row);
    paintGrade_(sh, sh.getLastRow());
    notifySave_(p, prev);

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
    .addItem('ทดสอบส่งแจ้งเตือน LINE', 'testLine')
    .addItem('ตรวจสภาพการแจ้งเตือน LINE', 'checkLine')
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
 *  ตั้งค่า token / ปลายทาง / โหมด ได้ที่บล็อกตัวแปรด้านบนสุดของไฟล์
 */

/* หา token จากตัวแปรด้านบนก่อน ถ้าเว้นว่างค่อยไปดู Script Properties
   (วิธีหลังปลอดภัยกว่าตอนต้องเอาไฟล์นี้ไปแชร์ที่อื่น) */
function lineToken_() {
  return LINE_TOKEN || PropertiesService.getScriptProperties().getProperty('LINE_TOKEN') || '';
}
function lineTo_() {
  return LINE_TO || PropertiesService.getScriptProperties().getProperty('LINE_TO') || '';
}

function pushLine_(text) {
  const token = lineToken_();
  if (!token) return false;   // ยังไม่ได้ตั้งค่า — ข้ามไปเงียบ ๆ

  const to = lineTo_();
  const url = to ? 'https://api.line.me/v2/bot/message/push'
                 : 'https://api.line.me/v2/bot/message/broadcast';
  const body = { messages: [{ type: 'text', text: text }] };
  if (to) body.to = to;

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    console.error('LINE ส่งไม่สำเร็จ: ' + res.getContentText());
    return false;
  }
  return true;
}

/* หาบันทึกล่าสุดของห้องนี้ ไล่จากแถวท้ายขึ้นมา — ไม่เจอคืน null */
function findLatest_(sh, room) {
  const last = sh.getLastRow();
  if (last < 2) return null;

  const key = String(room).trim();
  const values = sh.getRange(2, 1, last - 1, HEAD.length).getValues();
  const iRoom = HEAD.indexOf('ห้อง');
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][iRoom]).trim() !== key) continue;
    const o = {};
    HEAD.forEach(function (h, j) { o[h] = values[i][j] === '' ? '' : String(values[i][j]); });
    return o;
  }
  return null;
}

/* ช่องไหนเปลี่ยนไปบ้างระหว่างบันทึกเก่ากับใหม่ */
function diff_(prev, cur) {
  return COMPARE.filter(function (h) {
    return String(prev[h] || '') !== String(cur[h] || '');
  }).map(function (h) {
    return { field: h, from: prev[h] || '-', to: cur[h] || '-' };
  });
}

const GRADE_ICON = {'ผ่าน':'✅','เกือบผ่าน':'⚠️','ไม่ผ่าน':'❌','ไม่ได้ตรวจ':'⬜'};

function notifySave_(p, prev) {
  if (NOTIFY_WHEN === 'off') return;

  const grade = p['เกรด'] || '';
  const changes = prev ? diff_(prev, p) : null;

  /* บันทึกทับด้วยค่าเดิมเป๊ะ ๆ — ไม่ต้องกวน */
  if (changes && !changes.length) return;

  if (NOTIFY_WHEN === 'update' && !prev) return;
  if (NOTIFY_WHEN === 'defect' && grade !== 'ไม่ผ่าน' && grade !== 'เกือบผ่าน') return;

  const icon = GRADE_ICON[grade] || '⬜';
  let lines;

  if (changes) {
    lines = ['🔁 ห้อง ' + p['ห้อง'] + ' — แก้ไขผลตรวจ'];
    const g = changes.filter(function (c) { return c.field === 'เกรด'; })[0];
    lines.push(g ? (GRADE_ICON[g.from] || '⬜') + ' ' + g.from + '  →  ' + icon + ' ' + g.to
                 : icon + ' เกรดยังเป็น ' + grade);
    changes.filter(function (c) { return c.field !== 'เกรด'; })
      .forEach(function (c) { lines.push('• ' + c.field + ': ' + c.from + ' → ' + c.to); });
  } else {
    lines = [icon + ' ห้อง ' + p['ห้อง'] + ' — ' + grade,
      'ขอบเขต: ' + (p['ขอบเขตงาน'] || '-'),
      'สี: ' + (p['สีที่ใช้'] || '-') + ' · ระยะขอบ: ' + (p['ระยะขอบ'] || '-'),
      'ตัดขอบ: ' + (p['ตัดขอบ'] || '-') + ' · ฟองอากาศ: ' + (p['ฟองอากาศ'] || '-'),
      'กินผนัง: ' + (p['กินผนัง'] || '-')];
    if (p['หมายเหตุ']) lines.push('หมายเหตุ: ' + p['หมายเหตุ']);
  }

  if (p['ผู้ตรวจ']) lines.push('ผู้ตรวจ: ' + p['ผู้ตรวจ']);
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

/* ตรวจสภาพการแจ้งเตือน — บอกว่าติดตรงไหนโดยไม่ต้องส่งข้อความจริง */
function checkLine() {
  const ui = SpreadsheetApp.getUi();
  const title = 'ตรวจสภาพ LINE';
  const token = lineToken_();

  if (!token) {
    ui.alert(title, '❌ ยังไม่ได้ใส่ LINE_TOKEN\n\n' +
      'เปิดไฟล์ Code.gs แล้ววาง Channel access token ที่บรรทัด\n' +
      "var LINE_TOKEN = '';\n\nวิธีเอา token ดูใน SETUP.md หัวข้อ “แจ้งเตือนเข้า LINE”",
      ui.ButtonSet.OK);
    return;
  }

  const api = function (path) {
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/' + path,
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    let body = {};
    try { body = JSON.parse(res.getContentText()); } catch (e) {}
    return { code: res.getResponseCode(), body: body, text: res.getContentText() };
  };

  const out = [];
  const info = api('info');

  if (info.code === 401) {
    ui.alert(title, '❌ token ใช้ไม่ได้ (HTTP 401)\n\n' +
      'มักเกิดจากกด Revoke ไปแล้ว หรือคัดลอกมาไม่ครบ\n' +
      'ไปที่ LINE Developers → แท็บ Messaging API → Issue token ใหม่ แล้ววางทับ',
      ui.ButtonSet.OK);
    return;
  }
  if (info.code !== 200) {
    ui.alert(title, '❌ ต่อกับ LINE ไม่ได้ (HTTP ' + info.code + ')\n\n' + info.text, ui.ButtonSet.OK);
    return;
  }

  out.push('✅ token ใช้ได้');
  out.push('บัญชี: ' + (info.body.displayName || '-') +
           (info.body.basicId ? '  ' + info.body.basicId : ''));

  /* โควตาข้อความเดือนนี้ */
  const quota = api('message/quota'), used = api('message/quota/consumption');
  if (quota.code === 200 && used.code === 200) {
    out.push('โควตาเดือนนี้: ใช้ไป ' + (used.body.totalUsage || 0) + ' / ' +
      (quota.body.type === 'limited' ? quota.body.value : 'ไม่จำกัด'));
  }

  /* จำนวนเพื่อน — บัญชีที่ยังไม่รับรองจะโดน 403 ตรงนี้ ไม่ใช่ความผิดพลาด */
  const day = Utilities.formatDate(new Date(Date.now() - 864e5), 'Asia/Bangkok', 'yyyyMMdd');
  const fr = api('insight/followers?date=' + day);
  if (fr.code === 200 && fr.body.followers !== undefined) {
    out.push('จำนวนเพื่อน: ' + fr.body.followers + ' คน');
    if (!fr.body.followers) out.push('   ⚠️ ยังไม่มีใครแอด OA นี้ ข้อความจะไม่ถึงใคร');
  } else {
    out.push('เช็คจำนวนเพื่อนไม่ได้ (HTTP ' + fr.code + ' — บัญชีที่ยังไม่รับรองเช็คไม่ได้)');
    out.push('ให้เช็คเองว่าสแกน QR เพิ่ม OA เป็นเพื่อนแล้วหรือยัง');
  }

  out.push('');
  out.push('โหมดแจ้งเตือน: ' + NOTIFY_WHEN + ' — ' + ({
    all:    'แจ้งทุกครั้งที่บันทึก',
    update: 'แจ้งเฉพาะตอนแก้ไขห้องที่เคยบันทึก',
    defect: 'แจ้งเฉพาะห้องที่ไม่ผ่าน/เกือบผ่าน',
    off:    'ปิดแจ้งเตือน'
  }[NOTIFY_WHEN] || 'ค่าไม่ถูกต้อง จะไม่แจ้งเลย'));

  const to = lineTo_();
  out.push('ปลายทาง: ' + (to ? to.slice(0, 8) + '… (ส่งเจาะจง)'
                             : 'broadcast — ส่งหาเพื่อนของ OA ทุกคน'));

  /* ชีตพร้อมรับข้อมูลไหม */
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  out.push('แท็บ "' + SHEET_NAME + '": ' +
    (sh ? 'พบแล้ว มี ' + Math.max(0, sh.getLastRow() - 1) + ' แถว' : '❌ ไม่พบ'));

  out.push('');
  out.push('ถ้าทุกอย่างข้างบนเขียว แต่กดบันทึกในแอปแล้วไม่มีข้อความ');
  out.push('= ยังไม่ได้ Deploy เวอร์ชันใหม่');
  out.push('   (Deploy → Manage deployments → ✏️ → New version)');

  ui.alert(title, out.join('\n'), ui.ButtonSet.OK);
}

function testLine() {
  if (!lineToken_()) {
    SpreadsheetApp.getActive().toast('ยังไม่ได้ใส่ LINE_TOKEN ในไฟล์ Code.gs', 'ซิลิโคน', 6);
    return;
  }
  const ok = pushLine_('ทดสอบจากชีตบันทึกตรวจซิลิโคน — เชื่อมต่อสำเร็จ' +
    (lineTo_() ? '' : ' (โหมด broadcast ส่งหาเพื่อนของ OA ทุกคน)'));
  SpreadsheetApp.getActive().toast(
    ok ? 'ส่งแล้ว ไปเช็คในไลน์' : 'ส่งไม่สำเร็จ — เปิด Executions ดู log ว่า LINE ตอบว่าอะไร',
    'ซิลิโคน', 6);
}
