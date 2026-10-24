/**
 * E2E Smoke — Upload → Submit (route จริง) → Excel Export → อ่านกลับ
 * ============================================================================
 * รัน: node --import tsx src/services/__tests__/excel-export-e2e-smoke.test.ts
 *
 * จำลองเส้นทางเต็มด้วยข้อมูลสังเคราะห์ทั้งหมด (ไม่มีข้อมูลจริง / ไม่ต่อ network):
 *   1. POST /public/uploads/direct ไฟล์ชื่อไทย + ชื่อมีช่องว่าง/วงเล็บ (mock R2)
 *   2. GET /public/uploads/files/:key ดาวน์โหลดกลับ — header ปลอดภัย
 *   3. POST /public/applications/submit ผ่าน route จริง (D1 adapter)
 *      พร้อม filename จาก upload response → original_filename ถูกบันทึก
 *   4. exportApplicationsExcel → เขียน .xlsx ลงดิสก์จริง
 *   5. อ่านไฟล์กลับด้วย ExcelJS จาก disk → ชื่อไฟล์ = original_filename
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { Hono } from 'hono';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import ExcelJS from 'exceljs';
import { uploadRoutes } from '../../routes/upload.routes';
import { publicRoutes } from '../../routes/public.routes';
import {
  exportApplicationsExcel,
  __setDrizzleForTests,
} from '../excel-export.service';
import { __resetRateLimitStoreForTests } from '../../middlewares/rate-limit.middleware';

let passed = 0;
let failed = 0;
const failures: string[] = [];
function test(name, fn) {
  return Promise.resolve().then(() => fn()).then(() => {
    passed++;
    console.log(`  ✓ ${name}`);
  }).catch((e) => {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  ✗ ${name}: ${e?.message ?? e}`);
  });
}
function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assertTrue(cond, msg = '') { if (!cond) throw new Error(msg || 'Expected true'); }

// ── mock R2 (เหมือน upload-r2-regression.test.ts) ───────────────────────────
function createMockR2Bucket() {
  const objects = new Map();
  const bucket: any = {
    async put(key, value, options) {
      const bytes = value instanceof Uint8Array
        ? value
        : new Uint8Array(value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer());
      objects.set(key, { bytes, httpMetadata: options?.httpMetadata, customMetadata: options?.customMetadata });
    },
    async get(key) {
      const obj = objects.get(key);
      if (!obj) return undefined;
      return {
        key, size: obj.bytes.byteLength, httpEtag: 'mock-etag',
        httpMetadata: obj.httpMetadata, customMetadata: obj.customMetadata,
        body: obj.bytes, arrayBuffer: async () => obj.bytes.slice().buffer,
      };
    },
  };
  return { bucket, objects };
}

// ── D1-compatible adapter (แบบเดียวกับ submit-attachment-filename.test.ts) ─
function createD1Adapter(sqlite) {
  const makeStatement = (sqlText) => {
    const stmt = sqlite.prepare(sqlText);
    let bound = [];
    const api = {
      bind(...params) { bound = params; return api; },
      async all() { return { results: stmt.all(...bound) }; },
      async first() { return stmt.get(...bound) ?? null; },
      async run() {
        const info = stmt.run(...bound);
        return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
      },
      async raw() { return stmt.raw(true).all(...bound); },
    };
    return api;
  };
  return {
    prepare: (sqlText) => makeStatement(sqlText),
    async batch(statements) {
      const results = [];
      for (const s of statements) {
        await s.run();
        results.push({ results: [], success: true, meta: { changes: 0 } });
      }
      return results;
    },
  };
}

const PDF_BYTES = new TextEncoder().encode('%PDF-1.4 smoke-test-pdf-content-ไทย');

async function runAll() {
  console.log('\n=== E2E Smoke: Upload → Submit → DB → Excel → อ่านกลับ ===\n');

  const { bucket } = createMockR2Bucket();
  const app = new Hono();
  app.route('/api/v1/public/uploads', uploadRoutes);
  app.route('/api/v1/public', publicRoutes);

  // ── DB (in-memory + D1 adapter สำหรับ submit route จริง) ────────────────
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE templates (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE template_versions (id TEXT PRIMARY KEY, template_id TEXT NOT NULL, version_number INTEGER NOT NULL, status TEXT DEFAULT 'DRAFT');
    CREATE TABLE template_sections (id TEXT PRIMARY KEY, template_version_id TEXT NOT NULL, name TEXT NOT NULL, display_order INTEGER NOT NULL, is_active INTEGER DEFAULT 1);
    CREATE TABLE field_master (id TEXT PRIMARY KEY, field_type TEXT NOT NULL, label_th TEXT NOT NULL, pdf_mapping_key TEXT, allow_other INTEGER DEFAULT 0);
    CREATE TABLE template_fields (id TEXT PRIMARY KEY, template_version_id TEXT NOT NULL, field_id TEXT NOT NULL, section_id TEXT, display_order INTEGER NOT NULL, is_required INTEGER DEFAULT 1, override_label_th TEXT, allow_other INTEGER);
    CREATE TABLE recruitment_rounds (
      id TEXT PRIMARY KEY, template_version_id TEXT NOT NULL, title TEXT NOT NULL,
      position_level TEXT NOT NULL, open_date INTEGER NOT NULL, close_date INTEGER NOT NULL,
      status TEXT DEFAULT 'ACTIVE', created_at INTEGER, deleted_at INTEGER,
      announcement_title TEXT, announcement_description TEXT, contact_information TEXT,
      remark TEXT, application_pattern TEXT, round_code TEXT
    );
    CREATE TABLE applications (
      id TEXT PRIMARY KEY, application_no TEXT UNIQUE, round_id TEXT NOT NULL,
      email TEXT NOT NULL, fullname TEXT NOT NULL, national_id TEXT,
      status TEXT DEFAULT 'SUBMITTED', status_reason TEXT, verified_by TEXT, verified_at INTEGER,
      form_data TEXT NOT NULL, submitted_at INTEGER, deleted_at INTEGER,
      year INTEGER, round_code TEXT, seq_in_round INTEGER
    );
    CREATE TABLE application_attachments (id TEXT PRIMARY KEY, application_id TEXT NOT NULL, field_id TEXT NOT NULL, file_url TEXT NOT NULL, original_filename TEXT, uploaded_at INTEGER);
    CREATE TABLE admin_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'ADMIN', is_active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE audit_logs (id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, payload TEXT, ip_address TEXT, created_at INTEGER);
  `);
  sqlite.exec(`
    INSERT INTO templates VALUES ('tpl-1','ฟอร์ม smoke');
    INSERT INTO template_versions VALUES ('tv-1','tpl-1',1,'PUBLISHED');
    INSERT INTO template_sections VALUES ('sec-1','tv-1','เอกสารแนบ',0,1);
    INSERT INTO field_master VALUES ('field-fullname','TEXT','ชื่อ-นามสกุล','fullname',0);
    INSERT INTO field_master VALUES ('field-email','TEXT','อีเมล','email',0);
    INSERT INTO field_master VALUES ('field-phone','TEXT','เบอร์โทรศัพท์','phone',0);
    INSERT INTO field_master VALUES ('f-files','FILE','เอกสารประกอบ',NULL,0);
    INSERT INTO template_fields VALUES ('tf-1','tv-1','field-fullname','sec-1',1,1,NULL,NULL);
    INSERT INTO template_fields VALUES ('tf-2','tv-1','field-email','sec-1',2,1,NULL,NULL);
    INSERT INTO template_fields VALUES ('tf-3','tv-1','field-phone','sec-1',3,0,NULL,NULL);
    INSERT INTO template_fields VALUES ('tf-4','tv-1','f-files','sec-1',4,0,NULL,NULL);
    INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status, round_code)
    VALUES ('round-smoke','tv-1','รอบ smoke','ระดับต้น',1735603200,1798761600,'ACTIVE','SMK01');
    INSERT INTO admin_users VALUES ('admin-1','a@t.t','x','ADMIN',1);
  `);

  const d1 = createD1Adapter(sqlite);
  const env = () => ({
    DB: d1,
    R2_BUCKET: bucket,
    JWT_SECRET: 'test-secret',
    RATE_LIMIT_PER_MINUTE: '1000',
  });

  // drizzle (better-sqlite3) สำหรับ excel export service ผ่าน test seam
  const db = drizzle(sqlite);
  (db as any).rawSqlite = sqlite;

  // ── 1) Upload ไฟล์ 2 ไฟล์ ─────────────────────────────────────────────
  const uploadOne = async (name: string) => {
    __resetRateLimitStoreForTests();
    const form = new FormData();
    form.append('file', new File([PDF_BYTES], name, { type: 'application/pdf' }));
    const res = await app.request('/api/v1/public/uploads/direct', { method: 'POST', body: form }, env());
    assertEqual(res.status, 201, `upload "${name}"`);
    const body = await res.json();
    assertTrue(body.success);
    return body.data;
  };

  const thai = await uploadOne('ใบสมัคร-ฉบับแก้ไข.pdf');
  const spaced = await uploadOne('my file (final) v2 -- แก้ไข.pdf');

  await test('upload ไทย: response.filename เป็นชื่อไทยเต็ม', () => {
    assertEqual(thai.filename, 'ใบสมัคร-ฉบับแก้ไข.pdf');
    assertTrue(/^uploads\/documents\/\d{4}\/[0-9a-f-]{36}-ใบสมัคร-ฉบับแก้ไข\.pdf$/.test(thai.fileKey));
  });

  // ── 2) ดาวน์โหลดกลับ ──────────────────────────────────────────────────
  await test('download กลับ: 200 + เนื้อไฟล์ตรง + header ASCII ล้วน', async () => {
    const res = await app.request(
      `/api/v1/public/uploads/files/${encodeURIComponent(thai.fileKey)}`, {}, env(),
    );
    assertEqual(res.status, 200);
    const got = new Uint8Array(await res.arrayBuffer());
    assertEqual(new TextDecoder().decode(got), new TextDecoder().decode(PDF_BYTES), 'เนื้อไฟล์ตรง');
    const disposition = res.headers.get('Content-Disposition') || '';
    assertTrue(!/[^\x00-\x7f]/.test(disposition), 'header ต้อง ASCII ล้วน');
    assertTrue(disposition.includes('filename*=UTF-8\'\''), 'ต้องมี filename* RFC 5987');
  });

  // ── 3) Submit ผ่าน route จริง (frontend จะส่ง filename จาก upload response /
  //        file.name — ที่นี่ใช้ response.filename ตาม contract) ────────────
  await test('submit route จริง: 201 + original_filename ถูกบันทึกทั้งสองไฟล์', async () => {
    __resetRateLimitStoreForTests();
    const res = await app.request('/api/v1/public/applications/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roundId: 'round-smoke',
        formData: {
          'field-fullname': 'คนสมัครทดสอบ',
          'field-email': 'smoke@test.local',
          'field-phone': '0812345678',
        },
        attachments: [
          { fieldId: 'f-files', fileUrl: thai.fileUrl, filename: thai.filename },
          { fieldId: 'f-files', fileUrl: spaced.fileUrl, filename: spaced.filename },
        ],
      }),
    }, env());
    assertEqual(res.status, 201, `submit ต้อง 201: ${res.status} ${await res.text()}`);
    const atts = sqlite.prepare('SELECT original_filename FROM application_attachments ORDER BY rowid').all();
    assertEqual(atts.length, 2, 'บันทึก 2 attachment');
    assertEqual(atts[0].original_filename, 'ใบสมัคร-ฉบับแก้ไข.pdf');
    assertEqual(atts[1].original_filename, 'my file (final) v2 -- แก้ไข.pdf');
  });

  // ── 4) Export + เขียนลงดิสก์ ──────────────────────────────────────────
  __setDrizzleForTests(() => db);
  const outPath = join(tmpdir(), 'sao-smoke-export.xlsx');

  await test('export สำเร็จ + เขียนไฟล์ .xlsx ลงดิสก์จริง', async () => {
    const result = await exportApplicationsExcel(
      { JWT_SECRET: 'test-secret' } as any,
      { roundId: 'round-smoke' },
      'admin-1',
      '203.0.113.9',
    );
    assertTrue(result.ok, `export ok: ${JSON.stringify(result).slice(0, 200)}`);
    assertEqual(result.rowCount, 1);
    writeFileSync(outPath, Buffer.from(result.buffer));
    assertEqual(readFileSync(outPath).byteLength, result.buffer.byteLength, 'ขนาดไฟล์บนดิสก์ตรง buffer');
  });

  await test('อ่านกลับด้วย ExcelJS จากดิสก์: แสดง original_filename (ชื่อไทยครบ ไม่มี path/uuid)', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(outPath);
    const ws = wb.getWorksheet('ใบสมัคร');
    assertTrue(!!ws, 'ต้องมี worksheet');
    let col = -1;
    for (let i = 1; i <= ws.columnCount; i++) {
      if (String(ws.getRow(1).getCell(i).value) === 'เอกสารประกอบ') { col = i; break; }
    }
    assertTrue(col > 0, 'ต้องมีคอลัมน์ FILE');
    const cell = ws.getRow(2).getCell(col);
    const lines = String(cell.value).split('\n');
    assertEqual(lines.length, 2, `2 ไฟล์ 2 บรรทัด: ${JSON.stringify(lines)}`);
    assertEqual(lines[0], 'ใบสมัคร-ฉบับแก้ไข.pdf', 'ใช้ original_filename ชื่อไทย');
    assertEqual(lines[1], 'my file (final) v2 -- แก้ไข.pdf', 'ช่องว่าง/วงเล็บ/ขีด ครบ');
    assertTrue(cell.alignment?.wrapText === true, 'FILE cell ต้อง wrapText');
    for (const line of lines) {
      assertTrue(!line.includes('uploads'), 'ห้ามมี path');
      assertTrue(!/[0-9a-f]{8}-[0-9a-f]{4}/.test(line), 'ห้ามมี uuid');
      assertTrue(!line.includes('%'), 'ห้ามมี percent encoding');
    }
  });

  __setDrizzleForTests(null);
  try { rmSync(outPath); } catch { /* ลบไม่ได้ก็ปล่อย (tmp) */ }

  console.log(`\n=== Smoke: ${passed} ผ่าน, ${failed} ล้ม ===`);
  if (failures.length) failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch((e) => { console.error('FATAL:', e); process.exit(1); });
