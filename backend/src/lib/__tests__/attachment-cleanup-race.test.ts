/**
 * Regression: Attachment GC race with submit promote
 * ===========================================================================
 *
 * ก่อนแก้: cron เลือกแถว TEMP เกิน 7 วันแล้ว "ลบ R2 ก่อน mark" — ถ้าผู้สมัคร
 * submit promote แถว TEMP → ACTIVE ระหว่างช่วง SELECT กับ R2.delete
 * ไฟล์แนบของใบสมัครที่เพิ่ง submit ถูกลบจาก R2 ถาวร (mark guard กันแค่
 * การ overwrite สถานะ แต่ object หายแล้ว)
 *
 * หลังแก้: claim (mark DELETED ด้วย WHERE status='TEMP') ก่อน — กระทบ
 * 0 แถว = ถูก promote แล้ว ข้ามโดยไม่แตะ R2 / ถ้า R2.delete ล้มหลัง claim
 * revert กลับ TEMP ให้รอบถัดไป retry
 *
 * Run: node --import tsx src/lib/__tests__/attachment-cleanup-race.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { cleanupExpiredTempAttachments } from '../attachment-cleanup';

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
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function rowStatus(sqlite, id: string) {
  return sqlite.prepare('SELECT status FROM attachment_uploads WHERE id = ?').get(id)?.status;
}

const CUTOFF_ISO = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 วันก่อน = เกิน cutoff

async function runAllTests() {
  console.log('\n=== Attachment GC — race with submit promote ===\n');

  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE attachment_uploads (
      id TEXT PRIMARY KEY, r2_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'TEMP',
      uploaded_at INTEGER, application_id TEXT, original_filename TEXT,
      delete_token_hash TEXT, activated_at INTEGER, deleted_at INTEGER
    );
  `);
  const db = drizzle(sqlite);

  const insertTemp = (id: string, key: string) =>
    sqlite.prepare('INSERT INTO attachment_uploads (id, r2_key, status, uploaded_at) VALUES (?, ?, ?, ?)')
      .run(id, key, 'TEMP', Math.floor(CUTOFF_ISO.getTime() / 1000));

  function createR2() {
    const objects = new Set<string>();
    return {
      objects,
      bucket: {
        async put(key: string) { objects.add(key); },
        async delete(key: string) { objects.delete(key); },
      },
    };
  }

  await test('G1. ปกติ: TEMP เกิน cutoff → ลบ R2 + mark DELETED', async () => {
    insertTemp('g1', 'r2/g1.pdf');
    const { bucket, objects } = createR2();
    objects.add('r2/g1.pdf');
    const result = await cleanupExpiredTempAttachments(db as any, bucket as any);
    assertEqual(result.deleted, 1);
    assertEqual(result.errors, 0);
    assertEqual(objects.has('r2/g1.pdf'), false, 'R2 object must be removed');
    assertEqual(rowStatus(sqlite, 'g1'), 'DELETED');
  });

  await test('G2. TEMP ยังไม่เกิน cutoff → ไม่แตะ', async () => {
    sqlite.prepare('INSERT INTO attachment_uploads (id, r2_key, status, uploaded_at) VALUES (?, ?, ?, ?)')
      .run('g2', 'r2/g2.pdf', 'TEMP', Math.floor(Date.now() / 1000));
    const { bucket, objects } = createR2();
    objects.add('r2/g2.pdf');
    const result = await cleanupExpiredTempAttachments(db as any, bucket as any);
    assertEqual(result.deleted, 0);
    assertEqual(objects.has('r2/g2.pdf'), true);
    assertEqual(rowStatus(sqlite, 'g2'), 'TEMP');
  });

  await test('G3. RACE: promote ระหว่าง SELECT กับ claim → R2 object ต้องรอด + แถวยัง ACTIVE', async () => {
    insertTemp('g3', 'r2/g3.pdf');
    const { bucket, objects } = createR2();
    objects.add('r2/g3.pdf');

    let raced = false;
    // จำลอง submit promote แถว ณ ช่วงที่ cron กำลังสร้าง claim UPDATE
    // (ระหว่าง SELECT แถว TEMP กับ claim) — claim ต้องกระทบ 0 แถว
    const raceDb = new Proxy(db, {
      get(target, prop) {
        if (prop === 'update' && !raced) {
          raced = true;
          sqlite.prepare("UPDATE attachment_uploads SET status = 'ACTIVE', application_id = 'app-g3', activated_at = strftime('%s','now') WHERE status = 'TEMP'").run();
        }
        return target[prop];
      },
    });
    const result = await cleanupExpiredTempAttachments(raceDb as any, bucket as any);
    assertEqual(result.deleted, 0, 'claim ต้องกระทบ 0 แถว (ถูก promote แล้ว)');
    assertEqual(objects.has('r2/g3.pdf'), true, 'R2 object ต้องรอด — เป็นไฟล์ของใบสมัครที่ submit แล้ว');
    assertEqual(rowStatus(sqlite, 'g3'), 'ACTIVE', 'ledger ต้องยัง ACTIVE');
    assertEqual(result.errors, 0);
  });

  await test('G4. R2.delete ล้มหลัง claim → revert กลับ TEMP เพื่อ retry รอบหน้า', async () => {
    insertTemp('g4', 'r2/g4.pdf');
    const failingBucket = {
      async delete() { throw new Error('r2 unavailable'); },
    };
    const result = await cleanupExpiredTempAttachments(db as any, failingBucket as any);
    assertEqual(result.errors, 1);
    assertEqual(result.deleted, 0);
    assertEqual(rowStatus(sqlite, 'g4'), 'TEMP', 'ต้อง revert กลับ TEMP — รอบถัดไปต้อง retry ได้');
    // รอบถัดไป R2 หาย → สำเร็จ
    const { bucket, objects } = createR2();
    objects.add('r2/g4.pdf');
    const retry = await cleanupExpiredTempAttachments(db as any, bucket as any);
    assertEqual(retry.deleted, 1);
    assertEqual(rowStatus(sqlite, 'g4'), 'DELETED');
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
