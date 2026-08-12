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

/** รหัสผ่านสำหรับ "บันทึกข้อมูล" — เว้นว่าง = ใครเปิดลิงก์ก็บันทึกได้
 *  ถ้าใส่ไว้ หน้าเว็บจะขึ้นหน้าล็อกให้กรอกรหัสก่อนถึงจะบันทึกได้ */
var TOKEN = '';

/** true  = ใครก็ "ดู" ข้อมูลได้โดยไม่ต้องใส่รหัส (บันทึกยังต้องใช้ TOKEN เหมือนเดิม)
 *          ใช้คู่กับลิงก์หน้าเว็บที่ต่อท้ายว่า ?view สำหรับคนที่ให้ดูอย่างเดียว
 *  false = ต้องใส่รหัสทั้งดูและบันทึก */
var READ_OPEN = true;

/* คอลัมน์ที่ทุกหมวดมีเหมือนกัน — ซ้ายสุดกับขวาสุดของตาราง */
const HEAD_LEFT  = ['วันที่ตรวจ', 'ชั้น', 'ห้อง'];
const HEAD_RIGHT = ['หมายเหตุ', 'ผู้ตรวจ', 'บันทึกเมื่อ'];

const ACCESS = 'การเข้าห้อง';
const ACCESS_CHOICES = ['เข้าตรวจได้', 'ไม่มีกุญแจ', 'มีแขกพัก', 'ห้องปิดปรับปรุง'];

/* ==================== รอบตามแก้ ====================
 *  ตรวจไปแล้วรอบหนึ่ง เจอข้อบกพร่อง แล้วยังไงต่อ — ทุกหมวดมีคอลัมน์นี้เหมือนกัน
 *    รอแก้ไข   = ยังค้าง ห้องยังนับเป็นไม่ผ่าน
 *    อนุโลม    = ดูของจริง/ดูรูปแล้วผู้ตรวจยอมให้ผ่าน   → ห้องนี้ปิดจบ
 *    แก้ไขแล้ว = ช่างกลับไปแก้ แล้วตรวจซ้ำว่าเรียบร้อย  → ห้องนี้ปิดจบ
 *  ค่าที่กรอกไว้ตอนเจอข้อบกพร่องยังอยู่ครบ ไม่ถูกลบ จะได้ตามย้อนได้ว่าเดิมเสียตรงไหน
 *  กรอกในชีตเองก็ได้ — ใส่ อนุโลม แล้วห้องนั้นถือว่าปิดจบทันที
 *  (สั่งเมนู "ตัดเกรดใหม่จากข้อมูลเดิม" ให้ช่องผลตรวจตามมาเป็น "ผ่าน" ด้วย)          */
const FIX = 'สถานะแก้ไข';
const FIX_WAIT = 'รอแก้ไข', FIX_WAIVE = 'อนุโลม', FIX_DONE = 'แก้ไขแล้ว';
const FIX_CHOICES = [FIX_WAIT, FIX_WAIVE, FIX_DONE];
/** สองสถานะนี้แปลว่าไม่ต้องกลับไปแก้แล้ว */
function fixClosed_(v) {
  const s = String(v || '').trim();
  return s === FIX_WAIVE || s === FIX_DONE;
}

/* จำนวนห้องทั้งหมด ใช้คิด % ในหน้าสรุป — ต้องตรงกับที่ตั้งไว้ใน index.html */
const FLOOR_FROM = 3, FLOOR_TO = 20, ROOMS_PER_FLOOR = 12;
/** แท็บสรุป — ชื่อแท็บทั้งชีตใช้อังกฤษให้อ่านง่ายเวลาสลับแท็บ
 *  ชื่อไทยของเดิมอยู่ใน SUMMARY_WAS สคริปต์จะเปลี่ยนชื่อแท็บเก่าให้เอง ข้อมูลไม่หาย */
const SUMMARY_SHEET = 'Summary';
const SUMMARY_WAS   = ['สรุปรวม'];

/* ==================== ผลตรวจ ====================
 *  คำที่ลงช่องผลตรวจมีแค่สามคำ: ผ่าน · ไม่ผ่าน · ไม่ได้ตรวจ
 *  ส่วน "ระดับ" ที่ใช้เลือกสีกับนับยอด มีห้าระดับ คิดจากค่าที่กรอกไว้ในแถวนั้น
 *    ok   = เขียว   — ไม่พบข้อบกพร่องเลย
 *    done = น้ำเงิน — เคยเจอข้อบกพร่อง แต่รอบตามแก้จบแล้ว (อนุโลม/แก้ไขแล้ว)
 *                     ช่องผลตรวจของแถวแบบนี้ลงว่า "ผ่าน" ส่วนเหตุผลอยู่ในช่องสถานะแก้ไข
 *    warn = เหลือง — ไม่ผ่าน เสียเล็กน้อย แก้เฉพาะจุดได้   (ของเดิมเรียกว่า "เกือบผ่าน")
 *    bad  = แดง    — ไม่ผ่าน เสียจริงจัง ต้องกลับไปแก้
 *    skip = เทา    — เข้าห้องไม่ได้
 */
const LEVELS = ['ok', 'done', 'warn', 'bad', 'skip'];
const LEVEL_TEXT  = {ok:'ผ่าน', done:'ผ่าน', warn:'ไม่ผ่าน', bad:'ไม่ผ่าน', skip:'ไม่ได้ตรวจ'};
const LEVEL_ICON  = {ok:'✅', done:'☑️', warn:'⚠️', bad:'❌', skip:'⬜'};
const LEVEL_COLOR = {
  ok:   {bg:'#E2F0E9', fg:'#1B7A4B'},
  done: {bg:'#DDEAF3', fg:'#2A6484'},
  warn: {bg:'#F7EEDC', fg:'#8A5D14'},
  bad:  {bg:'#F7E2DF', fg:'#B23C31'},
  skip: {bg:'#E7ECEB', fg:'#6B7877'}
};

