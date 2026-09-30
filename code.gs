/**
 * Job calendar backend (Google Apps Script) with access codes.
 * Needs the appsscript.json manifest that comes with it (narrow Drive scope + Drive API service).
 * After any change: Deploy > Manage deployments > Edit > New version.
 *
 * NOTES FOR THIS ENVIRONMENT
 * Index.html reaches the browsers used with this project through something that damages any
 * text from two forward slashes in a row to the end of that line, even inside quoted web
 * addresses. That breaks the page script (blank calendar, no sign in box). To keep it working,
 * Index.html contains no line comments and never has two slashes in a row anywhere: it uses block
 * comments only, and builds web addresses from single slashes (API_URL, driveThumb, PRODID).
 * The full explanation and the list of changes are in the notes at the top of Index.html.
 * This file (Code.gs) runs on Google's servers, so normal comments and full web addresses are fine here.
 * doGet replaces the first occurrence of the placeholders __INITIAL_TOKEN__ and __INITIAL_JOB__ in
 * Index.html. Do not mention those placeholder names anywhere in Index.html above the hidden
 * initToken div, or the sign in links will stop working.
 */

// Leave blank if this script was opened from the sheet via Extensions > Apps Script.
// If the script is standalone, paste the spreadsheet ID here.
const SPREADSHEET_ID = '';
const SHEET_NAME = 'Assignments';
const PEOPLE_SHEET_NAME = 'People';
const PHOTO_FOLDER_NAME = 'Job Photos';

const ODOR_NO = 'No';

// [key, column header]. Order = column order in the Assignments sheet.
const COLS = [
  ['id', 'ID'],
  ['person', 'Person'],
  ['datetime', 'DateTime'],
  ['location', 'Location'],
  ['status', 'Status'],
  ['onceOver', 'Gave property a once over'],
  ['smoked', 'Believe property was smoked in'],
  ['smokedWhy', 'Smoked - why'],
  ['odorban', 'Treated with Odorban'],
  ['odorbanWhy', 'Odorban - why not'],
  ['suppliesNeeded', 'Cleaning supplies needed'],
  ['suppliesText', 'Supplies - what'],
  ['broken', 'Anything broken'],
  ['brokenText', 'Broken - what'],
  ['notes', 'Cleaner notes'],
  ['images', 'Images'],
  ['updated', 'Last updated'],
  ['oneTime', 'One-Night Stay'],
  ['paid', 'Paid']
];
const EDITABLE = ['status', 'onceOver', 'smoked', 'smokedWhy', 'odorban', 'odorbanWhy',
                  'suppliesNeeded', 'suppliesText', 'broken', 'brokenText', 'notes'];

/* ---------------- Entry points ---------------- */

// Opening the web app URL serves the calendar page (the Index file).
// ?json=1 (or ?action=ping) returns a plain health check instead and also creates the sheet tabs.
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.json === '1' || p.action === 'ping') {
    try {
      setup();
      return json_({ ok: true, status: 'Job calendar API is running.' });
    } catch (err) {
      return json_({ ok: false, error: String(err && err.message || err) });
    }
  }

  // Serve the page. A ?t=CODE in the link is dropped into the page so the person is signed in
  // automatically (the page can't read the /exec URL itself because it runs inside a frame).
  const token = String(p.t || '').replace(/[^A-Za-z0-9_-]/g, '');
  const job = String(p.job || '').replace(/[^A-Za-z0-9-]/g, '');
  const html = HtmlService.createHtmlOutputFromFile('Index').getContent()
    .replace('__INITIAL_TOKEN__', token)
    .replace('__INITIAL_JOB__', job);
  return HtmlService.createHtmlOutput(html)
    .setTitle('Job Calendar')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Used only if the page is hosted outside Apps Script and calls this URL with fetch().
function doPost(e) {
  return json_(respond_(e.postData.contents));
}

// Called by the page through google.script.run when it is served from Apps Script.
function handleRequest(reqText) {
  return JSON.stringify(respond_(reqText));
}

function respond_(reqText) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return process_(JSON.parse(reqText));
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    lock.releaseLock();
  }
}

function process_(req) {
  const user = authenticate_(req.token);
  if (!user) return { ok: false, code: 'auth', error: 'Access code not recognized.' };

  switch (req.action) {
    case 'list':
      return Object.assign({ ok: true, me: { name: user.name, role: user.role } }, listFor_(user));
    case 'create':
      requireAdmin_(user);
      return { ok: true, event: createEvent_(req) };
    case 'update':
      return { ok: true, event: updateEvent_(req, user) };
    case 'cancel':
      requireAdmin_(user);
      return { ok: true, event: cancelEvent_(req) };
    case 'upload':
      return { ok: true, images: uploadImage_(req, user) };
    default:
      return { ok: false, error: 'Unknown action: ' + req.action };
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor (Run > setup) to create the tabs and authorize the script. */
function setup() {
  getPeopleSheet_();
  getSheet_();
}

/* ---------------- People / access codes ---------------- */

function newToken_() {
  return Utilities.getUuid().replace(/-/g, '');
}

function sameName_(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function getSpreadsheet_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID)
                        : SpreadsheetApp.getActiveSpreadsheet();
}

function getPeopleSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(PEOPLE_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(PEOPLE_SHEET_NAME);
    sh.appendRow(['Name', 'Access code', 'Role', 'Active']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 4).setFontWeight('bold');
    sh.getRange(2, 3, sh.getMaxRows() - 1, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['admin', 'cleaner'], true).build());
    sh.getRange(2, 4, sh.getMaxRows() - 1, 1).insertCheckboxes();
    sh.appendRow(['Admin', newToken_(), 'admin', true]);
    sh.setColumnWidth(2, 300);
  }
  return sh;
}

