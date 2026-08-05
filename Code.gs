/*  ระบบเช็คห้องรวมหมวด — Google Apps Script
 *  ชีตเดียว สคริปต์เดียว รับได้ทุกหมวด (ม่าน · ซิลิโคน · หมวดใหม่ในอนาคต)
 *  แต่ละหมวดเก็บในแท็บของตัวเอง แต่ใช้ Web App ตัวเดียวกัน
 *
 *  วางไฟล์นี้ใน Apps Script ที่ผูกกับ Google Sheet แล้ว Deploy เป็น Web App
 *  ตั้งค่า: Execute as = Me, Who has access = Anyone
 *
 *  สำคัญ: ทุกครั้งที่แก้ไฟล์นี้ ต้อง Deploy → Manage deployments → ไอคอนดินสอ
 *  → Version: New version → Deploy ไม่งั้นลิงก์ /exec จะยังเสิร์ฟโค้ดเวอร์ชันเก่า
 *
 *  เพิ่มหมวดใหม่: เพิ่มก้อนใน TOPICS ข้างล่างนี้ก้อนหนึ่ง แล้วเพิ่มก้อนที่หน้าตา
 *  เหมือนกันใน index.html (ตัวแปร TOPICS เหมือนกัน) — ชื่อคอลัมน์ต้องตรงกันเป๊ะ
 */

const TZ = 'Asia/Bangkok';

/** รหัสผ่าน — เว้นว่าง = ใครเปิดลิงก์ก็ใช้ได้
 *  ถ้าใส่ไว้ หน้าเว็บจะขึ้นหน้าล็อกให้กรอกก่อนถึงจะอ่าน/เขียนชีตได้ */
var TOKEN = '';

/* คอลัมน์ที่ทุกหมวดมีเหมือนกัน — ซ้ายสุดกับขวาสุดของตาราง */
const HEAD_LEFT  = ['วันที่ตรวจ', 'ชั้น', 'ห้อง'];
const HEAD_RIGHT = ['หมายเหตุ', 'ผู้ตรวจ', 'บันทึกเมื่อ'];

const ACCESS = 'การเข้าห้อง';
const ACCESS_CHOICES = ['เข้าตรวจได้', 'ไม่มีกุญแจ', 'มีแขกพัก', 'ห้องปิดปรับปรุง'];

/* จำนวนห้องทั้งหมด ใช้คิด % ในหน้าสรุป — ต้องตรงกับที่ตั้งไว้ใน index.html */
const FLOOR_FROM = 3, FLOOR_TO = 20, ROOMS_PER_FLOOR = 12;
/** แท็บสรุป — ตั้งชื่อไม่ให้ชนกับแท็บ "สรุป" เดิมที่ทำไว้เอง */
const SUMMARY_SHEET = 'summary';
const SUMMARY_LEGACY = ['สรุปรวม'];

const GRADES = ['ผ่าน', 'เกือบผ่าน', 'ไม่ผ่าน', 'ไม่ได้ตรวจ'];
const GRADE_ICON  = {'ผ่าน':'✅', 'เกือบผ่าน':'⚠️', 'ไม่ผ่าน':'❌', 'ไม่ได้ตรวจ':'⬜'};
const GRADE_COLOR = {
  'ผ่าน':       {bg:'#E2F0E9', fg:'#1B7A4B'},
  'เกือบผ่าน':  {bg:'#F7EEDC', fg:'#8A5D14'},
  'ไม่ผ่าน':     {bg:'#F7E2DF', fg:'#B23C31'},
  'ไม่ได้ตรวจ': {bg:'#E7ECEB', fg:'#6B7877'}
};

/* ==================== หมวดที่เปิดใช้ ====================
 *  cols     = คอลัมน์กลางตาราง เรียงตามที่อยากให้ขึ้นในชีต
 *  grade    = ชื่อคอลัมน์ที่เก็บผลตัดเกรด
 *  choices  = ตัวเลือกของคอลัมน์นั้น (ใช้ทำดรอปดาวน์ในชีต + เทียบว่าค่าไหนคือค่าปกติ)
 *             ตัวแรกของรายการ = ค่าปกติ ที่เหลือถือว่าเป็นข้อบกพร่อง
 *  good     = ระบุค่าปกติเองเมื่อค่าปกติมีมากกว่าหนึ่งค่า
 *  auto     = คอลัมน์ที่หน้าเว็บเติมให้เอง ไม่ใช่ตัวเลือกให้กด
 */