/* คำที่ใช้ได้ในช่องผลตรวจ = ดรอปดาวน์ในชีต (ไม่ซ้ำกัน จึงมีสามคำ) */
const GRADES = ['ผ่าน', 'ไม่ผ่าน', 'ไม่ได้ตรวจ'];
/** คำเก่าก่อนรวมเหลือสองคำ — แถวที่ยังไม่ได้แปลงยังอ่านได้ ถือเป็นเหลือง */
const OLD_WARN = 'เกือบผ่าน';

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
    sheet: 'Curtain & Sheer', was: ['บันทึกม่าน'],
    grade: 'ผลตรวจ',
    /* แบรนด์เหลือ Smart curtain อย่างเดียวทั้งตึกแล้ว หน้าเว็บเลยไม่ให้เลือก เติมให้เอง
       ค่า Dooya ของห้องที่เคยบันทึกไว้ยังอยู่ในชีตเหมือนเดิม ไม่ถูกแตะและไม่ตัดเกรด */
    /* จำนวนจุดที่มีแสงไม่ใส่ไว้ใน auto — ต้องให้ num ตัดเกรดได้ เหมือนหมวดแสงรอบประตู */
    auto: ['Room type', 'แบรนด์'],
    cols: ['Room type', 'แบรนด์',
           'ปิดม่านโปร่ง', 'ปิดม่านทึบ', 'เปิดม่านโปร่ง', 'เปิดม่านทึบ',
           'แสงลอดม่านทึบ', 'จุดที่มีแสงม่านทึบ', 'จำนวนจุดที่มีแสงม่านทึบ',
           'สวิตช์ม่านโปร่ง', 'สวิตช์ม่านทึบ', 'มือดึงม่านโปร่ง', 'มือดึงม่านทึบ',
           'เสียงม่านโปร่ง', 'เสียงม่านทึบ', 'เดินลื่นทั้งระบบ',
           'ตีนตุ๊กแกม่านทึบ', 'ตะขอม่านทึบ', 'หัวสไลด์ม่านทึบ',
           'ชายม่านทึบถึงพื้น', 'ลอนม่านทึบ',
           FIX, ACCESS, 'ผลตรวจ'],
    choices: {
      'แบรนด์':          ['Smart curtain', 'Dooya'],
      /* เกณฑ์ปิดม่าน: ปิดแล้วเหลือระยะนิดหน่อยยังถือว่าปิดสุด (ผ่าน)
         ไม่ผ่านคือปิดแล้วสองบานยังห่างกันเกิน 10 ซม. — เหลือสองตัวเลือก */
      'ปิดม่านโปร่ง':    ['ปิดสุด', 'ปิดเหลือระยะห่างกันมากกว่า 10cm'],
      'ปิดม่านทึบ':      ['ปิดสุด', 'ปิดเหลือระยะห่างกันมากกว่า 10cm'],
      'เปิดม่านโปร่ง':   ['เปิดสุด', 'เปิดไม่สุด'],
      'เปิดม่านทึบ':     ['เปิดสุด', 'เปิดไม่สุด'],
      'สวิตช์ม่านโปร่ง': ['ปกติ', 'กดแล้วไม่ทำงาน'],
      'สวิตช์ม่านทึบ':   ['ปกติ', 'กดแล้วไม่ทำงาน'],
      'มือดึงม่านโปร่ง': ['ปกติ', 'ดึงแล้วไม่ทำงาน'],
      'มือดึงม่านทึบ':   ['ปกติ', 'ดึงแล้วไม่ทำงาน'],
      'เสียงม่านโปร่ง':  ['ปกติ', 'ดัง'],
      'เสียงม่านทึบ':    ['ปกติ', 'ดัง'],
      'เดินลื่นทั้งระบบ': ['ลื่น ไม่สะดุด', 'สะดุด/ฝืด'],
      /* แสงลอดม่าน + งานติดตั้ง — เช็คเฉพาะม่านทึบ ม่านโปร่งไม่ได้มีหน้าที่กันแสง
         ตัวแรกของแต่ละแถวคือค่าที่รับงานได้ ที่เหลือเป็นข้อบกพร่อง */
      'แสงลอดม่านทึบ':    ['ไม่มีแสงลอด', 'มีแสงลอด'],
      'ตีนตุ๊กแกม่านทึบ':  ['ติดแล้ว', 'ยังไม่ติด'],
      'ตะขอม่านทึบ':      ['ตะขอตะปู', 'ตะขอธรรมดา'],
      'หัวสไลด์ม่านทึบ':   ['สีขาว', 'สีเงิน'],
      'ชายม่านทึบถึงพื้น': ['ครึ่งนิ้ว', '1 นิ้ว', 'มากกว่า 1 นิ้ว'],
      'ลอนม่านทึบ':       ['ลอนสวยปกติ', 'ลอนสวยแต่ยับ', 'ไม่เป็นลอนหรือลอนไม่เท่ากัน']
    },
    /* แบรนด์เป็นข้อมูลของห้อง ไม่ใช่ข้อบกพร่อง — ทั้งสองค่าถือว่าปกติ ไม่ต้องระบายสี */
    good: { 'แบรนด์': ['Smart curtain', 'Dooya'] },
    warn: ['ดัง', 'มีแสงลอด', '1 นิ้ว', 'ลอนสวยแต่ยับ'],
    /* จุดแสงลอดนับเป็นตัวเลข เกณฑ์เดียวกับหมวดประตู — 1–2 จุดเหลือง เกินนั้นแดง */
    num: { 'จำนวนจุดที่มีแสงม่านทึบ': { ok: 0, warn: 2 } },
    /* ช่องข้อความที่ไม่มีตัวเลือกตายตัว — เจอคำพวกนี้อยู่ในช่องเมื่อไหร่ถือว่าไม่ผ่านสีแดง
       รอยต่อกลางรั่วคือแสงยิงเข้าหน้าคนนอนตรง ๆ จุดเดียวก็แดง ไม่ต้องรอครบสามจุด */
    has: { 'จุดที่มีแสงม่านทึบ': ['รอยต่อกลาง'] }
  },

  silicone: {
    name: 'ซิลิโคนขอบอ่าง', en: 'Silicone', icon: '🧴',
    sheet: 'Silicone', was: ['บันทึกตรวจ'],   /* แท็บเดิมชื่อ บันทึกตรวจ ข้อมูลเก่ายังอยู่ครบ */
    grade: 'เกรด',
    auto: [],
    cols: ['ขอบเขตงาน', 'สีที่ใช้', 'ระยะขอบ', 'ตัดขอบ', 'ฟองอากาศ',
           'กินผนัง', 'สภาพผนัง', FIX, ACCESS, 'เกรด'],
    choices: {
      'ขอบเขตงาน': ['ยิงครบทุกด้าน', 'ยิงขอบบนแค่ขอบบน (01&12)',
                    'ยิงด้านข้างมาด้วย', 'ยิงไม่ครบสามด้าน', 'ยังไม่ได้ยิง'],
      'สีที่ใช้':   ['แมตช์', 'เงา', 'ยังไม่ได้ยิง'],
      'ระยะขอบ':   ['เท่ากันทุกด้าน', 'มีด้านใดด้านหนึ่งหนากว่าผิดปกติ'],
      /* สี่ค่าแรกคือห้องที่ยิงครบทุกด้าน · สี่ค่าหลังคือห้อง 01/12 ที่ยิงแค่ขอบบน
         แนวบนของห้องมุมแบ่งเป็นสามท่อน ซ้าย กลาง ขวา และมี "ตลอดแนว" เมื่อเสียทั้งเส้น */
      'ตัดขอบ':    ['เรียบร้อย', 'เก็บไม่เรียบฝั่งซ้าย', 'เก็บไม่เรียบฝั่งขวา', 'เก็บไม่เรียบรอบด้าน',
                    'เก็บไม่เรียบท่อนซ้าย', 'เก็บไม่เรียบท่อนกลาง', 'เก็บไม่เรียบท่อนขวา',
                    'เก็บไม่เรียบตลอดแนว'],
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
    sheet: 'HW and A/C', was: ['บันทึกน้ำร้อนแอร์'],
    grade: 'ผลตรวจ',
    auto: [],
    cols: ['เวลาน้ำร้อน (วินาที)', 'อุณหภูมิน้ำที่วัดได้ (°C)',
           'อุณหภูมิที่ตั้งแอร์ (°C)', 'เวลาแอร์เย็น (นาที)', 'อุณหภูมิห้องที่วัดได้ (°C)',
           FIX, ACCESS, 'ผลตรวจ'],
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
    sheet: 'Door', was: ['บันทึกแสงรอบประตู'],
    grade: 'ผลตรวจ',
    auto: ['บานประตู'],
    cols: ['บานประตู', 'แสงเล็ดลอด', 'จุดที่มีแสง', 'จำนวนจุดที่มีแสง',
           FIX, ACCESS, 'ผลตรวจ'],
    choices: {
      'บานประตู':   ['มือจับซ้าย', 'มือจับขวา'],
      'แสงเล็ดลอด': ['ไม่มีแสงเล็ดลอด', 'มีแสงเล็ดลอด']
    },
    good: { 'บานประตู': ['มือจับซ้าย', 'มือจับขวา'] },   /* เป็นข้อมูลห้อง ไม่ใช่ข้อบกพร่อง */
    warn: ['มีแสงเล็ดลอด'],
    num: { 'จำนวนจุดที่มีแสง': { ok: 0, warn: 2 } }
  },

  molding: {
    name: 'คิ้วบัวใต้ซิงค์', en: 'Sink molding', icon: '🪵',
    sheet: 'Molding', was: ['บันทึกคิ้วบัวใต้ซิงค์'],
    grade: 'ผลตรวจ',
    auto: [],
    /* ท้ายเลขห้องที่หมวดนี้ไม่ต้องมีเรคคอร์ดเลย — ห้องมุมไม่มีบัวใต้ซิงค์
       ห้อง 02/11 ยังต้องมีเรคคอร์ด แต่ช่องบัวจะเป็น "-" เพราะตามแบบไม่มีบัว */
    skip: ['01', '12'],
    cols: ['บัวซ้าย', 'บัวกลาง', 'บัวขวา',
           'ช่องรูซ้าย', 'ช่องรูกลาง', 'ช่องรูขวา',
           FIX, ACCESS, 'ผลตรวจ'],
    choices: {
      'บัวซ้าย':    ['ติดเรียบร้อย', 'ขอบบัวไม่สุดขาไม้', 'ไม่ได้ติดบัว'],
      'บัวกลาง':   ['ติดเรียบร้อย', 'ขอบบัวไม่สุดขาไม้', 'ไม่ได้ติดบัว'],
      'บัวขวา':     ['ติดเรียบร้อย', 'ขอบบัวไม่สุดขาไม้', 'ไม่ได้ติดบัว'],
      'ช่องรูซ้าย':  ['ไม่มีช่องรู', 'มีช่องรู'],
      'ช่องรูกลาง': ['ไม่มีช่องรู', 'มีช่องรู'],
      'ช่องรูขวา':   ['ไม่มีช่องรู', 'มีช่องรู']
    },
    /* เกณฑ์รับงาน: ต้องติดบัวครบทุกช่วง ขอบเดินไปสุดขาไม้ และไม่มีช่องรูผนัง–พื้น
       ค่าปกติจึงเหลือ 'ติดเรียบร้อย' อย่างเดียว (ตัวแรกของ choices) ไม่ต้องมี good
       ห้อง 02/11 ที่ตามแบบไม่มีบัว ช่องบัวลงเป็น '-' อยู่แล้ว จึงไม่โดนตัดเกรดตรงนี้ */
    warn: ['มีช่องรู']
  },

  bathgap: {
    name: 'หลืบห้องน้ำ', en: 'Bathroom shadow gap', icon: '🚿',
    sheet: 'Bathroom', was: [],
    grade: 'ผลตรวจ',
    /* คอลัมน์ที่หน้าเว็บรวมค่าให้เอง ไม่ใช่ตัวเลือกให้กด */
    auto: ['แบบ shadow gap'],
    cols: ['กระเบื้อง shadow gap', 'สี shadow gap', 'แบบ shadow gap',
           'สีหลืบ exhaust air', FIX, ACCESS, 'ผลตรวจ'],
    /* เกณฑ์รับงาน — ตัวแรกของแต่ละแถวคือค่าที่ผ่าน ที่เหลือเป็นข้อบกพร่อง
       ผ่าน = ปูกระเบื้องสุดขอบร่อง · ในร่อง shadow gap ไม่ทาสี
              · หลืบ exhaust air ทาสีจบในหลืบ ไม่ทาลงมาบนกระเบื้องผนัง */
    choices: {
      'กระเบื้อง shadow gap': ['กระเบื้องสุดขอบ', 'กระเบื้องไม่สุดขอบ'],
      'สี shadow gap':        ['ไม่ทาสี', 'ทาสีน้ำตาล', 'ทาสีขาว'],
      'สีหลืบ exhaust air':   ['ทาสีไม่ลงมาผนัง', 'ทาสีลงมาผนัง']
    }
  }

};

