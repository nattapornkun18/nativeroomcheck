/*  บันทึกตรวจซิลิโคนขอบอ่าง — Google Apps Script
 *  วางไฟล์นี้ใน Apps Script ที่ผูกกับ Google Sheet แล้ว Deploy เป็น Web App
 *  ตั้งค่า: Execute as = Me, Who has access = Anyone
 */

const SHEET_NAME = 'บันทึกตรวจ';   // ชื่อแท็บในชีต

const HEAD = ['วันที่ตรวจ','ชั้น','ห้อง','ขอบเขตงาน','สีที่ใช้','ระยะขอบ','ตัดขอบ',
              'ฟองอากาศ','กินผนัง','สภาพผนัง','เกรด','หมายเหตุ','ผู้ตรวจ','บันทึกเมื่อ'];

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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

/* อ่านข้อมูลทั้งหมด */
function doGet(e) {
  try {
    const sh = getSheet_();
    const values = sh.getDataRange().getValues();
    if (values.length < 2) return json_({ ok: true, rows: [] });

    const head = values[0].map(String);
    const rows = values.slice(1)
      .filter(function (r) { return String(r[2]).trim() !== ''; })   // ต้องมีเลขห้อง
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
  lock.waitLock(20000);
  try {
    const sh = getSheet_();
    const p = (e && e.parameter) ? e.parameter : {};

    if (!p['ห้อง']) throw new Error('ไม่ได้ระบุเลขห้อง');

    if (!p['บันทึกเมื่อ']) {
      p['บันทึกเมื่อ'] = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm');
    }

    const row = HEAD.map(function (h) { return p[h] || ''; });
    sh.appendRow(row);

    return json_({ ok: true, room: p['ห้อง'], grade: p['เกรด'] || '' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