const TOPICS = {

  curtain: {
    name: 'ม่าน', en: 'Curtain', icon: '🪟',
    sheet: 'curtainsheer',
    legacy: ['บันทึกม่าน'],
    grade: 'ผลตรวจ',
    auto: ['Room type', 'แบรนด์'],
    cols: ['Room type', 'แบรนด์',
           'ปิดม่านโปร่ง', 'ปิดม่านทึบ', 'เปิดม่านโปร่ง', 'เปิดม่านทึบ',
           'สวิตช์ม่านโปร่ง', 'สวิตช์ม่านทึบ', 'มือดึงม่านโปร่ง', 'มือดึงม่านทึบ',
           'เสียงม่านโปร่ง', 'เสียงม่านทึบ', 'เดินลื่นทั้งระบบ',
           ACCESS, 'ผลตรวจ'],
    choices: {
      'แบรนด์':          ['Dooya', 'Smart curtain'],
      'ปิดม่านโปร่ง':    ['ปิดสุด', 'ปิดเหลือระยะนิดหน่อย', 'ปิดไม่ได้ เหลือครึ่งทาง'],
      'ปิดม่านทึบ':      ['ปิดสุด', 'ปิดเหลือระยะนิดหน่อย', 'ปิดไม่ได้ เหลือครึ่งทาง'],
      'เปิดม่านโปร่ง':   ['เปิดสุด', 'เปิดไม่สุด'],
      'เปิดม่านทึบ':     ['เปิดสุด', 'เปิดไม่สุด'],
      'สวิตช์ม่านโปร่ง': ['ปกติ', 'กดแล้วไม่ทำงาน'],
      'สวิตช์ม่านทึบ':   ['ปกติ', 'กดแล้วไม่ทำงาน'],
      'มือดึงม่านโปร่ง': ['ปกติ', 'ดึงแล้วไม่ทำงาน'],
      'มือดึงม่านทึบ':   ['ปกติ', 'ดึงแล้วไม่ทำงาน'],
      'เสียงม่านโปร่ง':  ['ปกติ', 'ดัง'],
      'เสียงม่านทึบ':    ['ปกติ', 'ดัง'],
      'เดินลื่นทั้งระบบ': ['ลื่น ไม่สะดุด', 'สะดุด/ฝืด']
    },
    warn: ['ปิดเหลือระยะนิดหน่อย', 'ดัง']
  },

  silicone: {
    name: 'ซิลิโคนขอบอ่าง', en: 'Silicone', icon: '🧴',
    sheet: 'silicone',
    legacy: ['บันทึกตรวจ'],   /* ชื่อเดิม — ข้อมูลที่เคยบันทึกไว้ถูกย้ายตามมาให้ */
    grade: 'เกรด',
    auto: [],
    cols: ['ขอบเขตงาน', 'สีที่ใช้', 'ระยะขอบ', 'ตัดขอบ', 'ฟองอากาศ',
           'กินผนัง', 'สภาพผนัง', ACCESS, 'เกรด'],
    choices: {
      'ขอบเขตงาน': ['ยิงครบทุกด้าน', 'ยิงขอบบนแค่ขอบบน (01&12)',
                    'ยิงด้านข้างมาด้วย', 'ยิงไม่ครบสามด้าน', 'ยังไม่ได้ยิง'],
      'สีที่ใช้':   ['แมตช์', 'เงา', 'ยังไม่ได้ยิง'],
      'ระยะขอบ':   ['เท่ากันทุกด้าน', 'มีด้านใดด้านหนึ่งหนากว่าผิดปกติ'],
      'ตัดขอบ':    ['เรียบร้อย', 'เก็บไม่เรียบฝั่งซ้าย', 'เก็บไม่เรียบฝั่งขวา', 'เก็บไม่เรียบรอบด้าน'],
      'ฟองอากาศ':  ['ไม่พบ', 'มี 1 จุด', 'มีหลายจุด'],
      'กินผนัง':    ['ไม่พบ', 'ฝั่งซ้าย', 'ฝั่งขวา', 'สองฝั่ง'],
      'สภาพผนัง':  ['ปกติ', 'ถลอก - ต้องแตะสี']
    },
    /* ห้อง 01/12 ยิงแค่ขอบบนถือว่าปกติเหมือนกัน จึงมีค่าปกติสองค่า */
    good: { 'ขอบเขตงาน': ['ยิงครบทุกด้าน', 'ยิงขอบบนแค่ขอบบน (01&12)'] },
    warn: ['มี 1 จุด', 'มีหลายจุด', 'ถลอก - ต้องแตะสี']
  },

  comfort: {
    name: 'น้ำร้อน & แอร์', en: 'Hot water & Aircon', icon: '🌡️',
    sheet: 'HW and A/C',
    legacy: ['บันทึกน้ำร้อนแอร์'],
    grade: 'ผลตรวจ',
    auto: [],
    cols: ['เวลาน้ำร้อน (วินาที)', 'อุณหภูมิน้ำที่วัดได้ (°C)',
           'อุณหภูมิที่ตั้งแอร์ (°C)', 'เวลาแอร์เย็น (นาที)', 'อุณหภูมิห้องที่วัดได้ (°C)',
           ACCESS, 'ผลตรวจ'],
    /* คอลัมน์เวลา/อุณหภูมิเป็นตัวเลข ไม่มีดรอปดาวน์ — เกณฑ์ตัดเกรดอยู่ที่หน้าเว็บ */
    choices: {},
    num: {
      'เวลาน้ำร้อน (วินาที)':      { ok: 30, warn: 60 },
      'เวลาแอร์เย็น (นาที)':        { ok: 15, warn: 30 },
      'อุณหภูมิน้ำที่วัดได้ (°C)':  { min: 40, max: 45, warnMin: 38, warnMax: 48 },
      'อุณหภูมิที่ตั้งแอร์ (°C)':   { min: 23, max: 25, warnMin: 22, warnMax: 26 }
    }
  },

  doorlight: {
    name: 'แสงรอบประตู', en: 'Door light leak', icon: '🚪',
    sheet: 'door',
    legacy: ['บันทึกแสงรอบประตู'],
    grade: 'ผลตรวจ',
    auto: ['บานประตู'],
    cols: ['บานประตู', 'แสงเล็ดลอด', 'จุดที่มีแสง', 'จำนวนจุดที่มีแสง', ACCESS, 'ผลตรวจ'],
    choices: {
      'บานประตู':   ['มือจับซ้าย', 'มือจับขวา'],
      'แสงเล็ดลอด': ['ไม่มีแสงเล็ดลอด', 'มีแสงเล็ดลอด']
    },
    good: { 'บานประตู': ['มือจับซ้าย', 'มือจับขวา'] },   /* เป็นข้อมูลห้อง ไม่ใช่ข้อบกพร่อง */
    warn: ['มีแสงเล็ดลอด'],
    num: { 'จำนวนจุดที่มีแสง': { ok: 0, warn: 2 } }
  }

};

/* คำเก่า → คำใหม่ ใช้ตอนแปลงข้อมูลที่บันทึกไว้ก่อนเปลี่ยนชื่อตัวเลือก */
const RENAMED = {
  'ครบสามด้าน':      'ยิงครบทุกด้าน',
  'ขอบบนอย่างเดียว': 'ยิงขอบบนแค่ขอบบน (01&12)',
  'PASS':            'ผ่าน',
  'DEFECT':          'ไม่ผ่าน'
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

/** หัวข้อความ ใช้แยกว่าข้อความมาจากระบบไหน เว้นว่าง = ไม่ขึ้นหัว */
var APP_TAG = '[เช็คห้อง]';

/** จะแจ้งตอนไหน — นับเป็น "หนึ่งครั้งที่กดบันทึก" = "หนึ่งข้อความ" เสมอ
 *  กดบันทึกรอบเดียวแต่อัปเดตหลายหมวด ก็รวมอยู่ในข้อความเดียว
 *  'all'    = ทุกครั้งที่กดบันทึก ทั้งตรวจครั้งแรกและตอนแก้ไข  ← ค่าเริ่มต้น
 *  'change' = เฉพาะรอบที่มีค่าเปลี่ยนจริง (กดทับด้วยค่าเดิมเป๊ะ ๆ จะเงียบ)
 *  'defect' = เฉพาะรอบที่มีหมวดไหนสักหมวดออกมาไม่ผ่าน/เกือบผ่าน
 *  'off'    = ไม่แจ้งเลย */
var NOTIFY_WHEN = 'all';

/* =============== ส่วนกลาง =============== */

function topic_(id) {
  const t = TOPICS[id];
  if (!t) throw new Error('ไม่รู้จักหมวด "' + id + '"');
  return t;
}

/** คอลัมน์ทั้งหมดของหมวดนี้ เรียงตามที่อยากให้ขึ้นในชีต */
function headOfTopic_(t) {
  return HEAD_LEFT.concat(t.cols, HEAD_RIGHT);
}

/** คอลัมน์ที่ถือว่าเป็น "ผลตรวจ" ใช้เทียบว่าบันทึกซ้ำมีอะไรเปลี่ยนไหม
    ไม่รวมวันที่ ผู้ตรวจ และเวลาบันทึก เพราะเปลี่ยนทุกครั้งอยู่แล้ว */
function compareCols_(t) {
  return t.cols.concat(['หมายเหตุ']);
}

/** ค่าที่ถือว่าปกติของคอลัมน์นั้น — ไม่ระบุใน good ก็ใช้ตัวแรกของ choices */
function goodOf_(t, col) {
  if (t.good && t.good[col]) return t.good[col];
  if (col === ACCESS) return [ACCESS_CHOICES[0]];
  const c = t.choices && t.choices[col];
  return c ? [c[0]] : [];
}

function isGood_(t, col, v) {
  const g = goodOf_(t, col);
  if (!g.length) return true;                 // คอลัมน์ที่ไม่มีตัวเลือก ไม่ตัดสิน
  const s = String(v || '');
  return s === '' || s === '-' || g.indexOf(s) !== -1;
}

/** หาแท็บของหมวดนี้ — ถ้ายังไม่มีชื่อใหม่แต่มีชื่อเดิมอยู่ ให้เปลี่ยนชื่อแท็บเดิม
 *  ไม่ใช่สร้างแท็บเปล่าใหม่ ข้อมูลกับรูปแบบที่บันทึกไว้แล้วจะได้ตามมาด้วย */
function renameOrCreate_(ss, name, legacy) {
  let sh = ss.getSheetByName(name);
  if (sh) return sh;
  (legacy || []).forEach(function (old) {
    if (sh) return;
    const o = ss.getSheetByName(old);
    if (o) { o.setName(name); sh = o; }
  });
  return sh || ss.insertSheet(name);
}

function sheetOf_(t) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('สคริปต์ไม่ได้ผูกกับชีต — ต้องเปิดจากเมนู ส่วนขยาย → Apps Script ในชีต');
  return renameOrCreate_(ss, t.sheet, t.legacy);
}