/* คำเก่า → คำใหม่ ใช้ตอนแปลงข้อมูลที่บันทึกไว้ก่อนเปลี่ยนชื่อตัวเลือก */
const RENAMED = {
  'ครบสามด้าน':      'ยิงครบทุกด้าน',
  'ขอบบนอย่างเดียว': 'ยิงขอบบนแค่ขอบบน (01&12)',
  'PASS':            'ผ่าน',
  'DEFECT':          'ไม่ผ่าน',
  /* เลิกใช้คำว่า "เกือบผ่าน" แล้ว — รวมเป็น "ไม่ผ่าน" แยกหนักเบาด้วยสีแทน */
  'เกือบผ่าน':        'ไม่ผ่าน',
  /* ม่าน: เกณฑ์ใหม่ถือว่าปิดแล้วเหลือระยะนิดหน่อยคือปิดสุด (ผ่าน)
     ไม่ผ่านคือปิดแล้วห่างกันเกิน 10 ซม. — แถวเก่าแปลงตามนี้แล้วสั่ง "ตัดเกรดใหม่" ต่อได้เลย */
  'ปิดเหลือระยะนิดหน่อย':   'ปิดสุด',
  'ปิดไม่ได้ เหลือครึ่งทาง': 'ปิดเหลือระยะห่างกันมากกว่า 10cm'
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
 *  'defect' = เฉพาะรอบที่มีหมวดไหนสักหมวดออกมาไม่ผ่าน (ทั้งเหลืองและแดง)
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

/* ชื่อแท็บแบบไม่ซีเรียส — ตัดช่องว่าง ตัวพิมพ์ใหญ่เล็ก และนับ & กับ and เป็นตัวเดียวกัน
   จะได้จับ "Curtain&Sheer" กับ "curtain and sheer" ว่าเป็นแท็บเดียวกัน */
function norm_(s) {
  return String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9฀-๿]/g, '');
}

/** หาแท็บของหมวดนี้แล้วจัดชื่อให้เป็นชื่อปัจจุบัน — ไม่เจอคืน null
 *  รับได้ทั้งชื่อปัจจุบัน ชื่อเก่าที่อยู่ใน was และชื่อที่พิมพ์ต่างกันนิดหน่อย
 *  ถ้าเข้าข่ายหลายแท็บ เลือกแท็บที่มีข้อมูลมากที่สุด (ข้อมูลเก่าจึงไม่ถูกทิ้ง)
 *  แท็บที่ชื่อชนกันแต่ไม่ได้ถูกเลือก จะโดนต่อท้ายว่า (สำรอง) ให้เอง ไม่มีอะไรถูกลบ */
function adoptSheet_(ss, name, was) {
  const want = [name].concat(was || []).map(norm_);
  const hits = ss.getSheets().filter(function (s) {
    return want.indexOf(norm_(s.getName())) !== -1;
  });
  if (!hits.length) return null;

  hits.sort(function (a, b) { return b.getLastRow() - a.getLastRow(); });
  const keep = hits[0];
  hits.slice(1).forEach(function (s) {
    if (s.getName() === name) s.setName(name + ' (สำรอง)');
  });
  if (keep.getName() !== name) keep.setName(name);
  return keep;
}

