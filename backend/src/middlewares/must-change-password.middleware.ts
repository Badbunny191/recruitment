import { createMiddleware } from 'hono/factory';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { Bindings, AppVariables } from '../types';
import { adminUsers } from '../db/schema';

/**
 * R9 — mustChangePassword Enforcement Gate
 * =========================================
 *
 * Source of truth ของ flag คือคอลัมน์ `admin_users.must_change_password`
 * (migration 020) — ไม่ฝังใน JWT เพราะ token มีอายุ 8 ชั่วโมงและไม่มี refresh
 * session: ถ้าอ่านจาก JWT ผู้ใช้ที่ถูก admin สั่ง force-change-password ระหว่าง
 * token ยังไม่หมดอายุจะรอดผ่านไปจนครบอายุ token จึงต้องอ่านจาก DB ทุก request
 * (PK lookup ครั้งเดียวต่อ request)
 *
 * เส้นทางที่ยังใช้ได้ (allowlist) — น้อยที่สุดเท่าที่จำเป็นต่อการเปลี่ยนรหัสผ่าน:
 *   - POST /auth/change-password  (เปลี่ยนรหัสผ่านของตัวเอง)
 *   - GET  /auth/me               (โปรไฟล์ของตัวเอง — frontend ใช้แสดงสถานะ)
 *
 * ไม่มี logout endpoint (logout เป็นการล้าง localStorage ฝั่ง client) และ
 * endpoint สาธารณะของผู้สมัครไม่ได้อยู่ใต้ adminRoutes จึงไม่เกี่ยว
 *
 * Response: 403 Forbidden (authenticate ผ่านแล้วแต่ยังทำอย่างอื่นไม่ได้)
 * พร้อม code MUST_CHANGE_PASSWORD ให้ frontend redirect ไปหน้าเปลี่ยนรหัสผ่าน
 *
 * DB query ล้มเหลว → fail-open (ให้ handler เองล้มตาม DB จริง) เพราะ
 * fail-closed จะทำให้ DB กระตุกครั้งเดียวบล็อกทั้งระบบ admin
 */

export const MUST_CHANGE_PASSWORD_CODE = 'MUST_CHANGE_PASSWORD';

/** Mount prefix ของ adminRoutes (index.ts + test fixtures ใช้เหมือนกัน) */
const ADMIN_MOUNT_PREFIX = '/api/v1/admin';

/** method + path (เทียบกับ mount prefix) ที่ยอมให้ผ่านขณะ flag เปิดอยู่ */
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

export const mustChangePasswordGate = createMiddleware<{
  Bindings: Bindings;
  Variables: AppVariables;
}>(async (c, next) => {
  // ต้องลงทะเบียนหลัง authMiddleware — jwtPayload พร้อมใช้แล้ว
  const payload = c.get('jwtPayload');
  if (!payload?.id) {
    await next();
    return;
  }

  const path = c.req.path.startsWith(ADMIN_MOUNT_PREFIX)
    ? c.req.path.slice(ADMIN_MOUNT_PREFIX.length)
    : c.req.path;
  if (ALLOWED_METHOD_PATHS.has(`${c.req.method} ${path}`)) {
    await next();
    return;
  }

  try {
    const row = await drizzle(c.env.DB)
      .select({ mustChangePassword: adminUsers.mustChangePassword })
      .from(adminUsers)
      .where(eq(adminUsers.id, payload.id))
      .get();

    if (row?.mustChangePassword) {
      return mustChangePasswordErrorResponse(c);
    }
  } catch (error) {
    console.error('[MUST_CHANGE_PASSWORD_GATE_DB_ERROR]', { userId: payload.id });
  }

  await next();
});