/** หัวตารางจริงของแท็บนี้ — แท็บเก่าที่ยังไม่มีคอลัมน์ใหม่จะได้คอลัมน์ต่อท้ายให้
    (ต่อท้ายอย่างเดียว ไม่แทรกกลาง ข้อมูลและสูตรเดิมจึงไม่เลื่อน) */
function headOfSheet_(sh, t) {
  const want = headOfTopic_(t);
  const lastCol = sh.getLastColumn();
  let head = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) {
    return String(v).trim();
  }) : [];
  while (head.length && head[head.length - 1] === '') head.pop();

  if (!head.length) {
    sh.getRange(1, 1, 1, want.length).setValues([want]);
    styleSheet_(t, sh, want);      /* แท็บใหม่ได้หน้าตาเหมือนแท็บอื่นตั้งแต่แรก
                                      ไม่ต้องรอให้ไปกดเมนูตั้งค่าชีต */
    return want.slice();
  }
  const missing = want.filter(function (h) { return head.indexOf(h) === -1; });
  if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
    head = head.concat(missing);
  }
  return head;
}

function getSheet_(id) {
  const t = topic_(id);
  const sh = sheetOf_(t);
  headOfSheet_(sh, t);
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** ค่าที่อ่านจากชีตอาจกลับมาเป็น Date — ส่งให้หน้าเว็บเป็นข้อความที่อ่านออกเสมอ */
function cellText_(v, col) {
  if (v === '' || v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return col === 'บันทึกเมื่อ'
      ? Utilities.formatDate(v, TZ, 'dd/MM/yyyy HH:mm')
      : Utilities.formatDate(v, TZ, 'dd/MM/yyyy');
  }
  return String(v);
}

function rowsOf_(id) {
  const t = topic_(id);
  const sh = sheetOf_(t);
  const head = headOfSheet_(sh, t);
  const last = sh.getLastRow();
  if (last < 2) return [];

  const iRoom = head.indexOf('ห้อง');
  const values = sh.getRange(2, 1, last - 1, head.length).getValues();
  return values
    .filter(function (r) { return String(r[iRoom]).trim() !== ''; })
    .map(function (r) {
      const o = {};
      head.forEach(function (h, i) { o[h] = cellText_(r[i], h); });
      return o;
    });
}

/* =============== Web App =============== */

function authed_(p) {
  return !TOKEN || String((p && p.token) || '') === String(TOKEN);
}

/**  GET
 *   ?action=ping                 → เช็คว่าเชื่อมได้ไหม และต้องใส่รหัสหรือเปล่า
 *   ?action=verify&token=xxx     → เช็ครหัสผ่าน
 *   ?action=config               → รายชื่อหมวดกับตัวเลือกทั้งหมด
 *   ?action=list                 → ข้อมูลทุกหมวด { curtain:[...], silicone:[...] }
 *   ?action=list&topic=curtain   → ข้อมูลหมวดเดียว
 */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const action = p.action || 'list';

    if (action === 'ping') {
      return json_({ ok: true, locked: !!TOKEN, topics: Object.keys(TOPICS) });
    }
    if (!authed_(p)) return json_({ ok: false, error: 'unauthorized' });
    if (action === 'verify') return json_({ ok: true });

    if (action === 'config') {
      const out = {};
      Object.keys(TOPICS).forEach(function (id) {
        const t = TOPICS[id];
        out[id] = { name: t.name, sheet: t.sheet, head: headOfTopic_(t),
                    grade: t.grade, choices: t.choices, access: ACCESS_CHOICES };
      });
      return json_({ ok: true, topics: out });
    }

    if (action === 'list') {
      if (p.topic) return json_({ ok: true, topic: p.topic, rows: rowsOf_(p.topic) });
      const data = {};
      Object.keys(TOPICS).forEach(function (id) { data[id] = rowsOf_(id); });
      return json_({ ok: true, data: data });
    }

    return json_({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/**  POST — หนึ่งครั้งที่กดบันทึก = หนึ่ง request = หนึ่งข้อความแจ้งเตือน
 *   body เป็น JSON (ส่งมาแบบ text/plain เพื่อเลี่ยง CORS preflight):
 *   {
 *     token, inspector, date: "yyyy-MM-dd",
 *     entries: [ { topic, room, floor, values:{ "ชื่อคอลัมน์": "ค่า" }, note } ]
 *   }
 *   ยังรับแบบเก่า (form-urlencoded หนึ่งแถวของหมวดซิลิโคน) ได้เหมือนเดิม
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return json_({ ok: false, error: 'ชีตกำลังถูกเขียนอยู่ ลองใหม่อีกครั้ง' });
  }
  try {
    const body = parseBody_(e);
    if (!authed_(body)) return json_({ ok: false, error: 'unauthorized' });

    const entries = body.entries || [];
    if (!entries.length) throw new Error('ไม่มีรายการให้บันทึก');

    const stamp = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
    const saved = [];

    entries.forEach(function (en) {
      const t = topic_(en.topic);
      const sh = sheetOf_(t);
      const head = headOfSheet_(sh, t);
      const room = String(en.room || '').trim();
      if (!room) throw new Error('ไม่ได้ระบุเลขห้อง');

      const prev = findLatest_(sh, head, room);
      const rec = {};
      head.forEach(function (h) { rec[h] = ''; });

      Object.keys(en.values || {}).forEach(function (k) {
        if (head.indexOf(k) !== -1) rec[k] = String(en.values[k]);
      });
      rec['ชั้น']       = String(en.floor || room.slice(0, -2));
      rec['ห้อง']       = room;
      rec['หมายเหตุ']   = String(en.note || '');
      rec['ผู้ตรวจ']    = String(body.inspector || '');
      rec['บันทึกเมื่อ'] = stamp;

      const rowIndex = appendRow_(sh, head, rec, body.date);
      rec['วันที่ตรวจ'] = cellText_(sh.getRange(rowIndex, head.indexOf('วันที่ตรวจ') + 1).getValue(),
                                   'วันที่ตรวจ');

      saved.push({ topic: en.topic, t: t, room: room, rec: rec, prev: prev,
                   defects: en.defects || null,
                   changes: prev ? diff_(t, prev, rec) : null });
    });

    notifySave_(saved, body);
    try { buildSummary_(); } catch (err) { console.error('อัปเดตหน้าสรุปไม่สำเร็จ: ' + err); }

    return json_({ ok: true, saved: saved.map(function (s) {
      return { topic: s.topic, room: s.room, grade: s.rec[s.t.grade] || '' };
    }) });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** รับได้ทั้ง JSON แบบใหม่ และ form-urlencoded แบบเก่าของหน้าเว็บซิลิโคนรุ่นก่อน */
function parseBody_(e) {
  const raw = e && e.postData && e.postData.contents;
  if (raw) {
    try {
      const j = JSON.parse(raw);
      if (j && j.entries) return j;
    } catch (err) { /* ไม่ใช่ JSON — ตกไปใช้ทางเก่า */ }
  }
  const p = (e && e.parameter) || {};
  if (!p['ห้อง']) return { entries: [] };

  const t = TOPICS.silicone;
  const values = {};
  t.cols.forEach(function (c) { if (p[c] !== undefined) values[c] = p[c]; });
  return {
    token: p.token || '',
    inspector: p['ผู้ตรวจ'] || '',
    date: p['วันที่ตรวจ'] || '',
    entries: [{ topic: 'silicone', room: p['ห้อง'], floor: p['ชั้น'],
                values: values, note: p['หมายเหตุ'] || '' }]
  };
}

/** yyyy-MM-dd → Date เที่ยงวัน (กันวันเลื่อนตอนข้ามโซนเวลา) — ว่าง = วันนี้ */
function dateValue_(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
  const th = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (th) return new Date(+th[3], +th[2] - 1, +th[1], 12, 0, 0);
  const now = new Date();
  return new Date(Utilities.formatDate(now, TZ, 'yyyy/MM/dd') + ' 12:00:00');
}

function appendRow_(sh, head, rec, dateStr) {
  const row = head.map(function (h) { return rec[h] === undefined ? '' : rec[h]; });
  const iDate = head.indexOf('วันที่ตรวจ');
  if (iDate !== -1) row[iDate] = dateValue_(dateStr);

  sh.appendRow(row);
  const r = sh.getLastRow();
  styleRow_(sh, head, r);
  if (iDate !== -1) sh.getRange(r, iDate + 1).setNumberFormat('dd/MM/yyyy');
  return r;
}

/* appendRow ใส่ให้แค่ข้อมูล ไม่ได้ก๊อปตัวหนา จัดกึ่งกลาง เส้นขอบ พื้นหลัง มาด้วย
   แถวใหม่เลยหน้าตาไม่เหมือนแถวเก่า — ยืมรูปแบบจากแถวข้อมูลแรกมาใส่ให้
   (สีของช่องที่เป็นข้อบกพร่องมาจาก conditional format ไม่ได้ก๊อปมา จึงไม่เพี้ยนตามค่าแถวต้นแบบ) */
function styleRow_(sh, head, row) {
  if (row <= 2) return;                       // แถว 2 เป็นต้นแบบเอง
  sh.getRange(2, 1, 1, head.length)
    .copyTo(sh.getRange(row, 1, 1, head.length), { formatOnly: true });
}

/* หาบันทึกล่าสุดของห้องนี้ ไล่จากแถวท้ายขึ้นมา — ไม่เจอคืน null */
function findLatest_(sh, head, room) {
  const last = sh.getLastRow();
  if (last < 2) return null;

  const key = String(room).trim();
  const iRoom = head.indexOf('ห้อง');
  const values = sh.getRange(2, 1, last - 1, head.length).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][iRoom]).trim() !== key) continue;
    const o = {};
    head.forEach(function (h, j) { o[h] = cellText_(values[i][j], h); });
    return o;
  }
  return null;
}

