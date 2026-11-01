// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Audit Service Tests (Audit Log Foundation — Phase 1)
 * =======================================================================
 * จุดเขียน audit กลาง (audit.service.ts):
 *
 *   A.  normalizeAuditPayload — object ผ่านตรง / JSON string parse กลับ /
 *       string แปลงไม่ได้ → { raw } / null → null
 *   B.  writeAudit — เขียนสำเร็จ, payload เก็บ single-encode (parse 1 ชั้น
 *       ได้ object), fail-soft เมื่อ DB โยน error, ip ตาม input,
 *       batch_id ใส่เมื่อส่งมา / ไม่ใส่คอลัมน์เมื่อไม่ส่ง (DDL เก่าไม่พัง)
 *   C.  SYSTEM_ADMIN_ID — ค่าคงที่ตรงกับ Migration 032
 *
 * Run: node --import tsx src/services/__tests__/audit.service.test.ts
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { normalizeAuditPayload, writeAudit, SYSTEM_ADMIN_ID } from '../audit.service';

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

function assertEqual(actual: any, expected: any, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: any, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

// ── Harness ──────────────────────────────────────────────────────────────
// DDL ตาม migration จริง (รวม batch_id จาก Migration 032)
function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE admin_users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'ADMIN', is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL,
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, payload TEXT,
      ip_address TEXT, batch_id TEXT, created_at INTEGER
    );
  `);
  const db = drizzle(sqlite);
  return { sqlite, db };
}

async function runAllTests() {
  console.log('\n=== Audit Service (Phase 1) — normalize + writeAudit ===\n');

  // ── A. normalizeAuditPayload ──
  await test('A1: object → ผ่านตรง (reference เดิม)', () => {
    const obj = { a: 1 };
    assertTrue(normalizeAuditPayload(obj) === obj, 'ต้องได้ object เดิม');
  });

  await test('A2: JSON string (โค้ดแบบเก่า) → parse กลับเป็น object', () => {
    const out = normalizeAuditPayload(JSON.stringify({ a: 1 }));
    assertEqual(out.a, 1, 'parse 1 ชั้นได้ object');
  });

  await test('A3: string ที่ไม่ใช่ JSON → { raw } ไม่พัง', () => {
    const out = normalizeAuditPayload('ข้อความธรรมดา');
    assertEqual(out.raw, 'ข้อความธรรมดา', 'เนื้อหาคงเดิมใน raw');
  });

  await test('A4: null / undefined → null', () => {
    assertTrue(normalizeAuditPayload(null) === null, 'null');
    assertTrue(normalizeAuditPayload(undefined) === null, 'undefined');
  });

  await test('A5: primitive อื่น → ห่อเป็น { raw }', () => {
    assertEqual(normalizeAuditPayload(42).raw, '42', 'number');
    assertEqual(normalizeAuditPayload(true).raw, 'true', 'boolean');
  });

  // ── B. writeAudit ──
  await test('B1: เขียนสำเร็จ → true + payload single-encode (parse 1 ชั้นได้ object)', async () => {
    const { sqlite, db } = createTestDb();
    const ok = await writeAudit({
      db,
      action: 'UPDATE',
      entityType: 'APPLICATION',
      entityId: 'app-1',
      actorId: 'admin-1',
      payload: { previousStatus: 'SUBMITTED', newStatus: 'QUALIFIED' },
      ipAddress: '10.0.0.1',
    });
    assertEqual(ok, true, 'คืน true');
    const row = sqlite.prepare('SELECT * FROM audit_logs').get();
    assertEqual(row.action, 'UPDATE', 'action');
    assertEqual(row.admin_id, 'admin-1', 'admin_id');
    // หัวใจของการแก้ double-encode: คอลัมน์ดิบ parse ครั้งเดียวได้ object
    const payload = JSON.parse(row.payload);
    assertTrue(payload && typeof payload === 'object', 'payload เป็น object เมื่อ parse 1 ชั้น');
    assertEqual(payload.newStatus, 'QUALIFIED', 'payload.newStatus');
    assertEqual(row.ip_address, '10.0.0.1', 'ip');
    assertEqual(row.batch_id, null, 'ไม่ส่ง batchId → NULL');
  });

  await test('B2: payload เป็น JSON string ก็ยังได้ single-encode', async () => {
    const { sqlite, db } = createTestDb();
    await writeAudit({
      db, action: 'CREATE', entityType: 'T', entityId: 'e1', actorId: 'admin-1',
      payload: JSON.stringify({ k: 'v' }),
    });
    const row = sqlite.prepare('SELECT payload FROM audit_logs').get();
    const payload = JSON.parse(row.payload);
    assertTrue(typeof payload === 'object' && payload.k === 'v', 'parse 1 ชั้นได้ object');
  });

  await test('B3: fail-soft — DB โยน error → คืน false ไม่ throw', async () => {
    const boom: any = {
      insert: () => { throw new Error('FK constraint failed'); },
    };
    const ok = await writeAudit({
      db: boom, action: 'UPDATE', entityType: 'T', entityId: 'e1',
      actorId: 'admin-1', payload: { a: 1 },
    });
    assertEqual(ok, false, 'คืน false (ไม่ block request จริง)');
  });

  await test('B4: batchId → เขียนลงคอลัมน์ batch_id', async () => {
    const { sqlite, db } = createTestDb();
    await writeAudit({
      db, action: 'UPDATE', entityType: 'APPLICATION', entityId: 'BULK/NEW',
      actorId: 'admin-1', payload: { batchId: 'batch-xyz' }, batchId: 'batch-xyz',
    });
    const row = sqlite.prepare('SELECT batch_id, payload FROM audit_logs').get();
    assertEqual(row.batch_id, 'batch-xyz', 'คอลัมน์ batch_id');
    assertEqual(JSON.parse(row.payload).batchId, 'batch-xyz', 'payload.batchId ประกอบการอ่าน');
  });

  await test('B5: payload null → คอลัมน์ payload NULL (เช่น middleware ที่ไม่มี custom payload)', async () => {
    const { sqlite, db } = createTestDb();
    const ok = await writeAudit({
      db, action: 'DELETE', entityType: 'T', entityId: 'e1', actorId: 'admin-1',
      payload: null,
    });
    assertEqual(ok, true, 'เขียนสำเร็จ');
    const row = sqlite.prepare('SELECT payload FROM audit_logs').get();
    assertEqual(row.payload, null, 'payload เป็น NULL ไม่ใช่ string ว่าง');
  });

  await test('B6: ipAddress undefined → unknown / null → NULL (คงพฤติกรรมเดิมทั้งสองแบบ)', async () => {
    const { sqlite, db } = createTestDb();
    await writeAudit({ db, action: 'UPDATE', entityType: 'T', entityId: 'e1', actorId: 'admin-1' });
    await writeAudit({ db, action: 'UPDATE', entityType: 'T', entityId: 'e2', actorId: 'admin-1', ipAddress: null });
    // ต้อง query ตาม entity_id — audit row id เป็น uuid สุ่ม ใช้ ORDER BY id ไม่ได้
    const row1 = sqlite.prepare("SELECT ip_address FROM audit_logs WHERE entity_id = 'e1'").get();
    const row2 = sqlite.prepare("SELECT ip_address FROM audit_logs WHERE entity_id = 'e2'").get();
    assertEqual(row1.ip_address, 'unknown', 'ไม่ส่ง → unknown');
    assertEqual(row2.ip_address, null, 'ส่ง null → NULL (เช่น ROUND_CLONED เดิม)');
  });

  // ── C. SYSTEM actor ──
  await test('C1: SYSTEM_ADMIN_ID ตรงกับ Migration 032', () => {
    assertEqual(SYSTEM_ADMIN_ID, '00000000-0000-0000-0000-000000000000', 'reserved uuid');
  });

  console.log(`\nผลรวม: ผ่าน ${passed} ไม่ผ่าน ${failed}`);
  if (failed > 0) {
    console.log('รายการที่ล้มเหลว:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

void runAllTests();