function sheetOf_(t) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('สคริปต์ไม่ได้ผูกกับชีต — ต้องเปิดจากเมนู ส่วนขยาย → Apps Script ในชีต');
  let sh = adoptSheet_(ss, t.sheet, t.was);
  if (!sh) sh = ss.insertSheet(t.sheet);
  return sh;
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

/*  จำคำตอบของการบันทึกที่สำเร็จไว้ 6 ชั่วโมง (เพดานของ CacheService)
    ใช้กันการบันทึกซ้ำเวลาหน้าเว็บส่งก้อนเดิมมาใหม่เพราะไม่ได้รับคำตอบครั้งแรก  */
function doneReply_(reqId) {
  if (!reqId) return null;
  try { return CacheService.getScriptCache().get('req:' + reqId); }
  catch (err) { return null; }
}
function keepReply_(reqId, obj) {
  if (!reqId) return;
  try { CacheService.getScriptCache().put('req:' + reqId, JSON.stringify(obj), 21600); }
  catch (err) { console.error('จำ reqId ไม่ได้: ' + err); }
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
      return json_({ ok: true, locked: !!TOKEN, readOpen: !!READ_OPEN,
                     topics: Object.keys(TOPICS) });
    }
    /* อ่านข้อมูลเปิดให้ทุกคนได้ถ้า READ_OPEN — การเขียนอยู่ที่ doPost ยังต้องมีรหัสเสมอ */
    const readOnly = (action === 'list' || action === 'config');
    if (!authed_(p) && !(READ_OPEN && readOnly)) {
      return json_({ ok: false, error: 'unauthorized' });
    }
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
  /*  เน็ตหลุดตอนรอคำตอบ หน้าเว็บจะส่งก้อนเดิมมาใหม่พร้อม reqId เดิม
      ถ้าก้อนนี้เคยบันทึกไปแล้ว ตอบคำตอบเดิมกลับไปเฉย ๆ จะได้ไม่มีแถวซ้ำและไม่ยิงไลน์ซ้ำ  */
  let body;
  try { body = parseBody_(e); }
  catch (err) { return json_({ ok: false, error: 'อ่านข้อมูลที่ส่งมาไม่ได้: ' + err }); }
  const reqId = String(body.reqId || '');
  const cached = doneReply_(reqId);
  if (cached) return ContentService.createTextOutput(cached)
    .setMimeType(ContentService.MimeType.JSON);

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return json_({ ok: false, error: 'ชีตกำลังถูกเขียนอยู่ ลองใหม่อีกครั้ง' });
  }
  try {
    /* ก้อนเดิมอาจกำลังเขียนอยู่ตอนที่เราเข้าคิว — พอได้ล็อกแล้วเช็คซ้ำอีกที */
    const again = doneReply_(reqId);
    if (again) return ContentService.createTextOutput(again)
      .setMimeType(ContentService.MimeType.JSON);

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
      /* "ไม่ผ่าน" สองระดับใช้คำเดียวกัน สีจึงต้องระบายเอง หลังก๊อปรูปแบบแถวต้นแบบมาแล้ว */
      paintGrade_(t, sh, head, rowIndex, rec);

      saved.push({ topic: en.topic, t: t, room: room, rec: rec, prev: prev,
                   defects: en.defects || null,
                   changes: prev ? diff_(t, prev, rec) : null });
    });

    notifySave_(saved, body);
    try { buildSummary_(); } catch (err) { console.error('อัปเดตหน้าสรุปไม่สำเร็จ: ' + err); }

    const out = { ok: true, saved: saved.map(function (s) {
      return { topic: s.topic, room: s.room, grade: s.rec[s.t.grade] || '' };
    }) };
    keepReply_(reqId, out);
    return json_(out);
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

/* ช่องไหนเปลี่ยนไปบ้างระหว่างบันทึกเก่ากับใหม่
   คำเก่า "เกือบผ่าน" นับเป็นคำเดียวกับ "ไม่ผ่าน" จะได้ไม่ฟ้องว่าเปลี่ยนทั้งที่ผลเท่าเดิม */