/* ช่องไหนเปลี่ยนไปบ้างระหว่างบันทึกเก่ากับใหม่ */
function diff_(t, prev, cur) {
  return compareCols_(t).filter(function (h) {
    return String(prev[h] || '') !== String(cur[h] || '');
  }).map(function (h) {
    return { field: h, from: prev[h] || '-', to: cur[h] || '-' };
  });
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
  const body = { messages: [{ type: 'text', text: APP_TAG ? APP_TAG + '\n' + text : text }] };
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

/* 2026-08-04 หรือ Date → 04/08/2026 */
function fmtDate_(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[3] + '/' + m[2] + '/' + m[1];
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : Utilities.formatDate(d, TZ, 'dd/MM/yyyy');
}

/** ข้อความของหนึ่งหมวดในรอบบันทึกนี้ */
function entryLines_(s) {
  const t = s.t, rec = s.rec;
  const grade = rec[t.grade] || '';
  const icon = GRADE_ICON[grade] || '⬜';
  const head = t.icon + ' ' + t.name;
  const lines = [];

  if (s.changes) {                                   /* เคยตรวจแล้ว — บอกเฉพาะที่เปลี่ยน */
    lines.push(head + ' — 🔁 แก้ไขผลตรวจ');
    const g = s.changes.filter(function (c) { return c.field === t.grade; })[0];
    lines.push(g ? '   ' + (GRADE_ICON[g.from] || '⬜') + ' ' + g.from + '  →  ' + icon + ' ' + g.to
                 : '   ' + icon + ' เกรดยังเป็น ' + grade);
    s.changes.filter(function (c) { return c.field !== t.grade; })
      .forEach(function (c) { lines.push('   • ' + c.field + ': ' + c.from + ' → ' + c.to); });
    if (!s.changes.length) lines.push('   ' + icon + ' บันทึกทับด้วยค่าเดิม');
    const before = fmtDate_(s.prev['วันที่ตรวจ']);
    if (before) lines.push('   (ตรวจครั้งก่อน ' + before + ')');
    return lines;
  }

  lines.push(head + ' — ' + icon + ' ' + grade);      /* ตรวจครั้งแรก — บอกจุดที่ไม่ปกติ */
  if (grade === 'ไม่ได้ตรวจ') {
    lines.push('   เหตุผล: ' + (rec[ACCESS] || rec['หมายเหตุ'] || '-'));
    return lines;
  }
  /* หน้าเว็บส่งรายการจุดที่เสียมาให้แล้ว (รู้เกณฑ์ของช่องตัวเลขด้วย) ใช้อันนั้นก่อน */
  const bad = s.defects && s.defects.length !== undefined
    ? s.defects
    : t.cols.filter(function (c) {
        return c !== t.grade && c !== ACCESS && t.auto.indexOf(c) === -1 && !isGood_(t, c, rec[c]);
      }).map(function (c) { return c + ': ' + rec[c]; });
  if (bad.length) bad.forEach(function (line) { lines.push('   • ' + line); });
  else lines.push('   ปกติทุกหัวข้อ');
  if (rec['หมายเหตุ']) lines.push('   หมายเหตุ: ' + rec['หมายเหตุ']);
  return lines;
}

/** หนึ่งครั้งที่กดบันทึก = หนึ่งข้อความ ต่อให้ในรอบนั้นอัปเดตหลายหมวดก็ตาม */
function notifySave_(saved, body) {
  if (NOTIFY_WHEN === 'off' || !saved.length) return;

  const anyChange = saved.some(function (s) { return !s.changes || s.changes.length; });
  const anyDefect = saved.some(function (s) {
    const g = s.rec[s.t.grade];
    return g === 'ไม่ผ่าน' || g === 'เกือบผ่าน';
  });
  if (NOTIFY_WHEN === 'change' && !anyChange) return;
  if (NOTIFY_WHEN === 'defect' && !anyDefect) return;

  const rooms = [];
  saved.forEach(function (s) { if (rooms.indexOf(s.room) === -1) rooms.push(s.room); });

  const lines = [];
  lines.push(rooms.length === 1
    ? '🏷️ ห้อง ' + rooms[0] + ' · อัปเดต ' + saved.length + ' หมวด'
    : '🏷️ อัปเดต ' + saved.length + ' รายการ · ห้อง ' + rooms.join(', '));

  saved.forEach(function (s) {
    lines.push('');
    if (rooms.length > 1) lines.push('ห้อง ' + s.room);
    entryLines_(s).forEach(function (l) { lines.push(l); });
  });

  const who = String(body.inspector || '').trim() || 'ไม่ระบุผู้ตรวจ';
  const when = fmtDate_(saved[0].rec['วันที่ตรวจ']) ||
               Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy');
  lines.push('');
  lines.push('— ' + who + ' · ' + when);

  pushLine_(lines.join('\n'));
}

/* =============== เมนูในชีต =============== */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('เช็คห้อง')
    .addItem('อัปเดตหน้าสรุป', 'buildSummary')
    .addItem('ตั้งค่าชีตทุกหมวด (จัดหน้าตา + ดรอปดาวน์ + สีเกรด)', 'setupSheet')
    .addItem('แปลงคำเก่าให้ตรงกับหน้าเว็บ', 'migrateLabels')
    .addItem('แปลงวันที่เป็นแบบไทย วัน/เดือน/ปี', 'migrateDates')
    .addItem('จัดรูปแบบทุกแถวให้เหมือนกัน', 'restyleAll')
    .addSeparator()
    .addItem('ทดสอบส่งแจ้งเตือน LINE', 'testLine')
    .addItem('ตรวจสภาพการแจ้งเตือน LINE', 'checkLine')
    .addToUi();
}

