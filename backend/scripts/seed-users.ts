/**
 * Seed Users Script
 * -----------------
 * สร้าง admin user พร้อม bcrypt hash + รหัสผ่านสุ่ม
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/seed-users.ts                 # สร้าง 1 SUPER_ADMIN
 *   npx tsx scripts/seed-users.ts --role ADMIN    # ระบุ role
 *   npx tsx scripts/seed-users.ts --email x@y.z   # ระบุ email
 *   npx tsx scripts/seed-users.ts --sql-only      # พิมพ์เฉพาะ SQL (ไม่แสดงรหัส)
 *
 * หลักการ:
 *   - รหัสผ่าน "ไม่" hardcode ในไฟล์ — สุ่มใหม่ทุกครั้งที่รัน
 *   - รหัสแสดงบน stdout ครั้งเดียว ไม่ถูกเขียนลงไฟล์
 *   - must_change_password = 1 → บังคับเปลี่ยนตอน login ครั้งแรก
 *   - role ต้องอยู่ใน USER_ROLES เท่านั้น (SUPER_ADMIN | ADMIN | VIEWER)
 *
 * หลังรัน: คัดลอก SQL ไป execute กับ D1 แล้วเก็บรหัสผ่านไว้ใน password manager
 * ห้าม commit ผลลัพธ์ของ script นี้
 */

import { hashSync } from 'bcryptjs';
import { randomInt } from 'node:crypto';

const BCRYPT_ROUNDS = 10;

/** ต้องตรงกับ USER_ROLES ใน src/types.ts */
const VALID_ROLES = ['SUPER_ADMIN', 'ADMIN', 'VIEWER'] as const;
type Role = (typeof VALID_ROLES)[number];

const DEFAULT_EMAIL = 'admin@recruitment.go.th';
const DEFAULT_ROLE: Role = 'SUPER_ADMIN';
const PASSWORD_LENGTH = 20;

// ── อ่าน args ──────────────────────────────────────────────────────────
function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const email = argValue('--email') ?? DEFAULT_EMAIL;
const roleArg = (argValue('--role') ?? DEFAULT_ROLE).toUpperCase();
const sqlOnly = process.argv.includes('--sql-only');

if (!VALID_ROLES.includes(roleArg as Role)) {
  console.error(`❌ role ไม่ถูกต้อง: ${roleArg}`);
  console.error(`   ต้องเป็นหนึ่งใน: ${VALID_ROLES.join(', ')}`);
  process.exit(1);
}
const role = roleArg as Role;

// ── สร้างรหัสผ่านสุ่มด้วย CSPRNG ───────────────────────────────────────
// ต้องผ่าน validatePassword() ใน src/utils/password.ts:
//   ≥8 ตัว, มี A-Z, a-z, 0-9, อักขระพิเศษ
function generatePassword(length: number = PASSWORD_LENGTH): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // ตัด I, O ที่อ่านสับสน
  const lower = 'abcdefghijkmnopqrstuvwxyz'; // ตัด l
  const digits = '23456789'; // ตัด 0, 1
  const special = '!@#$%^&*()_+-=';
  const all = upper + lower + digits + special;

  const pick = (chars: string): string => chars[randomInt(chars.length)];

  // บังคับอย่างละ 1 ตัวตามนโยบาย
  const required = [pick(upper), pick(lower), pick(digits), pick(special)];
  const rest: string[] = [];
  for (let i = required.length; i < length; i++) rest.push(pick(all));

  // Fisher-Yates ด้วย CSPRNG
  const chars = [...required, ...rest];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// ── main ───────────────────────────────────────────────────────────────
const password = generatePassword();
const passwordHash = hashSync(password, BCRYPT_ROUNDS);
const userId = `seed-admin-${Date.now().toString(36)}`;

if (!sqlOnly) {
  console.log('-- ============================================');
  console.log('-- Admin user — รหัสผ่านแสดงครั้งเดียวเท่านั้น');
  console.log('-- ============================================');
  console.log(`-- Email:    ${email}`);
  console.log(`-- Role:     ${role}`);
  console.log(`-- Password: ${password}`);
  console.log('--');
  console.log('-- ⚠️  เก็บรหัสนี้ใน password manager ทันที');
  console.log('-- ⚠️  ระบบจะบังคับเปลี่ยนรหัสตอน login ครั้งแรก');
  console.log('-- ============================================');
  console.log('');
}

console.log('-- SQL สำหรับ execute กับ D1:');
console.log(
  `INSERT INTO admin_users ` +
    `(id, email, password_hash, role, password_migrated, must_change_password, is_active, failed_login_attempts) VALUES ` +
    `('${userId}', '${email}', '${passwordHash}', '${role}', 1, 1, 1, 0);`
);
console.log('');
console.log('-- รันด้วย:');
console.log(`--   wrangler d1 execute sao-db --remote --command="<SQL ด้านบน>"`);
