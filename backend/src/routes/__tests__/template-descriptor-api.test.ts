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
      descriptor_updated_by TEXT
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
    // MASTER_DATA field gets table sample
    const eduData = (ctx.application.formData as any)['fm-edu'];
    assertTrue(Array.isArray(eduData), 'MASTER_DATA field should be array');
    sqlite.close();
  });

  // =====================================================================
  // [3] Generator + Preview Renderer Pipeline
  // =====================================================================
  console.log('\n[3] Generator + Preview Renderer');

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
    });
    assertTrue(result.ok);
    if (!result.ok) return;
    // 1 logo + 2 headings + 1 field + 1 table = 5
    assertEqual(result.descriptor.blocks.length, 5);
    assertEqual(result.meta.logoBlockId, result.descriptor.blocks[0].id);
    assertEqual(result.meta.headingCount, 2);
    assertEqual(result.meta.fieldBlockCount, 1);
    assertEqual(result.meta.tableBlockCount, 1);
    assertEqual(result.meta.totalBlocks, 5);
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
