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
  exportSelectedApplicationsExcel,
  __setDrizzleForTests,
  buildFieldColumns,
  MAX_EXPORT_ROWS,
} from '../excel-export.service';
import { handleExcelExport, handleExcelExportSelected } from '../../routes/excel-export.routes';
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

  // ── D1 fidelity: จำลอง bound parameter limit ของ Cloudflare D1 ─────────
  // D1 จำกัด 100 bound parameters ต่อ statement — better-sqlite3 ยอมรับได้
  // ไม่จำกัด ดังนั้นถ้าไม่ wrap แล้ว "test ผ่าน" ไม่ได้แปลว่า Production ผ่าน
  // wrapper นับ placeholder '?' ต่อ prepared statement แล้ว throw เมื่อเกิน 100
  const boundParamLog: Array<{ count: number; sql: string }> = [];
  const origPrepare = sqlite.prepare.bind(sqlite);
  sqlite.prepare = ((sql: string) => {
    const count = (String(sql).match(/\?/g) || []).length;
    boundParamLog.push({ count, sql: String(sql).replace(/\s+/g, ' ').slice(0, 120) });
    if (count > 100) {
      throw new Error(
        `D1_LIMIT: statement ใช้ bound parameters ${count} ตัว (เกิน limit 100): ${String(sql).slice(0, 200)}`,
      );
    }
    return origPrepare(sql);
  }) as typeof sqlite.prepare;

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
      file_url TEXT NOT NULL, original_filename TEXT, uploaded_at INTEGER
    );
    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL,
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, payload TEXT,
      ip_address TEXT, created_at INTEGER
    );
  `);
  const db = drizzle(sqlite);
  (db as any).rawSqlite = sqlite; // เข้าถึง raw better-sqlite3 สำหรับ seed/query ตรงๆ
  (db as any).boundParamLog = boundParamLog; // log bind ต่อ statement (T)
  (db as any).maxBoundParams = () =>
    boundParamLog.reduce((max, entry) => Math.max(max, entry.count), 0);
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
  // attachments: resume เดียว (มี original_filename ต่างจาก URL basename —
  // ใช้พิสูจน์ลำดับ priority) + docs สามไฟล์ (ไม่มี original_filename → fallback)
  const att = (id, fieldId, name, originalFilename = null) => db.rawSqlite.prepare(
    `INSERT INTO application_attachments (id, application_id, field_id, file_url, original_filename) VALUES (?, 'app-1', ?, ?, ?)`,
  ).run(id, fieldId, `https://r2.example/files/11111111-2222-3333-4444-555555555556-${name}`, originalFilename);
  att('at-1', FIELD_IDS.resume, 'resume.pdf', 'เรซูเม่_ผู้สมัคร_2026.pdf');
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

  // ── app-8: attachment fileUrl ทุกรูปแบบที่เจอจริง (filename display suite) ──
  insertApp(db, {
    id: 'app-8', no: 'APP-2026-0008', status: 'SUBMITTED',
    fullname: 'ไฟล์แนบ ทุกรูปแบบ', email: 'files@example.com',
    formData: {
      [FIELD_IDS.fullname]: 'ไฟล์แนบ ทุกรูปแบบ',
      [FIELD_IDS.email]: 'files@example.com',
      [FIELD_IDS.phone]: '0899999999',
    },
    submittedAt: NOW + 6000,
  });
  {
    const enc = encodeURIComponent;
    const att8 = (id, fieldId, fileUrl, originalFilename = null) => db.rawSqlite.prepare(
      `INSERT INTO application_attachments (id, application_id, field_id, file_url, original_filename) VALUES (?, 'app-8', ?, ?, ?)`,
    ).run(id, fieldId, fileUrl, originalFilename);
    // resume (ไฟล์เดียว): fileUrl รูปแบบที่ backend เก็บจริง (URL-encoded key) — ตัวอย่างจาก production
    att8('at-8-1', FIELD_IDS.resume,
      `/api/v1/public/uploads/files/${enc('uploads/documents/2026/cb189e11-64ab-4d46-a1d8-a495fe7fc846-media_6accd61b060ba_1791809051.pdf')}`);
    // docs (หลายไฟล์ ครบทุกรูปแบบ):
    att8('at-8-2', FIELD_IDS.docs,
      `/api/v1/public/uploads/files/${enc('uploads/documents/2026/b2a11f73-bdb4-4837-b2bd-5f4a6a905b66-ใบสมัคร-ฉบับแก้ไข.pdf')}`); // H + ไทย
    att8('at-8-3', FIELD_IDS.docs,
      'uploads/documents/2026/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-raw-object-key.pdf'); // I raw key
    att8('at-8-4', FIELD_IDS.docs,
      'https://r2.example/files/ffffffff-1111-2222-3333-444444444444-full-url.pdf'); // J full URL
    att8('at-8-5', FIELD_IDS.docs,
      `/api/v1/public/uploads/files/${enc('uploads/documents/2026/99999999-8888-7777-6666-555555555555-100%.pdf')}`); // K malformed %
    att8('at-8-6', FIELD_IDS.docs,
      'uploads\\documents\\2026\\\\12345678-1234-1234-1234-123456789012-backslash.pdf'); // backslash separator
    att8('at-8-7', FIELD_IDS.docs,
      'https://r2.example/files/a1b2c3d4-report.pdf'); // G ชื่อไม่มี uuid prefix → ห้ามตัด
    att8('at-8-8', FIELD_IDS.docs,
      'uploads/documents/2026/44444444-4444-4444-4444-444444444444-=cmd.pdf'); // R formula injection
    att8('at-8-9', FIELD_IDS.docs,
      `/api/v1/public/uploads/files/${enc('uploads/documents/2026/77777777-7777-7777-7777-777777777777-________________.pdf')}`); // Q ข้อมูลเก่าถูก mangle แล้ว
    att8('at-8-10', FIELD_IDS.docs,
      '/api/v1/public/uploads/files/'); // ถอดไม่ได้ → fallback "ไฟล์แนบ"
    // Migration 027 — original_filename variants:
    att8('at-8-11', FIELD_IDS.docs,
      `/api/v1/public/uploads/files/${enc('uploads/documents/2026/12121212-3434-5656-7878-909090909090-resume.pdf')}`,
      ''); // ค่าว่าง → ต้อง fallback ถอดจาก fileUrl เป็น "resume.pdf"
    att8('at-8-12', FIELD_IDS.docs,
      `/api/v1/public/uploads/files/${enc('uploads/documents/2026/13131313-3434-5656-7878-909090909090-อะไรก็ได้.pdf')}`,
      'เอกสาร\x01ไทย.pdf'); // control chars ใน record → ถูกตัดแบบ defensive
  }
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
  app.post('/applications/export-selected', adminOnlyMiddleware, handleExcelExportSelected);
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
    assertEqual(result.rowCount, 7, 'ไม่รวม DRAFT → 7 แถว'); // app-1,2,3,5,6,7,8
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
  t('12/X: FILE เดียว — original_filename ชนะ URL basename (priority ถูกต้อง)', () => {
    let r1;
    for (let r = 2; r <= ws.rowCount; r++) {
      if (String(ws.getRow(r).getCell(2).value) === 'APP-2026-0001') { r1 = ws.getRow(r); break; }
    }
    const col = findHeaderCol(ws, 'ฉลาก-f-resume');
    assertEqual(r1.getCell(col).value, 'เรซูเม่_ผู้สมัคร_2026.pdf',
      'ต้องใช้ original_filename ไม่ใช่ "resume.pdf" จาก URL');
  });

  t('13: FILE หลายไฟล์ ขึ้นบรรทัดใหม่ในเซลล์เดียว (ครบทุกไฟล์)', () => {
    let r1;
    for (let r = 2; r <= ws.rowCount; r++) {
      if (String(ws.getRow(r).getCell(2).value) === 'APP-2026-0001') { r1 = ws.getRow(r); break; }
    }
    const col = findHeaderCol(ws, 'ฉลาก-f-docs');
    assertEqual(r1.getCell(col).value, 'a.pdf\nb.pdf\nc.pdf');
  });

  // ── 15/16 + A,B,D,F,G,H,I,J,K,L,O,P,Q,R: FILE filename display ────────
  // app-8 มี attachment ครบทุกรูปแบบ (ดู seedApplications)
  const findRowByNo = (no: string) => {
    for (let r = 2; r <= ws.rowCount; r++) {
      if (String(ws.getRow(r).getCell(2).value) === no) return ws.getRow(r);
    }
    throw new Error(`ไม่พบแถว ${no}`);
  };

  t('15/H: fileUrl แบบ URL-encoded key → แสดงเฉพาะชื่อไฟล์ (ตัวอย่าง production)', () => {
    const r8 = findRowByNo('APP-2026-0008');
    const col = findHeaderCol(ws, 'ฉลาก-f-resume');
    assertEqual(r8.getCell(col).value, 'media_6accd61b060ba_1791809051.pdf',
      'ต้องตัด path/uuid เหลือชื่อเดียว');
  });

  t('15/A: URL-encoded key ชื่อไทย → แสดงชื่อไทยเต็ม', () => {
    const r8 = findRowByNo('APP-2026-0008');
    const col = findHeaderCol(ws, 'ฉลาก-f-docs');
    const lines = String(r8.getCell(col).value).split('\n');
    assertTrue(lines.includes('ใบสมัคร-ฉบับแก้ไข.pdf'),
      `ต้องมี "ใบสมัคร-ฉบับแก้ไข.pdf" ได้: ${JSON.stringify(lines)}`);
  });

  t('15/F+I+J: ตัด UUID 36 ตัว — ทั้ง raw key / full URL', () => {
    const r8 = findRowByNo('APP-2026-0008');
    const col = findHeaderCol(ws, 'ฉลาก-f-docs');
    const lines = String(r8.getCell(col).value).split('\n');
    assertTrue(lines.includes('raw-object-key.pdf'), `raw key: ${JSON.stringify(lines)}`);
    assertTrue(lines.includes('full-url.pdf'), `full URL: ${JSON.stringify(lines)}`);
  });

  t('15/G: ชื่อธรรมดาไม่มี UUID นำหน้า ไม่ถูกตัด', () => {
    const r8 = findRowByNo('APP-2026-0008');
    const col = findHeaderCol(ws, 'ฉลาก-f-docs');
    const lines = String(r8.getCell(col).value).split('\n');
    assertTrue(lines.includes('a1b2c3d4-report.pdf'),
      'ชื่อที่ขึ้นต้นคล้าย hex แต่ไม่ใช่ UUID เต็มต้องอยู่ครบ');
  });

  t('15/K: percent encoding เสีย (100%.pdf) ไม่ throw และถอด %2F ส่วนอื่นได้', () => {
    const r8 = findRowByNo('APP-2026-0008');
    const col = findHeaderCol(ws, 'ฉลาก-f-docs');
    const lines = String(r8.getCell(col).value).split('\n');
    assertTrue(lines.includes('100%.pdf'), `ต้องได้ "100%.pdf": ${JSON.stringify(lines)}`);
    for (const line of lines) {
      assertTrue(!line.includes('%2F'), `ห้ามมี %2F ค้างในชื่อที่ถอดแล้ว: ${line}`);
    }
  });

  t('15/L: object key คั่น backslash → ยังถอด basename ได้', () => {
    const r8 = findRowByNo('APP-2026-0008');
    const col = findHeaderCol(ws, 'ฉลาก-f-docs');
    const lines = String(r8.getCell(col).value).split('\n');
    assertTrue(lines.includes('backslash.pdf'), `backslash: ${JSON.stringify(lines)}`);
  });

  t('15/R: ชื่อไฟล์ขึ้นต้น "=" ถูกป้องกัน formula injection', () => {
    const r8 = findRowByNo('APP-2026-0008');
    const col = findHeaderCol(ws, 'ฉลาก-f-docs');
    const lines = String(r8.getCell(col).value).split('\n');
    assertTrue(lines.includes("'=cmd.pdf"), `ต้อง prefix single-quote: ${JSON.stringify(lines)}`);
  });

  t('15/Q: ข้อมูลเก่าที่ชื่อถูก mange เป็น _ แล้ว → แสดงตามที่ถอดได้ ไม่พัง', () => {
    const r8 = findRowByNo('APP-2026-0008');
    const col = findHeaderCol(ws, 'ฉลาก-f-docs');
    const lines = String(r8.getCell(col).value).split('\n');
    assertTrue(lines.includes('________________.pdf'), `mangled: ${JSON.stringify(lines)}`);
  });

  t('15/9: ถอดชื่อไม่ได้ → "ไฟล์แนบ" ห้าม null/undefined/path เต็ม', () => {
    const r8 = findRowByNo('APP-2026-0008');
    const col = findHeaderCol(ws, 'ฉลาก-f-docs');
    const lines = String(r8.getCell(col).value).split('\n');
    assertTrue(lines.includes('ไฟล์แนบ'), `fallback: ${JSON.stringify(lines)}`);
    const v = String(r8.getCell(col).value);
    assertTrue(!v.includes('undefined') && !v.includes('null') && !v.includes('[object'),
      'ห้ามมี null/undefined/[object Object]');
    assertTrue(!v.includes('uploads/documents/'), 'ห้ามเผย object key เต็ม');
    assertTrue(!v.includes('uploads%2F'), 'ห้ามเผย encoded key');
    assertTrue(!v.startsWith('http') && !v.includes('r2.example'), 'ห้ามเผย URL');
  });

  t('X: original_filename เป็นค่าว่าง → fallback ถอดจาก fileUrl', () => {
    const r8 = findRowByNo('APP-2026-0008');
    const col = findHeaderCol(ws, 'ฉลาก-f-docs');
    const lines = String(r8.getCell(col).value).split('\n');
    assertTrue(lines.includes('resume.pdf'), `ต้อง fallback เป็น "resume.pdf": ${JSON.stringify(lines)}`);
  });

  t('X: original_filename มี control chars → ถูกตัดแบบ defensive', () => {
    const r8 = findRowByNo('APP-2026-0008');
    const col = findHeaderCol(ws, 'ฉลาก-f-docs');
    const lines = String(r8.getCell(col).value).split('\n');
    assertTrue(lines.includes('เอกสารไทย.pdf'), `ต้องได้ "เอกสารไทย.pdf": ${JSON.stringify(lines)}`);
  });

  t('16/O: หลายไฟล์ 11 ไฟล์ แสดงครบคนละบรรทัด + wrapText เปิด', () => {
    const r8 = findRowByNo('APP-2026-0008');
    const col = findHeaderCol(ws, 'ฉลาก-f-docs');
    const cell = r8.getCell(col);
    const lines = String(cell.value).split('\n');
    assertEqual(lines.length, 11, `docs ต้องมี 11 บรรทัด: ${JSON.stringify(lines)}`);
    assertTrue(cell.alignment?.wrapText === true, 'FILE cell ต้องเปิด wrapText');
    // ไฟล์เดียว (resume) ก็ต้อง wrapText ตาม spec
    const resumeCol = findHeaderCol(ws, 'ฉลาก-f-resume');
    assertTrue(r8.getCell(resumeCol).alignment?.wrapText === true, 'FILE ไฟล์เดียวต้อง wrapText ด้วย');
    // คอลัมน์อื่น (TEXT) ไม่ถูกบังคับ wrapText
    const cityCol = findHeaderCol(ws, 'เมืองที่พัก (override)');
    const r2 = findRowByNo('APP-2026-0002');
    assertTrue(r2.getCell(cityCol).alignment?.wrapText !== true, 'TEXT ธรรมดาไม่ต้อง wrapText');
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
    assertEqual(r.rowCount, 5, 'app-2? REJECTED ไม่รวม → app-3,5,6,7,8');
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
    // app-1,2,3,6,7,8 = 2026-10-20 | app-5 = 2025 ออก
    assertEqual(r.rowCount, 6);
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
    for (const key of ['roundId', 'exportMode', 'filters', 'rowCount', 'columnCount', 'bytes', 'filename', 'durationMs', 'generatedAt']) {
      assertTrue(key in payload, `payload ต้องมี ${key}`);
    }
    assertEqual(payload.exportMode, 'FILTERED', 'filtered export ต้องระบุ exportMode');
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
    // filename= เป็น ASCII fallback จากรหัสรอบ; ชื่อจริงอยู่ที่ filename* (RFC 5987)
    assertTrue(/filename="TST01-\d{8}-\d{4}\.xlsx"/.test(disposition), `filename fallback ต้องเป็น TST01-stamp.xlsx: ${disposition}`);
    assertTrue(/filename\*=UTF-8''%E0%B9%83%E0%B8%9A%E0%B8%AA%E0%B8%A1%E0%B8%B1%E0%B8%84%E0%B8%A3-/.test(disposition), `filename* ต้องขึ้นต้น "ใบสมัคร-" (percent-encoded): ${disposition}`);
    // FN-H: ห้ามมี CR/LF ใน header (header injection)
    assertFalse(/[\r\n]/.test(disposition), 'ห้ามมี CR/LF ใน Content-Disposition');
    // FN-I: filename* decode กลับแล้วได้ชื่อไทยตามรูปแบบ "ใบสมัคร-{รอบ}-{stamp}.xlsx"
    const star = disposition.match(/filename\*=UTF-8''([^;]+)/);
    assertTrue(!!star, 'ต้องมี filename*');
    const decoded = decodeURIComponent(star[1]);
    assertTrue(/^ใบสมัคร-รอบทดสอบ export-\d{8}-\d{4}\.xlsx$/.test(decoded), `ชื่อไทยจาก filename*: ${decoded}`);
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

  // ═══════════════════════════════════════════════════════════════════════
  // FILENAME SUITE (FN-A–K) — ชื่อไฟล์อ้างอิงชื่อรอบจริง ห้ามใช้ UUID
  // ═══════════════════════════════════════════════════════════════════════
  const insertRound = (id, title, roundCode = null) => db.rawSqlite.prepare(
    `INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status, round_code)
     VALUES (?, ?, ?, 'ระดับต้น', 1735689600, 1767225600, 'CLOSED', ?)`,
  ).run(id, TV_ID, title, roundCode);

  t('FN-A+J: ใช้ชื่อรอบจริง (title) — ไม่มี UUID ในชื่อไฟล์', async () => {
    const r = await runExport();
    assertTrue(/^ใบสมัคร-รอบทดสอบ export-\d{8}-\d{4}\.xlsx$/.test(r.filename), `ได้ ${r.filename}`);
    assertFalse(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(r.filename), `ห้ามมี UUID: ${r.filename}`);
  });

  t('FN-B: ชื่อรอบภาษาไทยคงอยู่ครบ', async () => {
    insertRound('round-thai', 'นักทรัพยากรบุคคล', 'HR01');
    const r = await runExport({ roundId: 'round-thai' });
    assertTrue(/^ใบสมัคร-นักทรัพยากรบุคคล-\d{8}-\d{4}\.xlsx$/.test(r.filename), `ได้ ${r.filename}`);
  });

  t('FN-C: ชื่อรอบมี slash → ถูกแทนที่ ไม่หลงเหลือ / หรือ \\', async () => {
    insertRound('round-slash', 'รอบ ก/ข\\ค', 'SL01');
    const r = await runExport({ roundId: 'round-slash' });
    assertTrue(/^ใบสมัคร-รอบ ก ข ค-\d{8}-\d{4}\.xlsx$/.test(r.filename), `ได้ ${r.filename}`);
  });

  t('FN-D: อักขระต้องห้ามครบทุกตัว (/ \\ : * ? " < > |) ถูกตัด', async () => {
    insertRound('round-bad', 'a/b\\c:d*e?f"g<h>i|j', 'BD01');
    const r = await runExport({ roundId: 'round-bad' });
    const namePart = r.filename.replace(/^ใบสมัคร-/, '').replace(/-\d{8}-\d{4}\.xlsx$/, '');
    assertFalse(/[/\\:*?"<>|]/.test(namePart), `namePart: ${namePart}`);
  });

  t('FN-E: ชื่อรอบยาว 200 ตัวอักษร → ส่วนชื่อรอบ ≤ 80 ตัวอักษร', async () => {
    insertRound('round-long', 'ร'.repeat(200), 'LN01');
    const r = await runExport({ roundId: 'round-long' });
    const namePart = r.filename.replace(/^ใบสมัคร-/, '').replace(/-\d{8}-\d{4}\.xlsx$/, '');
    assertTrue(namePart.length > 0 && namePart.length <= 80, `namePart.length = ${namePart.length}`);
  });

  t('FN-F: ชื่อรอบว่าง → fallback เป็น roundCode', async () => {
    insertRound('round-nocode-title', '', 'FB01');
    const r = await runExport({ roundId: 'round-nocode-title' });
    assertTrue(/^ใบสมัคร-FB01-\d{8}-\d{4}\.xlsx$/.test(r.filename), `ได้ ${r.filename}`);
  });

  t('FN-G: ชื่อรอบและ roundCode ว่าง → fallback "รอบรับสมัคร"', async () => {
    insertRound('round-nocode', '   ', null);
    const r = await runExport({ roundId: 'round-nocode' });
    assertTrue(/^ใบสมัคร-รอบรับสมัคร-\d{8}-\d{4}\.xlsx$/.test(r.filename), `ได้ ${r.filename}`);
  });

  t('FN-K: audit บันทึก filename สุดท้ายเดียวกับ response', async () => {
    const r = await runExport({ status: 'QUALIFIED' });
    assertTrue(r.ok);
    const log = db.rawSqlite.prepare(`SELECT payload FROM audit_logs WHERE action='EXPORT_EXCEL' ORDER BY rowid DESC`).get();
    let payload = log.payload;
    for (let i = 0; typeof payload === 'string' && i < 3; i++) payload = JSON.parse(payload);
    assertEqual(payload.filename, r.filename, 'audit filename ต้องตรง response');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SELECTED EXPORT SUITE (SEL-L–Z + RBAC) — POST /applications/export-selected
  // ═══════════════════════════════════════════════════════════════════════
  const runSelected = (ids, roundId = ROUND_ID) => exportSelectedApplicationsExcel(
    { JWT_SECRET: SECRET }, // env stub — DB ถูกแทนที่ด้วย seam
    { roundId, applicationIds: ids },
    'admin-1',
    '203.0.113.9',
  );
  const postSelected = async (body, token) => {
    const app = makeRouteApp();
    return app.fetch(new Request('http://x/applications/export-selected', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }), { JWT_SECRET: SECRET });
  };
  const latestAudit = () => {
    const log = db.rawSqlite.prepare(`SELECT payload FROM audit_logs WHERE action='EXPORT_EXCEL' ORDER BY rowid DESC`).get();
    let payload = log.payload;
    for (let i = 0; typeof payload === 'string' && i < 3; i++) payload = JSON.parse(payload);
    return payload;
  };

  // seed เพิ่ม: รอบอื่น (ทดสอบข้ามรอบ) + รายการถูกลบ (soft-delete)
  insertRound('round-y1', 'รอบอื่น', 'OTH01');
  db.rawSqlite.prepare(
    `INSERT INTO applications (id, application_no, round_id, email, fullname, status, form_data, submitted_at)
     VALUES ('app-y1', 'APP-2026-1001', 'round-y1', 'y@t.t', 'อยู่อีกรอบ', 'SUBMITTED', '{}', ?)`,
  ).run(NOW + 100);
  db.rawSqlite.prepare(
    `INSERT INTO applications (id, application_no, round_id, email, fullname, status, form_data, submitted_at, deleted_at)
     VALUES ('app-del', 'APP-2026-1002', ?, 'del@t.t', 'ถูกลบแล้ว', 'SUBMITTED', '{}', ?, 1735689600)`,
  ).run(ROUND_ID, NOW + 200);

  t('SEL-L: เลือก 1 ใบ → 1 แถวถูกต้อง + ชื่อไฟล์ตามชื่อรอบ', async () => {
    const r = await runSelected(['app-1']);
    assertTrue(r.ok, JSON.stringify(r).slice(0, 200));
    assertEqual(r.rowCount, 1);
    const w = await readWorkbook(r.buffer);
    assertEqual(String(w.getRow(2).getCell(2).value), 'APP-2026-0001');
    assertTrue(/^ใบสมัคร-รอบทดสอบ export-\d{8}-\d{4}\.xlsx$/.test(r.filename), `ได้ ${r.filename}`);
  });

  t('SEL-M+U: เลือกหลายใบ → จำนวนแถวเท่าจำนวนที่เลือกพอดี', async () => {
    const r = await runSelected(['app-1', 'app-2', 'app-3']);
    assertTrue(r.ok);
    assertEqual(r.rowCount, 3);
  });

  t('SEL-N: เลือกครบทุกใบที่ export ได้ → เท่าผลลัพธ์ filtered default', async () => {
    const r = await runSelected(['app-1', 'app-2', 'app-3', 'app-5', 'app-6', 'app-7', 'app-8']);
    assertTrue(r.ok);
    assertEqual(r.rowCount, 7, 'ไม่รวม DRAFT (app-4) เช่นเดียวกับ filtered');
  });

  t('SEL-O: ID ซ้ำถูก deduplicate ตาม contract (ไม่ reject)', async () => {
    const r = await runSelected(['app-1', 'app-1', 'app-2', 'app-2']);
    assertTrue(r.ok);
    assertEqual(r.rowCount, 2);
    assertEqual(latestAudit().selectedCount, 2, 'selectedCount นับหลัง dedupe');
  });

  t('SEL-R: ID อยู่คนละรอบ → reject ทั้งชุด ห้าม export ข้ามรอบ', async () => {
    const r = await runSelected(['app-1', 'app-y1']);
    assertEqual(r.ok, false);
    assertEqual(r.code, 'APPLICATIONS_NOT_EXPORTABLE');
    assertEqual(r.httpStatus, 422);
    assertEqual(r.missingCount, 1);
  });

  t('SEL-S: ID ไม่มีอยู่ → reject ไม่มี partial export', async () => {
    const r = await runSelected(['app-1', 'app-not-exist']);
    assertEqual(r.ok, false);
    assertEqual(r.code, 'APPLICATIONS_NOT_EXPORTABLE');
    assertEqual(r.missingCount, 1);
  });

  t('SEL-T: soft-deleted ไม่ถูก export (กฎเดียวกับ filtered ที่ตัด deletedAt)', async () => {
    const mixed = await runSelected(['app-1', 'app-del']);
    assertEqual(mixed.ok, false, 'มี ID ถูกลบปน → reject');
    const onlyDeleted = await runSelected(['app-del']);
    assertEqual(onlyDeleted.ok, false, 'เลือกเฉพาะที่ถูกลบ → reject เช่นกัน');
    assertEqual(onlyDeleted.code, 'APPLICATIONS_NOT_EXPORTABLE');
  });

  t('SEL-V: ลำดับแถว deterministic (submittedAt desc) ไม่ขึ้นกับลำดับ input', async () => {
    const r = await runSelected(['app-1', 'app-8', 'app-2']);
    const w = await readWorkbook(r.buffer);
    assertEqual(String(w.getRow(2).getCell(2).value), 'APP-2026-0008', 'ล่าสุดก่อน');
    assertEqual(String(w.getRow(3).getCell(2).value), 'APP-2026-0002');
    assertEqual(String(w.getRow(4).getCell(2).value), 'APP-2026-0001');
    const r2 = await runSelected(['app-2', 'app-1', 'app-8']); // สลับลำดับที่ส่ง
    const w2 = await readWorkbook(r2.buffer);
    assertEqual(String(w2.getRow(2).getCell(2).value), 'APP-2026-0008', 'ผลลัพธ์เหมือนเดิม');
  });

  t('SEL-W+AU: workbook mapping เหมือน filtered + เปิดอ่านกลับด้วย ExcelJS ได้', async () => {
    const flt = await runExport(); // 7 แถว: app-1,2,3,5,6,7,8
    const sel = await runSelected(['app-1', 'app-2', 'app-3', 'app-5', 'app-6', 'app-7', 'app-8']);
    assertEqual(sel.columnCount, flt.columnCount, 'columnCount เท่ากัน');
    const ws = await readWorkbook(sel.buffer);
    const wf = await readWorkbook(flt.buffer);
    const headers = [];
    const headersF = [];
    for (let i = 1; i <= ws.columnCount; i++) {
      headers.push(headerAt(ws, i));
      headersF.push(headerAt(wf, i));
    }
    assertEqual(JSON.stringify(headers), JSON.stringify(headersF), 'header ทุกคอลัมน์เหมือน filtered');
    // ค่าตัวอย่างจาก shared builder: เบอร์โทรของ app-1
    let r1;
    for (let r = 2; r <= ws.rowCount; r++) {
      if (String(ws.getRow(r).getCell(2).value) === 'APP-2026-0001') { r1 = ws.getRow(r); break; }
    }
    assertEqual(r1.getCell(8).value, '0812345678');
  });

  t('SEL-X+Y+Z: audit exportMode=SELECTED + selectedCount ถูกต้อง + ไม่มี PII/ID ทั้งก้อน', async () => {
    await runSelected(['app-1', 'app-2', 'app-3']);
    const payload = latestAudit();
    assertEqual(payload.exportMode, 'SELECTED');
    assertEqual(payload.selectedCount, 3);
    assertEqual(payload.rowCount, 3);
    assertTrue(!('applicationIds' in payload), 'ห้ามเก็บ applicationIds ทั้งก้อน');
    assertTrue(!('filters' in payload), 'selected mode ไม่มี filters object');
    const payloadStr = JSON.stringify(payload);
    assertTrue(!payloadStr.includes('app-1'), 'ห้ามมี application id ใน audit');
    assertTrue(!payloadStr.includes('สมชาย'), 'ห้ามมีชื่อ');
    assertTrue(!payloadStr.includes('somchai@example.com'), 'ห้ามมีอีเมล');
    assertTrue(!payloadStr.includes('0812345678'), 'ห้ามมีเบอร์โทร');
  });

  t('SEL-404: รอบไม่มีจริง → ROUND_NOT_FOUND', async () => {
    const r = await runSelected(['app-1'], 'round-not-exist');
    assertEqual(r.ok, false);
    assertEqual(r.code, 'ROUND_NOT_FOUND');
  });

  t('SEL-route-P: 0 รายการ / ไม่ใช่ array / ไม่มี roundId → 400 พร้อมข้อความไทย', async () => {
    const token = await makeToken('ADMIN');
    const empty = await postSelected({ roundId: ROUND_ID, applicationIds: [] }, token);
    assertEqual(empty.status, 400);
    const body = await empty.json();
    assertTrue(String(body.message).includes('อย่างน้อย 1'), `ข้อความไทย: ${body.message}`);
    assertEqual((await postSelected({ roundId: ROUND_ID, applicationIds: 'app-1' }, token)).status, 400);
    assertEqual((await postSelected({ applicationIds: ['app-1'] }, token)).status, 400);
    assertEqual((await postSelected(null, token)).status, 400);
    // service-level defensive: หลัง dedupe เหลือ 0 → reject
    const zero = await runSelected([]);
    assertEqual(zero.ok, false);
  });

  t('SEL-route-Q: เกิน 1,000 ID → 400 (Zod max)', async () => {
    const token = await makeToken('ADMIN');
    const ids = Array.from({ length: MAX_EXPORT_ROWS + 1 }, (_, i) => `x-${i}`);
    const res = await postSelected({ roundId: ROUND_ID, applicationIds: ids }, token);
    assertEqual(res.status, 400);
    const body = await res.json();
    assertTrue(String(body.message).includes('สูงสุด'), `ข้อความ: ${body.message}`);
  });

  t('SEL-route-RBAC: ไม่มี token → 401, VIEWER → 403, ADMIN → 200 + filename*', async () => {
    assertEqual((await postSelected({ roundId: ROUND_ID, applicationIds: ['app-1'] }, null)).status, 401);
    const viewer = await makeToken('VIEWER');
    assertEqual((await postSelected({ roundId: ROUND_ID, applicationIds: ['app-1'] }, viewer)).status, 403);
    const admin = await makeToken('ADMIN');
    const res = await postSelected({ roundId: ROUND_ID, applicationIds: ['app-1'] }, admin);
    assertEqual(res.status, 200);
    assertEqual(
      res.headers.get('Content-Type'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    assertTrue((res.headers.get('Content-Disposition') || '').includes("filename*=UTF-8''"), 'selected ต้องมี filename* เหมือน filtered');
  });

  t('SEL-route-S: reject เป็น JSON ที่ชัดเจน พร้อม missingCount', async () => {
    const token = await makeToken('ADMIN');
    const res = await postSelected({ roundId: ROUND_ID, applicationIds: ['app-1', 'app-y1'] }, token);
    assertEqual(res.status, 422);
    const body = await res.json();
    assertEqual(body.error, 'APPLICATIONS_NOT_EXPORTABLE');
    assertEqual(body.missingCount, 1);
    assertTrue(String(body.message).length > 0, 'ต้องมีข้อความอธิบาย');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 2 SELECTOR SUITE (SEL-SEL-*) — POST /export-selected รับ { selector }
  // ═══════════════════════════════════════════════════════════════════════
  const runSelectedSelector = (selector, roundId = ROUND_ID) => exportSelectedApplicationsExcel(
    { JWT_SECRET: SECRET },
    { roundId, selector },
    'admin-1',
    '203.0.113.9',
  );

  t('SEL-SEL-A: selector kind ids = applicationIds เดิม (equivalence)', async () => {
    const legacy = await runSelected(['app-1', 'app-2', 'app-3']);
    const viaSelector = await runSelectedSelector({ kind: 'ids', ids: ['app-1', 'app-2', 'app-3'] });

    assertTrue(legacy.ok && viaSelector.ok, 'ทั้งสองต้องสำเร็จ');
    assertEqual(viaSelector.rowCount, legacy.rowCount, 'rowCount เท่ากัน');

    const wLegacy = await readWorkbook(legacy.buffer);
    const wSelector = await readWorkbook(viaSelector.buffer);
    const nosLegacy = [];
    const nosSelector = [];
    for (let r = 2; r <= legacy.rowCount + 1; r++) {
      nosLegacy.push(String(wLegacy.getRow(r).getCell(2).value));
      nosSelector.push(String(wSelector.getRow(r).getCell(2).value));
    }
    assertEqual(nosSelector.join('|'), nosLegacy.join('|'), 'ลำดับแถวและเลขที่ใบสมัครต้องเหมือนกันเป๊ะ');
  });

  t('SEL-SEL-B: selector kind ids ยัง reject ทั้งชุดเมื่อมี ID ที่ export ไม่ได้', async () => {
    const r = await runSelectedSelector({ kind: 'ids', ids: ['app-1', 'app-y1'] });
    assertEqual(r.ok, false, 'ต้อง reject');
    assertEqual(r.code, 'APPLICATIONS_NOT_EXPORTABLE');
    assertEqual(r.missingCount, 1);
  });

  t('SEL-SEL-C: selector kind filter → ชุดเดียวกับ export ตามตัวกรอง', async () => {
    const r = await runSelectedSelector({ kind: 'filter', roundId: ROUND_ID, status: 'QUALIFIED' });
    assertTrue(r.ok, JSON.stringify(r).slice(0, 200));

    // เทียบกับ export filtered เส้นทางเดิม
    const filtered = await exportApplicationsExcel(
      { JWT_SECRET: SECRET },
      { roundId: ROUND_ID, status: 'QUALIFIED' },
      'admin-1',
      '203.0.113.9',
    );
    assertTrue(filtered.ok, 'filtered export ต้องสำเร็จ');
    assertEqual(r.rowCount, filtered.rowCount, 'rowCount เท่ากับ filtered');
  });

  t('SEL-SEL-D: selector filter ตัด DRAFT โดย default (เหมือน filtered)', async () => {
    const r = await runSelectedSelector({ kind: 'filter', roundId: ROUND_ID });
    assertTrue(r.ok);
    // seed: app-1..app-8 โดย app-4 = DRAFT → 7 แถว
    assertEqual(r.rowCount, 7, 'ไม่รวม DRAFT');
  });

  t('SEL-SEL-E: selector filter ที่ไม่ตรงใคร → 422 ไม่ export เปล่า', async () => {
    const r = await runSelectedSelector({ kind: 'filter', roundId: ROUND_ID, status: 'CANCELED' });
    // seed ไม่มี CANCELED ในรอบนี้
    assertEqual(r.ok, false, 'ต้องไม่คืนไฟล์เปล่า');
    assertEqual(r.httpStatus, 422);
  });

  t('SEL-SEL-F: selector filter คนละรอบกับ roundId ที่ขอ → 422', async () => {
    const r = await runSelectedSelector({ kind: 'filter', roundId: 'round-y1' }, ROUND_ID);
    assertEqual(r.ok, false);
    assertEqual(r.httpStatus, 422);
  });

  t('SEL-SEL-G: audit ของ selector filter เก็บ describe ไม่เก็บ id array', async () => {
    const r = await runSelectedSelector({ kind: 'filter', roundId: ROUND_ID, status: 'QUALIFIED' });
    assertTrue(r.ok);
    const payload = latestAudit();
    assertEqual(payload.exportMode, 'SELECTED', 'exportMode ยังเป็น SELECTED');
    assertEqual(payload.selector.kind, 'filter', 'audit.selector.kind');
    assertEqual(payload.selector.roundId, ROUND_ID, 'audit.selector.roundId');
    assertTrue(!('ids' in payload.selector), 'ห้ามมี id array ใน audit');
  });

  t('SEL-SEL-H: route รับ selector ผ่าน HTTP + legacy applicationIds ยังผ่าน', async () => {
    const token = await makeToken('ADMIN');

    const viaSelector = await postSelected(
      { roundId: ROUND_ID, selector: { kind: 'ids', ids: ['app-1'] } },
      token,
    );
    assertEqual(viaSelector.status, 200, 'selector ผ่าน route');

    const viaLegacy = await postSelected({ roundId: ROUND_ID, applicationIds: ['app-1'] }, token);
    assertEqual(viaLegacy.status, 200, 'legacy applicationIds ยังผ่าน');

    // ส่งทั้งคู่พร้อมกัน → 400 (กำกวม)
    const both = await postSelected(
      { roundId: ROUND_ID, applicationIds: ['app-1'], selector: { kind: 'ids', ids: ['app-1'] } },
      token,
    );
    assertEqual(both.status, 400, 'selector + applicationIds → 400');

    // ไม่ส่งอะไรเลย → 400
    const neither = await postSelected({ roundId: ROUND_ID }, token);
    assertEqual(neither.status, 400, 'ไม่มีทั้งคู่ → 400');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // D1 LIMIT SUITE (A–T) — bound parameters ≤ 100 ต่อ statement บน D1 จริง
  // makeTestDb wrap sqlite.prepare ให้ throw เมื่อ statement ใดเกิน 100 bind
  // (better-sqlite3 ไม่จำกัด — ไม่ wrap แล้ว test ผ่านไม่การันตี Production)
  // ═══════════════════════════════════════════════════════════════════════
  const D1_ROUND = 'round-sel';
  {
    const s = (q: string, ...p: any[]) => db.rawSqlite.prepare(q).run(...p);
    s(
      `INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status, round_code)
       VALUES (?, ?, 'รอบทดสอบ chunk', 'ระดับต้น', 1735689600, 1767225600, 'ACTIVE', 'SEL01')`,
      D1_ROUND, TV_ID,
    );
    const insertSel = db.rawSqlite.prepare(
      `INSERT INTO applications (id, application_no, round_id, email, fullname, status, form_data, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = db.rawSqlite.transaction(() => {
      for (let i = 0; i < 1000; i++) {
        insertSel.run(`sel-${i}`, `SEL-${String(i).padStart(4, '0')}`, D1_ROUND, `sel${i}@t.t`, `ผู้สมัคร ${i}`, 'SUBMITTED', '{}', NOW + i);
      }
      insertSel.run('sel-draft', 'SEL-DRAFT', D1_ROUND, 'draft@t.t', 'ร่างในรอบ chunk', 'DRAFT', '{}', NOW + 5000);
      insertSel.run('sel-del', 'SEL-DELETED', D1_ROUND, 'del2@t.t', 'ถูกลบในรอบ chunk', 'SUBMITTED', '{}', NOW + 5001);
      db.rawSqlite.prepare(
        `UPDATE applications SET deleted_at = 1735689600 WHERE id = 'sel-del'`,
      ).run();
    });
    tx();

    // Attachments: 150 apps แรกมีไฟล์ (K) + sel-0 มี 3 ไฟล์ (L)
    const insertAtt = db.rawSqlite.prepare(
      `INSERT INTO application_attachments (id, application_id, field_id, file_url, original_filename)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const attTx = db.rawSqlite.transaction(() => {
      insertAtt.run('att-sel-a', 'sel-0', FIELD_IDS.docs, 'https://r2.example/files/aaaaaaaa-0000-0000-0000-000000000001-a.pdf', null);
      insertAtt.run('att-sel-b', 'sel-0', FIELD_IDS.docs, 'https://r2.example/files/aaaaaaaa-0000-0000-0000-000000000002-b.pdf', null);
      insertAtt.run('att-sel-c', 'sel-0', FIELD_IDS.docs, 'https://r2.example/files/aaaaaaaa-0000-0000-0000-000000000003-c.pdf', null);
      for (let i = 1; i < 150; i++) {
        insertAtt.run(`att-sel-${i}`, `sel-${i}`, FIELD_IDS.docs, `https://r2.example/files/bbbbbbbb-0000-0000-0000-${String(i).padStart(12, '0')}-doc-${i}.pdf`, null);
      }
    });
    attTx();
  }

  const selIds = (n: number) => Array.from({ length: n }, (_, i) => `sel-${i}`);

  t('D1-A: Selected 1 รายการ (chunk เดียว)', async () => {
    const r = await runSelected(['sel-0'], D1_ROUND);
    assertTrue(r.ok, JSON.stringify(r).slice(0, 150));
    assertEqual(r.rowCount, 1);
  });

  const expectSelectedCount = async (n: number, label: string) => {
    const r = await runSelected(selIds(n), D1_ROUND);
    assertTrue(r.ok, `${label}: ${JSON.stringify(r).slice(0, 150)}`);
    assertEqual(r.rowCount, n, `${label}: rowCount ต้องเท่าจำนวนที่เลือก`);
  };

  t('D1-B: Selected 90 รายการ (ขอบ chunk พอดี = 96/100 bind)', () => expectSelectedCount(90, 'B'));
  t('D1-C: Selected 91 รายการ (ข้ามขอบ chunk → 2 chunks)', () => expectSelectedCount(91, 'C'));
  t('D1-D: Selected 99 รายการ', () => expectSelectedCount(99, 'D'));
  t('D1-E: Selected 100 รายการ', () => expectSelectedCount(100, 'E'));
  t('D1-F: Selected 101 รายการ', () => expectSelectedCount(101, 'F'));
  t('D1-G: Selected 500 รายการ', () => expectSelectedCount(500, 'G'));

  t('D1-H: Selected 1,000 รายการ (ครบ cap) + bind สูงสุด ≤ 96', async () => {
    const r = await runSelected(selIds(1000), D1_ROUND);
    assertTrue(r.ok, JSON.stringify(r).slice(0, 150));
    assertEqual(r.rowCount, 1000);
    assertTrue(db.maxBoundParams() <= 96, `max bind = ${db.maxBoundParams()} ต้อง ≤ 96`);
  });

  t('D1-I: Selected 1,001 รายการ → ถูกปฏิเสธ', async () => {
    const r = await runSelected(selIds(1000).concat(['app-1']), D1_ROUND);
    assertEqual(r.ok, false, 'เกิน cap ต้อง reject');
  });

  t('D1-J: Filtered 1,000 รายการ (attachment query ต้อง chunk ด้วย)', async () => {
    const r = await runExport({ roundId: D1_ROUND });
    assertTrue(r.ok, JSON.stringify(r).slice(0, 150));
    assertEqual(r.rowCount, 1000, 'ไม่รวม DRAFT/ถูกลบ → 1,000 พอดี');
    assertTrue(db.maxBoundParams() <= 96, `max bind = ${db.maxBoundParams()}`);
  });

  t('D1-K+L: Attachments มากกว่า 100 apps + หลายไฟล์ต่อ app ครบถ้วน', async () => {
    const r = await runSelected(selIds(150), D1_ROUND); // 150 apps มีไฟล์ → query ต้อง chunk
    assertTrue(r.ok);
    const w = await readWorkbook(r.buffer);
    const docsCol = findHeaderCol(w, 'ฉลาก-f-docs');
    // sel-0 = แถวสุดท้าย (submittedAt ต่ำสุด) มี 3 ไฟล์ 3 บรรทัดตามลำดับ
    const lastRow = w.getRow(w.rowCount);
    assertEqual(String(lastRow.getCell(2).value), 'SEL-0000');
    assertEqual(String(lastRow.getCell(docsCol).value), 'a.pdf\nb.pdf\nc.pdf', 'หลายไฟล์ต่อ app ครบตามลำดับ');
    // sel-1 (แถวก่อนหน้า) มีไฟล์ของตัวเอง
    assertEqual(String(w.getRow(w.rowCount - 1).getCell(docsCol).value), 'doc-1.pdf');
  });

  t('D1-M: ID ซ้ำข้าม chunk หลัง deduplicate → export 90 ไม่ซ้ำแถว', async () => {
    const r = await runSelected([...selIds(90), ...selIds(90)], D1_ROUND);
    assertTrue(r.ok);
    assertEqual(r.rowCount, 90, 'ซ้ำทั้งชุดต้องเหลือ 90');
    assertEqual(latestAudit().selectedCount, 90);
  });

  t('D1-N: ID ข้ามรอบใน chunk ท้ายสุด → reject ทั้งชุด', async () => {
    const r = await runSelected([...selIds(90), 'app-y1'], D1_ROUND);
    assertEqual(r.ok, false);
    assertEqual(r.code, 'APPLICATIONS_NOT_EXPORTABLE');
  });

  t('D1-O: ID ไม่มีอยู่ใน chunk กลาง → reject ทั้งชุด', async () => {
    const ids = selIds(200);
    ids[95] = 'ghost-not-exist'; // ตก chunk ที่ 2 (index 90-179)
    const r = await runSelected(ids, D1_ROUND);
    assertEqual(r.ok, false);
    assertEqual(r.code, 'APPLICATIONS_NOT_EXPORTABLE');
    assertEqual(r.missingCount, 1);
  });

  t('D1-P: soft-deleted ใน chunk ใดก็ตาม → reject ทั้งชุด', async () => {
    const r = await runSelected([...selIds(90), 'sel-del'], D1_ROUND);
    assertEqual(r.ok, false);
    assertEqual(r.code, 'APPLICATIONS_NOT_EXPORTABLE');
  });

  t('D1-Q: DRAFT ใน chunk ใดก็ตาม → reject ทั้งชุด', async () => {
    const ids = selIds(150);
    ids[100] = 'sel-draft';
    const r = await runSelected(ids, D1_ROUND);
    assertEqual(r.ok, false);
    assertEqual(r.code, 'APPLICATIONS_NOT_EXPORTABLE');
  });

  t('D1-R: ลำดับผลลัพธ์ deterministic หลังรวมหลาย chunk (input สลับ)', async () => {
    const reversed = selIds(1000).reverse();
    const r = await runSelected(reversed, D1_ROUND);
    assertTrue(r.ok);
    const w = await readWorkbook(r.buffer);
    assertEqual(String(w.getRow(2).getCell(2).value), 'SEL-0999', 'แถวแรก = ล่าสุด (submittedAt desc)');
    assertEqual(String(w.getRow(w.rowCount).getCell(2).value), 'SEL-0000', 'แถวสุดท้าย = เก่าสุด');
    const r2 = await runSelected(selIds(1000), D1_ROUND); // ลำดับ input ตรงข้าม → ผลต้องเหมือน
    const w2 = await readWorkbook(r2.buffer);
    assertEqual(String(w2.getRow(2).getCell(2).value), 'SEL-0999');
    assertEqual(String(w2.getRow(w2.rowCount).getCell(2).value), 'SEL-0000');
  });

  t('D1-S: audit selectedCount/rowCount ถูกต้องข้ามหลาย chunk (101 รายการ)', async () => {
    await runSelected(selIds(101), D1_ROUND);
    const payload = latestAudit();
    assertEqual(payload.exportMode, 'SELECTED');
    assertEqual(payload.selectedCount, 101);
    assertEqual(payload.rowCount, 101);
    assertTrue(!('applicationIds' in payload), 'ห้ามเก็บ applicationIds ใน audit');
  });

  t('D1-T: instrumentation — ไม่มี statement เกิน 100 bind + มี evidence การ chunk (96 bind)', () => {
    const max = db.maxBoundParams();
    assertTrue(max <= 100, `max bound parameters = ${max} (limit 100)`);
    assertTrue(max <= 96, `max = ${max} ต้อง ≤ 96 ตาม chunk size 90 + bind อื่น 6`);
    // เจอ statement ที่ bind 96 (= chunk 90 ของ selected query) พิสูจน์ว่าวิ่งผ่าน path chunk จริง
    assertTrue(
      db.boundParamLog.some((e: any) => e.count === 96),
      'ต้องมี statement ที่ใช้ 96 bind (chunk เต็ม 90 + roundId + status 5)',
    );
    // และต้องไม่มี statement ไหนเกิน 100 (wrapper ก็ throw อยู่แล้ว — assert ซ้ำเพื่อข้อความชัด)
    const over = db.boundParamLog.filter((e: any) => e.count > 100);
    assertEqual(over.length, 0, `statement เกิน 100 bind: ${JSON.stringify(over.slice(0, 3))}`);
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
