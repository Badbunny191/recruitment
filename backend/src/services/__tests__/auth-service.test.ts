// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Auth Service Tests — bcrypt-only regression
 * =======================================================================
 *
 * ครอบพฤติกรรมหลังลบ legacy plaintext password path (2026-10-28)
 *
 *   A. hashPassword / verifyPassword ทำงานถูกต้องกับ bcrypt
 *   B. isBcryptHash แยก bcrypt ออกจาก plaintext ได้
 *   C. ถอยหลังไม่ได้: module ต้องไม่ export verifyPasswordForLogin / migratePassword
 *   D. ไม่มี plaintext comparison เหลือใน source
 *
 * Run: node --import tsx src/services/__tests__/auth-service.test.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import * as authService from '../auth.service';
import { hashPassword, verifyPassword, isBcryptHash, generateSecurePassword } from '../auth.service';

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

function assertTrue(condition: any, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

const SERVICE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'auth.service.ts'
);

async function runAll() {
  console.log('========================================');
  console.log('Auth Service — bcrypt-only regression');
  console.log('========================================\n');

  // ── A. hash / verify ────────────────────────────────────────────────
  console.log('A. hashPassword / verifyPassword');

  await test('A1: hashPassword สร้าง bcrypt hash ที่ verify ผ่าน', async () => {
    const hash = await hashPassword('correct-horse-battery');
    assertTrue(isBcryptHash(hash), 'hash ที่ได้ต้องเป็น bcrypt format');
    assertEqual(await verifyPassword('correct-horse-battery', hash), true, 'รหัสถูกต้องต้องผ่าน');
  });

  await test('A2: verifyPassword ปฏิเสธรหัสผิด', async () => {
    const hash = await hashPassword('correct-horse-battery');
    assertEqual(await verifyPassword('wrong-password', hash), false, 'รหัสผิดต้องไม่ผ่าน');
  });

  await test('A3: hashPassword ให้ hash ต่างกันทุกครั้ง (salt) แต่ verify ผ่านทั้งคู่', async () => {
    const h1 = await hashPassword('same-password');
    const h2 = await hashPassword('same-password');
    assertTrue(h1 !== h2, 'salt ต้องทำให้ hash ต่างกัน');
    assertEqual(await verifyPassword('same-password', h1), true, 'h1 ต้อง verify ผ่าน');
    assertEqual(await verifyPassword('same-password', h2), true, 'h2 ต้อง verify ผ่าน');
  });

  // ── B. isBcryptHash ─────────────────────────────────────────────────
  console.log('\nB. isBcryptHash');

  await test('B1: ปฏิเสธ plaintext "admin123"', async () => {
    assertEqual(isBcryptHash('admin123'), false, 'plaintext ต้องไม่ถูกมองเป็น bcrypt');
  });

  await test('B2: ปฏิเสธค่าว่างและรูปแบบผิด', async () => {
    assertEqual(isBcryptHash(''), false, 'empty');
    assertEqual(isBcryptHash('$invalid'), false, '$invalid');
    assertEqual(isBcryptHash('$2b$10$tooshort'), false, 'สั้นเกินไป');
    assertEqual(isBcryptHash('$2b$10$' + 'a'.repeat(52)), false, 'ยาว 52 ต้องไม่ผ่าน (ต้อง 53)');
  });

  await test('B3: ยอมรับ hash จริงจาก hashPassword()', async () => {
    const hash = await hashPassword('anything');
    assertEqual(isBcryptHash(hash), true, 'hash จริงต้องผ่าน');
  });

  // ── C. ถอยหลังไม่ได้ (regression guard) ─────────────────────────────
  console.log('\nC. Regression guard — dead code ต้องไม่กลับมา');

  await test('C1: module ไม่ export verifyPasswordForLogin', async () => {
    assertEqual(
      typeof (authService as any).verifyPasswordForLogin,
      'undefined',
      'verifyPasswordForLogin ต้องถูกลบออกจาก module'
    );
  });

  await test('C2: module ไม่ export migratePassword', async () => {
    assertEqual(
      typeof (authService as any).migratePassword,
      'undefined',
      'migratePassword ต้องถูกลบออกจาก module'
    );
  });

  await test('C3: export ที่เหลือมีแค่ 4 ตัวที่ตั้งใจ', async () => {
    const exported = Object.keys(authService).sort();
    const expected = ['generateSecurePassword', 'hashPassword', 'isBcryptHash', 'verifyPassword'];
    assertEqual(
      JSON.stringify(exported),
      JSON.stringify(expected),
      `export ต้องเหลือ ${expected.join(', ')}`
    );
  });

  // ── D. source ไม่มี plaintext comparison ────────────────────────────
  console.log('\nD. Source inspection');

  await test('D1: ไม่มี plaintext comparison ใน auth.service.ts', async () => {
    const src = readFileSync(SERVICE_PATH, 'utf8');
    assertTrue(
      !/password\s*===\s*passwordHash/.test(src),
      'ต้องไม่มี "password === passwordHash" เหลืออยู่'
    );
    assertTrue(
      !/passwordHash\s*===\s*password/.test(src),
      'ต้องไม่มี "passwordHash === password" เหลืออยู่'
    );
  });

  await test('D2: ไม่มีคำว่า needsMigration / Legacy mode ใน auth.service.ts', async () => {
    const src = readFileSync(SERVICE_PATH, 'utf8');
    assertTrue(!/needsMigration/.test(src), 'ต้องไม่มี needsMigration');
    assertTrue(!/Legacy mode/i.test(src), 'ต้องไม่มี "Legacy mode"');
  });

  await test('D3: ไม่มี import genSalt ที่ไม่ถูกใช้', async () => {
    const src = readFileSync(SERVICE_PATH, 'utf8');
    assertTrue(!/genSalt/.test(src), 'ต้องไม่มี genSalt');
  });

  // ── E. generateSecurePassword ยังทำงาน ──────────────────────────────
  console.log('\nE. generateSecurePassword (ต้องไม่ถูกกระทบ)');

  await test('E1: สร้างรหัสตามความยาวที่ขอ และมีอักขระครบ 4 ชนิด', async () => {
    const pw = generateSecurePassword(16);
    assertEqual(pw.length, 16, 'ความยาวต้องเป็น 16');
    assertTrue(/[A-Z]/.test(pw), 'ต้องมีตัวพิมพ์ใหญ่');
    assertTrue(/[a-z]/.test(pw), 'ต้องมีตัวพิมพ์เล็ก');
    assertTrue(/[0-9]/.test(pw), 'ต้องมีตัวเลข');
    assertTrue(/[!@#$%^&*()_+\-=]/.test(pw), 'ต้องมีอักขระพิเศษ');
  });

  await test('E2: สร้างสองครั้งได้ค่าไม่ซ้ำ', async () => {
    const a = generateSecurePassword(16);
    const b = generateSecurePassword(16);
    assertTrue(a !== b, 'ต้องไม่ซ้ำกัน');
  });

  // ── สรุป ────────────────────────────────────────────────────────────
  console.log('\n========================================');
  if (failed > 0) {
    console.log(`FAIL: ${failed} failed, ${passed} passed`);
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log(`PASS: all ${passed} tests passed`);
  }
}

runAll();
