/**
 * Seed Users Script
 * -----------------
 * Generates bcrypt-hashed passwords for demo users and outputs SQL.
 * 
 * Usage:
 *   cd backend
 *   npx tsx scripts/seed-users.ts
 * 
 * This will output SQL statements that you can copy into seed.sql
 * or run directly against your D1 database.
 */

import { hashSync } from 'bcryptjs';

const BCRYPT_ROUNDS = 10;

const DEMO_USERS = [
  {
    id: 'seed-admin-001',
    email: 'admin@recruitment.go.th',
    password: 'Admin@123!',
    role: 'SUPER_ADMIN',
    mustChangePassword: true,
  },
  {
    id: 'seed-admin-002',
    email: 'hr@recruitment.go.th',
    password: 'Hr@123!',
    role: 'ADMIN',
    mustChangePassword: true,
  },
  {
    id: 'seed-admin-003',
    email: 'reviewer@recruitment.go.th',
    password: 'Review@123!',
    role: 'REVIEWER',
    mustChangePassword: true,
  },
  {
    id: 'seed-admin-004',
    email: 'viewer@recruitment.go.th',
    password: 'View@123!',
    role: 'VIEWER',
    mustChangePassword: true,
  },
];

console.log('-- ============================================');
console.log('-- Generated SQL - Run against D1 database');
console.log('-- ============================================');
console.log('');

for (const user of DEMO_USERS) {
  const hashedPassword = hashSync(user.password, BCRYPT_ROUNDS);
  
  console.log(`-- ${user.email} (${user.role}) - password: ${user.password}`);
  console.log(`INSERT OR REPLACE INTO admin_users ` +
    `(id, email, password_hash, role, password_migrated, must_change_password, is_active) VALUES ` +
    `('${user.id}', '${user.email}', '${hashedPassword}', '${user.role}', 1, ${user.mustChangePassword ? 1 : 0}, 1);`);
  console.log('');
}

console.log('-- ============================================');
console.log('-- Verification: Test login with these credentials');
console.log('-- ============================================');
for (const user of DEMO_USERS) {
  console.log(`-- Email: ${user.email} | Password: ${user.password} | Role: ${user.role}`);
}
