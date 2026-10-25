/**
 * Tests: Configurable PDF Filename (Migration 028)
 * --------------------------------------------
 * รัน: node --import tsx src/utils/__tests__/application-pdf-filename.test.ts
 *
 * Scope:
 *   1. validatePdfFilenamePattern — pattern validator (ข้อความไทย)
 *   2. buildApplicationPdfFilename — resolver + sanitization + fallback
 *   3. buildPdfContentDisposition — RFC 5987 header (filename + filename*)
 *   4. loadPdfFilenameContext — join applications → rounds → template_versions
 *      บน in-memory better-sqlite3 + migration 028 DDL จริง
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as schema from '../../db/schema';
import {
  validatePdfFilenamePattern,
  normalizePdfFilenamePattern,
  buildApplicationPdfFilename,
  buildPdfContentDisposition,
  buildPdfAsciiFallbackFilename,
  DEFAULT_PDF_FILENAME_PATTERN,
  MAX_PDF_PATTERN_LENGTH,
  MAX_PDF_FILENAME_LENGTH,
  MAX_FULLNAME_SEGMENT_LENGTH,
} from '../application-pdf-filename';
import { loadPdfFilenameContext } from '../../services/application-pdf-context';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((e) => {
      failed++;
      failures.push(`${name}: ${e?.message ?? e}`);
      console.log(`  ✗ ${name}: ${e?.message ?? e}`);
    });
}

function assert(condition: any, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

function assertEqual(actual: any, expected: any, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertOk(pattern: unknown, msg = '') {
  const result = validatePdfFilenamePattern(pattern);
  assert(result.ok, `${msg} expected ok, got ${'message' in result ? result.message : ''}`);
}

function assertFail(pattern: unknown, expectedMessage?: string, msg = '') {
  const result = validatePdfFilenamePattern(pattern);
  assert(!result.ok, `${msg} expected fail`);
  if (expectedMessage) {
    assertEqual(result.message, expectedMessage, `${msg} message`);
  }
}

const SYNTH = {
  applicationNo: 'APP-2026-5025',
  fullname: 'นายทดสอบ ระบบ',
  roundCode: 'TEST',
  year: 2026,
  applicationId: 'app-uuid-1234',
};

// =============================================================================
// 1. Validator
// =============================================================================

async function testValidator() {
  console.log('\n[1] validatePdfFilenamePattern');

  test('V1: null / undefined / ว่าง / whitespace ผ่าน (ใช้ค่าเริ่มต้น)', () => {
    assertOk(null);
    assertOk(undefined);
    assertOk('');
    assertOk('   ');
  });

  test('V2: ไม่มี {applicationNo} ไม่ผ่าน', () => {
    assertFail('ใบสมัคร_{fullname}', 'รูปแบบชื่อไฟล์ต้องมี {applicationNo}');
    assertFail('ใบสมัคร', 'รูปแบบชื่อไฟล์ต้องมี {applicationNo}');
  });

  test('V3: Unknown Token ไม่ผ่าน — ระบุ token แรกที่พบ', () => {
    assertFail('ใบสมัคร_{applicationNo}_{email}', 'พบตัวแปรที่ระบบไม่รองรับ: {email}');
    assertFail('ใบสมัคร_{applicationNo}_{phone}', 'พบตัวแปรที่ระบบไม่รองรับ: {phone}');
    assertFail('ใบสมัคร_{applicationNo}_{nationalId}', 'พบตัวแปรที่ระบบไม่รองรับ: {nationalId}');
    assertFail('ใบสมัคร_{applicationNo}_{fileUrl}', 'พบตัวแปรที่ระบบไม่รองรับ: {fileUrl}');
    assertFail('ใบสมัคร_{applicationNo}_{bogus}', 'พบตัวแปรที่ระบบไม่รองรับ: {bogus}');
  });

  test('V4: Token อนุญาตทั้งหมดผ่าน', () => {
    assertOk('ใบสมัคร_{applicationNo}_{fullname}_{roundCode}_{year}');
    assertOk('{applicationNo}');
  });

  test('V5: มี .pdf ไม่ผ่าน (ระบบเติมให้)', () => {
    assertFail('ใบสมัคร_{applicationNo}.pdf', 'ไม่ต้องระบุนามสกุล .pdf ระบบจะเพิ่มให้อัตโนมัติ');
    assertFail('ใบสมัคร_{applicationNo}.PDF', 'ไม่ต้องระบุนามสกุล .pdf ระบบจะเพิ่มให้อัตโนมัติ');
    assertFail('ใบสมัคร_{applicationNo}.pDf', 'ไม่ต้องระบุนามสกุล .pdf ระบบจะเพิ่มให้อัตโนมัติ');
  });

  test('V6: slash / backslash ไม่ผ่าน', () => {
    assertFail('a/b_{applicationNo}', 'รูปแบบชื่อไฟล์ต้องไม่มีเครื่องหมาย / หรือ \\');
    assertFail('a\\b_{applicationNo}', 'รูปแบบชื่อไฟล์ต้องไม่มีเครื่องหมาย / หรือ \\');
  });

  test('V7: ".." ไม่ผ่าน', () => {
    // "../" เจอเช็ค slash ก่อน (ลำดับใน validator)
    assertFail('../{applicationNo}', 'รูปแบบชื่อไฟล์ต้องไม่มีเครื่องหมาย / หรือ \\');
    assertFail('a..b_{applicationNo}', 'รูปแบบชื่อไฟล์ต้องไม่มี ".."');
  });

  test('V8: CR/LF / control characters ไม่ผ่าน', () => {
    assertFail('ใบสมัคร_{applicationNo}\n');
    assertFail('ใบสมัคร_{applicationNo}\r\n');
    assertFail('ใบสมัคร_{applicationNo}\t');
    assertFail('ใบสมัคร_{applicationNo}\u0000');
  });

  test('V9: เกิน 200 UTF-16 code units ไม่ผ่าน', () => {
    const base = 'x'.repeat(MAX_PDF_PATTERN_LENGTH - '{applicationNo}'.length);
    assertOk(`${base}{applicationNo}`);
    assertFail(
      `${base}x{applicationNo}`,
      'รูปแบบชื่อไฟล์ต้องมีความยาวไม่เกิน 200 ตัวอักษร'
    );
  });

  test('V10: type ไม่ใช่ string ไม่ผ่าน', () => {
    assertFail(123);
    assertFail({});
  });

  test('V11: normalize — whitespace เท่านั้น → null, มีเนื้อหาคงเดิม', () => {
    assertEqual(normalizePdfFilenamePattern('   '), null);
    assertEqual(normalizePdfFilenamePattern(null), null);
    assertEqual(normalizePdfFilenamePattern(undefined), null);
    assertEqual(normalizePdfFilenamePattern(' ใบสมัคร_{applicationNo} '), ' ใบสมัคร_{applicationNo} ');
  });
}

// =============================================================================
// 2. Resolver + Sanitization
// =============================================================================

async function testResolver() {
  console.log('\n[2] buildApplicationPdfFilename');

  test('R1: Default Pattern (null) — UAT fixture', () => {
    assertEqual(
      buildApplicationPdfFilename({ pattern: null, ...SYNTH }),
      'ใบสมัคร_APP-2026-5025_นายทดสอบ_ระบบ.pdf'
    );
    assertEqual(
      buildApplicationPdfFilename({ pattern: undefined, ...SYNTH }),
      'ใบสมัคร_APP-2026-5025_นายทดสอบ_ระบบ.pdf'
    );
    assertEqual(
      buildApplicationPdfFilename({ pattern: '', ...SYNTH }),
      'ใบสมัคร_APP-2026-5025_นายทดสอบ_ระบบ.pdf'
    );
  });

  test('R2: Custom Pattern + roundCode/year', () => {
    assertEqual(
      buildApplicationPdfFilename({
        pattern: '{roundCode}_{year}_{applicationNo}_{fullname}',
        ...SYNTH,
      }),
      'TEST_2026_APP-2026-5025_นายทดสอบ_ระบบ.pdf'
    );
  });

  test('R3: ภาษาไทย — สระ วรรณยุกต์ คงครบ (ช่องว่างภายใน → _)', () => {
    assertEqual(
      buildApplicationPdfFilename({
        pattern: DEFAULT_PDF_FILENAME_PATTERN,
        applicationNo: 'APP-2026-0001',
        fullname: 'นางสาวสุทัศนา ภูริภัณฑ์วราภรณ์',
      }),
      'ใบสมัคร_APP-2026-0001_นางสาวสุทัศนา_ภูริภัณฑ์วราภรณ์.pdf'
    );
  });

  test('R4: ช่องว่างหลายช่อง / tab / newline → underscore เดียว', () => {
    assertEqual(
      buildApplicationPdfFilename({
        pattern: DEFAULT_PDF_FILENAME_PATTERN,
        applicationNo: 'APP-1',
        fullname: 'นาย ทดสอบ    ระบบ\n\tสำรอง',
      }),
      'ใบสมัคร_APP-1_นาย_ทดสอบ_ระบบ_สำรอง.pdf'
    );
  });

  test('R5: fullname null/ว่าง → ตัดส่วน fullname + underscore เกิน', () => {
    assertEqual(
      buildApplicationPdfFilename({
        pattern: DEFAULT_PDF_FILENAME_PATTERN,
        applicationNo: 'APP-1',
        fullname: null,
      }),
      'ใบสมัคร_APP-1.pdf'
    );
    assertEqual(
      buildApplicationPdfFilename({
        pattern: DEFAULT_PDF_FILENAME_PATTERN,
        applicationNo: 'APP-1',
        fullname: '   ',
      }),
      'ใบสมัคร_APP-1.pdf'
    );
  });

  test('R6: applicationNo null → ใช้ applicationId', () => {
    assertEqual(
      buildApplicationPdfFilename({
        pattern: DEFAULT_PDF_FILENAME_PATTERN,
        applicationNo: null,
        applicationId: 'uuid-1234',
        fullname: 'นายทดสอบ',
      }),
      'ใบสมัคร_uuid-1234_นายทดสอบ.pdf'
    );
  });

  test('R7: path traversal ในค่า token ถูก sanitize', () => {
    const result = buildApplicationPdfFilename({
      pattern: DEFAULT_PDF_FILENAME_PATTERN,
      applicationNo: '../../etc/passwd',
      fullname: '..\\evil',
    });
    assert(!result.includes('/'), `no slash: ${result}`);
    assert(!result.includes('\\'), `no backslash: ${result}`);
    assert(!/^\.\./.test(result.replace('.pdf', '')), `no leading "..": ${result}`);
    assert(result.endsWith('.pdf'), `ends with .pdf: ${result}`);
  });

  test('R8: ตัดอักขระต้องห้าม : * ? " < > |', () => {
    assertEqual(
      buildApplicationPdfFilename({
        pattern: DEFAULT_PDF_FILENAME_PATTERN,
        applicationNo: 'APP-1',
        fullname: 'นาย<>:"|?*ทดสอบ',
      }),
      'ใบสมัคร_APP-1_นาย_ทดสอบ.pdf'
    );
  });

  test('R9: ชื่อยาว — fullname segment ถูกจำกัด', () => {
    const longName = 'ก'.repeat(200);
    const result = buildApplicationPdfFilename({
      pattern: DEFAULT_PDF_FILENAME_PATTERN,
      applicationNo: 'APP-1',
      fullname: longName,
    });
    const inner = result.slice('ใบสมัคร_APP-1_'.length, -'.pdf'.length);
    assert(
      Array.from(inner).length <= MAX_FULLNAME_SEGMENT_LENGTH,
      `fullname segment must be <= ${MAX_FULLNAME_SEGMENT_LENGTH}, got ${Array.from(inner).length}`
    );
    assert(!/[._\s]$/.test(inner), 'no trailing separator after truncation');
  });

  test('R10: ไม่มี .pdf.pdf — เติมนามสกุลครั้งเดียว', () => {
    const result = buildApplicationPdfFilename({
      pattern: '{applicationNo}',
      applicationNo: 'APP-1',
    });
    assertEqual(result, 'APP-1.pdf');
    assert(!/\.pdf.*\.pdf$/.test(result), 'no double .pdf suffix');
    assert(!/\.pdf\.pdf$/.test(result), 'no .pdf.pdf');

    // ค่าที่ resolve ลงท้าย .pdf อยู่แล้ว → ไม่เติมซ้ำ
    assertEqual(
      buildApplicationPdfFilename({ pattern: '{applicationNo}', applicationNo: 'APP-1.pdf' }),
      'APP-1.pdf'
    );
  });

  test('R11: ไม่มี underscore/ขีดเกินท้ายชื่อ', () => {
    const result = buildApplicationPdfFilename({
      pattern: DEFAULT_PDF_FILENAME_PATTERN,
      applicationNo: 'APP-1',
      fullname: 'นายทดสอบ-',
    });
    assert(!/[._\s]$/.test(result.replace('.pdf', '')), `no trailing separator: ${result}`);
  });

  test('R12: ผลลัพธ์ว่างทั้งหมด → fallback ใบสมัคร_{applicationNo|applicationId}', () => {
    assertEqual(
      buildApplicationPdfFilename({ pattern: '{fullname}', fullname: null, applicationNo: null, applicationId: 'app-9' }),
      'ใบสมัคร_app-9.pdf'
    );
    assertEqual(
      buildApplicationPdfFilename({ pattern: '{fullname}', fullname: null, applicationNo: 'APP-7', applicationId: null }),
      'ใบสมัคร_APP-7.pdf'
    );
  });

  test('R13: deterministic — input เดียวกันได้ชื่อเดียวกัน', () => {
    const a = buildApplicationPdfFilename({ pattern: null, ...SYNTH });
    const b = buildApplicationPdfFilename({ pattern: null, ...SYNTH });
    assertEqual(a, b);
  });

  test('R14: ชื่อไฟล์รวมเกิน MAX_PDF_FILENAME_LENGTH ถูกตัด', () => {
    const result = buildApplicationPdfFilename({
      pattern: '{applicationNo}_{fullname}',
      applicationNo: 'A'.repeat(200),
      fullname: 'นายทดสอบ',
    });
    const withoutExt = result.slice(0, -'.pdf'.length);
    assert(
      Array.from(withoutExt).length <= MAX_PDF_FILENAME_LENGTH,
      `total must be <= ${MAX_PDF_FILENAME_LENGTH}`
    );
    assert(result.endsWith('.pdf'), 'still ends with .pdf');
  });

  test('R15: token นอก allowlist ใน pattern ที่เก็บไว้แล้ว → แทนด้วยค่าว่าง (ไม่ resolve ค่า)', () => {
    assertEqual(
      buildApplicationPdfFilename({
        pattern: '{applicationNo}_{email}',
        applicationNo: 'APP-1',
        email: 'x@y.z' as any,
      }),
      'APP-1.pdf'
    );
  });
}

// =============================================================================
// 3. Content-Disposition
// =============================================================================

async function testContentDisposition() {
  console.log('\n[3] buildPdfContentDisposition');

  test('CD1: มีทั้ง filename และ filename*', () => {
    const header = buildPdfContentDisposition('ใบสมัคร_APP-2026-5025_นายทดสอบ_ระบบ.pdf', {
      applicationNo: 'APP-2026-5025',
      applicationId: 'app-uuid-1234',
    });
    assert(header.startsWith('attachment; filename="'), header);
    assert(header.includes('; filename*=UTF-8\'\''), header);
  });

  test('CD2: filename* decode กลับเป็นภาษาไทยได้ตรงตัว', () => {
    const name = 'ใบสมัคร_APP-2026-5025_นายทดสอบ_ระบบ.pdf';
    const header = buildPdfContentDisposition(name, { applicationNo: 'APP-2026-5025' });
    const m = header.match(/filename\*=UTF-8''([^;]+)/);
    assert(m, 'has filename*');
    assertEqual(decodeURIComponent(m[1]), name);
  });

  test('CD3: filename (ASCII fallback) มีแต่ ASCII ที่ปลอดภัย', () => {
    const ascii = buildPdfAsciiFallbackFilename({
      applicationNo: 'APP-2026-5025',
      applicationId: 'app-uuid',
    });
    assertEqual(ascii, 'application-APP-2026-5025.pdf');
    assert(/^[\x20-\x7e]+$/.test(ascii), 'ASCII only');
    const asciiThai = buildPdfAsciiFallbackFilename({ applicationNo: 'ใบสมัคร', applicationId: 'uuid-x' });
    assert(/^[\x20-\x7e]+$/.test(asciiThai), `ASCII only even with Thai appNo: ${asciiThai}`);
    assertEqual(asciiThai, 'application-uuid-x.pdf');
  });

  test('CD4: ไม่มี CR/LF / Header Injection', () => {
    const header = buildPdfContentDisposition('นายทดสอบ\r\nX-Evil: injected.pdf', {
      applicationNo: 'APP-1\nX-Evil: nope',
    });
    assert(!/[\r\n]/.test(header), 'no CR/LF in header');
    assert(!header.toLowerCase().includes('x-evil'), 'no injected header');
  });

  test('CD5: ชื่อมีอักขระ quote → ASCII fallback ไม่มี quote คร่อมซ้อน', () => {
    const header = buildPdfContentDisposition('a"b.pdf', { applicationNo: 'A"B' });
    assert(!header.includes('a"b'), 'Thai name never in filename=');
    const asciiPart = header.split(';')[1].trim();
    assert(/^filename="[^"]*"$/.test(asciiPart), `safe quoted ascii: ${asciiPart}`);
  });
}

// =============================================================================
// 4. loadPdfFilenameContext (better-sqlite3 + migration 028 DDL จริง)
// =============================================================================

async function testDbContext() {
  console.log('\n[4] loadPdfFilenameContext (in-memory SQLite)');

  test('DB1: migration 028 เพิ่มคอลัมน์ + drizzle อ่าน/เขียน pdfFilenamePattern ได้', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE admin_users (id TEXT PRIMARY KEY);
      CREATE TABLE templates (id TEXT PRIMARY KEY);
      CREATE TABLE template_versions (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL REFERENCES templates(id),
        version_number INTEGER NOT NULL,
        status TEXT DEFAULT 'DRAFT',
        created_at INTEGER,
        descriptor_json TEXT,
        descriptor_schema_version INTEGER,
        descriptor_updated_at INTEGER,
        descriptor_updated_by TEXT,
        UNIQUE (template_id, version_number)
      );
      CREATE TABLE recruitment_rounds (
        id TEXT PRIMARY KEY,
        template_version_id TEXT NOT NULL REFERENCES template_versions(id),
        title TEXT NOT NULL,
        position_level TEXT NOT NULL,
        open_date INTEGER NOT NULL,
        close_date INTEGER NOT NULL,
        status TEXT DEFAULT 'ACTIVE',
        created_at INTEGER,
        deleted_at INTEGER,
        announcement_title TEXT,
        announcement_description TEXT,
        contact_information TEXT,
        remark TEXT,
        application_pattern TEXT,
        round_code TEXT
      );
      CREATE TABLE applications (
        id TEXT PRIMARY KEY,
        application_no TEXT UNIQUE,
        round_id TEXT NOT NULL REFERENCES recruitment_rounds(id),
        email TEXT NOT NULL,
        fullname TEXT NOT NULL,
        national_id TEXT,
        status TEXT DEFAULT 'SUBMITTED',
        status_reason TEXT,
        verified_by TEXT,
        verified_at INTEGER,
        form_data TEXT NOT NULL,
        submitted_at INTEGER,
        deleted_at INTEGER,
        year INTEGER,
        round_code TEXT,
        seq_in_round INTEGER
      );
    `);

    // apply migration 028 DDL จริงจากไฟล์
    const migrationSql = readFileSync(
      join(__dirname, '../../../migrations/028_template_versions_pdf_filename_pattern.sql'),
      'utf8'
    );
    const alterMatch = migrationSql.match(/ALTER TABLE[^;]+;/);
    assert(alterMatch, 'migration 028 has ALTER TABLE statement');
    sqlite.exec(alterMatch[0]);

    const db = drizzle(sqlite, { schema });
    sqlite.exec(`
      INSERT INTO templates (id) VALUES ('tpl-1');
      INSERT INTO template_versions (id, template_id, version_number, status, pdf_filename_pattern)
        VALUES ('ver-1', 'tpl-1', 1, 'PUBLISHED', 'ใบสมัคร_{applicationNo}_{fullname}');
      INSERT INTO template_versions (id, template_id, version_number, status)
        VALUES ('ver-2', 'tpl-1', 2, 'DRAFT');
      INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status, round_code)
        VALUES ('round-1', 'ver-1', 'รอบทดสอบ', 'ปริญญาตรี', 1000, 2000, 'ACTIVE', 'TEST');
      INSERT INTO applications (id, application_no, round_id, email, fullname, form_data, status, year, round_code)
        VALUES ('app-1', 'APP-2026-5025', 'round-1', 'test@example.com', 'นายทดสอบ ระบบ', '{}', 'SUBMITTED', 2026, 'TEST');
    `);

    // อ่านกลับผ่าน drizzle schema mapping
    const ver = await db.select().from(schema.templateVersions).where(eqVer('ver-1')).get();
    assertEqual(ver.pdfFilenamePattern, 'ใบสมัคร_{applicationNo}_{fullname}');
    const verNull = await db.select().from(schema.templateVersions).where(eqVer('ver-2')).get();
    assertEqual(verNull.pdfFilenamePattern, null);

    // context: application → round → version
    const ctx = await loadPdfFilenameContext(db as any, 'app-1');
    assert(ctx, 'context found');
    assertEqual(ctx.pattern, 'ใบสมัคร_{applicationNo}_{fullname}');
    assertEqual(ctx.applicationNo, 'APP-2026-5025');
    assertEqual(ctx.fullname, 'นายทดสอบ ระบบ');
    assertEqual(ctx.roundCode, 'TEST');
    assertEqual(ctx.year, 2026);
    assertEqual(ctx.applicationId, 'app-1');

    // resolver กับ context จริง → ชื่อ UAT
    assertEqual(
      buildApplicationPdfFilename(ctx),
      'ใบสมัคร_APP-2026-5025_นายทดสอบ_ระบบ.pdf'
    );

    // version เก่า (null) → context pattern null → resolver ใช้ default
    sqlite.exec(`UPDATE recruitment_rounds SET template_version_id = 'ver-2' WHERE id = 'round-1';`);
    const ctx2 = await loadPdfFilenameContext(db as any, 'app-1');
    assertEqual(ctx2.pattern, null);
    assertEqual(
      buildApplicationPdfFilename(ctx2),
      'ใบสมัคร_APP-2026-5025_นายทดสอบ_ระบบ.pdf'
    );

    // application เก่าไม่มี year/roundCode snapshot
    sqlite.exec(`UPDATE applications SET year = NULL, round_code = NULL WHERE id = 'app-1';`);
    const ctx3 = await loadPdfFilenameContext(db as any, 'app-1');
    assertEqual(ctx3.year, null);
    assertEqual(
      buildApplicationPdfFilename({ pattern: '{applicationNo}_{roundCode}_{year}_{fullname}', ...ctx3 }),
      'APP-2026-5025_นายทดสอบ ระบบ.pdf'
    );

    // ไม่พบ application → null
    const missing = await loadPdfFilenameContext(db as any, 'nope');
    assertEqual(missing, null);

    function eqVer(id: string) {
      const { eq } = require('drizzle-orm');
      return eq(schema.templateVersions.id, id);
    }
  });
}

// =============================================================================
// Run
// =============================================================================

async function runAllTests() {
  console.log('\n========================================');
  console.log('Configurable PDF Filename Tests (Migration 028)');
  console.log('========================================');

  await testValidator();
  await testResolver();
  await testContentDisposition();
  await testDbContext();

  console.log('\n----------------------------------------');
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

runAllTests();
