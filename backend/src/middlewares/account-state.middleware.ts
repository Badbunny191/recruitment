import { createMiddleware } from 'hono/factory';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { Bindings, AppVariables } from '../types';
import { adminUsers } from '../db/schema';

/**
 * R9 + R9.1 — Account State Gate
 * ================================
 *
 * Source of truth ของสถานะบัญชีคือตาราง `admin_users`
 * (migration 020): `is_active` และ `must_change_password`
 * — ไม่ฝังใน JWT เพราะ token มีอายุ 8 ชั่วโมงและไม่มี refresh session:
 * admin disable บัญชีหรือสั่ง force-change-password ระหว่าง token ยังไม่หมดอายุ
 * ต้องมีผลทันที จึงต้องอ่านสถานะล่าสุดจาก DB ทุก request (PK lookup ครั้งเดียว)
 *
 * ลำดับการตรวจ (order สำคัญ — ดู R9.1 Part D):
 *   1. isActive = false        → 403 ACCOUNT_DISABLED บล็อกทุก path
 *      (disable เป็นสัญญาณที่แรงและถาวรกว่า — บัญชีที่ถูกปิด "ไม่มีสิทธิ์"
 *      แม้แต่เปลี่ยนรหัสผ่าน จึงไม่มี allowlist ให้ผ่าน)
 *   2. mustChangePassword = true → 403 MUST_CHANGE_PASSWORD เฉพาะ path ที่
 *      ไม่อยู่ใน allowlist (น้อยที่สุดเท่าที่จำเป็นต่อการเปลี่ยนรหัสผ่าน):
 *        - POST /auth/change-password  (เปลี่ยนรหัสผ่านของตัวเอง)
 *        - GET  /auth/me               (โปรไฟล์ของตัวเอง — frontend ใช้แสดงสถานะ)
 *
 * ไม่มี logout endpoint (logout เป็นการล้าง localStorage ฝั่ง client) และ
 * endpoint สาธารณะของผู้สมัครไม่ได้อยู่ใต้ adminRoutes จึงไม่เกี่ยว
 *
 * DB query ล้มเหลว → fail-open (ให้ handler เองล้มตาม DB จริง) เพราะ
 * fail-closed จะทำให้ DB กระตุกครั้งเดียวบล็อกทั้งระบบ admin
 * user row หาย → ปล่อยผ่าน (handler 404 ตามเดิม)
 */

export const MUST_CHANGE_PASSWORD_CODE = 'MUST_CHANGE_PASSWORD';
export const ACCOUNT_DISABLED_CODE = 'ACCOUNT_DISABLED';

/** Mount prefix ของ adminRoutes (index.ts + test fixtures ใช้เหมือนกัน) */
const ADMIN_MOUNT_PREFIX = '/api/v1/admin';

/** method + path (เทียบกับ mount prefix) ที่ยอมให้ผ่านขณะ mustChangePassword เปิดอยู่ */
const ALLOWED_METHOD_PATHS = new Set(['POST /auth/change-password', 'GET /auth/me']);

export function mustChangePasswordErrorResponse(c: any) {
  return c.json(
    {
      success: false,
      code: MUST_CHANGE_PASSWORD_CODE,
      error: MUST_CHANGE_PASSWORD_CODE,
      message: 'Password change required — กรุณาเปลี่ยนรหัสผ่านก่อนใช้งานระบบ',
    },
    403,
  );
}

export function accountDisabledErrorResponse(c: any) {
  return c.json(
    {
      success: false,
      code: ACCOUNT_DISABLED_CODE,
      error: ACCOUNT_DISABLED_CODE,
      message: 'Account disabled',
    },
    403,
  );
}

export const accountStateGate = createMiddleware<{
  Bindings: Bindings;
  Variables: AppVariables;
}>(async (c, next) => {
  // ต้องลงทะเบียนหลัง authMiddleware — jwtPayload พร้อมใช้แล้ว
  const payload = c.get('jwtPayload');
  if (!payload?.id) {
    await next();
    return;
  }

  try {
    const row = await drizzle(c.env.DB)
      .select({
        isActive: adminUsers.isActive,
        mustChangePassword: adminUsers.mustChangePassword,
      })
      .from(adminUsers)
      .where(eq(adminUsers.id, payload.id))
      .get();

    // user หายจาก DB → ปล่อยผ่านให้ handler 404 ตามพฤติกรรมเดิม
    if (!row) {
      await next();
      return;
    }

    // R9.1 — ปิดบัญชีมีผลทันทีแม้ JWT ยังไม่หมดอายุ และบล็อกทุก path
    // (รวม allowlist ของ mustChangePassword — บัญชีปิดแล้วไม่มีอะไรให้ทำ)
    if (row.isActive === false) {
      return accountDisabledErrorResponse(c);
    }

    // R9 — บังคับเปลี่ยนรหัสผ่าน: ยกเว้นเฉพาะ allowlist
    if (row.mustChangePassword) {
      const path = c.req.path.startsWith(ADMIN_MOUNT_PREFIX)
        ? c.req.path.slice(ADMIN_MOUNT_PREFIX.length)
        : c.req.path;
      if (!ALLOWED_METHOD_PATHS.has(`${c.req.method} ${path}`)) {
        return mustChangePasswordErrorResponse(c);
      }
    }
  } catch (error) {
    console.error('[ACCOUNT_STATE_GATE_DB_ERROR]', { userId: payload.id });
  }

  await next();
});
