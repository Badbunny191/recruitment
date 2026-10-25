/**
 * Integration Tests: Admin API Layer (Document Composer)
 * --------------------------------------------
 * Feature: Document Composer V1 — Admin API Layer
 *
 * รัน: node --import tsx src/routes/__tests__/template-descriptor-api.test.ts
 *
 * Scope:
 *   ทดสอบ business logic ของ Admin API Layer:
 *   - Template Descriptor Service (load/save)
 *   - Template Descriptor Preview Service (build preview context)
 *   - Generator + Preview Renderer (end-to-end pipeline)
 *   - Zod Request Schema (validation rules)
 *
 * Test Strategy:
 *   - ใช้ in-memory better-sqlite3 + Drizzle (เหมือน rbac.test.ts)
 *   - Test seam `__setDrizzleForTests` inject fake Drizzle
 *   - ตรวจ behavior ของ service + ใช้ Zod schema แบบ manual
 *   - ไม่ test HTTP layer โดยตรง (เพราะ require D1 environment)
 *
 * Covered Scenarios:
 *   1. Save → Load round-trip
 *   2. Save validation (invalid shape)
 *   3. Save optimistic lock (expectedVersion mismatch)
 *   4. Build preview context (sections + fields + sample formData)
 *   5. Generate descriptor (sections + fields → descriptor)
 *   6. Render preview (descriptor + context → html)
 *   7. Zod schema: PUT request validation
 *   8. Zod schema: preview request validation
 *   9. Zod schema: generate request validation
 *  10. End-to-end: generate → preview → save → load
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql, eq } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '../../db/schema';

import {
  loadTemplateDescriptor,
  saveTemplateDescriptor,
  __setDrizzleForTests as setTemplateDb,
} from '../../services/template-descriptor.service';
import {
  buildPreviewContext,
  __setDrizzleForTests as setPreviewDb,
} from '../../services/template-descriptor-preview.service';
import {
  generateDescriptorFromTemplate,
  renderDescriptorToPreview,
} from '../../lib/document-composer';

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

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(
      `${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertTrue(condition, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

function assertFalse(condition, msg = '') {
  if (condition) throw new Error(msg || 'Expected false');
}

function assertContains(haystack, needle, msg = '') {
  if (typeof haystack !== 'string' || !haystack.includes(needle)) {
    throw new Error(
      `${msg || 'contains'} expected ${JSON.stringify(needle)} in ${JSON.stringify(haystack)}`
    );
  }
}

// =============================================================================
// Harness — in-memory SQLite + Drizzle
// =============================================================================

function makeInMemorySchema() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE admin_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'ADMIN',
      is_active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      password_changed_at INTEGER,
      failed_login_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER,
      password_migrated INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at INTEGER,
      deleted_at INTEGER
    );
    CREATE TABLE template_versions (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      status TEXT DEFAULT 'DRAFT',
      created_at INTEGER,
      descriptor_json TEXT,
      descriptor_schema_version INTEGER,
      descriptor_updated_at INTEGER,
      descriptor_updated_by TEXT,
      pdf_filename_pattern TEXT
    );
    CREATE TABLE template_sections (
      id TEXT PRIMARY KEY,
      template_version_id TEXT NOT NULL,
      name TEXT NOT NULL,
      display_order INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE field_master (
      id TEXT PRIMARY KEY,
      field_type TEXT NOT NULL,
      label_th TEXT NOT NULL,
      default_options TEXT,
      pdf_mapping_key TEXT,
      is_active INTEGER DEFAULT 1,
      help_text TEXT,
      placeholder TEXT,
      section TEXT,
      file_config TEXT,
      validation_type TEXT,
      validation_message TEXT
    );
    -- [Live Preview] จำเป็นสำหรับ loadPrimaryRound() — ถ้าไม่มีตารางนี้
    -- preview จะ catch error และ fallback เป็น placeholder (ไม่ crash)
    CREATE TABLE recruitment_rounds (
      id TEXT PRIMARY KEY,
      template_version_id TEXT NOT NULL,
      title TEXT NOT NULL,
      position_level TEXT NOT NULL,
      open_date INTEGER NOT NULL,
      close_date INTEGER NOT NULL,
      status TEXT DEFAULT 'DRAFT',
      created_at INTEGER,
      deleted_at INTEGER,
      announcement_title TEXT,
      announcement_description TEXT,
      contact_information TEXT,
      remark TEXT,
      application_pattern TEXT,
      round_code TEXT
    );
    CREATE TABLE template_fields (
      id TEXT PRIMARY KEY,
      template_version_id TEXT NOT NULL,
      field_id TEXT NOT NULL,
      section_id TEXT,
      display_order INTEGER NOT NULL,
      is_required INTEGER DEFAULT 1,
      override_options TEXT,
      override_label_th TEXT,
      help_text TEXT,
      placeholder TEXT,
      validation_rules TEXT,
      rows INTEGER,
      min_length INTEGER,
      max_length INTEGER,
      validation_message TEXT
    );
  `);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

function seedBasicData(db: any) {
  db.run(sql`INSERT INTO templates (id, name) VALUES ('tpl-1', 'Test Template')`);
  db.run(sql`INSERT INTO template_versions
    (id, template_id, version_number, status)
    VALUES ('tv-1', 'tpl-1', 1, 'DRAFT')`);
  db.run(sql`INSERT INTO field_master (id, field_type, label_th)
    VALUES ('fm-name', 'TEXT', 'ชื่อ-นามสกุล')`);
  db.run(sql`INSERT INTO field_master (id, field_type, label_th)
    VALUES ('fm-edu', 'MASTER_DATA', 'ประวัติการศึกษา')`);
  db.run(sql`INSERT INTO template_sections
    (id, template_version_id, name, display_order, is_active)
    VALUES ('sec-1', 'tv-1', 'ข้อมูลส่วนตัว', 1, 1)`);
  db.run(sql`INSERT INTO template_sections
    (id, template_version_id, name, display_order, is_active)
    VALUES ('sec-2', 'tv-1', 'การศึกษา', 2, 1)`);
  db.run(sql`INSERT INTO template_fields
    (id, template_version_id, field_id, section_id, display_order, is_required)
    VALUES ('tf-1', 'tv-1', 'fm-name', 'sec-1', 1, 1)`);
  db.run(sql`INSERT INTO template_fields
    (id, template_version_id, field_id, section_id, display_order, is_required)
    VALUES ('tf-2', 'tv-1', 'fm-edu', 'sec-2', 1, 1)`);
}

const SAMPLE_DESCRIPTOR = {
  version: 1 as const,
  blocks: [
    { id: 'logo-1', type: 'logo' as const, align: 'left' as const },
    {
      id: 'h-1',
      type: 'heading' as const,
      text: 'ข้อมูลส่วนตัว',
      size: 'medium' as const,
      bold: true,
      align: 'left' as const,
      marginTop: 12,
      marginBottom: 8,
    },
    {
      id: 'f-1',
      type: 'field' as const,
      fieldId: 'fm-name',
      align: 'left' as const,
      marginTop: 0,
      marginBottom: 8,
    },
  ],
};

// =============================================================================
// Zod Request Schemas (mirror route file — duplicated for test independence)
// =============================================================================

const SaveDescriptorRequestSchema = z.object({
  descriptor: z.object({
    version: z.literal(1),
    blocks: z.array(z.any()).min(1, 'Descriptor must have at least one block'),
  }),
  expectedSchemaVersion: z.number().int().nonnegative().optional(),
});

const PreviewDescriptorRequestSchema = z.object({
  descriptor: z.object({
    version: z.literal(1),
    blocks: z.array(z.any()).min(1),
  }),
});

const GenerateDescriptorRequestSchema = z
  .object({
    tableFieldIds: z.array(z.string().min(1)).optional(),
  })
  .optional()
  .default({});

// =============================================================================
// Tests
// =============================================================================

async function runAllTests() {
  console.log('\n=== Admin API Layer — Service Integration Tests ===\n');

  // =====================================================================
  // [1] Template Descriptor Service: load + save
  // =====================================================================
  console.log('[1] Template Descriptor Service');

  await test('load returns default descriptor when none saved', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    const result = await loadTemplateDescriptor(db as any, 'tv-1');
    assertTrue(result.ok);
    if (!result.ok) return;
    assertEqual(result.descriptor.version, 1);
    assertEqual(result.schemaVersion, null);
    assertEqual(result.meta.source, 'default');
    assertEqual(result.meta.reason, 'NO_DESCRIPTOR');
    sqlite.close();
  });

  await test('save + load round-trip preserves descriptor', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    const saveResult = await saveTemplateDescriptor(db as any, 'tv-1', SAMPLE_DESCRIPTOR, {
      adminUserId: 'admin-1',
    });
    assertTrue(saveResult.ok);
    if (!saveResult.ok) return;
    assertEqual(saveResult.schemaVersion, 1);

    const loadResult = await loadTemplateDescriptor(db as any, 'tv-1');
    assertTrue(loadResult.ok);
    if (!loadResult.ok) return;
    assertEqual(loadResult.schemaVersion, 1);
    assertEqual(loadResult.meta.source, 'db');
    assertEqual(loadResult.descriptor.blocks.length, 3);
    sqlite.close();
  });

  await test('save rejects invalid descriptor with VALIDATION_FAILED', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    const result = await saveTemplateDescriptor(
      db as any,
      'tv-1',
      {
        version: 1,
        blocks: [{ id: 'b1', type: 'field' }], // missing fieldId
      },
      { adminUserId: 'admin-1' }
    );
    assertFalse(result.ok);
    if (result.ok) return;
    assertEqual(result.reason, 'VALIDATION_FAILED');
    assertTrue(Array.isArray(result.issues));
    sqlite.close();
  });

  await test('save returns NOT_FOUND for non-existent version', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    const result = await saveTemplateDescriptor(db as any, 'nonexistent', SAMPLE_DESCRIPTOR, {
      adminUserId: 'admin-1',
    });
    assertFalse(result.ok);
    if (result.ok) return;
    assertEqual(result.reason, 'NOT_FOUND');
    sqlite.close();
  });

  await test('save with mismatched expectedVersion returns VERSION_MISMATCH', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    // First save with no expected version
    const first = await saveTemplateDescriptor(db as any, 'tv-1', SAMPLE_DESCRIPTOR, {
      adminUserId: 'admin-1',
    });
    assertTrue(first.ok);
    // Second save with wrong expectedVersion
    const second = await saveTemplateDescriptor(db as any, 'tv-1', SAMPLE_DESCRIPTOR, {
      adminUserId: 'admin-1',
      expectedVersion: 999,
    });
    assertFalse(second.ok);
    if (second.ok) return;
    assertEqual(second.reason, 'VERSION_MISMATCH');
    sqlite.close();
  });

  // =====================================================================
  // [1.1] D1 result shape — regression test
  //
  // Production ใช้ D1 (Cloudflare) ซึ่ง drizzle-orm/d1 return shape คือ
  //   { success, meta: { changes, last_row_id, ... } }
  // ไม่ใช่ top-level { changes } เหมือน better-sqlite3
  //
  // ถ้าอ่านผิด path → VERSION_MISMATCH 409 ตลอด (false positive)
  // =====================================================================
  await test('save with expectedVersion handles D1 result shape (meta.changes)', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);

    // Intercept update().run() เพื่อ simulate D1 result shape
    const originalUpdate = db.update;
    let intercepted = false;
    (db as any).update = function (...args: any[]) {
      const q = originalUpdate.apply(this, args);
      const originalRun = q.set.bind(q);
      // Wrap the chain to inject D1 result shape
      return new Proxy(q, {
        get(target, prop) {
          if (prop === 'set') {
            return (...setArgs: any[]) => {
              const next = originalRun(...setArgs);
              const origWhereRun = next.where.bind(next);
              return new Proxy(next, {
                get(t2, p2) {
                  if (p2 === 'where') {
                    return (...wArgs: any[]) => {
                      const final = origWhereRun(...wArgs);
                      const origRun = final.run.bind(final);
                      final.run = async () => {
                        // Simulate D1: { success: true, meta: { changes: 1, last_row_id: 1 } }
                        const realResult = await origRun();
                        intercepted = true;
                        return {
                          success: true,
                          meta: {
                            changes: (realResult as any)?.changes ?? 1,
                            last_row_id: (realResult as any)?.lastInsertRowid ?? 1,
                          },
                        };
                      };
                      return final;
                    };
                  }
                  return (t2 as any)[p2];
                },
              });
            };
          }
          return (target as any)[prop];
        },
      });
    };

    const first = await saveTemplateDescriptor(db as any, 'tv-1', SAMPLE_DESCRIPTOR, {
      adminUserId: 'admin-1',
    });
    assertTrue(first.ok);
    assertTrue(intercepted, 'D1 interceptor should have fired');

    const second = await saveTemplateDescriptor(db as any, 'tv-1', SAMPLE_DESCRIPTOR, {
      adminUserId: 'admin-1',
      expectedVersion: 1,
    });
    assertTrue(second.ok, 'D1 result shape with meta.changes should yield ok=true');
    sqlite.close();
  });

  // =====================================================================
  // [2] Template Descriptor Preview Service: buildPreviewContext
  // =====================================================================
  console.log('\n[2] Template Descriptor Preview Service');

  await test('buildPreviewContext returns null for missing version', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    const ctx = await buildPreviewContext(db as any, 'nonexistent');
    assertEqual(ctx, null);
    sqlite.close();
  });

  await test('buildPreviewContext returns valid context for version', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;
    assertEqual(ctx.templateVersion.id, 'tv-1');
    assertEqual(ctx.sections.length, 2);
    assertEqual(ctx.fields.length, 2);
    assertTrue(ctx.application.formData !== null);
    // Sample formData should be populated
    assertTrue((ctx.application.formData as any)['fm-name'] !== undefined);
    assertTrue((ctx.application.formData as any)['fm-edu'] !== undefined);
    // MASTER_DATA field gets single-object sample (Requirement F)
    // - ค่าเดียวเสมอ (ไม่ใช่ array 2 แถว) — "สังกัดปัจจุบัน" render เป็น 1 ค่า
    // - object { id, name } — ใช้ field.label เป็น display label
    const eduData = (ctx.application.formData as any)['fm-edu'];
    assertTrue(eduData !== null && typeof eduData === 'object');
    assertFalse(Array.isArray(eduData), 'MASTER_DATA sample must be single object (Requirement F)');
    assertEqual(typeof eduData.name, 'string');
    sqlite.close();
  });

  // ── [2.1] Regression: BUG — hard-coded education data ──────────────
  // Bug: composer preview ของ Table block ทุก field แสดง header
  //   "ปีการศึกษา | สถาบัน | วุฒิ" แทนที่จะเป็น field label จริง
  // Root cause: buildSampleFormData() inject hard-coded education rows
  //   { ปีการศึกษา: '2566', สถาบัน: 'ตัวอย่าง', วุฒิ: 'ตัวอย่าง' }
  // โดยไม่สนใจ field.label ของ field นั้นๆ
  // Fix: schema-aware sample → ใช้ field.label เป็น column name
  // See: backend/src/services/template-descriptor-preview.service.ts:buildSampleFormData
  await test('MASTER_DATA sample column name = field.label (regression: no hard-coded edu data)', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db); // ← seed tv-1
    // เพิ่ม field ที่ label ไม่ใช่ "ประวัติการศึกษา"
    // (จำลองเคส field "สังกัดปัจจุบัน" ที่ user report)
    db.run(sql`INSERT INTO field_master (id, field_type, label_th)
      VALUES ('fm-aff', 'MASTER_DATA', 'สังกัดปัจจุบัน')`);
    db.run(sql`INSERT INTO template_sections
      (id, template_version_id, name, display_order, is_active)
      VALUES ('sec-aff', 'tv-1', 'สังกัดปัจจุบัน', 1, 1)`);
    db.run(sql`INSERT INTO template_fields
      (id, template_version_id, field_id, section_id, display_order, is_required)
      VALUES ('tf-aff', 'tv-1', 'fm-aff', 'sec-aff', 1, 1)`);

    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;

    // MASTER_DATA = single object { id, name } (Requirement F)
    const sample = (ctx.application.formData as any)['fm-aff'];
    assertTrue(sample !== null && typeof sample === 'object');
    assertFalse(Array.isArray(sample), 'MASTER_DATA must be single object (Requirement F)');
    assertEqual(typeof sample.name, 'string');
    assertTrue(sample.name.length > 0, 'name should be non-empty placeholder');

    // ── ตรวจ: display label ตรงกับ field.label "สังกัดปัจจุบัน" ──
    assertContains(
      sample.name,
      'สังกัดปัจจุบัน',
      `name should reference field.label, got "${sample.name}"`
    );

    // ── ตรวจ: ไม่มี hard-coded "ปีการศึกษา/สถาบัน/วุฒิ" keys ──
    const sampleKeys = Object.keys(sample);
    assertFalse(sampleKeys.includes('ปีการศึกษา'), 'must not contain "ปีการศึกษา"');
    assertFalse(sampleKeys.includes('สถาบัน'), 'must not contain "สถาบัน"');
    assertFalse(sampleKeys.includes('วุฒิ'), 'must not contain "วุฒิ"');
    sqlite.close();
  });

  // ── [2.2] Live Preview: real document data (application no / round) ──
  //
  // Requirement: preview ต้องอ่านข้อมูลจาก Template/Round ที่กำลังแก้ไข
  //   แทน descriptor placeholder
  //
  // ก่อนแก้: applicationNo = 'PREVIEW' (hardcoded), positionLevel = 'N/A'
  // หลังแก้: อ่าน round จริง + สร้างเลขที่ใบสมัครจาก applicationPattern engine
  await test('buildPreviewContext reads real round data (positionLevel/title)', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    db.run(sql`INSERT INTO recruitment_rounds
      (id, template_version_id, title, position_level, open_date, close_date,
       application_pattern, round_code)
      VALUES ('round-1', 'tv-1', 'รับสมัครนักตรวจสอบ', 'ระดับปฏิบัติการ',
              1794000000, 1800000000, '{YEAR}-{ROUND_CODE}-{RUNNING:4}', 'CHM01')`);

    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;
    assertEqual(ctx.round.positionLevel, 'ระดับปฏิบัติการ', 'must read real positionLevel');
    assertEqual(ctx.round.title, 'รับสมัครนักตรวจสอบ', 'must read real round title');
    assertEqual(ctx.round.roundCode, 'CHM01', 'must read real roundCode');
    sqlite.close();
  });

  await test('buildPreviewContext generates real application number from pattern', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    db.run(sql`INSERT INTO recruitment_rounds
      (id, template_version_id, title, position_level, open_date, close_date,
       application_pattern, round_code)
      VALUES ('round-1', 'tv-1', 'ทดสอบ', 'ปฏิบัติการ', 1794000000, 1800000000,
              '{YEAR}-{ROUND_CODE}-{RUNNING:4}', 'CHM01')`);

    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;
    // ต้องเป็นเลขที่ format จริง ไม่ใช่ 'PREVIEW'
    assertTrue(
      ctx.application.applicationNo !== 'PREVIEW',
      'applicationNo must not be the PREVIEW placeholder'
    );
    assertTrue(
      ctx.application.applicationNo.includes('CHM01'),
      `applicationNo should contain roundCode, got "${ctx.application.applicationNo}"`
    );
    assertTrue(
      /-\d{4}$/.test(ctx.application.applicationNo),
      `running number should be 4 digits, got "${ctx.application.applicationNo}"`
    );
    sqlite.close();
  });

  await test('buildPreviewContext falls back gracefully when round has no pattern', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    // round ที่ admin ยังไม่ได้ตั้ง application_pattern
    db.run(sql`INSERT INTO recruitment_rounds
      (id, template_version_id, title, position_level, open_date, close_date)
      VALUES ('round-1', 'tv-1', 'ยังไม่ตั้งค่า', 'ปฏิบัติการ', 1794000000, 1800000000)`);

    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;
    // ต้องไม่แสดง pattern ดิบกลับมา (เช่น "{YEAR}-{ROUND_CODE}...")
    assertTrue(
      !ctx.application.applicationNo.includes('{'),
      `must not leak raw pattern, got "${ctx.application.applicationNo}"`
    );
    assertEqual(ctx.application.applicationNo, 'PREVIEW-0001');
    sqlite.close();
  });

  await test('buildPreviewContext keeps working when NO round exists', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db); // ไม่ seed round เลย

    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;
    assertEqual(ctx.application.applicationNo, 'PREVIEW-0001');
    assertEqual(ctx.round.positionLevel, 'N/A', 'fallback when no round');
    assertEqual(ctx.round.title, 'Preview Mode');
    sqlite.close();
  });

  // ── [2.3] Live Preview: document token field-first ────────────────
  // field ที่ผูกกับ document token ต้องได้ค่าตัวอย่างที่อ่านได้จริง
  // ไม่ใช่ "ตัวอย่าง{label}" (ซึ่งจะไปโผล่ในหัวเอกสารแบบไม่สมจริง)
  await test('document token field gets readable sample (not "ตัวอย่าง...")', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    db.run(sql`INSERT INTO field_master (id, field_type, label_th, pdf_mapping_key)
      VALUES ('fm-pos', 'TEXT', 'ตำแหน่ง', 'position')`);
    db.run(sql`INSERT INTO template_fields
      (id, template_version_id, field_id, section_id, display_order, is_required)
      VALUES ('tf-pos', 'tv-1', 'fm-pos', 'sec-1', 3, 0)`);

    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;
    const value = (ctx.application.formData as any)['fm-pos'];
    assertTrue(
      typeof value === 'string' && !value.startsWith('ตัวอย่าง'),
      `token field sample should not be prefixed with "ตัวอย่าง", got "${value}"`
    );
    sqlite.close();
  });

  await test('MASTER_DATA sample uses label per-field (not shared "ประวัติการศึกษา")', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db); // ← seed tv-1
    // field — label = "หน่วยงาน"
    db.run(sql`INSERT INTO field_master (id, field_type, label_th)
      VALUES ('fm-org', 'MASTER_DATA', 'หน่วยงาน')`);
    db.run(sql`INSERT INTO template_sections
      (id, template_version_id, name, display_order, is_active)
      VALUES ('sec-org', 'tv-1', 'หน่วยงาน', 1, 1)`);
    db.run(sql`INSERT INTO template_fields
      (id, template_version_id, field_id, section_id, display_order, is_required)
      VALUES ('tf-org', 'tv-1', 'fm-org', 'sec-org', 1, 1)`);

    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;

    // MASTER_DATA = single object { id, name } (Requirement F)
    const sample = (ctx.application.formData as any)['fm-org'];
    assertTrue(sample !== null && typeof sample === 'object');
    assertFalse(Array.isArray(sample), 'MASTER_DATA must be single object');
    assertEqual(typeof sample.name, 'string');
    // display name = field.label (per-field)
    assertContains(sample.name, 'หน่วยงาน');
    sqlite.close();
  });

  // =====================================================================
  // [3] Generator + Preview Renderer Pipeline
  // =====================================================================
  console.log('\n[3] Generator + Preview Renderer');

  // Default descriptor now includes system data and signature blocks (Requirement H)
// ลำดับ: Logo (1) → Heading Title (1) → SystemData APPLICATION_NO (1)
//       → SystemData APPLICATION_DATE (1) → Section Headings (N)
//       → Field/Table blocks (M) → Signature (1)
// (ก่อนหน้านี้ test เคย assert 5 blocks — เพิ่มเป็น 9 เพราะ system data + title heading + signature)
await test('generateDescriptorFromTemplate produces valid descriptor', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;

    const result = generateDescriptorFromTemplate({
      sections: ctx.sections.map((s) => ({
        id: s.id,
        name: s.name,
        displayOrder: s.displayOrder,
        isActive: true,
      })),
      fields: ctx.fields.map((f) => ({
        id: f.id,
        fieldId: f.fieldId,
        sectionId: f.sectionId,
        displayOrder: f.displayOrder,
        type: f.type as any,
        overrideLabelTh: null,
        labelTh: f.label,
      })),
      // seed fm-edu เป็น MASTER_DATA — ระบุให้เป็น table เพื่อเทียบ assertion เก่า
      // (ถ้าไม่ระบุ tableFieldIds → heuristic: MASTER_DATA = field block ตาม Requirement F.1)
      tableFieldIds: ctx.fields
        .filter((f) => f.type === 'MASTER_DATA')
        .map((f) => f.id),
    });
    assertTrue(result.ok);
    if (!result.ok) return;
    // ลำดับตาม Requirement H: 1 logo + 1 title heading + 2 systemData
    // + N section headings + M fields/tables + 1 signature
    // seedBasicData ใส่ 2 sections (sec-1, sec-2) + 2 fields (TEXT + MASTER_DATA)
    // = 1 logo + 1 title heading + 2 systemData
    //   + 2 section headings (1 per section)
    //   + 1 field block (TEXT) + 1 table block (MASTER_DATA — explicit override)
    //   + 1 signature = 9
    assertEqual(result.descriptor.blocks.length, 9);
    // ตรวจสอบลำดับที่สำคัญ: บล็อกแรกเป็น logo, บล็อกสุดท้ายเป็น signature
    assertEqual(result.descriptor.blocks[0].type, 'logo');
    assertEqual(result.descriptor.blocks[result.descriptor.blocks.length - 1].type, 'signature');
    assertEqual(result.meta.logoBlockId, result.descriptor.blocks[0].id);
    // headingCount = title heading + section headings
    assertEqual(result.meta.headingCount, 3);
    assertEqual(result.meta.fieldBlockCount, 1);
    assertEqual(result.meta.tableBlockCount, 1);
    assertEqual(result.meta.systemDataCount, 2);
    assertEqual(result.meta.totalBlocks, 9);
    sqlite.close();
  });

  await test('renderDescriptorToPreview produces html with all sections', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;

    const result = generateDescriptorFromTemplate({
      sections: ctx.sections.map((s) => ({
        id: s.id,
        name: s.name,
        displayOrder: s.displayOrder,
        isActive: true,
      })),
      fields: ctx.fields.map((f) => ({
        id: f.id,
        fieldId: f.fieldId,
        sectionId: f.sectionId,
        displayOrder: f.displayOrder,
        type: f.type as any,
        overrideLabelTh: null,
        labelTh: f.label,
      })),
    });
    assertTrue(result.ok);
    if (!result.ok) return;

    const preview = renderDescriptorToPreview(result.descriptor, ctx);
    assertTrue(preview.html.includes('<!DOCTYPE html>'));
    assertTrue(preview.body.length > 0);
    assertEqual(preview.meta.blockCount, result.descriptor.blocks.length);
    assertEqual(preview.meta.missingFieldIds.length, 0);
    sqlite.close();
  });

  // ── [3.1] Preview = เอกสาร ไม่ใช่ฟอร์ม ────────────────────────────
  // 🔑 ห้ามมี form control ใน preview (input/textarea/select/checkbox/radio)
  //    เพื่อให้ HTML Preview กับ PDF Preview มีหน้าตาใกล้เคียงกันที่สุด
  await test('TEXT field renders as document text, not <input> control', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db); // fm-name = TEXT
    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;

    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [{ id: 'f-1', type: 'field', fieldId: 'fm-name' }] },
      ctx
    );
    assertFalse(
      preview.body.includes('<input'),
      'preview must NOT contain any <input> element'
    );
    assertFalse(
      preview.body.includes('class="dc-control"'),
      'preview must NOT emit a .dc-control element'
    );
    assertTrue(
      preview.body.includes('dc-field__value'),
      'field block must render value as document text'
    );
    assertTrue(
      preview.body.includes('ตัวอย่าง'),
      'resolved value must be shown as plain document text'
    );
    // label ยังต้องอยู่ (ป้ายกำกับเอกสาร ไม่ใช่ <label> ของฟอร์ม)
    assertTrue(
      preview.body.includes('ชื่อ-นามสกุล'),
      'field label must still be present'
    );
    sqlite.close();
  });

  // 🔑 กัน regression: ทุก field type ต้องไม่หลุดเป็น form control
  await test('no field type leaks a form control into preview', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;

    // ทุก field ของ template version นี้ (TEXT / MASTER_DATA / ฯลฯ)
    const preview = renderDescriptorToPreview(
      {
        version: 1,
        blocks: ctx.fields.map((f, i) => ({
          id: `f-${i}`,
          type: 'field' as const,
          fieldId: f.fieldId,
        })),
      },
      ctx
    );

    for (const tag of ['<input', '<textarea', '<select', '<option', 'type="radio"', 'type="checkbox"']) {
      assertFalse(
        preview.body.includes(tag),
        `preview must NOT contain ${tag}`
      );
    }
    sqlite.close();
  });

  await test('MASTER_DATA / TABLE field still renders real <table>', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db); // fm-edu = MASTER_DATA
    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;

    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [{ id: 't-1', type: 'table', fieldId: 'fm-edu' }] },
      ctx
    );
    assertTrue(preview.body.includes('<table'), 'table block must emit <table>');
    assertTrue(preview.body.includes('</table>'));
    assertTrue(preview.body.includes('<thead>'), 'table must have header row');
    sqlite.close();
  });

  // ── [3.2] Live Preview: document token in heading ────────────────
  // Requirement 5: รองรับ application number token
  await test('heading resolves {APPLICATION_NO} from real context', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    db.run(sql`INSERT INTO recruitment_rounds
      (id, template_version_id, title, position_level, open_date, close_date,
       application_pattern, round_code)
      VALUES ('round-1', 'tv-1', 'ทดสอบ', 'ปฏิบัติการ', 1794000000, 1800000000,
              '{YEAR}-{ROUND_CODE}-{RUNNING:4}', 'CHM01')`);
    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;

    const preview = renderDescriptorToPreview(
      {
        version: 1,
        blocks: [
          {
            id: 'h-1',
            type: 'heading',
            text: 'ใบสมัครเลขที่ {APPLICATION_NO}',
            size: 'medium',
          },
        ],
      },
      ctx
    );

    assertFalse(
      preview.body.includes('{APPLICATION_NO}'),
      'token must be resolved, not left as literal placeholder'
    );
    assertTrue(
      preview.body.includes('CHM01'),
      'resolved heading must contain real application number'
    );
    sqlite.close();
  });

  await test('unresolved token stays visible as placeholder (no silent blank)', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db); // ไม่มี round → ไม่มี position data
    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;

    const preview = renderDescriptorToPreview(
      {
        version: 1,
        blocks: [
          {
            id: 'h-1',
            type: 'heading',
            text: 'ตำแหน่ง {POSITION_NUMBER}',
            size: 'medium',
          },
        ],
      },
      ctx
    );

    // ระบบไม่มีเลขตำแหน่ง → ต้องเห็น placeholder ชัดเจน
    // (ไม่ใช่ช่องว่างเงียบ ๆ ที่ทำให้เข้าใจว่าเอกสารพัก)
    assertTrue(
      preview.body.includes('{POSITION_NUMBER}'),
      'unresolved token should stay visible as placeholder'
    );
    sqlite.close();
  });

  // Test: document info strip แสดง token ที่ resolve ได้จริง
  // (อัปเดตสำหรับ requirements ใหม่: info strip แสดงเฉพาะ INSERTABLE tokens —
  //  ไม่รวม POSITION_LEVEL / POSITION_NUMBER / ROUND_CODE ที่ระบบไม่มีข้อมูล/ไม่บังคับ)
  await test('document info strip shows resolved + unresolved tokens', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    db.run(sql`INSERT INTO recruitment_rounds
      (id, template_version_id, title, position_level, open_date, close_date,
       application_pattern, round_code)
      VALUES ('round-1', 'tv-1', 'ทดสอบ', 'ระดับปฏิบัติการ', 1794000000, 1800000000,
              '{YEAR}-{ROUND_CODE}-{RUNNING:4}', 'CHM01')`);
    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;

    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [{ id: 'h-1', type: 'heading', text: 'X', size: 'small' }] },
      ctx
    );

    assertTrue(
      preview.html.includes('dc-docinfo'),
      'document info strip must be present in full html'
    );
    // CHM01 มาจาก round_code ใน application number ที่สร้างจาก pattern
    assertTrue(
      preview.html.includes('CHM01'),
      'info strip should show resolved application number'
    );
    // info strip ตอนนี้แสดงเฉพาะ INSERTABLE tokens (Requirement A)
    // round.title ก็เป็น INSERTABLE (ROUND_NAME) และ resolve ได้
    assertTrue(
      preview.html.includes('ทดสอบ'),
      'info strip should show resolved round title (ROUND_NAME)'
    );
    sqlite.close();
  });

  await test('preview escapes HTML in token values (XSS safety)', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    db.run(sql`INSERT INTO recruitment_rounds
      (id, template_version_id, title, position_level, open_date, close_date)
      VALUES ('round-1', 'tv-1', '<script>alert(1)</script>', 'ปฏิบัติการ',
              1794000000, 1800000000)`);
    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;

    const preview = renderDescriptorToPreview(
      { version: 1, blocks: [{ id: 'h-1', type: 'heading', text: 'X', size: 'small' }] },
      ctx
    );
    assertFalse(
      preview.html.includes('<script>alert'),
      'raw <script> from round title must not appear unescaped'
    );
    sqlite.close();
  });

  // =====================================================================
  // [3.6] Live Preview UX — Mode switcher, Document Header, Diagnostics
  // Requirements:
  //   4  → mode toggle form/document
  //   5  → document header has logo+title+application no+position
  //   6  → unresolved token shows gray placeholder, no false data
  //   9  → same renderer/data source for fullscreen and compact preview
  // =====================================================================
  console.log('\n[3.6] Live Preview UX');

  await test('[UX] mode="document" renders field as label+value, not control', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db); // fm-name = TEXT
    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;

    const descriptor = {
      version: 1 as const,
      blocks: [{ id: 'f-1', type: 'field', fieldId: 'fm-name' } as const],
    };

    const preview = renderDescriptorToPreview(descriptor as any, ctx, {
      mode: 'document',
    });

    assertEqual(preview.mode, 'document');
    assertFalse(
      preview.body.includes('class="dc-control"'),
      'document mode must NOT emit .dc-control (no form control)'
    );
    assertTrue(
      preview.body.includes('dc-field__value'),
      'document mode must render value as label+value'
    );
    sqlite.close();
  });

  // 🔑 Preview เป็นเอกสารเสมอ → mode ที่ client ส่งมาไม่เปลี่ยนผลลัพธ์
  await test('[UX] mode ใดก็ตาม → render เป็น document (ไม่มี form control)', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;

    const descriptor = {
      version: 1 as const,
      blocks: [{ id: 'f-1', type: 'field', fieldId: 'fm-name' } as const],
    };

    const fromDocument = renderDescriptorToPreview(descriptor as any, ctx, {
      mode: 'document',
    });
    const fromLegacyForm = renderDescriptorToPreview(descriptor as any, ctx, {
      mode: 'form',
    });

    // ทั้งสองทางต้องได้เอกสารชุดเดียวกัน (legacy 'form' ถูก normalize แล้ว)
    assertEqual(fromLegacyForm.mode, 'document', 'mode ถูก normalize เป็น document');
    assertEqual(
      fromLegacyForm.body,
      fromDocument.body,
      'legacy mode="form" ต้องให้ผลลัพธ์เดียวกับ document'
    );
    assertFalse(
      fromLegacyForm.body.includes('class="dc-control"'),
      'ไม่มี mode ไหนที่ emit .dc-control'
    );
    sqlite.close();
  });

  await test('[UX] document header includes real logo + title + tokens', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    db.run(sql`INSERT INTO recruitment_rounds
      (id, template_version_id, title, position_level, open_date, close_date,
       application_pattern, round_code)
      VALUES ('round-1', 'tv-1', 'ทดสอบ', 'ระดับปฏิบัติการ',
              1794000000, 1800000000,
              '{YEAR}-{ROUND_CODE}-{RUNNING:4}', 'CHM01')`);
    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;

    const descriptor = {
      version: 1 as const,
      blocks: [{ id: 'h-1', type: 'heading', text: 'ใบสมัคร', size: 'large' } as const],
    };

    const preview = renderDescriptorToPreview(descriptor as any, ctx, {
      includeHeader: true,
    });

    // Header must exist as separate field
    assertTrue(preview.header.length > 0, 'header html must be present');

    // ── Logo ──────────────────────────────────────────────────────────────
    // ⚠️ เปลี่ยนจาก "placeholder" → "โลโก้จริง" (ตามแผน Logo rendering path)
    //
    // เดิม: organizations ไม่มี column logo → header แสดง "ยังไม่มีโลโก้"
    // แต่ PDF ใช้ SAO logo จริงจาก assets/sao-logo.data.ts อยู่แล้ว
    //   → HTML Preview ต้องตรงกับ PDF (single source of truth)
    //
    // โลโก้ถูกส่งผ่าน CSS var (--dc-logo-src) ครั้งเดียวต่อ response
    // ไม่ใช่ inline base64 ใน src="" (HTML attribute ไม่รองรับ var())
    assertTrue(
      preview.header.includes('dc-logo__image'),
      'header must render the real logo element'
    );
    assertTrue(
      !preview.header.includes('ยังไม่มีโลโก้'),
      'header must NOT show "ยังไม่มีโลโก้" placeholder now that a real logo exists'
    );
    assertTrue(
      preview.styles.includes('--dc-logo-src'),
      'styles must expose the inline logo CSS variable'
    );
    // payload ต้องถูกส่งครั้งเดียว ไม่ขึ้นกับจำนวน logo block
    assertEqual(
      (preview.styles.match(/data:image\/png;base64,/g) ?? []).length,
      1,
      'logo payload must be embedded exactly once per response'
    );
    // payload ไม่ควรถูก copy ลง body
    assertTrue(
      !preview.body.includes('base64,'),
      'body must reference the logo via CSS var, not inline base64'
    );

    // Title (ไม่มี token → ใช้ title text ดิบ)
    assertTrue(
      preview.header.includes('ใบสมัคร'),
      'header must show document title'
    );

    // Application No resolved
    assertTrue(
      preview.header.includes('CHM01'),
      'header must show resolved application no'
    );

    // Position name fallback is null → empty placeholder
    // (Req 6: ห้าม substitute ข้อมูลคนละควาหามาย)
    assertTrue(
      preview.header.includes('{POSITION_NAME}'),
      'POSITION_NAME unresolved must show placeholder, not position_level'
    );

    // Position number ถูกลบออกจาก document header (Requirement A — ไม่บังคับใช้ POSITION_NUMBER)
    // เพราะระบบไม่มีข้อมูลเลขตำแหน่งจริง
    // header แสดงเฉพาะ INSERTABLE tokens:
    //   APPLICATION_NO, ROUND_NAME, APPLICATION_DATE, PRINT_DATE, POSITION_NAME

    // Empty values มี class .dc-header-meta__value--empty
    assertTrue(
      preview.header.includes('dc-header-meta__value--empty'),
      'unresolved tokens must be marked with empty class for gray styling'
    );

    sqlite.close();
  });

  // Test: POSITION_NAME must NOT fallback to positionLevel (Req 6)
  // Descriptor ใช้ POSITION_NAME ผ่าน SystemDataBlock → diagnostics แสดง POSITION_NAME
  // แต่ไม่บังคับให้ POSITION_LEVEL อยู่ใน diagnostics ถ้า descriptor ไม่ได้ใช้
  await test('[UX] POSITION_NAME must NOT fallback to positionLevel — descriptor uses POSITION_NAME (Req 6)', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    db.run(sql`INSERT INTO recruitment_rounds
      (id, template_version_id, title, position_level, open_date, close_date,
       application_pattern, round_code)
      VALUES ('round-1', 'tv-1', 'ทดสอบ', 'ระดับปฏิบัติการ',
              1794000000, 1800000000,
              '{YEAR}-{ROUND_CODE}-{RUNNING:4}', 'CHM01')`);
    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;

    // ── Descriptor ใช้ POSITION_NAME ผ่าน SystemDataBlock ──
    const descriptor = {
      version: 1 as const,
      blocks: [
        { id: 'sd-pn', type: 'systemData' as const, key: 'POSITION_NAME' as const },
        { id: 'h-1', type: 'heading' as const, text: 'X', size: 'large' as const },
      ],
    };

    const preview = renderDescriptorToPreview(descriptor as any, ctx);

    // ── POSITION_NAME ต้องอยู่ใน diagnostics (descriptor ใช้) ──
    const positionNameRow = preview.tokens.find(
      (t) => t.token === 'POSITION_NAME'
    );
    assertTrue(positionNameRow !== undefined, 'POSITION_NAME must exist in diagnostics');
    if (positionNameRow) {
      assertEqual(
        positionNameRow.empty,
        true,
        'POSITION_NAME must be empty (no source data in system)'
      );
      assertTrue(
        positionNameRow.text === '{POSITION_NAME}',
        'POSITION_NAME text must show placeholder, not actual position data'
      );
    }

    // ── POSITION_LEVEL ไม่ต้องอยู่ใน diagnostics (descriptor ไม่ได้ใช้) ──
    const positionLevelRow = preview.tokens.find(
      (t) => t.token === 'POSITION_LEVEL'
    );
    assertTrue(
      positionLevelRow === undefined,
      'POSITION_LEVEL must NOT be in diagnostics (descriptor does not use it)'
    );

    sqlite.close();
  });

  // Test: diagnostics tokens panel — shows ONLY tokens actually used in descriptor
  // (อัปเดตสำหรับ Requirement E ใหม่:
  //  diagnostics ส่งกลับเฉพาะ token ที่ descriptor ใช้จริง
  //  Token ที่ไม่ได้ใช้ → ไม่ปรากฏใน diagnostics และไม่ถูกนับว่าขาด)
  await test('[UX] diagnostics=tokens exposed for FE panels — only used tokens (Req E)', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    db.run(sql`INSERT INTO recruitment_rounds
      (id, template_version_id, title, position_level, open_date, close_date,
       application_pattern, round_code)
      VALUES ('round-1', 'tv-1', 'ทดสอบ', 'ระดับปฏิบัติการ',
              1794000000, 1800000000,
              '{YEAR}-{ROUND_CODE}-{RUNNING:4}', 'CHM01')`);
    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;

    // ── Descriptor ใช้จริง: APPLICATION_NO (SystemDataBlock) + ROUND_NAME (Heading) ──
    const descriptor = {
      version: 1 as const,
      blocks: [
        { id: 'sd-1', type: 'systemData' as const, key: 'APPLICATION_NO' as const },
        { id: 'h-1', type: 'heading' as const, text: 'รอบ {ROUND_NAME}', size: 'medium' as const },
      ],
    };

    const preview = renderDescriptorToPreview(descriptor as any, ctx);
    assertTrue(Array.isArray(preview.tokens));

    // ── Token ที่ descriptor ใช้จริง: เฉพาะ APPLICATION_NO + ROUND_NAME ──
    assertTrue(preview.tokens.length >= 2, 'must include used tokens');
    assertTrue(
      preview.tokens.some((t) => t.token === 'APPLICATION_NO'),
      'APPLICATION_NO must be present (SystemDataBlock)'
    );
    assertTrue(
      preview.tokens.some((t) => t.token === 'ROUND_NAME'),
      'ROUND_NAME must be present (heading text)'
    );

    // ── Token ที่ descriptor ไม่ได้ใช้: ห้ามอยู่ใน diagnostics ──
    const tokenNames = preview.tokens.map((t) => t.token);
    assertFalse(
      tokenNames.includes('POSITION_NAME'),
      'POSITION_NAME must NOT be in diagnostics (not used in this descriptor)'
    );
    assertFalse(
      tokenNames.includes('POSITION_NUMBER'),
      'POSITION_NUMBER must NOT be in diagnostics (not used in this descriptor)'
    );
    assertFalse(
      tokenNames.includes('POSITION_LEVEL'),
      'POSITION_LEVEL must NOT be in diagnostics (not used in this descriptor)'
    );
    assertFalse(
      tokenNames.includes('APPLICATION_DATE'),
      'APPLICATION_DATE must NOT be in diagnostics (not used in this descriptor)'
    );
    assertFalse(
      tokenNames.includes('PRINT_DATE'),
      'PRINT_DATE must NOT be in diagnostics (not used in this descriptor)'
    );
    sqlite.close();
  });

  // ── Regression test: descriptor ใช้เฉพาะ APPLICATION_NO → diagnostics มีแค่ APPLICATION_NO ──
  await test('[UX] diagnostics=APPLICATION_NO only when descriptor uses only APPLICATION_NO (Req E regression)', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    db.run(sql`INSERT INTO recruitment_rounds
      (id, template_version_id, title, position_level, open_date, close_date,
       application_pattern, round_code)
      VALUES ('round-1', 'tv-1', 'ทดสอบ', 'ระดับปฏิบัติการ',
              1794000000, 1800000000,
              '{YEAR}-{ROUND_CODE}-{RUNNING:4}', 'CHM01')`);
    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;

    // Descriptor ใช้แค่ APPLICATION_NO ผ่าน SystemDataBlock
    const descriptor = {
      version: 1 as const,
      blocks: [
        { id: 'sd-1', type: 'systemData' as const, key: 'APPLICATION_NO' as const },
      ],
    };

    const preview = renderDescriptorToPreview(descriptor as any, ctx);

    // ต้องมีเฉพาะ APPLICATION_NO
    assertEqual(preview.tokens.length, 1, 'must have exactly 1 token');
    assertEqual(preview.tokens[0].token, 'APPLICATION_NO');

    // ROUND_CODE, POSITION_NAME, POSITION_LEVEL ต้องไม่ปรากฏ
    const names = preview.tokens.map((t) => t.token);
    assertFalse(names.includes('ROUND_CODE'), 'ROUND_CODE must not appear');
    assertFalse(names.includes('POSITION_NAME'), 'POSITION_NAME must not appear');
    assertFalse(names.includes('POSITION_LEVEL'), 'POSITION_LEVEL must not appear');
    assertFalse(names.includes('PRINT_DATE'), 'PRINT_DATE must not appear');

    sqlite.close();
  });

  await test('[UX] includeHeader=false → header html is empty (thumbnail mode)', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    db.run(sql`INSERT INTO recruitment_rounds
      (id, template_version_id, title, position_level, open_date, close_date,
       application_pattern, round_code)
      VALUES ('round-1', 'tv-1', 'ทดสอบ', 'ระดับปฏิบัติการ',
              1794000000, 1800000000,
              '{YEAR}-{ROUND_CODE}-{RUNNING:4}', 'CHM01')`);
    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;

    const descriptor = {
      version: 1 as const,
      blocks: [{ id: 'h-1', type: 'heading', text: 'X', size: 'large' } as const],
    };

    const preview = renderDescriptorToPreview(descriptor as any, ctx, {
      includeHeader: false,
    });
    assertEqual(preview.header, '', 'header must be empty when disabled');
    sqlite.close();
  });

  await test('[UX] same data source for fullscreen and compact (Req 9)', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);
    db.run(sql`INSERT INTO recruitment_rounds
      (id, template_version_id, title, position_level, open_date, close_date,
       application_pattern, round_code)
      VALUES ('round-1', 'tv-1', 'ทดสอบ', 'ระดับปฏิบัติการ',
              1794000000, 1800000000,
              '{YEAR}-{ROUND_CODE}-{RUNNING:4}', 'CHM01')`);
    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;

    const descriptor = {
      version: 1 as const,
      blocks: [{ id: 'h-1', type: 'heading', text: 'X', size: 'large' } as const],
    };

    // Fullscreen: includeHeader=true, mode='document'
    const fullscreen = renderDescriptorToPreview(descriptor as any, ctx, {
      includeHeader: true,
      mode: 'document',
    });
    // Thumbnail: includeHeader=false, mode='form'
    const thumbnail = renderDescriptorToPreview(descriptor as any, ctx, {
      includeHeader: false,
      mode: 'form',
    });

    // Same token resolution result (single source of truth)
    assertEqual(fullscreen.tokens.length, thumbnail.tokens.length);
    for (let i = 0; i < fullscreen.tokens.length; i++) {
      const a = fullscreen.tokens[i];
      const b = thumbnail.tokens[i];
      assertEqual(a.token, b.token, 'token id match');
      assertEqual(a.text, b.text, 'token text match');
      assertEqual(a.empty, b.empty, 'token empty match');
    }
    // Same body for fields (token logic shared)
    assertEqual(fullscreen.body.length > 0, true);
    sqlite.close();
  });

  // =====================================================================
  // [4] Zod Request Schema Validation
  // =====================================================================
  console.log('\n[4] Zod Request Schema Validation');

  await test('SaveDescriptorRequestSchema accepts valid payload', () => {
    const result = SaveDescriptorRequestSchema.safeParse({
      descriptor: SAMPLE_DESCRIPTOR,
    });
    assertTrue(result.success);
  });

  await test('SaveDescriptorRequestSchema accepts with expectedSchemaVersion', () => {
    const result = SaveDescriptorRequestSchema.safeParse({
      descriptor: SAMPLE_DESCRIPTOR,
      expectedSchemaVersion: 1,
    });
    assertTrue(result.success);
  });

  await test('SaveDescriptorRequestSchema rejects missing descriptor', () => {
    const result = SaveDescriptorRequestSchema.safeParse({});
    assertFalse(result.success);
  });

  await test('SaveDescriptorRequestSchema rejects empty blocks', () => {
    const result = SaveDescriptorRequestSchema.safeParse({
      descriptor: { version: 1, blocks: [] },
    });
    assertFalse(result.success);
  });

  await test('SaveDescriptorRequestSchema rejects wrong version', () => {
    const result = SaveDescriptorRequestSchema.safeParse({
      descriptor: { version: 2, blocks: SAMPLE_DESCRIPTOR.blocks },
    });
    assertFalse(result.success);
  });

  await test('PreviewDescriptorRequestSchema accepts valid payload', () => {
    const result = PreviewDescriptorRequestSchema.safeParse({
      descriptor: SAMPLE_DESCRIPTOR,
    });
    assertTrue(result.success);
  });

  await test('PreviewDescriptorRequestSchema rejects empty blocks', () => {
    const result = PreviewDescriptorRequestSchema.safeParse({
      descriptor: { version: 1, blocks: [] },
    });
    assertFalse(result.success);
  });

  await test('GenerateDescriptorRequestSchema accepts empty payload', () => {
    const result = GenerateDescriptorRequestSchema.safeParse({});
    assertTrue(result.success);
  });

  await test('GenerateDescriptorRequestSchema accepts tableFieldIds', () => {
    const result = GenerateDescriptorRequestSchema.safeParse({
      tableFieldIds: ['tf-1', 'tf-2'],
    });
    assertTrue(result.success);
  });

  await test('GenerateDescriptorRequestSchema accepts undefined', () => {
    const result = GenerateDescriptorRequestSchema.safeParse(undefined);
    assertTrue(result.success);
  });

  await test('GenerateDescriptorRequestSchema rejects empty string in tableFieldIds', () => {
    const result = GenerateDescriptorRequestSchema.safeParse({
      tableFieldIds: [''],
    });
    assertFalse(result.success);
  });

  // =====================================================================
  // [5] End-to-End: generate → preview → save → load
  // =====================================================================
  console.log('\n[5] End-to-End Pipeline');

  await test('full workflow: generate → preview → save → load', async () => {
    const { sqlite, db } = makeInMemorySchema();
    setTemplateDb(db);
    setPreviewDb(db);
    seedBasicData(db);

    // 1. Build preview context
    const ctx = await buildPreviewContext(db as any, 'tv-1');
    assertTrue(ctx !== null);
    if (!ctx) return;

    // 2. Generate descriptor
    const genResult = generateDescriptorFromTemplate({
      sections: ctx.sections.map((s) => ({
        id: s.id,
        name: s.name,
        displayOrder: s.displayOrder,
        isActive: true,
      })),
      fields: ctx.fields.map((f) => ({
        id: f.id,
        fieldId: f.fieldId,
        sectionId: f.sectionId,
        displayOrder: f.displayOrder,
        type: f.type as any,
        overrideLabelTh: null,
        labelTh: f.label,
      })),
    });
    assertTrue(genResult.ok);
    if (!genResult.ok) return;

    // 3. Render preview
    const preview = renderDescriptorToPreview(genResult.descriptor, ctx);
    assertTrue(preview.html.length > 0);

    // 4. Save
    const saveResult = await saveTemplateDescriptor(db as any, 'tv-1', genResult.descriptor, {
      adminUserId: 'admin-1',
    });
    assertTrue(saveResult.ok);

    // 5. Load
    const loadResult = await loadTemplateDescriptor(db as any, 'tv-1');
    assertTrue(loadResult.ok);
    if (!loadResult.ok) return;
    assertEqual(loadResult.meta.source, 'db');
    assertEqual(loadResult.descriptor.blocks.length, genResult.descriptor.blocks.length);
    sqlite.close();
  });
}

runAllTests()
  .then(() => {
    console.log('\n=== Summary ===\n');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    if (failures.length > 0) {
      console.log('\nFailures:');
      failures.forEach((f) => console.log(`  - ${f}`));
    }
    if (failed > 0) {
      (globalThis as any).process.exit(1);
    }
  })
  .catch((e) => {
    console.error('Test runner failed:', e);
    (globalThis as any).process.exit(1);
  });