/** Reads the People tab. Rows with a name but no code/role get them filled in. */
function readPeople_(fillBlanks) {
  const sh = getPeopleSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const range = sh.getRange(2, 1, last - 1, 4);
  const values = range.getValues();
  const people = [];
  values.forEach((r, i) => {
    const name = String(r[0] || '').trim();
    if (!name) return;
    let token = String(r[1] || '').trim();
    let role = String(r[2] || '').trim().toLowerCase();
    const activeRaw = r[3];
    if (fillBlanks) {
      if (!token) { token = newToken_(); sh.getRange(i + 2, 2).setValue(token); }
      if (role !== 'admin' && role !== 'cleaner') { role = 'cleaner'; sh.getRange(i + 2, 3).setValue('cleaner'); }
      if (activeRaw === '') sh.getRange(i + 2, 4).setValue(true);
    }
    const active = !(activeRaw === false || String(activeRaw).toUpperCase() === 'FALSE');
    people.push({ name: name, token: token, role: role === 'admin' ? 'admin' : 'cleaner', active: active });
  });
  return people;
}

function authenticate_(token) {
  token = String(token || '').trim();
  if (!token) return null;
  const match = readPeople_(false).find(p => p.active && p.token && p.token === token);
  return match ? { name: match.name, role: match.role } : null;
}

function requireAdmin_(user) {
  if (user.role !== 'admin') throw new Error('Only an admin can do that.');
}

/* ---------------- Assignments sheet helpers ---------------- */

function getSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(COLS.map(c => c[1]));
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, COLS.length).setFontWeight('bold');
    sh.getRange(2, 3, sh.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  } else {
    const headerLen = sh.getLastColumn();
    if (headerLen < COLS.length) {
      const missing = COLS.slice(headerLen).map(c => c[1]);
      const start = headerLen + 1;
      sh.getRange(1, start, 1, missing.length).setValues([missing]);
      sh.getRange(1, start, 1, missing.length).setFontWeight('bold');
    }
    const oneTimeCol = colIndex_('oneTime') + 1;
    if (sh.getLastColumn() >= oneTimeCol) {
      const cell = sh.getRange(1, oneTimeCol);
      const oldLabel = cell.getValue();
      if (oldLabel === 'One-time cleaning' || oldLabel === 'One-Day Only Stay') cell.setValue(COLS[oneTimeCol - 1][1]);
    }
  }
  return sh;
}

function colIndex_(key) {
  return COLS.findIndex(c => c[0] === key);
}

function rowToObj_(row) {
  const o = {};
  COLS.forEach((c, i) => {
    const k = c[0];
    let v = row[i];
    if (v instanceof Date) v = v.toISOString();
    o[k] = (v === null || v === undefined) ? '' : v;
  });
  o.onceOver = (o.onceOver === true || String(o.onceOver).toUpperCase() === 'TRUE');
  o.oneTime = (o.oneTime === true || String(o.oneTime).toUpperCase() === 'TRUE');
  o.paid = (o.paid === true || String(o.paid).toUpperCase() === 'TRUE');
  o.images = o.images ? String(o.images).split('\n').filter(Boolean) : [];
  Object.keys(o).forEach(k => {
    if (k !== 'onceOver' && k !== 'oneTime' && k !== 'paid' && k !== 'images') o[k] = String(o[k]);
  });
  return o;
}

function objToRow_(o) {
  return COLS.map(c => {
    const k = c[0];
    if (k === 'datetime' || k === 'updated') return o[k] ? new Date(o[k]) : '';
    if (k === 'images') return (o.images || []).join('\n');
    return o[k];
  });
}

function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2 || !id) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function listEvents_() {
  const sh = getSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, COLS.length).getValues()
    .filter(r => r[0] && r[colIndex_('status')] !== 'Cancelled')
    .map(rowToObj_);
}

function listFor_(user) {
  const all = listEvents_();
  if (user.role === 'admin') {
    const people = readPeople_(true).filter(p => p.active)
      .map(p => ({ name: p.name, token: p.token, role: p.role }));
    return { events: all, people: people };
  }
  return { events: all.filter(ev => sameName_(ev.person, user.name)) };
}

/* ---------------- Validation ---------------- */