function sameWord_(v) {
  const s = String(v || '');
  return s === OLD_WARN ? LEVEL_TEXT.warn : s;
}
function diff_(t, prev, cur) {
  return compareCols_(t).filter(function (h) {
    return sameWord_(prev[h]) !== sameWord_(cur[h]);
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
  /* ไอคอนแยกเหลืองกับแดงให้เห็นในไลน์ ทั้งที่คำเดียวกัน */
  const icon = LEVEL_ICON[levelOf_(t, rec)] || '⬜';
  const head = t.icon + ' ' + t.name;
  const lines = [];

  if (s.changes) {                                   /* เคยตรวจแล้ว — บอกเฉพาะที่เปลี่ยน */
    lines.push(head + ' — 🔁 แก้ไขผลตรวจ');
    const g = s.changes.filter(function (c) { return c.field === t.grade; })[0];
    const wasIcon = s.prev ? (LEVEL_ICON[levelOf_(t, s.prev)] || '⬜') : '⬜';
    lines.push(g ? '   ' + wasIcon + ' ' + g.from + '  →  ' + icon + ' ' + g.to
                 : '   ' + icon + ' ผลตรวจยังเป็น ' + grade);
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
  /* หมวดเก็บข้อมูล ยังไม่ตัดเกรด — บอกไปเลยว่าห้องนี้เป็นแบบไหน แทนคำว่าปกติทุกหัวข้อ */
  if (t.survey) {
    t.cols.filter(function (c) { return c !== t.grade && c !== ACCESS; })
      .forEach(function (c) { if (rec[c] && rec[c] !== '-') lines.push('   • ' + c + ': ' + rec[c]); });
    if (rec['หมายเหตุ']) lines.push('   หมายเหตุ: ' + rec['หมายเหตุ']);
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
  if (rec[FIX]) lines.push('   รอบตามแก้: ' + rec[FIX]);
  if (rec['หมายเหตุ']) lines.push('   หมายเหตุ: ' + rec['หมายเหตุ']);
  return lines;
}

/** หนึ่งครั้งที่กดบันทึก = หนึ่งข้อความ ต่อให้ในรอบนั้นอัปเดตหลายหมวดก็ตาม */
function notifySave_(saved, body) {
  if (NOTIFY_WHEN === 'off' || !saved.length) return;

  const anyChange = saved.some(function (s) { return !s.changes || s.changes.length; });
  const anyDefect = saved.some(function (s) {
    const lv = levelOf_(s.t, s.rec);
    return lv === 'bad' || lv === 'warn';
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
    .addItem('ล้างข้อมูลทั้งห้อง (ทุกหมวดในครั้งเดียว)', 'clearRoom')
    .addItem('ตั้งค่าชีตทุกหมวด (จัดหน้าตา + ดรอปดาวน์ + สีเกรด)', 'setupSheet')
    .addItem('ตัดเกรดใหม่จากข้อมูลเดิม (ใช้ตอนเปลี่ยนเกณฑ์)', 'regrade')
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
  done: { bg: '#DDEAF3', fg: '#2A6484' },
  width: { 'วันที่ตรวจ': 96, 'ชั้น': 52, 'ห้อง': 62, 'หมายเหตุ': 230,
           'ผู้ตรวจ': 92, 'บันทึกเมื่อ': 128,
           'กระเบื้อง shadow gap': 156, 'สี shadow gap': 108,
           'แบบ shadow gap': 232, 'สีหลืบ exhaust air': 152 },
  center: ['ชั้น', 'ห้อง', 'จำนวนจุดที่มีแสง', 'เวลาน้ำร้อน (วินาที)', 'เวลาแอร์เย็น (นาที)',
           'อุณหภูมิน้ำที่วัดได้ (°C)', 'อุณหภูมิที่ตั้งแอร์ (°C)', 'อุณหภูมิห้องที่วัดได้ (°C)']
};

/** ค่าที่ถือว่าเป็นไม่ผ่านระดับเหลือง ที่เหลือที่ไม่ใช่ค่าปกติ = แดง */
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

/** ระบายช่องผลตรวจของแถวเดียว ตามระดับของแถวนั้น */
function paintGrade_(t, sh, head, row, rec) {
  const iG = head.indexOf(t.grade);
  if (iG < 0) return;
  const lv = levelOf_(t, rec);
  const cell = sh.getRange(row, iG + 1);
  if (lv === 'warn' || lv === 'bad') {
    cell.setBackground(LEVEL_COLOR[lv].bg).setFontColor(LEVEL_COLOR[lv].fg);
  } else {
    cell.setBackground(null).setFontColor(null);   /* ที่เหลือปล่อยให้กฎตามคำจัดการ */
  }
}

/** ระบายช่องผลตรวจใหม่ทั้งคอลัมน์ — เรียกหลังจากที่รูปแบบอาจถูกก๊อปทับ
 *  (จัดรูปแบบทุกแถว / ตั้งค่าชีต / ตัดเกรดใหม่) */
function repaintGrades_(t, sh, head) {
  const last = sh.getLastRow();
  const iG = head.indexOf(t.grade), iRoom = head.indexOf('ห้อง');
  if (last < 2 || iG < 0) return 0;

  const values = sh.getRange(2, 1, last - 1, head.length).getValues();
  const bg = [], fg = [];
  values.forEach(function (r) {
    const row = {};
    head.forEach(function (h, j) { row[h] = cellText_(r[j], h); });
    const lv = (iRoom < 0 || String(r[iRoom]).trim() !== '') ? levelOf_(t, row) : '';
    const paint = (lv === 'warn' || lv === 'bad');
    bg.push([paint ? LEVEL_COLOR[lv].bg : null]);
    fg.push([paint ? LEVEL_COLOR[lv].fg : null]);
  });
  const range = sh.getRange(2, iG + 1, last - 1, 1);
  range.setBackgrounds(bg);
  range.setFontColors(fg);
  return last - 1;
}

/* ตั้งค่าชีตให้กรอกมือได้โดยไม่พิมพ์ผิด + จัดหน้าตาให้เหมือนกันทุกแท็บ
   รันซ้ำได้ไม่มีผลเสีย */
function setupSheet() {
  eachTopic_(function (t, sh, head) {
    migrateLabels_(t, sh, head);
    styleSheet_(t, sh, head);
    restyleAll_(sh, head);   /* แถวที่บันทึกไปก่อนหน้านี้จะได้หน้าตาเหมือนกันทั้งตาราง */
    repaintGrades_(t, sh, head);
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
    all[FIX] = FIX_CHOICES;
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
    /* ช่องรอบตามแก้ — รอแก้ไขเป็นเหลือง (ยังค้าง) ส่วนอนุโลม/แก้ไขแล้วเป็นน้ำเงิน (ปิดจบ) */
    FIX_CHOICES.forEach(function (v) {
      const col = head.indexOf(FIX) + 1;
      if (col > 0) add(col, v, fixClosed_(v) ? LOOK.done : LOOK.warn);
    });
    /* ช่องผลตรวจ — "ผ่าน" กับ "ไม่ได้ตรวจ" ระบายด้วยกฎตามคำได้เลย
       ส่วน "ไม่ผ่าน" มีสองสีแต่คำเดียวกัน กฎตามคำจึงแยกไม่ออก ต้องระบายเอง
       ทีละแถวใน repaintGrades_() (กฎ conditional format ทับสีที่ระบายเองเสมอ
       จึงต้องไม่ตั้งกฎของคำว่า "ไม่ผ่าน" ไว้ตรงนี้) */
    ['ok', 'skip'].forEach(function (lv) {
      const col = head.indexOf(t.grade) + 1;
      if (col > 0) add(col, LEVEL_TEXT[lv], LEVEL_COLOR[lv]);
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

/* =============== ล้างข้อมูลทั้งห้อง ===============
   หน้าเว็บมีแต่ "เพิ่ม" ไม่เคยลบอะไรในชีต การลบจึงทำจากในชีตอย่างเดียว
   เมนูนี้ลบให้ครบทุกหมวดในครั้งเดียว จะได้ไม่ต้องไล่ลบทีละแท็บ           */

/** เลขแถวของห้องที่ระบุในแท็บนี้ (ห้องหนึ่งมีได้หลายแถว ถ้าเคยบันทึกทับ) */
function roomRows_(sh, head, rooms) {
  const last = sh.getLastRow();
  const iRoom = head.indexOf('ห้อง');
  if (last < 2 || iRoom < 0) return [];
  const values = sh.getRange(2, iRoom + 1, last - 1, 1).getValues();
  const out = [];
  values.forEach(function (r, i) {
    if (rooms.indexOf(String(r[0]).trim()) !== -1) out.push(i + 2);
  });
  return out;
}

/** เมนู: ล้างข้อมูลของห้องที่ระบุ ทุกหมวด — ใช้ตอนอยากเริ่มตรวจห้องนั้นใหม่หมด */
function clearRoom() {
  const ui = SpreadsheetApp.getUi();
  const ask = ui.prompt('ล้างข้อมูลทั้งห้อง',
    'ใส่เลขห้องที่จะลบ ระบบจะลบให้ครบทุกหมวดในครั้งเดียว\n' +
    'ใส่หลายห้องได้ คั่นด้วยเว้นวรรคหรือจุลภาค เช่น   304 305, 411',
    ui.ButtonSet.OK_CANCEL);
  if (ask.getSelectedButton() !== ui.Button.OK) return;

  const rooms = String(ask.getResponseText() || '').split(/[\s,]+/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s; });
  if (!rooms.length) { ui.alert('ยังไม่ได้ใส่เลขห้อง'); return; }

  const detail = [];
  let total = 0;
  eachTopic_(function (t, sh, head) {
    const n = roomRows_(sh, head, rooms).length;
    if (n) { detail.push('• ' + t.icon + ' ' + t.name + ' — ' + n + ' แถว'); total += n; }
  });
  if (!total) { ui.alert('ไม่พบข้อมูลของห้อง ' + rooms.join(', ') + ' ในหมวดไหนเลย'); return; }

  const yes = ui.alert('ยืนยันการลบ',
    'ห้อง ' + rooms.join(', ') + ' จะถูกลบทั้งหมด ' + total + ' แถว\n\n' +
    detail.join('\n') + '\n\nลบแล้วห้องนี้จะกลับไปเป็น "ยังไม่ตรวจ" ทุกหมวด',
    ui.ButtonSet.YES_NO);
  if (yes !== ui.Button.YES) return;

  const n = eachTopic_(function (t, sh, head) {
    const rows = roomRows_(sh, head, rooms);
    for (let i = rows.length - 1; i >= 0; i--) sh.deleteRow(rows[i]);   /* ลบจากล่างขึ้นบน เลขแถวจะได้ไม่เลื่อน */
    return rows.length;
  }).reduce(function (a, b) { return a + b; }, 0);

  buildSummary_();
  SpreadsheetApp.getActive().toast(
    'ลบแล้ว ' + n + ' แถว · อัปเดตหน้าสรุปให้แล้ว — หน้าเว็บจะตามภายในไม่เกินครึ่งนาที',
    'เช็คห้อง', 8);
}

/* =============== ตัดเกรดใหม่จากข้อมูลเดิม ===============
   ช่องผลตรวจในชีตเก็บเกรดที่ตัดไว้ ณ ตอนกดบันทึก ถ้าวันหลังเปลี่ยนเกณฑ์
   (เช่น หมวดเก็บข้อมูลอย่างหลืบห้องน้ำ สรุปได้แล้วว่าแบบไหนคือแบบที่ถูก)
   แถวเก่ายังถือเกรดเดิมอยู่ เมนูนี้คิดเกรดใหม่จากค่าที่เก็บไว้แล้วในแต่ละแถว
   จะได้ไม่ต้องเดินไล่กรอกใหม่ทุกห้อง                                        */

/** ระดับที่ควรจะเป็นของแถวหนึ่ง คิดจากค่าที่เก็บไว้ ตามเกณฑ์ล่าสุดของหมวดนั้น
 *  ใช้เกณฑ์ชุดเดียวกับที่ระบายสีในชีต — ค่าที่ไม่ใช่ค่าปกติ ถ้าอยู่ใน warn = เหลือง
 *  ที่เหลือ = แดง  ·  คืนค่าว่าง = ยังบอกไม่ได้ ให้ปล่อยของเดิมไว้ */
function levelOfRow_(t, row) {
  const acc = String(row[ACCESS] || '').trim();
  if (!acc) return '';                                  /* แถวเก่าก่อนมีคอลัมน์นี้ ไม่แตะ */
  if (acc !== ACCESS_CHOICES[0]) return 'skip';
  const warns = warnValues_(t);
  let warn = false, bad = false;
  for (let i = 0; i < t.cols.length; i++) {
    const c = t.cols[i];
    if (c === t.grade || c === ACCESS || c === FIX || t.auto.indexOf(c) !== -1) continue;
    const v = String(row[c] || '').trim();
    if (!v || v === '-') continue;                      /* ช่องที่หมวดนี้ไม่ตรวจในห้องนั้น */
    /* ช่องข้อความยาวที่ไม่มีตัวเลือกตายตัว — ตัดสินจากคำที่โผล่อยู่ในช่อง */
    if (t.has && t.has[c]) {
      if (hasBad_(t.has[c], v)) bad = true;
      continue;
    }
    if (t.num && t.num[c]) {
      const n = Number(v), spec = t.num[c];
      if (isNaN(n)) continue;
      if (spec.ok !== undefined) {
        if (n > spec.warn) bad = true;
        else if (n > spec.ok) warn = true;
      } else {
        if (n < spec.warnMin || n > spec.warnMax) bad = true;
        else if (n < spec.min || n > spec.max) warn = true;
      }
      continue;
    }
    if (isGood_(t, c, v)) continue;
    if (warns.indexOf(v) !== -1) warn = true;
    else bad = true;
  }
  /* เจอข้อบกพร่องแล้วรอบตามแก้จบไปแล้ว (อนุโลม/แก้ไขแล้ว) = ปิดจบ ไม่นับเป็นห้องที่ต้องแก้ */
  if ((bad || warn) && fixClosed_(row[FIX])) return 'done';
  return bad ? 'bad' : warn ? 'warn' : 'ok';
}

/** คำที่ควรอยู่ในช่องผลตรวจของแถวนี้ — ว่าง = ยังบอกไม่ได้ ให้ปล่อยคำเดิมไว้ */
function gradeOfRow_(t, row) {
  const lv = levelOfRow_(t, row);
  return lv ? LEVEL_TEXT[lv] : '';
}

/** ระดับของแถวที่บันทึกไว้แล้ว ใช้เลือกสี — คำในช่องผลตรวจเป็นตัวตัดสินว่าผ่านหรือไม่
 *  ถ้าไม่ผ่าน ค่อยคิดจากค่าที่กรอกไว้ว่าเหลืองหรือแดง (คิดไม่ได้ = แดงไว้ก่อน)
 *  สีจึงไม่มีทางขัดกับคำ ต่อให้เกณฑ์เปลี่ยนหลังจากบันทึกไปแล้ว */
function levelOf_(t, row) {
  const g = String(row[t.grade] || '').trim();
  if (!g) return '';
  if (g === LEVEL_TEXT.skip) return 'skip';
  /* ช่องสถานะแก้ไขมาก่อนคำในช่องผลตรวจ — กดอนุโลมในชีตเองแล้วห้องนั้นปิดจบทันที
     ไม่ต้องรอให้ใครกดบันทึกจากหน้าเว็บใหม่ */
  if (fixClosed_(row[FIX])) return 'done';
  if (g === LEVEL_TEXT.ok)  return 'ok';
  if (g === OLD_WARN)       return 'warn';       /* แถวเก่าที่ยังไม่ได้แปลงคำ */
  if (g !== LEVEL_TEXT.bad) return '';
  return levelOfRow_(t, row) === 'warn' ? 'warn' : 'bad';
}

/** เมนู: ตัดเกรดใหม่ทุกแถวทุกหมวด — บอกก่อนว่าจะเปลี่ยนกี่แถว แล้วค่อยยืนยัน */
function regrade() {
  const ui = SpreadsheetApp.getUi();
  const plan = eachTopic_(function (t, sh, head) {
    const iG = head.indexOf(t.grade);
    const last = sh.getLastRow();
    if (iG < 0 || last < 2) return { t: t, sh: sh, iG: iG, rows: [] };
    const values = sh.getRange(2, 1, last - 1, head.length).getValues();
    const rows = [];
    values.forEach(function (r, i) {
      if (String(r[head.indexOf('ห้อง')]).trim() === '') return;
      const row = {};
      head.forEach(function (h, j) { row[h] = cellText_(r[j], h); });
      const want = gradeOfRow_(t, row);
      if (want && want !== String(r[iG]).trim()) rows.push({ n: i + 2, from: String(r[iG]).trim(), to: want });
    });
    return { t: t, sh: sh, iG: iG, rows: rows };
  });

  const total = plan.reduce(function (a, p) { return a + p.rows.length; }, 0);
  if (!total) { ui.alert('ทุกแถวตรงกับเกณฑ์ล่าสุดอยู่แล้ว ไม่มีอะไรต้องเปลี่ยน'); return; }

  const detail = plan.filter(function (p) { return p.rows.length; }).map(function (p) {
    return '• ' + p.t.icon + ' ' + p.t.name + ' — ' + p.rows.length + ' แถว';
  });
  const yes = ui.alert('ตัดเกรดใหม่จากข้อมูลเดิม',
    'จะเขียนทับช่องผลตรวจ ' + total + ' แถว\n\n' + detail.join('\n') +
    '\n\nคิดจากค่าที่กรอกไว้แล้วในแต่ละแถว ไม่แตะค่าอื่นในตาราง',
    ui.ButtonSet.YES_NO);
  if (yes !== ui.Button.YES) return;

  plan.forEach(function (p) {
    p.rows.forEach(function (r) { p.sh.getRange(r.n, p.iG + 1).setValue(r.to); });
  });
  /* คำอาจเหมือนเดิมแต่ความหนักเบาเปลี่ยน — ระบายสีใหม่ทั้งคอลัมน์ไว้ก่อน */
  eachTopic_(function (t, sh, head) { return repaintGrades_(t, sh, head); });
  buildSummary_();
  SpreadsheetApp.getActive().toast(
    'ตัดเกรดใหม่แล้ว ' + total + ' แถว · อัปเดตหน้าสรุปให้แล้ว', 'เช็คห้อง', 8);
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
  const n = eachTopic_(function (t, sh, head) {
    const rows = restyleAll_(sh, head);
    repaintGrades_(t, sh, head);   /* ก๊อปรูปแบบทับไปแล้ว ต้องระบายสีผลตรวจคืน */
    return rows;
  }).reduce(function (a, b) { return a + b; }, 0);
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

/** ช่องข้อความยาวมีคำที่ถือว่าไม่ผ่านอยู่ไหม — ใช้กับช่องที่ไม่มีตัวเลือกตายตัว
 *  เช่นช่องจุดแสงลอดม่าน ที่เก็บเป็นรายชื่อจุดคั่นด้วย · */
function hasBad_(keys, v) {
  const s = String(v || '');
  return keys.some(function (k) { return s.indexOf(k) !== -1; });
}

/** สรุปเป็นข้อความว่าห้องนี้ตกเพราะอะไร */
function whyOf_(t, row) {
  const out = [];
  if (row[ACCESS] && row[ACCESS] !== ACCESS_CHOICES[0]) return row[ACCESS];
  t.cols.forEach(function (c) {
    if (c === t.grade || c === ACCESS || c === FIX || t.auto.indexOf(c) !== -1) return;
    const v = String(row[c] || '').trim();
    if (!v || v === '-') return;
    if (t.has && t.has[c]) { if (hasBad_(t.has[c], v)) out.push(c + ': ' + v); return; }
    if (t.num && t.num[c]) { if (numBad_(t.num[c], Number(v))) out.push(c + ': ' + v); return; }
    if (!isGood_(t, c, v)) out.push(c + ': ' + v);
  });
  return out.join(' · ');
}

const TOTAL_ROOMS = (FLOOR_TO - FLOOR_FROM + 1) * ROOMS_PER_FLOOR;

/* บางหมวดไม่ต้องตรวจบางห้องตามแบบ (skip = ท้ายเลขห้องที่ข้าม)
   ห้องพวกนั้นไม่ต้องมีเรคคอร์ด และไม่ถูกนับเป็นห้องที่ยังตรวจไม่ครบ */
function skipOf_(t)     { return t.skip || []; }
function perFloorOf_(t) { return ROOMS_PER_FLOOR - skipOf_(t).length; }
function totalOf_(t)    { return (FLOOR_TO - FLOOR_FROM + 1) * perFloorOf_(t); }

/* จำนวนคอลัมน์ของแท็บสรุป — ทุกแถวถูกเติมให้ยาวเท่านี้เสมอก่อนเขียนลงชีต */
const SUM_COLS = 10;

/** สร้าง/อัปเดตแท็บสรุปรวม — เรียกจากเมนู และเรียกเองทุกครั้งที่บันทึก */
function buildSummary_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = adoptSheet_(ss, SUMMARY_SHEET, SUMMARY_WAS);
  if (!sh) sh = ss.insertSheet(SUMMARY_SHEET, 0);

  const ids = Object.keys(TOPICS);
  const latest = {};
  ids.forEach(function (id) { latest[id] = latestByRoom_(id); });

  const rows = [];
  const blank = function () { const a = []; while (a.length < SUM_COLS) a.push(''); return a; };
  const line1 = function (text) { const a = blank(); a[0] = text; return a; };
  const pad   = function (a) { while (a.length < SUM_COLS) a.push(''); return a; };

  const now = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
  rows.push(line1('📋 สรุปการตรวจห้อง'));
  rows.push(line1('อัปเดตล่าสุด ' + now + ' · ทั้งหมด ' + TOTAL_ROOMS + ' ห้อง (ชั้น ' +
             FLOOR_FROM + '–' + FLOOR_TO + ' ชั้นละ ' + ROOMS_PER_FLOOR + ' ห้อง)'));
  rows.push(blank());

  /* ---- ภาพรวมรายหมวด ---- */
  /* สองคอลัมน์กลางเป็น "ไม่ผ่าน" ทั้งคู่ ต่างกันที่สี — ใส่วงเล็บกำกับไว้ที่หัวตาราง
     เพราะหัวตารางเป็นพื้นเขียวเหมือนกันหมด ระบายสีแยกไม่ได้
     "ปิดจบ" คือห้องที่เคยไม่ผ่าน แล้วรอบตามแก้จบแล้ว (อนุโลม/แก้ไขแล้ว) */
  const headA = ['หมวด', 'ตรวจแล้ว', 'เหลือ', 'ความคืบหน้า',
                 'ผ่าน', 'ปิดจบ (อนุโลม/แก้ไขแล้ว)', 'ไม่ผ่าน (เหลือง)', 'ไม่ผ่าน (แดง)',
                 'ไม่ได้ตรวจ', 'ยังรอแก้ไข'];
  rows.push(headA);
  const bandA = rows.length;                       /* แถวหัวของบล็อกแรก */
  const totals = { rec: 0, fix: 0, want: 0, closed: 0 };
  ids.forEach(function (id) {
    const t = TOPICS[id], m = latest[id], rooms = Object.keys(m);
    const want = totalOf_(t);
    const c = {}; LEVELS.forEach(function (lv) { c[lv] = 0; });
    rooms.forEach(function (rn) { const lv = levelOf_(t, m[rn]); if (c[lv] !== undefined) c[lv]++; });
    const fix = c.bad + c.warn;
    totals.rec += rooms.length; totals.fix += fix;
    totals.want += want; totals.closed += c.done;
    rows.push([t.icon + ' ' + t.name, rooms.length, want - rooms.length,
               rooms.length / want,
               c.ok, c.done, c.warn, c.bad, c.skip, fix]);
  });
  rows.push(['รวมทุกหมวด', totals.rec, totals.want - totals.rec,
             totals.rec / totals.want, '', totals.closed, '', '', '', totals.fix]);
  const endA = rows.length;

  /* ---- ความคืบหน้ารายชั้น ---- */
  rows.push(blank());
  rows.push(line1('ความคืบหน้ารายชั้น (ตรวจแล้ว / ที่ต้องตรวจในชั้นนั้น)'));
  const headB = ['ชั้น'].concat(ids.map(function (id) { return TOPICS[id].icon + ' ' + TOPICS[id].name; }));
  rows.push(pad(headB));
  const bandB = rows.length;
  for (let f = FLOOR_FROM; f <= FLOOR_TO; f++) {
    const line = ['ชั้น ' + f];
    ids.forEach(function (id) {
      let n = 0;
      for (let i = 1; i <= ROOMS_PER_FLOOR; i++) if (latest[id][String(f * 100 + i)]) n++;
      line.push(n + '/' + perFloorOf_(TOPICS[id]));
    });
    rows.push(pad(line));
  }
  const endB = rows.length;

  /* ---- ห้องที่ยังรอแก้ไข กับ ห้องที่ปิดจบไปแล้ว ----
     แยกกันคนละบล็อก บล็อกแรกคือรายชื่อที่ต้องเดินไปตามจริง ๆ
     บล็อกหลังเก็บไว้ให้ตามย้อนได้ว่าห้องไหนอนุโลม ห้องไหนแก้แล้ว เดิมเสียตรงไหน */
  const byRoom = function (a, b) {
    return String(a.row[0]).localeCompare(String(b.row[0]), 'th', { numeric: true });
  };
  const pick = function (want) {
    const out = [];
    ids.forEach(function (id) {
      const t = TOPICS[id], m = latest[id];
      Object.keys(m).forEach(function (rn) {
        const lv = levelOf_(t, m[rn]);
        if (want.indexOf(lv) === -1) return;
        const state = lv === 'done' ? String(m[rn][FIX] || '').trim() : LEVEL_TEXT[lv];
        out.push({ lv: lv,
          row: pad([rn, m[rn]['ชั้น'], t.icon + ' ' + t.name, state, whyOf_(t, m[rn]),
                    fmtDate_(m[rn]['วันที่ตรวจ']), m[rn]['ผู้ตรวจ'] || '']) });
      });
    });
    return out.sort(byRoom);
  };

  rows.push(blank());
  rows.push(line1('ห้องที่ยังรอแก้ไข'));
  rows.push(pad(['ห้อง', 'ชั้น', 'หมวด', 'ผล', 'รายละเอียด', 'วันที่ตรวจ', 'ผู้ตรวจ']));
  const bandC = rows.length;
  const fixes = pick(['bad', 'warn']);
  if (fixes.length) fixes.forEach(function (f) { rows.push(f.row); });
  else rows.push(line1('— ยังไม่มีห้องที่รอแก้ไข —'));
  const endC = rows.length;

  rows.push(blank());
  rows.push(line1('ปิดจบแล้ว — อนุโลม / แก้ไขแล้ว'));
  rows.push(pad(['ห้อง', 'ชั้น', 'หมวด', 'สถานะ', 'เดิมไม่ผ่านตรงไหน', 'วันที่ตรวจ', 'ผู้ตรวจ']));
  const bandD = rows.length;
  const closed = pick(['done']);
  if (closed.length) closed.forEach(function (f) { rows.push(f.row); });
  else rows.push(line1('— ยังไม่มีห้องที่ปิดจบด้วยการอนุโลมหรือแก้ไขแล้ว —'));
  const endD = rows.length;

  /* ---- เขียนลงชีต ---- */
  if (sh.getMaxRows() < rows.length + 20) {
    sh.insertRowsAfter(sh.getMaxRows(), rows.length + 20 - sh.getMaxRows());
  }
  if (sh.getMaxColumns() < SUM_COLS) {
    sh.insertColumnsAfter(sh.getMaxColumns(), SUM_COLS - sh.getMaxColumns());
  }
  sh.clear();
  sh.clearConditionalFormatRules();
  sh.getBandings().forEach(function (b) { b.remove(); });
  sh.getRange(1, 1, rows.length, SUM_COLS).setValues(rows);

  /* ---- แต่งหน้า ---- */
  sh.setFrozenRows(3);
  sh.getRange('A1').setFontSize(15).setFontWeight('bold').setFontColor(LOOK.headBg);
  sh.getRange('A2').setFontSize(10).setFontColor('#6B7A8D');
  [bandA, bandB, bandC, bandD].forEach(function (r) {
    sh.getRange(r, 1, 1, SUM_COLS).setBackground(LOOK.headBg).setFontColor(LOOK.headFg)
      .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center')
      .setVerticalAlignment('middle').setWrap(true);   /* หัวยาวอย่าง "ไม่ผ่าน (เหลือง)" จะได้ไม่ล้น */
  });
  [bandB - 1, bandC - 1, bandD - 1].forEach(function (r) {
    sh.getRange(r, 1, 1, SUM_COLS).setFontWeight('bold').setFontSize(11).setFontColor(LOOK.headBg);
  });
  sh.setColumnWidth(1, 190);
  /* คอลัมน์ 5 เป็นช่องรายละเอียดของสองบล็อกล่าง เลยต้องกว้างกว่าเพื่อน */
  for (let c = 2; c <= SUM_COLS; c++) sh.setColumnWidth(c, c === 5 ? 300 : 108);

  sh.getRange(bandA + 1, 2, ids.length + 1, SUM_COLS - 1).setHorizontalAlignment('center');
  sh.getRange(bandA + 1, 4, ids.length + 1, 1).setNumberFormat('0.0%');
  sh.getRange(endA, 1, 1, SUM_COLS).setFontWeight('bold').setBackground('#EFF3F7');
  sh.getRange(bandB + 1, 2, endB - bandB, SUM_COLS - 1).setHorizontalAlignment('center');
  [[bandC, endC], [bandD, endD]].forEach(function (b) {
    sh.getRange(b[0] + 1, 1, b[1] - b[0], 4).setHorizontalAlignment('center');
    sh.getRange(b[0] + 1, 5, b[1] - b[0], 1).setHorizontalAlignment('left');
  });

  [[bandA, endA], [bandB, endB], [bandC, endC], [bandD, endD]].forEach(function (b) {
    sh.getRange(b[0], 1, b[1] - b[0] + 1, SUM_COLS)
      .setBorder(true, true, true, true, true, true, LOOK.grid, SpreadsheetApp.BorderStyle.SOLID);
  });

  /* สีของช่องนับจำนวน — ระบายตามระดับของคอลัมน์นั้นไปเลย (คอลัมน์ 5–9 = ok done warn bad skip) */
  const rules = [];
  if (ids.length) {
    ['ok', 'done', 'warn', 'bad', 'skip'].forEach(function (lv, i) {
      sh.getRange(bandA + 1, 5 + i, ids.length, 1)
        .setBackground(LEVEL_COLOR[lv].bg).setFontColor(LEVEL_COLOR[lv].fg);
    });
  }
  /* ช่อง "ผล" ของรายการห้องที่รอแก้ไข — คำเดียวกันสองสี ระบายทีละแถวเอง
     ส่วนบล็อกปิดจบใช้สีเดียวกันหมด ระบายรวดเดียวได้ */
  if (fixes.length) {
    const bg = fixes.map(function (f) { return [LEVEL_COLOR[f.lv].bg]; });
    const fg = fixes.map(function (f) { return [LEVEL_COLOR[f.lv].fg]; });
    const cell = sh.getRange(bandC + 1, 4, fixes.length, 1);
    cell.setBackgrounds(bg);
    cell.setFontColors(fg);
  }
  if (closed.length) {
    sh.getRange(bandD + 1, 4, closed.length, 1)
      .setBackground(LEVEL_COLOR.done.bg).setFontColor(LEVEL_COLOR.done.fg);
  }
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(0).setBackground(LOOK.bad.bg).setFontColor(LOOK.bad.fg)
    .setRanges([sh.getRange(bandA + 1, SUM_COLS, ids.length, 1)]).build());
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

    const cnt = {}; LEVELS.forEach(function (lv) { cnt[lv] = 0; });
    const failed = [];
    rows.forEach(function (r) {
      const lv = levelOf_(t, r);
      if (cnt[lv] !== undefined) cnt[lv]++;
      if (lv === 'bad' || lv === 'warn') failed.push(r['ห้อง']);
    });
    total += rows.length;

    msg.push('');
    msg.push(t.icon + ' ' + t.name + ' — บันทึก ' + rows.length + ' รายการ');
    msg.push('   ✅ ' + cnt.ok + ' · ☑️ ' + cnt.done + ' · ⚠️ ' + cnt.warn +
             ' · ❌ ' + cnt.bad + ' · ⬜ ' + cnt.skip);
    if (failed.length) msg.push('   ห้องที่รอแก้ไข: ' + failed.join(', '));
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
    defect: 'แจ้งเฉพาะรอบที่มีหมวดไม่ผ่าน (ทั้งเหลืองและแดง)',
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
    const sh = adoptSheet_(ss, t.sheet, t.was);
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
