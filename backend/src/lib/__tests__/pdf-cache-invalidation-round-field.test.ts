/**
 * Regression: PDF cache invalidation จาก round title / field master edits
 * ===========================================================================
 *
 * ก่อนแก้: จุด invalidate เดียวในระบบคือ descriptor PUT แต่ PDF render
 * อ่าน recruitment_rounds.title ({ROUND_NAME}) และ join field_master
 * (label/options/pdfMappingKey) สด ๆ ทุกครั้ง — แก้ชื่อรอบหรือ field
 * แล้ว cache เดิมใน R2 (ไม่มี TTL) เสิร์ฟ PDF เนื้อหาเก่าตลอดไป
 *
 * หลังแก้: PATCH /rounds/:id (title เปลี่ยน) เรียก invalidatePdfCacheForRound
 * และ PATCH /fields/:id เรียก invalidatePdfCacheForFieldMaster
 * (test นี้ล็อกพฤติกรรมของ 2 function ใหม่ + ขอบเขตการลบ)
 *
 * Run: node --import tsx src/lib/__tests__/pdf-cache-invalidation-round-field.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { invalidatePdfCacheForRound, invalidatePdfCacheForFieldMaster } from '../pdf-cache-invalidation';
import { PDF_CACHE_VERSION } from '../pdf-types';

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  ✗ ${name}: ${e?.message ?? e}`);
  }
}

function assertEqual(actual: any, expected: any, msg = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function createMockR2() {
  const deleted: string[] = [];
  return {
    bucket: {
      async delete(keys: string | string[]) {
        for (const k of Array.isArray(keys) ? keys : [keys]) deleted.push(k);
      },
    },
    deleted,
  };
}

const KEY = (appId: string) => `pdf/applications/${appId}/${PDF_CACHE_VERSION}.pdf`;

async function runAllTests() {
  console.log('\n=== PDF Cache Invalidation — round / field-master scope ===\n');

  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE applications (id TEXT PRIMARY KEY, round_id TEXT);
    CREATE TABLE recruitment_rounds (id TEXT PRIMARY KEY, template_version_id TEXT);
    CREATE TABLE template_versions (id TEXT PRIMARY KEY);
    CREATE TABLE template_fields (id TEXT PRIMARY KEY, template_version_id TEXT NOT NULL, field_id TEXT NOT NULL, display_order INTEGER NOT NULL DEFAULT 0);
    INSERT INTO applications VALUES ('A1', 'R1'), ('A2', 'R1'), ('A3', 'R2'), ('A4', 'R3');
    INSERT INTO recruitment_rounds VALUES ('R1', 'TV1'), ('R2', 'TV2'), ('R3', 'TV3');
    INSERT INTO template_versions VALUES ('TV1'), ('TV2'), ('TV3');
    INSERT INTO template_fields VALUES ('TF1', 'TV1', 'F1', 0), ('TF2', 'TV1', 'F2', 1), ('TF3', 'TV2', 'F1', 0);
  `);
  const db = drizzle(sqlite);

  await test('C1. invalidatePdfCacheForRound(R1) ลบเฉพาะใบสมัครใน R1', async () => {
    const { bucket, deleted } = createMockR2();
    const result = await invalidatePdfCacheForRound(db as any, bucket as any, 'R1');
    assertEqual(result.failed, false);
    assertEqual(result.invalidated, 2, 'A1 + A2');
    assertEqual(deleted.sort(), [KEY('A1'), KEY('A2')].sort());
  });

  await test('C2. invalidatePdfCacheForFieldMaster(F1) ลบทุกใบสมัครที่ TV ผูก F1 (ข้าม version)', async () => {
    const { bucket, deleted } = createMockR2();
    const result = await invalidatePdfCacheForFieldMaster(db as any, bucket as any, 'F1');
    assertEqual(result.failed, false);
    assertEqual(result.invalidated, 3, 'A1, A2 (TV1) + A3 (TV2) — ไม่รวม A4 (TV3 ไม่ใช้ F1)');
    assertEqual(deleted.sort(), [KEY('A1'), KEY('A2'), KEY('A3')].sort());
  });

  await test('C3. invalidatePdfCacheForFieldMaster(F2) ลบเฉพาะ TV1', async () => {
    const { bucket, deleted } = createMockR2();
    const result = await invalidatePdfCacheForFieldMaster(db as any, bucket as any, 'F2');
    assertEqual(result.invalidated, 2);
    assertEqual(deleted.sort(), [KEY('A1'), KEY('A2')].sort());
  });

  await test('C4. field ที่ไม่มีใครใช้ → invalidated 0, failed false', async () => {
    const { bucket, deleted } = createMockR2();
    const result = await invalidatePdfCacheForFieldMaster(db as any, bucket as any, 'F-none');
    assertEqual(result.invalidated, 0);
    assertEqual(result.failed, false);
    assertEqual(deleted, []);
  });

  await test('C5. round ไม่มีใบสมัคร → invalidated 0', async () => {
    const { bucket, deleted } = createMockR2();
    const result = await invalidatePdfCacheForRound(db as any, bucket as any, 'R-none');
    assertEqual(result.invalidated, 0);
    assertEqual(result.failed, false);
    assertEqual(deleted, []);
  });

  await test('C6. R2 undefined → no-op ไม่ throw', async () => {
    const r1 = await invalidatePdfCacheForRound(db as any, undefined, 'R1');
    const r2 = await invalidatePdfCacheForFieldMaster(db as any, undefined, 'F1');
    assertEqual(r1.invalidated, 0);
    assertEqual(r1.failed, false);
    assertEqual(r2.invalidated, 0);
    assertEqual(r2.failed, false);
  });

  await test('C7. R2 delete ล้ม → failed=true ไม่ throw (best-effort)', async () => {
    const badBucket = { async delete() { throw new Error('r2 down'); } };
    const result = await invalidatePdfCacheForRound(db as any, badBucket as any, 'R1');
    assertEqual(result.failed, true);
    assertEqual(result.invalidated, 0);
  });

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    failures.forEach((f) => console.error(`  FAIL: ${f}`));
    process.exit(1);
  }
}

runAllTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
