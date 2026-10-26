// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Audit Display Resolver Tests (Migration 029 / UX human-readable)
 * =======================================================================
 *
 * resolver กลาง (audit-display.service.ts) แปลง entityId (UUID) ใน audit_logs
 * เป็นชื่อที่คนอ่านได้ ณ ตอนอ่าน — ไม่แก้ historical data
 *
 *   A.  APPLICATION            → "APP-YYYY-NNNN" + ชื่อผู้สมัคร
 *   B.  EXPORT_EXCEL (APPLICATION + roundId) → resolve เป็นรอบรับสมัคร
 *   C.  TEMPLATE_VERSION(+)    → ชื่อ template + vN (join templates)
 *   D.  RECRUITMENT_ROUND / ROUND_CLONED → ชื่อรอบ + ระดับตำแหน่ง
 *   E.  master data ทั้งชุด (FIELD_MASTER/ORG/JOB/LEVEL/POSITION/ADMIN_USER)
 *   F.  resolve ไม่ได้ → ไม่อยู่ใน map (fallback UUID ฝั่ง UI)
 *   G.  BULK/NEW + entityType ไม่รู้จัก → ข้าม ไม่ throw
 *   H.  array ว่าง → map ว่าง
 *   I.  >90 ids → แบ่ง chunk ครบทุก id (D1 bind limit)
 *
 * Run: node --import tsx src/services/__tests__/audit-display.service.test.ts
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';
import { resolveAuditEntityDisplays } from '../audit-display.service';

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });

  // DDL เฉพาะคอลัมน์ที่ resolver select — test ไม่ต้องมี schema เต็ม
  sqlite.exec(`
    CREATE TABLE applications (
      id TEXT PRIMARY KEY,
      application_no TEXT UNIQUE,
      fullname TEXT NOT NULL
    );
    CREATE TABLE recruitment_rounds (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      position_level TEXT NOT NULL
    );
    CREATE TABLE templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE template_versions (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL REFERENCES templates(id),
      version_number INTEGER NOT NULL
    );
    CREATE TABLE field_master (
      id TEXT PRIMARY KEY,
      label_th TEXT NOT NULL
    );
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE job_families (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE position_levels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE positions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL
    );
    CREATE TABLE admin_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL
    );
  `);

  return { sqlite, db };
}

const insert = (sqlite, sql, params) => sqlite.prepare(sql).run(...params);

let passed = 0;
let failed = 0;
const failures: string[] = [];
const tests: Array<[string, () => Promise<void> | void]> = [];

function test(name, fn) {
  tests.push([name, fn]);
}

