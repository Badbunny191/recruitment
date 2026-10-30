// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
/**
 * Audit Log Display Resolver Tests (UX human-readable)
 * =======================================================================
 *
 * หน้า Audit Logs ต้องอ่านรู้เรื่อง "ใคร ทำอะไร กับใคร" โดยไม่ต้องจำ UUID
 * resolver กลาง 2 ชั้น:
 *   - backend: resolveAuditEntityDisplays (ดู audit-display.service.test.ts)
 *   - client:  lib/audit-log-display.ts (ไฟล์นี้) — รับ display จาก backend
 *     → fallback client lookup → fallback UUID ย่อ
 *
 *   A.   AUDIT_ACTION_CONFIG ครบทุก action จริงในระบบ (label ไทย)
 *   B.   action ไม่รู้จัก → fallback raw string สีเทา
 *   C.   shortId ย่อ UUID แบบเดิม
 *   D–F. resolveAuditEntity: display จาก backend ชนะ → client lookup
 *        fallback → null เมื่อ resolve ไม่ได้ทั้งคู่
 *   G–J. buildAuditDescription: PDF_DOWNLOAD / EXPORT_EXCEL /
 *        TEMPLATE_VERSION_DESCRIPTOR / CREATE-UPDATE-DELETE
 *   K.   APPLICATION status change (payload.status) คงพฤติกรรมเดิม
 *   L.   fallback UUID เมื่อ resolve ไม่ได้ (ทุก action)
 *   N.   CREATE_USER — อ่าน targetEmail/role จาก payload
 *   O.   ROUND_CLONED — label ไทยครบทุกผิว (ตาราง/description/fallback)
 *   P.   LOGIN/LOGIN_FAILED/ACCOUNT_LOCKED + CHANGE_PASSWORD/RESET_PASSWORD
 *        (badge ไทย + description ไทย) + legacy entity_type USER
 *   M.   source contract ของ audit-logs page — ใช้ lib กลาง ห้ามประกาศ
 *        ACTION_CONFIG/ENTITY_LABEL ซ้ำในหน้า
 *
 * Run: node --import tsx src/lib/__tests__/audit-log-display.test.ts
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  AUDIT_ACTION_CONFIG,
  getAuditActionConfig,
  getAuditEntityLabel,
  shortId,
  resolveAuditEntity,
  buildAuditDescription,
} from '../audit-log-display';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pagePath = join(
  __dirname, '..', '..', 'app', '(admin)', 'admin', 'audit-logs', 'page.tsx'
);
const pageSource = readFileSync(pagePath, 'utf8');

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  ✗ ${name}: ${e?.message ?? e}`);
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

// =========================================================
//  A–C. action config / entity label / shortId
// =========================================================

test('A: ACTION_CONFIG ครบทุก action ที่ระบบบันทึกจริง พร้อม label ไทย', () => {
  // CREATE/UPDATE/DELETE มาจาก auditMiddleware, PDF_DOWNLOAD/EXPORT_EXCEL
  // บันทึกแบบ manual — ไม่มี action อื่นในระบบ (publish/archive = UPDATE)
  // CREATE_USER (P0 fix): POST /admin/users — action เฉพาะ
  for (const action of ['CREATE', 'CREATE_USER', 'UPDATE', 'DELETE', 'PDF_DOWNLOAD', 'EXPORT_EXCEL']) {
    assertTrue(AUDIT_ACTION_CONFIG[action], `ต้องมี config ของ ${action}`);
    assertTrue(AUDIT_ACTION_CONFIG[action].label !== action, `${action} ต้องมี label ที่คนอ่าน`);
  }
  assertEqual(AUDIT_ACTION_CONFIG.PDF_DOWNLOAD.label, 'ดาวน์โหลด PDF', 'label PDF_DOWNLOAD');
  assertEqual(AUDIT_ACTION_CONFIG.EXPORT_EXCEL.label, 'ส่งออก Excel', 'label EXPORT_EXCEL');
  assertEqual(AUDIT_ACTION_CONFIG.CREATE_USER.label, 'สร้างผู้ใช้', 'label CREATE_USER');
});

test('B: action ไม่รู้จัก → fallback raw string (badge สีเทา)', () => {
  const cfg = getAuditActionConfig('SOMETHING_NEW');
  assertEqual(cfg.label, 'SOMETHING_NEW', 'ต้องแสดง raw action');
  assertTrue(cfg.className.includes('slate'), 'fallback ต้องเป็นสีเทา');
});

test('C: shortId ย่อ UUID แบบเดิม', () => {
  assertEqual(shortId('65ef12ab34cd56ef'), '65ef…56ef', 'รูปแบบ 4 หน้า 4 หลัง');
  assertEqual(shortId('abc'), 'abc', 'ค่าสั้นคืนเดิม');
  assertEqual(shortId(''), '-', 'ค่าว่าง → dash');
});

// =========================================================
//  D–F. resolveAuditEntity
// =========================================================

test('D: display จาก backend มาก่อน (APPLICATION → appNo + ชื่อผู้สมัคร)', () => {
  const resolved = resolveAuditEntity(
    {
      action: 'PDF_DOWNLOAD',
      entityType: 'APPLICATION',
      entityId: 'app-uuid',
      display: { name: 'APP-2026-5012', secondary: 'นายสมชาย ใจดี' },
    },
    () => 'client-name',
  );
  assertEqual(resolved.primary, 'APP-2026-5012', 'ต้องใช้ display จาก backend');
  assertEqual(resolved.secondary, 'นายสมชาย ใจดี', 'ต้องได้ secondary');
});

test('E: ไม่มี display → fallback client lookup', () => {
  const resolved = resolveAuditEntity(
    { action: 'UPDATE', entityType: 'RECRUITMENT_ROUND', entityId: 'round-uuid' },
    (entityType, entityId) => (entityId === 'round-uuid' ? 'เชี่ยวชาญ 2569 (เชี่ยวชาญ)' : null),
  );
  assertEqual(resolved?.primary, 'เชี่ยวชาญ 2569 (เชี่ยวชาญ)', 'ต้อง fallback client lookup');
});

test('F: resolve ไม่ได้ทั้งคู่ → null (ผู้เรียก fallback shortId เอง)', () => {
  const resolved = resolveAuditEntity(
    { action: 'DELETE', entityType: 'APPLICATION', entityId: 'gone' },
    () => null,
  );
  assertEqual(resolved, null, 'ต้องเป็น null');
});

// =========================================================
//  G–J. buildAuditDescription
// =========================================================

test('G: PDF_DOWNLOAD → "ดาวน์โหลด PDF APP-2026-5012 (นายสมชาย ใจดี)"', () => {
  const log = {
    action: 'PDF_DOWNLOAD',
    entityType: 'APPLICATION',
    entityId: 'app-uuid',
    display: { name: 'APP-2026-5012', secondary: 'นายสมชาย ใจดี' },
  };
  assertEqual(
    buildAuditDescription(log, resolveAuditEntity(log, () => null), null),
    'ดาวน์โหลด PDF APP-2026-5012 (นายสมชาย ใจดี)',
    'ครบ ใคร-ทำอะไร-กับใคร',
  );
});

test('H: EXPORT_EXCEL → "ส่งออก Excel เชี่ยวชาญ 2569 (เชี่ยวชาญ)"', () => {
  const log = {
    action: 'EXPORT_EXCEL',
    entityType: 'APPLICATION',
    entityId: 'round-uuid',
    display: { name: 'เชี่ยวชาญ 2569', secondary: 'เชี่ยวชาญ' },
  };
  assertEqual(
    buildAuditDescription(log, resolveAuditEntity(log, () => null), null),
    'ส่งออก Excel เชี่ยวชาญ 2569 (เชี่ยวชาญ)',
    'ต้องโชว์ชื่อรอบ ไม่ใช่ UUID ของ round',
  );
});

test('I: TEMPLATE_VERSION_DESCRIPTOR → "บันทึกตัวประกอบเอกสาร แบบฟอร์มสมัครงาน v5"', () => {
  const log = {
    action: 'UPDATE',
    entityType: 'TEMPLATE_VERSION_DESCRIPTOR',
    entityId: 'ver-uuid',
    display: { name: 'แบบฟอร์มสมัครงาน', secondary: 'v5' },
  };
  assertEqual(
    buildAuditDescription(log, resolveAuditEntity(log, () => null), null),
    'บันทึกตัวประกอบเอกสาร แบบฟอร์มสมัครงาน v5',
    'ต้องโชว์ template + เลข version',
  );
});

test('J: CREATE/UPDATE/DELETE คงรูปแบบเดิมด้วยชื่อใหม่', () => {
  const mk = (action, entityType) => ({
    action,
    entityType,
    entityId: 'e1',
    display: { name: 'ชื่อจริง', secondary: null },
  });
  assertEqual(
    buildAuditDescription(mk('CREATE', 'RECRUITMENT_ROUND'), { primary: 'ชื่อจริง' }, null),
    'สร้างรอบรับสมัคร ชื่อจริง',
    'CREATE',
  );
  assertEqual(
    buildAuditDescription(mk('UPDATE', 'TEMPLATE'), { primary: 'ชื่อจริง' }, null),
    'แก้ไขTemplate ชื่อจริง',
    'UPDATE',
  );
  assertEqual(
    buildAuditDescription(mk('DELETE', 'POSITION'), { primary: 'ชื่อจริง' }, null),
    'ลบตำแหน่ง ชื่อจริง',
    'DELETE',
  );
});

// =========================================================
//  K–L. พฤติกรรมเดิมที่ต้องคงไว้
// =========================================================

test('K: APPLICATION status change (payload.status) คงพฤติกรรมเดิม', () => {
  const log = {
    action: 'UPDATE',
    entityType: 'APPLICATION',
    entityId: 'app-uuid',
    display: { name: 'APP-2026-5012', secondary: 'นายสมชาย ใจดี' },
  };
  assertEqual(
    buildAuditDescription(log, { primary: 'APP-2026-5012' }, { status: 'QUALIFIED' }),
    'เปลี่ยนสถานะใบสมัคร → QUALIFIED',
    'เคสไม่มี reason',
  );
  assertEqual(
    buildAuditDescription(log, { primary: 'APP-2026-5012' }, { status: 'REJECTED', statusReason: 'ไม่ผ่านคุณสมบัติ' }),
    'เปลี่ยนสถานะใบสมัคร → REJECTED (ไม่ผ่านคุณสมบัติ)',
    'เคสมี reason',
  );
});

test('L: resolve ไม่ได้ → fallback UUID ย่อใน description ทุก action', () => {
  assertEqual(
    buildAuditDescription(
      { action: 'PDF_DOWNLOAD', entityType: 'APPLICATION', entityId: '65ef12ab34cd56ef' },
      null,
      null,
    ),
    'ดาวน์โหลด PDF 65ef…56ef',
    'PDF_DOWNLOAD fallback UUID',
  );
  assertEqual(
    buildAuditDescription(
      { action: 'EXPORT_EXCEL', entityType: 'APPLICATION', entityId: '5a7c12ab34cd47eb' },
      null,
      null,
    ),
    'ส่งออก Excel 5a7c…47eb',
    'EXPORT_EXCEL fallback UUID',
  );
});

// =========================================================
//  N. CREATE_USER — ต้องอ่านออกว่าสร้างผู้ใช้คนไหน (P0 fix)
// =========================================================

test('N: CREATE_USER → "สร้างผู้ใช้ <email> (<role>)" จาก payload', () => {
  // entityId = 'BULK/NEW' (route ไม่มี :id) → resolve ไม่ได้
  // → ต้องดึง targetEmail + role จาก payload
  const log = {
    action: 'CREATE_USER',
    entityType: 'ADMIN_USER',
    entityId: 'BULK/NEW',
  };
  assertEqual(
    buildAuditDescription(log, null, { targetEmail: 'newuser@test.local', role: 'ADMIN' }),
    'สร้างผู้ใช้ newuser@test.local (ADMIN)',
    'ต้องโชว์อีเมล + role ของผู้ใช้ที่ถูกสร้าง',
  );
});

test('N2: CREATE_USER ไม่มี payload → fallback ไม่ crash', () => {
  const log = {
    action: 'CREATE_USER',
    entityType: 'ADMIN_USER',
    entityId: 'BULK/NEW',
  };
  const desc = buildAuditDescription(log, null, null);
  assertTrue(desc.includes('สร้างผู้ใช้'), 'ต้องยังบอกว่าเป็นการสร้างผู้ใช้');
});

test('N3: CREATE_USER ที่มี role แต่ไม่มี email → ไม่ crash', () => {
  const log = {
    action: 'CREATE_USER',
    entityType: 'ADMIN_USER',
    entityId: 'BULK/NEW',
  };
  const desc = buildAuditDescription(log, null, { role: 'VIEWER' });
  assertTrue(desc.includes('สร้างผู้ใช้'), 'ต้องยังบอกว่าเป็นการสร้างผู้ใช้');
});

// =========================================================
//  O. ROUND_CLONED — label ไทยครบทุกผิว (ตาราง/description/fallback)
// =========================================================

test('O: label ของ entityType ROUND_CLONED ต้องเป็นไทย "คัดลอกรอบรับสมัคร"', () => {
  assertEqual(getAuditEntityLabel('ROUND_CLONED'), 'คัดลอกรอบรับสมัคร', 'ต้องมี label ไทย ไม่ใช่ raw enum');
});

test('O2: description ROUND_CLONED → "คัดลอกรอบรับสมัคร → <ชื่อรอบ>"', () => {
  const log = {
    action: 'CREATE',
    entityType: 'ROUND_CLONED',
    entityId: 'new-round-uuid',
    display: { name: 'เชี่ยวชาญ 2569 (Copy)', secondary: 'เชี่ยวชาญ' },
  };
  assertEqual(
    buildAuditDescription(log, resolveAuditEntity(log, () => null), null),
    'คัดลอกรอบรับสมัคร → เชี่ยวชาญ 2569 (Copy)',
    'ต้องโชว์ชื่อรอบใหม่ ไม่ใช่ UUID/raw enum (ระดับตำแหน่งโชว์ในคอลัมน์ entity)',
  );
});

test('O3: ROUND_CLONED resolve ไม่ได้ → fallback UUID ย่อ พร้อมคำไทยนำหน้า', () => {
  assertEqual(
    buildAuditDescription(
      { action: 'CREATE', entityType: 'ROUND_CLONED', entityId: '65ef12ab34cd56ef' },
      null,
      null,
    ),
    'คัดลอกรอบรับสมัคร → 65ef…56ef',
    'fallback ต้องไม่แสดง ROUND_CLONED ดิบ',
  );
});

test('O4: page contract — filter Entity และ client fallback lookup ต้องมี ROUND_CLONED', () => {
  assertTrue(
    /'ROUND_CLONED'/.test(pageSource.match(/const ENTITY_OPTIONS = \[[\s\S]*?\] as const/)?.[0] ?? ''),
    'ENTITY_OPTIONS ต้องมี ROUND_CLONED (กรองได้ใน dropdown)',
  );
  assertTrue(
    /ROUND_CLONED:\s*'ROUND'/.test(pageSource),
    'ENTITY_TO_LOOKUP ต้อง map ROUND_CLONED → ROUND (fallback ชื่อรอบเมื่อ backend display หาย)',
  );
});

// =========================================================
//  P. LOGIN/LOGIN_FAILED/ACCOUNT_LOCKED + CHANGE_PASSWORD/
//     RESET_PASSWORD + legacy USER — label ไทยครบทุกผิว
// =========================================================

test('P: ACTION_CONFIG มี LOGIN/LOGIN_FAILED/ACCOUNT_LOCKED label ไทย', () => {
  assertEqual(AUDIT_ACTION_CONFIG.LOGIN.label, 'เข้าสู่ระบบ', 'label LOGIN');
  assertEqual(AUDIT_ACTION_CONFIG.LOGIN_FAILED.label, 'เข้าสู่ระบบไม่สำเร็จ', 'label LOGIN_FAILED');
  assertEqual(AUDIT_ACTION_CONFIG.ACCOUNT_LOCKED.label, 'บัญชีถูกล็อก', 'label ACCOUNT_LOCKED');
});

test('P2: LOGIN → "เข้าสู่ระบบ <email>"', () => {
  const log = {
    action: 'LOGIN',
    entityType: 'ADMIN_USER',
    entityId: 'admin-uuid',
    display: { name: 'admin@example.com', secondary: null },
  };
  assertEqual(
    buildAuditDescription(log, resolveAuditEntity(log, () => null), null),
    'เข้าสู่ระบบ admin@example.com',
    'ต้องโชว์อีเมล ไม่ใช่ raw enum LOGIN',
  );
});

test('P3: LOGIN_FAILED → ไทยครบ ทั้งเคส display resolve ได้และ fallback payload.email', () => {
  const log = {
    action: 'LOGIN_FAILED',
    entityType: 'ADMIN_USER',
    entityId: 'admin-uuid',
    display: { name: 'admin@example.com', secondary: null },
  };
  assertEqual(
    buildAuditDescription(log, resolveAuditEntity(log, () => null), null),
    'เข้าสู่ระบบไม่สำเร็จ admin@example.com',
    'เคส display resolve ได้',
  );
  assertEqual(
    buildAuditDescription(
      { action: 'LOGIN_FAILED', entityType: 'ADMIN_USER', entityId: 'gone' },
      null,
      { email: 'admin@example.com', failedAttempts: 3 },
    ),
    'เข้าสู่ระบบไม่สำเร็จ admin@example.com',
    'display resolve ไม่ได้ → ใช้ payload.email ห้าม raw enum/UUID',
  );
});

test('P4: ACCOUNT_LOCKED → "บัญชีถูกล็อก <email>"', () => {
  const log = {
    action: 'ACCOUNT_LOCKED',
    entityType: 'ADMIN_USER',
    entityId: 'admin-uuid',
    display: { name: 'admin@example.com', secondary: null },
  };
  assertEqual(
    buildAuditDescription(log, resolveAuditEntity(log, () => null), {
      email: 'admin@example.com',
      lockReason: 'MAX_FAILED_ATTEMPTS',
    }),
    'บัญชีถูกล็อก admin@example.com',
    'ต้องโชว์อีเมล ไม่ใช่ raw enum ACCOUNT_LOCKED',
  );
});

test('P5: CHANGE_PASSWORD → "เปลี่ยนรหัสผ่าน <email>" จาก payload.targetEmail (entityId = BULK/NEW resolve ไม่ได้)', () => {
  assertEqual(
    buildAuditDescription(
      { action: 'CHANGE_PASSWORD', entityType: 'ADMIN_USER', entityId: 'BULK/NEW' },
      null,
      { selfChange: true, targetEmail: 'admin@example.com' },
    ),
    'เปลี่ยนรหัสผ่าน admin@example.com',
    'ต้องไม่แสดง raw enum CHANGE_PASSWORD',
  );
});

test('P6: RESET_PASSWORD → "รีเซ็ตรหัสผ่าน <email>"', () => {
  const log = {
    action: 'RESET_PASSWORD',
    entityType: 'ADMIN_USER',
    entityId: 'target-uuid',
    display: { name: 'target@example.com', secondary: null },
  };
  assertEqual(
    buildAuditDescription(log, resolveAuditEntity(log, () => null), {
      selfChange: false,
      targetEmail: 'target@example.com',
    }),
    'รีเซ็ตรหัสผ่าน target@example.com',
    'ต้องโชว์อีเมลเจ้าของบัญชี ไม่ใช่ raw enum RESET_PASSWORD',
  );
});

test('P7: label ของ entityType USER (legacy) ต้องเป็นไทย "ผู้ใช้งานระบบ"', () => {
  assertEqual(getAuditEntityLabel('USER'), 'ผู้ใช้งานระบบ', 'ต้องมี label ไทย ไม่ใช่ raw enum USER');
});

test('P8: page contract — filter Action ต้องมี LOGIN/LOGIN_FAILED/ACCOUNT_LOCKED', () => {
  const m = pageSource.match(/const ACTION_OPTIONS = \[[\s\S]*?\] as const/)?.[0] ?? '';
  assertTrue(/'LOGIN'/.test(m), 'ACTION_OPTIONS ต้องมี LOGIN (กรองได้ใน dropdown)');
  assertTrue(/'LOGIN_FAILED'/.test(m), 'ACTION_OPTIONS ต้องมี LOGIN_FAILED');
  assertTrue(/'ACCOUNT_LOCKED'/.test(m), 'ACTION_OPTIONS ต้องมี ACCOUNT_LOCKED');
});

// =========================================================
//  M. source contract — audit-logs page ใช้ lib กลาง
// =========================================================

test('M: page ต้อง import จาก lib/audit-log-display และห้ามประกาศ map ซ้ำ', () => {
  assertTrue(
    pageSource.includes("from '@/lib/audit-log-display'"),
    'ต้อง import resolver กลางจาก lib',
  );
  assertTrue(
    !/const ACTION_CONFIG[:\s]/.test(pageSource),
    'ห้ามประกาศ ACTION_CONFIG ในหน้า (ใช้ getAuditActionConfig จาก lib)',
  );
  assertTrue(
    !/const ENTITY_LABEL[:\s]/.test(pageSource),
    'ห้ามประกาศ ENTITY_LABEL ในหน้า (ใช้ getAuditEntityLabel จาก lib)',
  );
  assertTrue(
    pageSource.includes('buildAuditDescription(log, resolved, payload)'),
    'ตารางต้องเรียก buildAuditDescription ด้วย resolved display',
  );
  assertTrue(
    pageSource.includes("renderActionBadge"),
    'badge ต้อง render ผ่าน renderActionBadge (getAuditActionConfig)',
  );
});

// =========================================================
console.log('\n========================================');
if (failed > 0) {
  console.log(`FAIL: ${failed} failed, ${passed} passed`);
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log(`PASS: all ${passed} tests passed`);
}
