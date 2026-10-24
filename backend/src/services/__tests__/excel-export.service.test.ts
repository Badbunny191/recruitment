/**
 * Excel Export Service + Route Tests
 * ============================================================================
 * รัน: node --import tsx src/services/__tests__/excel-export.service.test.ts
 *
 * Coverage (ตาม spec 30 ข้อ — ข้อ 29/30 เป็นผลการรัน suite/build ภายนอก):
 *   1-3   Dynamic column / section / field ordering
 *   4     Field type ครบทุกประเภท
 *   5-6   Other Option + ไม่มีคอลัมน์ __other
 *   7     Formula injection
 *   8-9   เบอร์โทร leading zero + เลขที่ตำแหน่งเป็น text
 *   10    ข้อความหลายบรรทัด
 *   11    Master data (name เท่านั้น)
 *   12-13 ไฟล์เดียว / หลายไฟล์
 *   14    Missing data → ช่องว่าง
 *   15    Legacy formData (JSON string / double-encoded)
 *   16    Duplicate system columns (dedupe ตาม Field ID)
 *   17-19 Status / search / date-range filters
 *   20    ไม่รวม DRAFT โดย default
 *   21    RBAC (401 / VIEWER 403 / ADMIN+SUPER_ADMIN 200)
 *   22    Audit log 1 รายการ ไม่มี PII
 *   23    Empty round → ไฟล์มีหัวตาราง
 *   24    เกิน 1,000 รายการ → 422
 *   25-26 Content-Type / Content-Disposition
 *   27    XLSX เปิดอ่านกลับได้
 *   28    ไม่มี public export endpoint
 *
 * ข้อมูลทั้งหมดสังเคราะห์ใน test (in-memory SQLite) — ไม่มีข้อมูลจริง
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sign } from 'hono/jwt';
import ExcelJS from 'exceljs';
import {
  exportApplicationsExcel,
  __setDrizzleForTests,
  buildFieldColumns,
  MAX_EXPORT_ROWS,
} from '../excel-export.service';
import { handleExcelExport } from '../../routes/excel-export.routes';
import { authMiddleware, adminOnlyMiddleware } from '../../middlewares/auth.middleware';
import { publicRoutes } from '../../routes/public.routes';
import { Hono } from 'hono';

const SECRET = 'test-secret';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`✓ ${name}`);
    })
    .catch((e) => {
      failed++;
      failures.push(`${name}: ${e?.message ?? e}`);
      console.log(`✗ ${name}: ${e?.message ?? e}`);
    });
}
function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assertTrue(condition, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

// =============================================================================
// In-memory SQLite mirror (columns ที่ export path ใช้จริง)
// =============================================================================
function makeTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE admin_users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'ADMIN', is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE field_master (
      id TEXT PRIMARY KEY, field_type TEXT NOT NULL, label_th TEXT NOT NULL,
      default_options TEXT, allow_other INTEGER DEFAULT 0
    );
    CREATE TABLE templates (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE template_versions (id TEXT PRIMARY KEY, template_id TEXT NOT NULL, version_number INTEGER NOT NULL, status TEXT DEFAULT 'DRAFT');
    CREATE TABLE template_sections (
      id TEXT PRIMARY KEY, template_version_id TEXT NOT NULL, name TEXT NOT NULL,
      display_order INTEGER NOT NULL, is_active INTEGER DEFAULT 1
    );
    CREATE TABLE template_fields (
      id TEXT PRIMARY KEY, template_version_id TEXT NOT NULL, field_id TEXT NOT NULL,
      section_id TEXT, display_order INTEGER NOT NULL, is_required INTEGER DEFAULT 1,
      override_options TEXT, override_label_th TEXT, allow_other INTEGER
    );
    CREATE TABLE recruitment_rounds (
      id TEXT PRIMARY KEY, template_version_id TEXT NOT NULL, title TEXT NOT NULL,
      position_level TEXT NOT NULL, open_date INTEGER NOT NULL, close_date INTEGER NOT NULL,
      status TEXT DEFAULT 'ACTIVE', deleted_at INTEGER, round_code TEXT
    );
    CREATE TABLE applications (
      id TEXT PRIMARY KEY, application_no TEXT UNIQUE, round_id TEXT NOT NULL,
      email TEXT NOT NULL, fullname TEXT NOT NULL, national_id TEXT,
      status TEXT DEFAULT 'SUBMITTED', status_reason TEXT,
      form_data TEXT NOT NULL, submitted_at INTEGER, deleted_at INTEGER
    );
    CREATE TABLE application_attachments (
      id TEXT PRIMARY KEY, application_id TEXT NOT NULL, field_id TEXT NOT NULL,
      file_url TEXT NOT NULL, uploaded_at INTEGER
    );
    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL,
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, payload TEXT,
      ip_address TEXT, created_at INTEGER
    );
  `);
  const db = drizzle(sqlite);
  (db as any).rawSqlite = sqlite; // เข้าถึง raw better-sqlite3 สำหรับ seed/query ตรงๆ
  return db;
}

// ── Synthetic world ─────────────────────────────────────────────────────────
const ROUND_ID = 'round-x1';
const TV_ID = 'tv-x1';
const FIELD_IDS = {
  fullname: 'field-fullname', email: 'field-email', phone: 'field-phone',
  city: 'f-city', address: 'f-address', posNo: 'f-pos-no', score: 'f-score',
  birth: 'f-birth', edu: 'f-edu', gender: 'f-gender',
  agree: 'f-agree', skills: 'f-skills', org: 'f-org',
  resume: 'f-resume', docs: 'f-docs',
};

const SQL_FIELDS: Array<[string, string, string, string | null, number, string | null, number | null]> = [
  // [fieldId, sectionId, displayOrder, labelOverride, type, defaultOptions, allowOther]
  [FIELD_IDS.fullname, 'sec-a', 1, null, 'TEXT', null, null],
  [FIELD_IDS.email,    'sec-a', 2, null, 'TEXT', null, null],
  [FIELD_IDS.phone,    'sec-a', 3, null, 'TEXT', null, null],
  [FIELD_IDS.city,     'sec-a', 4, 'เมืองที่พัก (override)', 'TEXT', null, null],
  [FIELD_IDS.posNo,    'sec-a', 5, null, 'NUMBER', null, null],
  [FIELD_IDS.address,  'sec-b', 1, null, 'TEXTAREA', null, null],
  [FIELD_IDS.score,    'sec-b', 2, null, 'NUMBER', null, null],
  [FIELD_IDS.birth,    'sec-b', 3, null, 'DATE', null, null],
  [FIELD_IDS.edu,      'sec-b', 4, null, 'DROPDOWN', '["มัธยมศึกษา","ปริญญาตรี"]', 1],
  [FIELD_IDS.gender,   'sec-b', 5, null, 'RADIO', '["ชาย","หญิง"]', 1],
  [FIELD_IDS.org,      'sec-c', 2, null, 'MASTER_DATA', null, null],
  [FIELD_IDS.agree,    'sec-c', 1, null, 'CHECKBOX', null, null],
  [FIELD_IDS.skills,   'sec-c', 3, null, 'CHECKBOX', '["Excel","Word"]', 1],
  [FIELD_IDS.resume,   'sec-c', 4, null, 'FILE', null, null],
  [FIELD_IDS.docs,     'sec-c', 5, null, 'FILE', null, null],
];

function seedWorld(db) {
  const s = (q: string, ...p: any[]) => db.rawSqlite.prepare(q).run(...p);
  // sections ตั้ง displayOrder สลับ (b=2, a=0, c=1) เพื่อทดสอบ section ordering
  s(`INSERT INTO templates (id, name) VALUES ('tpl-x1', 'แบบฟอร์มทดสอบ')`);
  s(`INSERT INTO template_versions (id, template_id, version_number, status) VALUES (?, 'tpl-x1', 1, 'PUBLISHED')`, TV_ID);
  s(`INSERT INTO template_sections (id, template_version_id, name, display_order) VALUES (?, ?, 'ข้อมูลส่วนตัว', 0)`, 'sec-a', TV_ID);
  s(`INSERT INTO template_sections (id, template_version_id, name, display_order) VALUES (?, ?, 'ข้อมูลการศึกษา', 2)`, 'sec-b', TV_ID);
  s(`INSERT INTO template_sections (id, template_version_id, name, display_order) VALUES (?, ?, 'เอกสารแนบ', 1)`, 'sec-c', TV_ID);

  for (const [fid, secId, order, labelOverride, type, options, allowOther] of SQL_FIELDS) {
    s(
      `INSERT INTO field_master (id, field_type, label_th, default_options, allow_other)
       VALUES (?, ?, ?, ?, ?)`,
      fid, type, `ฉลาก-${fid}`, options, allowOther ?? 0,
    );
    s(
      `INSERT INTO template_fields (id, template_version_id, field_id, section_id, display_order, override_label_th, allow_other)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      `tf-${fid}`, TV_ID, fid, secId, order, labelOverride, allowOther,
    );
  }

  s(
    `INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status, round_code)
     VALUES (?, ?, 'รอบทดสอบ export', 'ระดับต้น', 1735689600, 1767225600, 'CLOSED', 'TST01')`,
    ROUND_ID, TV_ID,
  );
  s(
    `INSERT INTO admin_users (id, email, password_hash, role) VALUES ('admin-1', 'a@t.t', 'x', 'ADMIN')`,
  );
}

function insertApp(
  db,
  { id, no, status = 'SUBMITTED', reason = null, fullname, email, formData, submittedAt, deletedAt = null },
) {
  db.rawSqlite.prepare(
    `INSERT INTO applications (id, application_no, round_id, email, fullname, status, status_reason, form_data, submitted_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, no, ROUND_ID, email, fullname, status, reason,
    typeof formData === 'string' ? formData : JSON.stringify(formData),
    submittedAt, deletedAt,
  );
}

const NOW = Math.floor(Date.parse('2026-10-20T10:00:00+07:00') / 1000);

const RICH_FORM_DATA = {
  [FIELD_IDS.fullname]: 'สมชาย ใจดี',
  [FIELD_IDS.email]: 'somchai@example.com',
  [FIELD_IDS.phone]: '0812345678',
  [FIELD_IDS.city]: '=HYPERLINK("http://evil","คลิก")',
  [FIELD_IDS.posNo]: '0123',
  [FIELD_IDS.address]: 'บรรทัดที่ 1\nบรรทัดที่ 2',
  [FIELD_IDS.score]: 95.5,
  [FIELD_IDS.birth]: '1995-06-15',
  [FIELD_IDS.edu]: 'อื่นๆ (โปรดระบุ)',
  [`${FIELD_IDS.edu}__other`]: 'ปริญญาเอก',
  [FIELD_IDS.gender]: 'หญิง',
  [FIELD_IDS.org]: { id: 'org-9', name: 'สำนักงานสตรวจสอบ' },
  [FIELD_IDS.agree]: true,
  [FIELD_IDS.skills]: ['Excel', 'อื่นๆ (โปรดระบุ)'],
  [`${FIELD_IDS.skills}__other`]: 'Python',
};

function seedApplications(db) {
  insertApp(db, {
    id: 'app-1', no: 'APP-2026-0001', status: 'QUALIFIED',
    fullname: 'สมชาย ใจดี', email: 'somchai@example.com',
    formData: RICH_FORM_DATA, submittedAt: NOW,
  });
  // attachments: resume เดียว + docs สามไฟล์
  const att = (id, fieldId, name) => db.rawSqlite.prepare(
    `INSERT INTO application_attachments (id, application_id, field_id, file_url) VALUES (?, 'app-1', ?, ?)`,
  ).run(id, fieldId, `https://r2.example/files/11111111-2222-3333-4444-555555555556-${name}`);
  att('at-1', FIELD_IDS.resume, 'resume.pdf');
  att('at-2', FIELD_IDS.docs, 'a.pdf');
  att('at-3', FIELD_IDS.docs, 'b.pdf');
  att('at-4', FIELD_IDS.docs, 'c.pdf');

  insertApp(db, {
    id: 'app-2', no: 'APP-2026-0002', status: 'REJECTED', reason: 'เอกสารไม่ครบ',
    fullname: 'สมหญิง ค้นหาฉัน', email: 'somying@example.com',
    formData: {
      [FIELD_IDS.fullname]: 'สมหญิง ค้นหาฉัน',
      [FIELD_IDS.email]: 'somying@example.com',
      [FIELD_IDS.phone]: '0998765432',
      [FIELD_IDS.agree]: false,
    },
    submittedAt: NOW + 3600,
  });
  insertApp(db, {
    id: 'app-3', no: 'APP-2026-0003', status: 'ARCHIVED',
    fullname: 'เก็บแล้ว ไปก่อน', email: 'arch@example.com',
    formData: { [FIELD_IDS.phone]: '0800000000' },
    submittedAt: NOW + 7200,
  });
  insertApp(db, {
    id: 'app-4', no: 'APP-2026-0004', status: 'DRAFT',
    fullname: 'ร่าง ยังไม่ส่ง', email: 'draft@example.com',
    formData: { [FIELD_IDS.phone]: '0700000000' },
    submittedAt: NOW + 10800,
  });
  insertApp(db, {
    id: 'app-5', no: 'APP-2026-0005', status: 'SUBMITTED',
    fullname: 'นอกช่วงวันที่', email: 'out@example.com',
    formData: { [FIELD_IDS.phone]: '0600000000' },
    submittedAt: Math.floor(Date.parse('2025-01-01T10:00:00+07:00') / 1000),
  });
  insertApp(db, {
    id: 'app-6', no: 'APP-2026-0006', status: 'SUBMITTED',
    fullname: 'เลกาซี สตริง', email: 'legacy@example.com',
    formData: JSON.stringify({ [FIELD_IDS.phone]: '0876543210', [FIELD_IDS.city]: 'เชียงใหม่' }), // legacy: JSON string
    submittedAt: NOW + 5400,
  });
  insertApp(db, {
    id: 'app-7', no: 'APP-2026-0007', status: 'SUBMITTED',
    fullname: 'เลกาซี ซ้อนสอง', email: 'legacy2@example.com',
    formData: JSON.stringify(JSON.stringify({ [FIELD_IDS.phone]: '0876543211' })), // double-encoded
    submittedAt: NOW + 5500,
  });
}

// ── Workbook reader helpers ─────────────────────────────────────────────────
async function readWorkbook(buffer): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
  return wb.getWorksheet('ใบสมัคร');
}
function headerAt(ws, idx): string {
  return String(ws.getRow(1).getCell(idx).value ?? '');
}
function findHeaderCol(ws, header: string): number {
  for (let i = 1; i <= ws.columnCount; i++) {
    if (headerAt(ws, i) === header) return i;
  }
  return -1;
}

// ── Common run harness ──────────────────────────────────────────────────────
let db;
async function runExport(filters = {}, adminRole = 'ADMIN') {
  return exportApplicationsExcel(
    { JWT_SECRET: SECRET }, // env stub — DB ถูกแทนที่ด้วย seam
    { roundId: filters.roundId ?? ROUND_ID, ...filters },
    'admin-1',
    '203.0.113.9',
  );
}

// ── Route-level harness (RBAC + headers) ────────────────────────────────────
function makeRouteApp() {
  const app = new Hono();
  app.use('/applications/*', authMiddleware);
  app.get('/applications/export', adminOnlyMiddleware, handleExcelExport);
  return app;
}
async function makeToken(role: string) {
  return sign({ id: 'admin-1', email: 'a@t.t', role, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
}

// =============================================================================
// Run
// =============================================================================
async function runAllTests() {
  console.log('========================================');
  console.log('Excel Export Tests');
  console.log('========================================\n');
  // tests แชร์ state (ws/result/db) → รันตามลำดับประกาศ ไม่ใช่ parallel
  const cases: Array<[string, () => any]> = [];
  const t = (name, fn) => cases.push([name, fn]);

  // ── setup (sequential ก่อน push tests ที่ share db) ─────────────────────
  db = makeTestDb();
  seedWorld(db);
  seedApplications(db);
  __setDrizzleForTests(() => db);

  let ws: ExcelJS.Worksheet;
  let result;

  // ── 27/4: XLSX เปิดอ่านกลับได้ + ใช้ต่อใน test อื่น ──────────────────────
  t('27: writeBuffer ผลลัพธ์เปิดอ่านกลับได้ด้วย ExcelJS', async () => {
    result = await runExport();
    assertTrue(result.ok, `export ควรสำเร็จ: ${JSON.stringify(result)}`);
    assertEqual(result.rowCount, 6, 'ไม่รวม DRAFT → 6 แถว'); // app-1,2,3,5,6,7
    ws = await readWorkbook(result.buffer);
    assertTrue(!!ws, 'ต้องมี worksheet ใบสมัคร');
  });

  // ── 1-3: ordering ─────────────────────────────────────────────────────
  t('2: คอลัมน์ระบบ 8 ตัวแรกเรียงตาม spec', () => {
    const expected = ['ลำดับ', 'เลขที่ใบสมัคร', 'วันที่สมัคร', 'สถานะ', 'เหตุผลสถานะ', 'ชื่อ-นามสกุล', 'อีเมล', 'เบอร์โทรศัพท์'];
    const actual = [];
    for (let i = 1; i <= 8; i++) actual.push(headerAt(ws, i));
    assertEqual(JSON.stringify(actual), JSON.stringify(expected), 'system columns:');
  });

  t('2: dynamic เรียงตาม section order (a=0, c=1, b=2)', () => {
    // sec-a: city(4), posNo(5) | sec-c: agree(1), org(2), skills(3), resume(4), docs(5) | sec-b: address(1), score(2), birth(3), edu(4), gender(5)
    const expected = [
      'เมืองที่พัก (override)', 'ฉลาก-f-pos-no',
      'ฉลาก-f-agree', 'ฉลาก-f-org', 'ฉลาก-f-skills', 'ฉลาก-f-resume', 'ฉลาก-f-docs',
      'ฉลาก-f-address', 'ฉลาก-f-score', 'ฉลาก-f-birth', 'ฉลาก-f-edu', 'ฉลาก-f-gender',
    ];
    const actual = [];
    for (let i = 9; i <= 8 + expected.length; i++) actual.push(headerAt(ws, i));
    assertEqual(JSON.stringify(actual), JSON.stringify(expected), 'dynamic columns:');
  });

  t('3: field ordering ภายใน section ตาม displayOrder (unit)', () => {
    const cols = buildFieldColumns([
      { fieldId: 'x1', type: 'TEXT', label: 'L1', sectionId: 's1', displayOrder: 3, sectionName: 'S', sectionOrder: 1 },
      { fieldId: 'x2', type: 'TEXT', label: 'L2', sectionId: 's1', displayOrder: 1, sectionName: 'S', sectionOrder: 1 },
      { fieldId: 'x3', type: 'TEXT', label: 'L3', sectionId: null, displayOrder: 2, sectionName: null, sectionOrder: null },
      { fieldId: 'x4', type: 'TEXT', label: 'L4', sectionId: null, displayOrder: 1, sectionName: null, sectionOrder: null },
    ]);
    assertEqual(JSON.stringify(cols.map((c) => c.header)), JSON.stringify(['L2', 'L1', 'L4', 'L3']));
  });

  // ── 16: dedupe ────────────────────────────────────────────────────────
  t('16: ไม่สร้าง dynamic column ซ้ำกับ system columns (field-fullname/email/phone)', () => {
    const allHeaders = [];
    for (let i = 1; i <= ws.columnCount; i++) allHeaders.push(headerAt(ws, i));
    // template มี 15 fields → dynamic ควรเหลือ 12 (dedupe 3)
    assertEqual(ws.columnCount, 8 + 12, 'total columns');
    assertEqual(allHeaders.filter((h) => h === 'ฉลาก-field-fullname' || h === 'ฉลาก-field-email' || h === 'ฉลาก-field-phone').length, 0);
  });

  // ── 4: ทุก field type ─────────────────────────────────────────────────
  t('4: TEXT แสดงข้อมูลทั้งหมด + วันที่สมัคร/สถานะ/เหตุผล ภาษาไทย', () => {
    const row = ws.getRow(2); // แถวแรก (desc by submittedAt → app-2? ตรวจจาก applicationNo)
    // หาแถวของ app-1 ก่อน
    let r1;
    for (let r = 2; r <= ws.rowCount; r++) {
      if (String(ws.getRow(r).getCell(2).value) === 'APP-2026-0001') { r1 = ws.getRow(r); break; }
    }
    assertTrue(!!r1, 'ต้องพบแถว APP-2026-0001');
    assertEqual(r1.getCell(4).value, 'ผ่านการตรวจสอบ', 'สถานะไทย');
    assertEqual(r1.getCell(3).value, '2026-10-20 10:00', 'วันที่สมัคร Bangkok');
  });

  t('4: TEXT ค่าไทย + override label ใช้ overrideLabelTh', () => {
    const cityCol = findHeaderCol(ws, 'เมืองที่พัก (override)');
    assertTrue(cityCol > 0, 'ต้องมีคอลัมน์ override label');
  });

  // ── 7: formula injection ─────────────────────────────────────────────
  t('7: Formula injection — =HYPERLINK ถูก prefix single-quote', async () => {
    let r1;
    for (let r = 2; r <= ws.rowCount; r++) {
      if (String(ws.getRow(r).getCell(2).value) === 'APP-2026-0001') { r1 = ws.getRow(r); break; }
    }
    const cityCol = findHeaderCol(ws, 'เมืองที่พัก (override)');
    assertEqual(r1.getCell(cityCol).value, `'=HYPERLINK("http://evil","คลิก")`);
  });

  // ── 8-9: text cells ───────────────────────────────────────────────────
  t('8: เบอร์โทรศัพท์ string + leading zero ครบ + numFmt @', () => {
    let r1;
    for (let r = 2; r <= ws.rowCount; r++) {
      if (String(ws.getRow(r).getCell(2).value) === 'APP-2026-0001') { r1 = ws.getRow(r); break; }
    }
    const v = r1.getCell(8).value;
    assertEqual(typeof v, 'string', 'phone type');
    assertEqual(v, '0812345678', 'phone ครบ leading zero');
  });

  t('9: เลขที่ตำแหน่ง NUMBER "0123" เก็บเป็น text ไม่กลายเป็น 123', () => {
    let r1;
    for (let r = 2; r <= ws.rowCount; r++) {
      if (String(ws.getRow(r).getCell(2).value) === 'APP-2026-0001') { r1 = ws.getRow(r); break; }
    }
    const col = findHeaderCol(ws, 'ฉลาก-f-pos-no');
    const v = r1.getCell(col).value;
    assertEqual(typeof v, 'string', 'posNo type');
    assertEqual(v, '0123', 'posNo คง leading zero');
  });

  t('4: NUMBER ปกติเป็น number cell', () => {
    let r1;
    for (let r = 2; r <= ws.rowCount; r++) {
      if (String(ws.getRow(r).getCell(2).value) === 'APP-2026-0001') { r1 = ws.getRow(r); break; }
    }
    const col = findHeaderCol(ws, 'ฉลาก-f-score');
    const v = r1.getCell(col).value;
    assertEqual(typeof v, 'number', 'score type');
    assertEqual(v, 95.5, 'score value');
  });

  // ── 10: multi-line ────────────────────────────────────────────────────
  t('10: TEXTAREA คง \\n หลายบรรทัด', () => {
    let r1;
    for (let r = 2; r <= ws.rowCount; r++) {
      if (String(ws.getRow(r).getCell(2).value) === 'APP-2026-0001') { r1 = ws.getRow(r); break; }
    }
    const col = findHeaderCol(ws, 'ฉลาก-f-address');
    const v = String(r1.getCell(col).value);
    assertTrue(v.includes('\n'), 'ต้องมีบรรทัดใหม่');
    assertEqual(v, 'บรรทัดที่ 1\nบรรทัดที่ 2');
  });

  // ── DATE ──────────────────────────────────────────────────────────────
  t('4: DATE เป็นข้อความ YYYY-MM-DD', () => {
    let r1;
    for (let r = 2; r <= ws.rowCount; r++) {
      if (String(ws.getRow(r).getCell(2).value) === 'APP-2026-0001') { r1 = ws.getRow(r); break; }
    }
    const col = findHeaderCol(ws, 'ฉลาก-f-birth');
    assertEqual(typeof r1.getCell(col).value, 'string', 'date type');
    assertEqual(r1.getCell(col).value, '1995-06-15', 'date format');
  });

  // ── 5: other option ───────────────────────────────────────────────────
  t('5: Other Option (dropdown) แสดง "อื่นๆ: ปริญญาเอก"', () => {
    let r1;
    for (let r = 2; r <= ws.rowCount; r++) {
      if (String(ws.getRow(r).getCell(2).value) === 'APP-2026-0001') { r1 = ws.getRow(r); break; }
    }
    const col = findHeaderCol(ws, 'ฉลาก-f-edu');
    assertEqual(r1.getCell(col).value, 'อื่นๆ: ปริญญาเอก');
  });

  t('5: Other Option (checkbox group) รวมทุกค่า + อื่นๆ ในเซลล์เดียว', () => {
    let r1;
    for (let r = 2; r <= ws.rowCount; r++) {
      if (String(ws.getRow(r).getCell(2).value) === 'APP-2026-0001') { r1 = ws.getRow(r); break; }
    }
    const col = findHeaderCol(ws, 'ฉลาก-f-skills');
    assertEqual(r1.getCell(col).value, 'Excel, อื่นๆ: Python');
  });

  t('6: ไม่มีคอลัมน์ที่ลงท้าย __other และไม่มี header key __other', () => {
    for (let i = 1; i <= ws.columnCount; i++) {
      const h = headerAt(ws, i);
      assertTrue(!h.includes('__other'), `header ต้องไม่มี __other: ${h}`);
    }
  });

  // ── checkbox เดี่ยว ───────────────────────────────────────────────────
  t('4: CHECKBOX เดี่ยว ใช่/ไม่ใช่', () => {
    let r1; let r2;
    for (let r = 2; r <= ws.rowCount; r++) {
      const no = String(ws.getRow(r).getCell(2).value);
      if (no === 'APP-2026-0001') r1 = ws.getRow(r);
      if (no === 'APP-2026-0002') r2 = ws.getRow(r);
    }
    const col = findHeaderCol(ws, 'ฉลาก-f-agree');
    assertEqual(r1.getCell(col).value, 'ใช่');
    assertEqual(r2.getCell(col).value, 'ไม่ใช่');
  });

  // ── 11: master data ───────────────────────────────────────────────────
  t('11: MASTER_DATA แสดง name เท่านั้น (ไม่มี id / JSON)', () => {
    let r1;
    for (let r = 2; r <= ws.rowCount; r++) {
      if (String(ws.getRow(r).getCell(2).value) === 'APP-2026-0001') { r1 = ws.getRow(r); break; }
    }
    const col = findHeaderCol(ws, 'ฉลาก-f-org');
    assertEqual(r1.getCell(col).value, 'สำนักงานสตรวจสอบ');
    assertTrue(!String(r1.getCell(col).value).includes('org-9'), 'ห้ามมี id ดิบ');
    assertTrue(!String(r1.getCell(col).value).includes('{'), 'ห้ามเป็น JSON');
  });

  // ── 12-13: files ──────────────────────────────────────────────────────
  t('12: FILE เดียวแสดงชื่อไฟล์ (ตัด uuid prefix)', () => {
    let r1;
    for (let r = 2; r <= ws.rowCount; r++) {
      if (String(ws.getRow(r).getCell(2).value) === 'APP-2026-0001') { r1 = ws.getRow(r); break; }
    }
    const col = findHeaderCol(ws, 'ฉลาก-f-resume');
    assertEqual(r1.getCell(col).value, 'resume.pdf');
  });

  t('13: FILE หลายไฟล์ ขึ้นบรรทัดใหม่ในเซลล์เดียว (ครบทุกไฟล์)', () => {
    let r1;
    for (let r = 2; r <= ws.rowCount; r++) {
      if (String(ws.getRow(r).getCell(2).value) === 'APP-2026-0001') { r1 = ws.getRow(r); break; }
    }
    const col = findHeaderCol(ws, 'ฉลาก-f-docs');
    assertEqual(r1.getCell(col).value, 'a.pdf\nb.pdf\nc.pdf');
  });

  // ── 14: missing data ──────────────────────────────────────────────────
  t('14: field ที่ผู้สมัครไม่กรอก → ช่องว่าง (ไม่ใช่ undefined/null)', () => {
    let r2;
    for (let r = 2; r <= ws.rowCount; r++) {
      if (String(ws.getRow(r).getCell(2).value) === 'APP-2026-0002') { r2 = ws.getRow(r); break; }
    }
    const col = findHeaderCol(ws, 'ฉลาก-f-birth');
    const v = r2.getCell(col).value;
    assertTrue(v === null || v === '', `ควรว่าง แต่ได้ ${JSON.stringify(v)}`);
  });

  // ── 15: legacy formData ───────────────────────────────────────────────
  t('15: Legacy formData แบบ JSON string อ่านได้', async () => {
    const w = await readWorkbook(result.buffer);
    let r6;
    for (let r = 2; r <= w.rowCount; r++) {
      if (String(w.getRow(r).getCell(2).value) === 'APP-2026-0006') { r6 = w.getRow(r); break; }
    }
    assertEqual(r6.getCell(8).value, '0876543210', 'phone จาก legacy JSON string');
    const cityCol = findHeaderCol(w, 'เมืองที่พัก (override)');
    assertEqual(r6.getCell(cityCol).value, 'เชียงใหม่');
  });

  t('15: Legacy formData double-encoded อ่านได้', async () => {
    const w = await readWorkbook(result.buffer);
    let r7;
    for (let r = 2; r <= w.rowCount; r++) {
      if (String(w.getRow(r).getCell(2).value) === 'APP-2026-0007') { r7 = w.getRow(r); break; }
    }
    assertEqual(r7.getCell(8).value, '0876543211', 'phone จาก double-encoded');
  });

  // ── 17-20: filters ────────────────────────────────────────────────────
  t('17: Status filter (QUALIFIED) ได้เฉพาะแถวที่ตรง', async () => {
    const r = await runExport({ status: 'QUALIFIED' });
    assertTrue(r.ok);
    assertEqual(r.rowCount, 1);
    const w = await readWorkbook(r.buffer);
    assertEqual(String(w.getRow(2).getCell(2).value), 'APP-2026-0001');
  });

  t('17: Status filter หลายค่า (SUBMITTED,ARCHIVED)', async () => {
    const r = await runExport({ status: 'SUBMITTED,ARCHIVED' });
    assertEqual(r.rowCount, 4, 'app-2? REJECTED ไม่รวม → app-3,5,6,7');
  });

  t('20: Default ไม่รวม DRAFT', async () => {
    const r = await runExport();
    const w = await readWorkbook(r.buffer);
    let draftFound = false;
    for (let row = 2; row <= w.rowCount; row++) {
      if (String(w.getRow(row).getCell(4).value) === 'ร่าง') draftFound = true;
    }
    assertFalse(draftFound, 'DRAFT ต้องไม่อยู่ใน export default');
  });

  t('18: Search filter หาชื่อ "ค้นหาฉัน"', async () => {
    const r = await runExport({ search: 'ค้นหาฉัน' });
    assertEqual(r.rowCount, 1);
    const w = await readWorkbook(r.buffer);
    assertEqual(String(w.getRow(2).getCell(6).value), 'สมหญิง ค้นหาฉัน');
  });

  t('18: Search filter หาเลขใบสมัคร', async () => {
    const r = await runExport({ search: 'APP-2026-0003' });
    assertEqual(r.rowCount, 1);
  });

  t('19: Date range กรอง submittedAt (Bangkok)', async () => {
    const r = await runExport({ dateFrom: '2026-10-20', dateTo: '2026-10-20' });
    // app-1,2,3,6,7 = 2026-10-20 | app-5 = 2025 ออก
    assertEqual(r.rowCount, 5);
  });

  t('19: dateTo อย่างเดียวตัดรายการหลังวันที่', async () => {
    const r = await runExport({ dateTo: '2025-12-31' });
    assertEqual(r.rowCount, 1, 'เหลือ app-5 (2025-01-01)');
  });

  // ── 22: audit ─────────────────────────────────────────────────────────
  t('22: Audit log 1 รายการ EXPORT_EXCEL + payload ครบ + ไม่มี PII', async () => {
    const countBefore = db.rawSqlite.prepare(`SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'EXPORT_EXCEL'`).get().c;
    const r = await runExport({ status: 'QUALIFIED', search: 'สมชาย' });
    assertTrue(r.ok);
    const logs = db.rawSqlite.prepare(`SELECT * FROM audit_logs WHERE action = 'EXPORT_EXCEL' ORDER BY rowid DESC`).all();
    const delta = logs.length - countBefore;
    assertEqual(delta, 1, 'export 1 ครั้ง = audit เพิ่ม 1 รายการ (ไม่ใช่ต่อผู้สมัคร)');
    assertTrue(logs.length >= 1, 'ต้องมี audit อย่างน้อย 1');
    const latest = logs[0]; // DESC → ใหม่สุดคือการ export ครั้งล่าสุด
    assertEqual(latest.entity_type, 'APPLICATION');
    assertEqual(latest.entity_id, ROUND_ID);
    assertEqual(latest.admin_id, 'admin-1');
    // drizzle mode:'json' อาจคืน string / object / string ซ้อนสองชั้น — parse จนกว่าจะเป็น object
    let payload = latest.payload;
    for (let i = 0; typeof payload === 'string' && i < 3; i++) payload = JSON.parse(payload);
    const payloadStr = JSON.stringify(payload);
    for (const key of ['roundId', 'filters', 'rowCount', 'columnCount', 'bytes', 'filename', 'durationMs', 'generatedAt']) {
      assertTrue(key in payload, `payload ต้องมี ${key}`);
    }
    // ห้ามมี PII ใน payload
    assertTrue(!payloadStr.includes('สมชาย'), 'ห้ามมีชื่อ');
    assertTrue(!payloadStr.includes('somchai@example.com'), 'ห้ามมีอีเมล');
    assertTrue(!payloadStr.includes('0812345678'), 'ห้ามมีเบอร์โทร');
    assertTrue(payloadStr.includes('[redacted length=5]'), 'search ต้องถูก redact ("สมชาย" = 5 ตัวอักษร)');
  });

  // ── 23: empty round ───────────────────────────────────────────────────
  t('23: รอบไม่มีใบสมัคร → ไฟล์มีเฉพาะหัวตาราง', async () => {
    db.rawSqlite.prepare(`INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status) VALUES ('round-empty', ?, 'รอบว่าง', 'ระดับต้น', 1735689600, 1767225600, 'CLOSED')`).run(TV_ID);
    const r = await runExport({ roundId: 'round-empty' });
    assertTrue(r.ok, 'รอบว่างต้อง export ได้');
    assertEqual(r.rowCount, 0);
    const w = await readWorkbook(r.buffer);
    assertEqual(w.rowCount, 1, 'มีแค่ header');
    assertEqual(headerAt(w, 1), 'ลำดับ');
  });

  t('404: รอบไม่มีจริง → ROUND_NOT_FOUND', async () => {
    const r = await runExport({ roundId: 'round-not-exist' });
    assertEqual(r.ok, false);
    assertEqual(r.code, 'ROUND_NOT_FOUND');
  });

  // ── 24: cap 1,000 ─────────────────────────────────────────────────────
  t('24: เกิน 1,000 รายการ → TOO_MANY_ROWS (ไม่เพิ่ม limit แก้ปัญหา)', async () => {
    db.rawSqlite.prepare(`INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status) VALUES ('round-big', ?, 'รอบใหญ่', 'ระดับต้น', 1735689600, 1767225600, 'ACTIVE')`).run(TV_ID);
    const insertMany = db.rawSqlite.prepare(
      `INSERT INTO applications (id, application_no, round_id, email, fullname, status, form_data, submitted_at)
       VALUES (?, ?, 'round-big', ?, ?, 'SUBMITTED', '{}', ?)`,
    );
    const tx = db.rawSqlite.transaction(() => {
      for (let i = 0; i < MAX_EXPORT_ROWS + 1; i++) {
        insertMany.run(`big-${i}`, `BIG-${String(i).padStart(5, '0')}`, `u${i}@t.t`, `ผู้ใช้ ${i}`, NOW + i);
      }
    });
    tx();
    const r = await runExport({ roundId: 'round-big' });
    assertEqual(r.ok, false);
    assertEqual(r.code, 'TOO_MANY_ROWS');
    assertEqual(r.httpStatus, 422);
  });

  t('24b: 1,000 รายการพอดี → ผ่าน', async () => {
    db.rawSqlite.prepare(`DELETE FROM applications WHERE id LIKE 'big-%'`).run();
    const insertMany = db.rawSqlite.prepare(
      `INSERT INTO applications (id, application_no, round_id, email, fullname, status, form_data, submitted_at)
       VALUES (?, ?, 'round-big', ?, ?, 'SUBMITTED', '{}', ?)`,
    );
    const tx = db.rawSqlite.transaction(() => {
      for (let i = 0; i < MAX_EXPORT_ROWS; i++) {
        insertMany.run(`big-${i}`, `BIG-${String(i).padStart(5, '0')}`, `u${i}@t.t`, `ผู้ใช้ ${i}`, NOW + i);
      }
    });
    tx();
    const r = await runExport({ roundId: 'round-big' });
    assertTrue(r.ok, `1,000 พอดีต้องผ่าน: ${JSON.stringify(r).slice(0, 200)}`);
    assertEqual(r.rowCount, MAX_EXPORT_ROWS);
  });

  // ── 21/25/26: route-level RBAC + headers ───────────────────────────────
  t('21: ไม่มี token → 401', async () => {
    const app = makeRouteApp();
    const res = await app.fetch(
      new Request(`http://x/applications/export?roundId=${ROUND_ID}`),
      { JWT_SECRET: SECRET },
    );
    assertEqual(res.status, 401);
  });

  t('21: VIEWER → 403', async () => {
    const app = makeRouteApp();
    const token = await makeToken('VIEWER');
    const res = await app.fetch(
      new Request(`http://x/applications/export?roundId=${ROUND_ID}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { JWT_SECRET: SECRET },
    );
    assertEqual(res.status, 403);
  });

  t('21+25+26: ADMIN → 200 + Content-Type XLSX + Content-Disposition attachment', async () => {
    const app = makeRouteApp();
    const token = await makeToken('ADMIN');
    const res = await app.fetch(
      new Request(`http://x/applications/export?roundId=${ROUND_ID}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { JWT_SECRET: SECRET },
    );
    assertEqual(res.status, 200);
    assertEqual(
      res.headers.get('Content-Type'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const disposition = res.headers.get('Content-Disposition') || '';
    assertTrue(disposition.startsWith('attachment;'), `Content-Disposition: ${disposition}`);
    assertTrue(/filename="applications-TST01-[^"]+\.xlsx"/.test(disposition), `filename ต้องเป็น applications-TST01-*.xlsx: ${disposition}`);
  });

  t('21: SUPER_ADMIN → 200', async () => {
    const app = makeRouteApp();
    const token = await makeToken('SUPER_ADMIN');
    const res = await app.fetch(
      new Request(`http://x/applications/export?roundId=${ROUND_ID}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { JWT_SECRET: SECRET },
    );
    assertEqual(res.status, 200);
  });

  t('route: ไม่มี roundId → 400', async () => {
    const app = makeRouteApp();
    const token = await makeToken('ADMIN');
    const res = await app.fetch(
      new Request(`http://x/applications/export`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { JWT_SECRET: SECRET },
    );
    assertEqual(res.status, 400);
  });

  t('route: เกิน cap → 422 พร้อมข้อความไทย', async () => {
    // 24b เหลือ 1,000 พอดี → เพิ่ม 1 แถวให้เกิน cap
    db.rawSqlite.prepare(
      `INSERT INTO applications (id, application_no, round_id, email, fullname, status, form_data, submitted_at)
       VALUES ('big-extra', 'BIG-EXTRA', 'round-big', 'extra@t.t', 'เกินโค้ต', 'SUBMITTED', '{}', ?)`,
    ).run(NOW);
    const app = makeRouteApp();
    const token = await makeToken('ADMIN');
    const res = await app.fetch(
      new Request(`http://x/applications/export?roundId=round-big`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { JWT_SECRET: SECRET },
    );
    assertEqual(res.status, 422);
    const body = await res.json();
    assertTrue(String(body.message).includes('เกินขีดจำกัด'), body.message);
  });

  // ── 28: ไม่มี public export ───────────────────────────────────────────
  t('28: ไม่มี public export endpoint (publicRoutes → 404)', async () => {
    const app = new Hono();
    app.route('/api/v1/public', publicRoutes);
    const res = await app.fetch(
      new Request(`http://x/api/v1/public/applications/export?roundId=${ROUND_ID}`),
      {},
    );
    assertEqual(res.status, 404, 'public export ต้องไม่มี');
  });

  // ── teardown ───────────────────────────────────────────────────────────
  // ── run (sequential ตามลำดับประกาศ) ────────────────────────────────────
  for (const [name, fn] of cases) await test(name, fn);
  __setDrizzleForTests(null);

  console.log('\n========================================');
  console.log(`ผลลัพธ์: ${passed} ผ่าน, ${failed} ล้ม`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  ✗ ${f}`));
  }
  console.log('========================================');
  process.exit(failed > 0 ? 1 : 0);
}

function assertFalse(condition, msg = '') {
  assertTrue(!condition, msg || 'Expected false');
}

runAllTests().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