function eachTopic_(fn) {
  return Object.keys(TOPICS).map(function (id) {
    const t = TOPICS[id];
    const sh = sheetOf_(t);
    const head = headOfSheet_(sh, t);
    return fn(t, sh, head, id);
  });
}

/* หน้าตาตาราง — ให้ทุกแท็บโทนเดียวกันหมด */
const LOOK = {
  headBg: '#1F7A54', headFg: '#FFFFFF',
  bad:  { bg: '#F7E2DF', fg: '#B23C31' },
  warn: { bg: '#FBEBD2', fg: '#8A5D14' },
  grid: '#D6DDE6',
  width: { 'วันที่ตรวจ': 96, 'ชั้น': 52, 'ห้อง': 62, 'หมายเหตุ': 230,
           'ผู้ตรวจ': 92, 'บันทึกเมื่อ': 128 },
  center: ['ชั้น', 'ห้อง', 'จำนวนจุดที่มีแสง', 'เวลาน้ำร้อน (วินาที)', 'เวลาแอร์เย็น (นาที)',
           'อุณหภูมิน้ำที่วัดได้ (°C)', 'อุณหภูมิที่ตั้งแอร์ (°C)', 'อุณหภูมิห้องที่วัดได้ (°C)']
};

/** ค่าที่ถือว่าเป็น "เกือบผ่าน" (เหลือง) ที่เหลือที่ไม่ใช่ค่าปกติ = แดง */
function warnValues_(t) {
  return (t.warn || []).concat(ACCESS_CHOICES.slice(1));
}

/** จัดหน้าตาแท็บหนึ่งให้เหมือนกันหมด — หัวเขียว เส้นตาราง แถบสลับสี ดรอปดาวน์ สีข้อบกพร่อง
 *  แยกออกมาเพราะเรียกสองที่: ตอนสร้างแท็บใหม่ กับตอนกดเมนูตั้งค่าชีต  */
function styleSheet_(t, sh, head) {
  /* แท็บใหม่ของ Google มี 1000 แถว — ขยายให้พอก่อน ไม่งั้น getRange จะหลุดขอบชีต */
  const WANT_ROWS = 2000;
  if (sh.getMaxRows() < WANT_ROWS + 1) {
    sh.insertRowsAfter(sh.getMaxRows(), WANT_ROWS + 1 - sh.getMaxRows());
  }
  if (sh.getMaxColumns() > head.length) {
    sh.deleteColumns(head.length + 1, sh.getMaxColumns() - head.length);
  }
  const rows = sh.getMaxRows() - 1;

  /* ---- หัวตาราง ---- */
  sh.getRange(1, 1, 1, head.length)
    .setBackground(LOOK.headBg).setFontColor(LOOK.headFg)
    .setFontWeight('bold').setFontSize(10)
    .setVerticalAlignment('middle').setHorizontalAlignment('center').setWrap(true);
  sh.setRowHeight(1, 34);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(Math.min(3, head.length));
  if (!sh.getFilter()) sh.getRange(1, 1, sh.getMaxRows(), head.length).createFilter();

  /* ---- แถบสลับสีอ่อน ๆ แบบเดียวกับแท็บซิลิโคน ---- */
  sh.getBandings().forEach(function (b) { b.remove(); });
  sh.getRange(1, 1, sh.getMaxRows(), head.length)
    .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREEN, true, false);

  /* ---- ความกว้าง / การจัดวาง / เส้นตาราง ---- */
  head.forEach(function (h, i) {
    sh.setColumnWidth(i + 1, LOOK.width[h] || 132);
    const col = sh.getRange(2, i + 1, rows, 1);
    col.setFontSize(10).setVerticalAlignment('middle').setWrap(false);
    col.setHorizontalAlignment(
      (LOOK.center.indexOf(h) !== -1 || h === t.grade) ? 'center' : 'left');
  });
  const iDate = head.indexOf('วันที่ตรวจ') + 1;
  if (iDate > 0) sh.getRange(2, iDate, rows, 1).setNumberFormat('dd/MM/yyyy')
    .setHorizontalAlignment('center');
  const iRoom = head.indexOf('ห้อง') + 1;
  if (iRoom > 0) sh.getRange(2, iRoom, rows, 1).setFontWeight('bold');
  sh.getRange(1, 1, sh.getMaxRows(), head.length)
    .setBorder(true, true, true, true, true, true, LOOK.grid, SpreadsheetApp.BorderStyle.SOLID);

  styleRules_(t, sh, head, rows);
}