function missing_(o) {
  const m = [];
  if (!o.onceOver) m.push('confirm you gave the property a once over');
  if (!o.smoked) m.push('answer the smoked-in question');
  else if (o.smoked === 'Yes' && !String(o.smokedWhy).trim()) m.push('explain why you think it was smoked in');
  if (!o.odorban) m.push('answer the Odorban question');
  else if (o.odorban === ODOR_NO && !String(o.odorbanWhy).trim()) m.push('explain why Odorban was not used');
  if (!o.suppliesNeeded) m.push('answer the cleaning supplies question');
  else if (o.suppliesNeeded === 'Yes' && !String(o.suppliesText).trim()) m.push('list the supplies needed');
  if (!o.broken) m.push('answer the anything-broken question');
  else if (o.broken === 'Yes' && !String(o.brokenText).trim()) m.push('describe what is broken');
  if (!o.images.length) m.push('upload at least one photo');
  return m;
}

/* ---------------- Actions ---------------- */

function createEvent_(req) {
  const wanted = String(req.person || '').trim();
  const location = String(req.location || '').trim();
  const dt = new Date(req.datetime);
  if (!wanted || !location || isNaN(dt)) throw new Error('Person, time and location are required.');

  const person = readPeople_(false).find(p => p.active && sameName_(p.name, wanted));
  if (!person) throw new Error('"' + wanted + '" is not an active person on the People tab.');

  const o = rowToObj_(COLS.map(() => ''));
  o.id = Utilities.getUuid();
  o.person = person.name;
  o.datetime = dt.toISOString();
  o.location = location;
  o.status = 'Assigned';
  o.oneTime = !!req.oneTime;
  o.paid = false;
  o.updated = new Date().toISOString();

  const sh = getSheet_();
  sh.appendRow(objToRow_(o));
  sh.getRange(sh.getLastRow(), colIndex_('datetime') + 1).setNumberFormat('yyyy-mm-dd hh:mm');
  return o;
}

function updateEvent_(req, user) {
  const sh = getSheet_();
  const rowIdx = findRow_(sh, req.id);
  if (rowIdx < 0) throw new Error('Event not found.');
  const range = sh.getRange(rowIdx, 1, 1, COLS.length);
  const o = rowToObj_(range.getValues()[0]);
  if (o.status === 'Cancelled') throw new Error('This event was cancelled.');
  if (user.role !== 'admin' && !sameName_(o.person, user.name)) throw new Error('This job is assigned to someone else.');

  EDITABLE.forEach(k => { if (req[k] !== undefined) o[k] = req[k]; });
  if (req.paid !== undefined) {
    if (user.role !== 'admin') throw new Error('Only an admin can mark a job as paid.');
    o.paid = !!req.paid;
  }
  if (o.status !== 'Done') o.paid = false;

  if (o.status === 'Done') {
    const m = missing_(o);
    if (m.length) throw new Error('Not finished yet: ' + m.join('; ') + '.');
  }
  o.updated = new Date().toISOString();
  range.setValues([objToRow_(o)]);
  return o;
}

function cancelEvent_(req) {
  const sh = getSheet_();
  const rowIdx = findRow_(sh, req.id);
  if (rowIdx < 0) throw new Error('Event not found.');
  sh.getRange(rowIdx, colIndex_('status') + 1).setValue('Cancelled');
  sh.getRange(rowIdx, colIndex_('updated') + 1).setValue(new Date());
  return { id: req.id, status: 'Cancelled' };
}

/* ---------------- Photos (Drive API v3, drive.file scope) ---------------- */

function getPhotoFolderId_() {
  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty('PHOTO_FOLDER_ID');
  if (saved) {
    try {
      const f = Drive.Files.get(saved, { fields: 'id,trashed' });
      if (f && !f.trashed) return saved;
    } catch (err) { /* folder gone: make a new one */ }
  }
  const folder = Drive.Files.create(
    { name: PHOTO_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }, null, { fields: 'id' });
  props.setProperty('PHOTO_FOLDER_ID', folder.id);
  return folder.id;
}

function uploadImage_(req, user) {
  const sh = getSheet_();
  const rowIdx = findRow_(sh, req.id);
  if (rowIdx < 0) throw new Error('Event not found.');
  const person = sh.getRange(rowIdx, colIndex_('person') + 1).getValue();
  if (user.role !== 'admin' && !sameName_(person, user.name)) throw new Error('This job is assigned to someone else.');

  const bytes = Utilities.base64Decode(req.data);
  const name = String(req.filename || ('photo-' + Date.now() + '.jpg')).replace(/[^\w.\- ]/g, '_');
  const blob = Utilities.newBlob(bytes, 'image/jpeg', name);

  const file = Drive.Files.create({ name: name, parents: [getPhotoFolderId_()] }, blob, { fields: 'id' });
  Drive.Permissions.create({ role: 'reader', type: 'anyone' }, file.id);
  const url = 'https://drive.google.com/file/d/' + file.id + '/view';

  const cell = sh.getRange(rowIdx, colIndex_('images') + 1);
  const existing = cell.getValue() ? String(cell.getValue()).split('\n').filter(Boolean) : [];
  existing.push(url);
  cell.setValue(existing.join('\n'));
  return existing;
}