async function runAll() {
  for (const [name, fn] of tests) {
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
}

function assertTrue(condition, msg) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}\n  expected: ${expected}\n  actual:   ${actual}`);
  }
}

// fixture กลาง — ตารางเดียวใช้ร่วมทุกเคส
const { sqlite, db } = createTestDb();
insert(sqlite, 'INSERT INTO applications (id, application_no, fullname) VALUES (?, ?, ?)', [
  'app-uuid-1', 'APP-2026-5012', 'นายสมชาย ใจดี',
]);
insert(sqlite, 'INSERT INTO recruitment_rounds (id, title, position_level) VALUES (?, ?, ?)', [
  'round-uuid-1', 'เชี่ยวชาญ 2569', 'เชี่ยวชาญ',
]);
insert(sqlite, 'INSERT INTO templates (id, name) VALUES (?, ?)', [
  'tpl-uuid-1', 'แบบฟอร์มสมัครงาน',
]);
insert(sqlite, 'INSERT INTO template_versions (id, template_id, version_number) VALUES (?, ?, ?)', [
  'ver-uuid-1', 'tpl-uuid-1', 5,
]);
insert(sqlite, 'INSERT INTO field_master (id, label_th) VALUES (?, ?)', [
  'field-uuid-1', 'ชื่อ-นามสกุล',
]);
insert(sqlite, 'INSERT INTO organizations (id, name) VALUES (?, ?)', ['org-uuid-1', 'สำนักตรวจสอบภายใน']);
insert(sqlite, 'INSERT INTO job_families (id, name) VALUES (?, ?)', ['job-uuid-1', 'งานตรวจสอบ']);
insert(sqlite, 'INSERT INTO position_levels (id, name) VALUES (?, ?)', ['lvl-uuid-1', 'เชี่ยวชาญ']);
insert(sqlite, 'INSERT INTO positions (id, title) VALUES (?, ?)', ['pos-uuid-1', 'นักตรวจสอบภายใน']);
insert(sqlite, 'INSERT INTO admin_users (id, email) VALUES (?, ?)', ['admin-uuid-1', 'admin@example.com']);

// =========================================================
//  A. APPLICATION
// =========================================================

test('A: APPLICATION → applicationNo + ชื่อผู้สมัคร', async () => {
  const map = await resolveAuditEntityDisplays(db, [
    { id: 'log-1', action: 'PDF_DOWNLOAD', entityType: 'APPLICATION', entityId: 'app-uuid-1' },
  ]);
  assertEqual(map['log-1']?.name, 'APP-2026-5012', 'name ต้องเป็น applicationNo');
  assertEqual(map['log-1']?.secondary, 'นายสมชาย ใจดี', 'secondary ต้องเป็นชื่อผู้สมัคร');
});

// =========================================================
//  B. EXPORT_EXCEL — entityType APPLICATION แต่ entityId = roundId
// =========================================================

test('B: EXPORT_EXCEL → resolve เป็นรอบรับสมัคร (title + positionLevel)', async () => {
  const map = await resolveAuditEntityDisplays(db, [
    { id: 'log-2', action: 'EXPORT_EXCEL', entityType: 'APPLICATION', entityId: 'round-uuid-1' },
  ]);
  assertEqual(map['log-2']?.name, 'เชี่ยวชาญ 2569', 'name ต้องเป็นชื่อรอบ');
  assertEqual(map['log-2']?.secondary, 'เชี่ยวชาญ', 'secondary ต้องเป็นระดับตำแหน่ง');
});

// =========================================================
//  C. TEMPLATE_VERSION / TEMPLATE_VERSION_DESCRIPTOR (join templates)
// =========================================================

test('C: TEMPLATE_VERSION_DESCRIPTOR → ชื่อ template + vN', async () => {
  const map = await resolveAuditEntityDisplays(db, [
    { id: 'log-3', action: 'UPDATE', entityType: 'TEMPLATE_VERSION_DESCRIPTOR', entityId: 'ver-uuid-1' },
    { id: 'log-4', action: 'UPDATE', entityType: 'TEMPLATE_VERSION', entityId: 'ver-uuid-1' },
  ]);
  assertEqual(map['log-3']?.name, 'แบบฟอร์มสมัครงาน', 'name ต้องเป็นชื่อ template');
  assertEqual(map['log-3']?.secondary, 'v5', 'secondary ต้องเป็น vN');
  assertEqual(map['log-4']?.name, 'แบบฟอร์มสมัครงาน', 'TEMPLATE_VERSION ต้อง resolve เหมือนกัน');
});

// =========================================================
//  D. ROUND
// =========================================================

test('D: RECRUITMENT_ROUND และ ROUND_CLONED → ชื่อรอบ', async () => {
  const map = await resolveAuditEntityDisplays(db, [
    { id: 'log-5', action: 'UPDATE', entityType: 'RECRUITMENT_ROUND', entityId: 'round-uuid-1' },
    { id: 'log-6', action: 'CREATE', entityType: 'ROUND_CLONED', entityId: 'round-uuid-1' },
  ]);
  assertEqual(map['log-5']?.name, 'เชี่ยวชาญ 2569', 'RECRUITMENT_ROUND ต้องได้ชื่อรอบ');
  assertEqual(map['log-6']?.name, 'เชี่ยวชาญ 2569', 'ROUND_CLONED (entityId = รอบใหม่) ต้องได้ชื่อรอบ');
});

// =========================================================
//  E. master data
// =========================================================

test('E: FIELD_MASTER / ORGANIZATION / JOB_FAMILY / POSITION_LEVEL / POSITION / ADMIN_USER', async () => {
  const map = await resolveAuditEntityDisplays(db, [
    { id: 'l1', action: 'UPDATE', entityType: 'FIELD_MASTER', entityId: 'field-uuid-1' },
    { id: 'l2', action: 'CREATE', entityType: 'ORGANIZATION', entityId: 'org-uuid-1' },
    { id: 'l3', action: 'UPDATE', entityType: 'JOB_FAMILY', entityId: 'job-uuid-1' },
    { id: 'l4', action: 'CREATE', entityType: 'POSITION_LEVEL', entityId: 'lvl-uuid-1' },
    { id: 'l5', action: 'UPDATE', entityType: 'POSITION', entityId: 'pos-uuid-1' },
    { id: 'l6', action: 'UPDATE', entityType: 'ADMIN_USER', entityId: 'admin-uuid-1' },
  ]);
  assertEqual(map['l1']?.name, 'ชื่อ-นามสกุล', 'FIELD_MASTER ต้องได้ labelTh');
  assertEqual(map['l2']?.name, 'สำนักตรวจสอบภายใน', 'ORGANIZATION ต้องได้ name');
  assertEqual(map['l3']?.name, 'งานตรวจสอบ', 'JOB_FAMILY ต้องได้ name');
  assertEqual(map['l4']?.name, 'เชี่ยวชาญ', 'POSITION_LEVEL ต้องได้ name');
  assertEqual(map['l5']?.name, 'นักตรวจสอบภายใน', 'POSITION ต้องได้ title');
  assertEqual(map['l6']?.name, 'admin@example.com', 'ADMIN_USER ต้องได้ email');
});

// =========================================================
//  F. resolve ไม่ได้
// =========================================================

test('F: id ไม่มีในตาราง (ถูกลบ/legacy) → ไม่อยู่ใน map (fallback UUID ฝั่ง UI)', async () => {
  const map = await resolveAuditEntityDisplays(db, [
    { id: 'log-miss', action: 'UPDATE', entityType: 'APPLICATION', entityId: 'gone-uuid' },
  ]);
  assertTrue(!('log-miss' in map), 'resolve ไม่ได้ต้องไม่มี key');
});

// =========================================================
//  G. ข้ามอย่างปลอดภัย
// =========================================================

test('G: BULK/NEW และ entityType ไม่รู้จัก → ข้าม ไม่ throw', async () => {
  const map = await resolveAuditEntityDisplays(db, [
    { id: 'log-bulk', action: 'CREATE', entityType: 'TEMPLATE_SECTION', entityId: 'BULK/NEW' },
    { id: 'log-unknown', action: 'CREATE', entityType: 'SOMETHING_NEW', entityId: 'xyz' },
  ]);
  assertTrue(!('log-bulk' in map), 'BULK/NEW ต้องถูกข้าม');
  assertTrue(!('log-unknown' in map), 'entityType ไม่รู้จักต้องถูกข้าม');
});

// =========================================================
//  H. array ว่าง
// =========================================================

test('H: logs ว่าง → map ว่าง', async () => {
  const map = await resolveAuditEntityDisplays(db, []);
  assertEqual(Object.keys(map).length, 0, 'ต้องได้ map ว่าง');
});

// =========================================================
//  I. chunking > 90 ids
// =========================================================

test('I: 100 application ids → แบ่ง chunk (≤90) แล้ว resolve ครบทุก id', async () => {
  const { sqlite: s2, db: db2 } = createTestDb();
  const logs = [];
  for (let i = 1; i <= 100; i++) {
    const id = `app-${String(i).padStart(3, '0')}`;
    insert(s2, 'INSERT INTO applications (id, application_no, fullname) VALUES (?, ?, ?)', [
      id, `APP-2026-${String(i).padStart(4, '0')}`, `ผู้สมัคร ${i}`,
    ]);
    logs.push({ id: `log-${id}`, action: 'UPDATE', entityType: 'APPLICATION', entityId: id });
  }
  const map = await resolveAuditEntityDisplays(db2, logs);
  assertEqual(Object.keys(map).length, 100, 'ทุก id ต้องถูก resolve (ข้าม chunk boundary)');
  assertEqual(map['log-app-100']?.name, 'APP-2026-0100', 'ตัวท้ายสุด (chunk 2) ต้องถูก resolve');
});

// =========================================================
runAll().then(() => {
  console.log('\n========================================');
  if (failed > 0) {
    console.log(`FAIL: ${failed} failed, ${passed} passed`);
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log(`PASS: all ${passed} tests passed`);
  }
});