/* ตั้งค่าชีตให้กรอกมือได้โดยไม่พิมพ์ผิด + จัดหน้าตาให้เหมือนกันทุกแท็บ
   รันซ้ำได้ไม่มีผลเสีย */
function setupSheet() {
  eachTopic_(function (t, sh, head) {
    migrateLabels_(t, sh, head);
    styleSheet_(t, sh, head);
    restyleAll_(sh, head);   /* แถวที่บันทึกไปก่อนหน้านี้จะได้หน้าตาเหมือนกันทั้งตาราง */
  });
  buildSummary_();
  SpreadsheetApp.getActive().toast('ตั้งค่าชีตทุกหมวด + หน้าสรุปเรียบร้อย', 'เช็คห้อง', 5);
}

/** ดรอปดาวน์ + กฎสีของช่องที่เป็นข้อบกพร่อง */
function styleRules_(t, sh, head, rows) {
  {
    /* ---- ดรอปดาวน์ ---- */
    const all = {};
    Object.keys(t.choices || {}).forEach(function (c) { all[c] = t.choices[c]; });
    all[ACCESS] = ACCESS_CHOICES;
    all[t.grade] = GRADES;
    Object.keys(all).forEach(function (c) {
      const col = head.indexOf(c) + 1;
      if (col < 1) return;
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(all[c], true)
        .setAllowInvalid(false)
        .setHelpText('เลือกจากรายการเท่านั้น เพื่อให้ตรงกับหน้าเว็บ')
        .build();
      sh.getRange(2, col, rows, 1).setDataValidation(rule);
    });

    /* ---- สีของช่องที่เป็นข้อบกพร่อง ---- */
    const warns = warnValues_(t);
    const rules = [];
    const add = function (col, value, look) {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo(value)
        .setBackground(look.bg).setFontColor(look.fg)
        .setRanges([sh.getRange(2, col, rows, 1)]).build());
    };

    Object.keys(t.choices || {}).forEach(function (c) {
      const col = head.indexOf(c) + 1;
      if (col < 1) return;
      const good = goodOf_(t, c);
      t.choices[c].forEach(function (v) {
        if (good.indexOf(v) !== -1) return;
        add(col, v, warns.indexOf(v) !== -1 ? LOOK.warn : LOOK.bad);
      });
    });
    ACCESS_CHOICES.slice(1).forEach(function (v) {
      const col = head.indexOf(ACCESS) + 1;
      if (col > 0) add(col, v, LOOK.warn);
    });
    GRADES.forEach(function (g) {
      const col = head.indexOf(t.grade) + 1;
      if (col > 0) add(col, g, { bg: GRADE_COLOR[g].bg, fg: GRADE_COLOR[g].fg });
    });

    /* คอลัมน์ตัวเลข ใช้เกณฑ์ ok/warn แทนการเทียบข้อความ */
    Object.keys(t.num || {}).forEach(function (c) {
      const col = head.indexOf(c) + 1, n = t.num[c];
      if (col < 1) return;
      const range = [sh.getRange(2, col, rows, 1)];
      if (n.ok !== undefined) {
        rules.push(SpreadsheetApp.newConditionalFormatRule()
          .whenNumberGreaterThan(n.warn).setBackground(LOOK.bad.bg).setFontColor(LOOK.bad.fg)
          .setRanges(range).build());
        rules.push(SpreadsheetApp.newConditionalFormatRule()
          .whenNumberBetween(n.ok + 0.0001, n.warn).setBackground(LOOK.warn.bg)
          .setFontColor(LOOK.warn.fg).setRanges(range).build());
      } else {
        rules.push(SpreadsheetApp.newConditionalFormatRule()
          .whenNumberNotBetween(n.warnMin, n.warnMax).setBackground(LOOK.bad.bg)
          .setFontColor(LOOK.bad.fg).setRanges(range).build());
        rules.push(SpreadsheetApp.newConditionalFormatRule()
          .whenNumberNotBetween(n.min, n.max).setBackground(LOOK.warn.bg)
          .setFontColor(LOOK.warn.fg).setRanges(range).build());
      }
    });

    /* ทับกฎเดิมของแท็บนี้ทั้งหมด — ทุกแท็บสคริปต์เป็นคนดูแลอยู่แล้ว
       จัดใหม่ทุกครั้งที่รัน จะได้ไม่ซ้อนกันและได้หน้าตาเหมือนกันหมด */
    sh.setConditionalFormatRules(rules);
  }
}

/* แปลงค่าคำเก่าให้เป็นคำใหม่ ทุกหมวด ทุกคอลัมน์ที่มีตัวเลือก */
function migrateLabels() {
  const n = eachTopic_(migrateLabels_).reduce(function (a, b) { return a + b; }, 0);
  SpreadsheetApp.getActive().toast('แปลงแล้ว ' + n + ' ช่อง', 'เช็คห้อง', 5);
}

function migrateLabels_(t, sh, head) {
  const last = sh.getLastRow();
  if (last < 2) return 0;

  const cols = t.cols.concat([t.grade]);
  let changed = 0;
  cols.forEach(function (c) {
    const col = head.indexOf(c) + 1;
    if (col < 1) return;
    const range = sh.getRange(2, col, last - 1, 1);
    const values = range.getValues();
    let hit = 0;
    const out = values.map(function (r) {
      const v = String(r[0]);
      if (RENAMED[v]) { hit++; return [RENAMED[v]]; }
      return [r[0]];
    });
    if (hit) { range.setValues(out); changed += hit; }
  });
  return changed;
}

/* วันที่ที่เก็บเป็นข้อความ yyyy-MM-dd → วันที่จริงที่แสดงแบบ วัน/เดือน/ปี */
function migrateDates() {
  const n = eachTopic_(function (t, sh, head) {
    const last = sh.getLastRow();
    const col = head.indexOf('วันที่ตรวจ') + 1;
    if (last < 2 || col < 1) return 0;

    const range = sh.getRange(2, col, last - 1, 1);
    const values = range.getValues();
    let hit = 0;
    const out = values.map(function (r) {
      const m = String(r[0]).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return [r[0]];
      hit++;
      return [new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0)];
    });
    if (hit) range.setValues(out);
    range.setNumberFormat('dd/MM/yyyy');
    return hit;
  }).reduce(function (a, b) { return a + b; }, 0);
  SpreadsheetApp.getActive().toast('แปลงวันที่แล้ว ' + n + ' ช่อง', 'เช็คห้อง', 5);
}

/* จัดรูปแบบทุกแถวให้เหมือนแถวข้อมูลแรก — ใช้เก็บกวาดแถวที่บันทึกไปก่อนหน้านี้ */
function restyleAll() {
  const n = eachTopic_(function (t, sh, head) { return restyleAll_(sh, head); })
    .reduce(function (a, b) { return a + b; }, 0);
  SpreadsheetApp.getActive().toast(
    n ? 'จัดรูปแบบให้ ' + n + ' แถวแล้ว' : 'ยังไม่มีแถวที่ต้องจัด', 'เช็คห้อง', 5);
}

function restyleAll_(sh, head) {
  const last = sh.getLastRow();
  if (last < 3) return 0;
  sh.getRange(2, 1, 1, head.length)
    .copyTo(sh.getRange(3, 1, last - 2, head.length), { formatOnly: true });
  return last - 2;
}

/* =============== แท็บสรุปรวม =============== */

/** แถวล่าสุดของแต่ละห้องในหมวดหนึ่ง (แถวท้ายสุดของห้องนั้นชนะ) */
function latestByRoom_(id) {
  const m = {};
  rowsOf_(id).forEach(function (r) {
    const k = String(r['ห้อง']).trim();
    if (k) m[k] = r;
  });
  return m;
}

function numBad_(spec, v) {
  if (isNaN(v)) return false;
  if (spec.ok !== undefined) return v > spec.ok;
  return v < spec.min || v > spec.max;
}

/** สรุปเป็นข้อความว่าห้องนี้ตกเพราะอะไร */
function whyOf_(t, row) {
  const out = [];
  if (row[ACCESS] && row[ACCESS] !== ACCESS_CHOICES[0]) return row[ACCESS];
  t.cols.forEach(function (c) {
    if (c === t.grade || c === ACCESS || t.auto.indexOf(c) !== -1) return;
    const v = String(row[c] || '').trim();
    if (!v || v === '-') return;
    if (t.num && t.num[c]) { if (numBad_(t.num[c], Number(v))) out.push(c + ': ' + v); return; }
    if (!isGood_(t, c, v)) out.push(c + ': ' + v);
  });
  return out.join(' · ');
}

const TOTAL_ROOMS = (FLOOR_TO - FLOOR_FROM + 1) * ROOMS_PER_FLOOR;

/** สร้าง/อัปเดตแท็บสรุปรวม — เรียกจากเมนู และเรียกเองทุกครั้งที่บันทึก */
function buildSummary_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = renameOrCreate_(ss, SUMMARY_SHEET, SUMMARY_LEGACY);

  const ids = Object.keys(TOPICS);
  const latest = {};
  ids.forEach(function (id) { latest[id] = latestByRoom_(id); });

  const rows = [];
  const now = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
  rows.push(['📋 สรุปการตรวจห้อง', '', '', '', '', '', '', '', '']);
  rows.push(['อัปเดตล่าสุด ' + now + ' · ทั้งหมด ' + TOTAL_ROOMS + ' ห้อง (ชั้น ' +
             FLOOR_FROM + '–' + FLOOR_TO + ' ชั้นละ ' + ROOMS_PER_FLOOR + ' ห้อง)',
             '', '', '', '', '', '', '', '']);
  rows.push(['', '', '', '', '', '', '', '', '']);

  /* ---- ภาพรวมรายหมวด ---- */
  const headA = ['หมวด', 'ตรวจแล้ว', 'เหลือ', 'ความคืบหน้า',
                 'ผ่าน', 'เกือบผ่าน', 'ไม่ผ่าน', 'ไม่ได้ตรวจ', 'ต้องกลับไปแก้'];
  rows.push(headA);
  const bandA = rows.length;                       /* แถวหัวของบล็อกแรก */
  const totals = { done: 0, fix: 0 };
  ids.forEach(function (id) {
    const t = TOPICS[id], m = latest[id], rooms = Object.keys(m);
    const c = {}; GRADES.forEach(function (g) { c[g] = 0; });
    rooms.forEach(function (rn) { const g = m[rn][t.grade]; if (c[g] !== undefined) c[g]++; });
    const fix = c['ไม่ผ่าน'] + c['เกือบผ่าน'];
    totals.done += rooms.length; totals.fix += fix;
    rows.push([t.icon + ' ' + t.name, rooms.length, TOTAL_ROOMS - rooms.length,
               rooms.length / TOTAL_ROOMS,
               c['ผ่าน'], c['เกือบผ่าน'], c['ไม่ผ่าน'], c['ไม่ได้ตรวจ'], fix]);
  });
  rows.push(['รวมทุกหมวด', totals.done, ids.length * TOTAL_ROOMS - totals.done,
             totals.done / (ids.length * TOTAL_ROOMS), '', '', '', '', totals.fix]);
  const endA = rows.length;

  /* ---- ความคืบหน้ารายชั้น ---- */
  rows.push(['', '', '', '', '', '', '', '', '']);
  rows.push(['ความคืบหน้ารายชั้น (ตรวจแล้วกี่ห้องจาก ' + ROOMS_PER_FLOOR + ')',
             '', '', '', '', '', '', '', '']);
  const headB = ['ชั้น'].concat(ids.map(function (id) { return TOPICS[id].icon + ' ' + TOPICS[id].name; }));
  while (headB.length < 9) headB.push('');
  rows.push(headB);
  const bandB = rows.length;
  for (let f = FLOOR_FROM; f <= FLOOR_TO; f++) {
    const line = ['ชั้น ' + f];
    ids.forEach(function (id) {
      let n = 0;
      for (let i = 1; i <= ROOMS_PER_FLOOR; i++) if (latest[id][String(f * 100 + i)]) n++;
      line.push(n + '/' + ROOMS_PER_FLOOR);
    });
    while (line.length < 9) line.push('');
    rows.push(line);
  }
  const endB = rows.length;

  /* ---- ห้องที่ต้องกลับไปแก้ ---- */
  rows.push(['', '', '', '', '', '', '', '', '']);
  rows.push(['ห้องที่ต้องกลับไปแก้', '', '', '', '', '', '', '', '']);
  rows.push(['ห้อง', 'ชั้น', 'หมวด', 'ผล', 'รายละเอียด', 'วันที่ตรวจ', 'ผู้ตรวจ', '', '']);
  const bandC = rows.length;

  const fixes = [];
  ids.forEach(function (id) {
    const t = TOPICS[id], m = latest[id];
    Object.keys(m).forEach(function (rn) {
      const g = m[rn][t.grade];
      if (g !== 'ไม่ผ่าน' && g !== 'เกือบผ่าน') return;
      fixes.push([rn, m[rn]['ชั้น'], t.icon + ' ' + t.name, g, whyOf_(t, m[rn]),
                  fmtDate_(m[rn]['วันที่ตรวจ']), m[rn]['ผู้ตรวจ'] || '', '', '']);
    });
  });
  fixes.sort(function (a, b) { return String(a[0]).localeCompare(String(b[0]), 'th', { numeric: true }); });
  if (fixes.length) fixes.forEach(function (f) { rows.push(f); });
  else rows.push(['— ยังไม่มีห้องที่ต้องแก้ —', '', '', '', '', '', '', '', '']);
  const endC = rows.length;

  /* ---- เขียนลงชีต ---- */
  if (sh.getMaxRows() < rows.length + 20) {
    sh.insertRowsAfter(sh.getMaxRows(), rows.length + 20 - sh.getMaxRows());
  }
  sh.clear();
  sh.clearConditionalFormatRules();
  sh.getBandings().forEach(function (b) { b.remove(); });
  sh.getRange(1, 1, rows.length, 9).setValues(rows);

  /* ---- แต่งหน้า ---- */
  sh.setFrozenRows(3);
  sh.getRange('A1').setFontSize(15).setFontWeight('bold').setFontColor(LOOK.headBg);
  sh.getRange('A2').setFontSize(10).setFontColor('#6B7A8D');
  [bandA, bandB, bandC].forEach(function (r) {
    sh.getRange(r, 1, 1, 9).setBackground(LOOK.headBg).setFontColor(LOOK.headFg)
      .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center');
  });
  [bandB - 1, bandC - 1].forEach(function (r) {
    sh.getRange(r, 1, 1, 9).setFontWeight('bold').setFontSize(11).setFontColor(LOOK.headBg);
  });
  sh.setColumnWidth(1, 190);
  for (let c = 2; c <= 9; c++) sh.setColumnWidth(c, c === 5 ? 300 : 108);

  sh.getRange(bandA + 1, 2, ids.length + 1, 8).setHorizontalAlignment('center');
  sh.getRange(bandA + 1, 4, ids.length + 1, 1).setNumberFormat('0.0%');
  sh.getRange(endA, 1, 1, 9).setFontWeight('bold').setBackground('#EFF3F7');
  sh.getRange(bandB + 1, 2, endB - bandB, 8).setHorizontalAlignment('center');
  sh.getRange(bandC + 1, 1, endC - bandC, 4).setHorizontalAlignment('center');
  sh.getRange(bandC + 1, 5, endC - bandC, 1).setHorizontalAlignment('left');

  [[bandA, endA], [bandB, endB], [bandC, endC]].forEach(function (b) {
    sh.getRange(b[0], 1, b[1] - b[0] + 1, 9)
      .setBorder(true, true, true, true, true, true, LOOK.grid, SpreadsheetApp.BorderStyle.SOLID);
  });

  /* สีของช่องผลตรวจ */
  const rules = [];
  const gradeRanges = [sh.getRange(bandA + 1, 5, ids.length, 4), sh.getRange(bandC + 1, 4, endC - bandC, 1)];
  GRADES.forEach(function (g) {
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(g)
      .setBackground(GRADE_COLOR[g].bg).setFontColor(GRADE_COLOR[g].fg)
      .setRanges(gradeRanges).build());
  });
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(0).setBackground(LOOK.bad.bg).setFontColor(LOOK.bad.fg)
    .setRanges([sh.getRange(bandA + 1, 7, ids.length, 1), sh.getRange(bandA + 1, 9, ids.length, 1)]).build());
  sh.setConditionalFormatRules(rules);

  return sh;
}

/** เมนู: อัปเดตหน้าสรุป */
function buildSummary() {
  const sh = buildSummary_();
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sh);
  SpreadsheetApp.getActive().toast('อัปเดตหน้าสรุปแล้ว', 'เช็คห้อง', 5);
}

/* สรุปประจำวันทุกหมวด — ผูกกับ Trigger แบบ Time-driven ถ้าอยากให้ส่งทุกเย็น */
function dailySummary() {
  const today = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy');
  const msg = ['📋 สรุปการตรวจวันที่ ' + today];
  let total = 0;

  Object.keys(TOPICS).forEach(function (id) {
    const t = TOPICS[id];
    const rows = rowsOf_(id).filter(function (r) { return fmtDate_(r['วันที่ตรวจ']) === today; });
    if (!rows.length) return;

    const cnt = {}; GRADES.forEach(function (g) { cnt[g] = 0; });
    const failed = [];
    rows.forEach(function (r) {
      const g = r[t.grade];
      if (cnt[g] !== undefined) cnt[g]++;
      if (g === 'ไม่ผ่าน') failed.push(r['ห้อง']);
    });
    total += rows.length;

    msg.push('');
    msg.push(t.icon + ' ' + t.name + ' — บันทึก ' + rows.length + ' รายการ');
    msg.push('   ✅ ' + cnt['ผ่าน'] + ' · ⚠️ ' + cnt['เกือบผ่าน'] +
             ' · ❌ ' + cnt['ไม่ผ่าน'] + ' · ⬜ ' + cnt['ไม่ได้ตรวจ']);
    if (failed.length) msg.push('   ห้องที่ต้องแก้: ' + failed.join(', '));
  });

  if (!total) return;   // วันนี้ไม่มีบันทึก ไม่ต้องส่ง
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
  const day = Utilities.formatDate(new Date(Date.now() - 864e5), TZ, 'yyyyMMdd');
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
    all:    'แจ้งทุกครั้งที่กดบันทึก (กดหนึ่งครั้ง = หนึ่งข้อความ)',
    change: 'แจ้งเฉพาะรอบที่มีค่าเปลี่ยนจริง',
    defect: 'แจ้งเฉพาะรอบที่มีหมวดไม่ผ่าน/เกือบผ่าน',
    off:    'ปิดแจ้งเตือน'
  }[NOTIFY_WHEN] || 'ค่าไม่ถูกต้อง จะไม่แจ้งเลย'));

  const to = lineTo_();
  out.push('ปลายทาง: ' + (to ? to.slice(0, 8) + '… (ส่งเจาะจง)'
                             : 'broadcast — ส่งหาเพื่อนของ OA ทุกคน'));

  /* ชีตพร้อมรับข้อมูลไหม */
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  out.push('');
  Object.keys(TOPICS).forEach(function (id) {
    const t = TOPICS[id];
    const sh = ss.getSheetByName(t.sheet);
    out.push(t.icon + ' ' + t.name + ' → แท็บ "' + t.sheet + '": ' +
      (sh ? 'พบแล้ว มี ' + Math.max(0, sh.getLastRow() - 1) + ' แถว'
          : 'ยังไม่มี (จะสร้างให้เองตอนบันทึกครั้งแรก)'));
  });

  out.push('');
  out.push('ถ้าทุกอย่างข้างบนเขียว แต่กดบันทึกในแอปแล้วไม่มีข้อความ');
  out.push('= ยังไม่ได้ Deploy เวอร์ชันใหม่');
  out.push('   (Deploy → Manage deployments → ✏️ → New version)');

  ui.alert(title, out.join('\n'), ui.ButtonSet.OK);
}

function testLine() {
  if (!lineToken_()) {
    SpreadsheetApp.getActive().toast('ยังไม่ได้ใส่ LINE_TOKEN ในไฟล์ Code.gs', 'เช็คห้อง', 6);
    return;
  }
  const ok = pushLine_('ทดสอบจากชีตเช็คห้อง — เชื่อมต่อสำเร็จ' +
    (lineTo_() ? '' : ' (โหมด broadcast ส่งหาเพื่อนของ OA ทุกคน)'));
  SpreadsheetApp.getActive().toast(
    ok ? 'ส่งแล้ว ไปเช็คในไลน์' : 'ส่งไม่สำเร็จ — เปิด Executions ดู log ว่า LINE ตอบว่าอะไร',
    'เช็คห้อง', 6);
}
