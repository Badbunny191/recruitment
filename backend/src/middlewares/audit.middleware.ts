import { createMiddleware } from 'hono/factory';
import { drizzle } from 'drizzle-orm/d1';
import { auditLogs } from '../db/schema';
import { v4 as uuidv4 } from 'uuid';
import { Bindings, AppVariables } from '../types';

export const auditMiddleware = (entityType: string, options?: { action?: string }) => createMiddleware<{ Bindings: Bindings; Variables: AppVariables }>(async (c, next) => {
  await next();
  
  const method = c.req.method;
  if (method === 'GET' || c.res.status >= 400) return;

  const db = drizzle(c.env.DB);
  const user = c.get('jwtPayload');
  
  // Default action มาจาก HTTP method — POST /admin/applications/bulk-status
  // เป็นการ "อัปเดตสถานะ" จึง override เป็น UPDATE เพื่อให้ audit ตรงความหมาย
  let action = options?.action ?? 'CREATE';
  if (method === 'PUT' || method === 'PATCH') action = 'UPDATE';
  if (method === 'DELETE') action = 'DELETE';

  // Entity ID: route handler ตั้ง c.set('auditEntityId', ...) นำหน้าได้ เมื่อ
  // id ของ entity ไม่ได้อยู่ใน path เป็น :id เช่น POST /templates/:id/versions
  // (:id = templateId แต่ entity จริงคือ version ที่เพิ่งสร้าง) และ
  // PUT /template-versions/:versionId (param ไม่ได้ชื่อ id → param('id') = undefined)
  // ไม่ตั้ง → ใช้ param('id') ตามเดิม, ไม่มีทั้งคู่ → sentinel 'BULK/NEW'
  const entityId = c.get('auditEntityId') || c.req.param('id') || 'BULK/NEW';
  
  // Check for custom audit payload set by route handler
  // Routes can set this to include change tracking data
  const customPayload = c.get('auditPayload');
  
  // For APPLICATION status updates, capture the request body as payload
  let payload: any = null;
  if (entityType === 'APPLICATION' && (method === 'PATCH' || method === 'PUT') && !customPayload) {
    try {
      const body = await c.req.json().catch(() => null);
      if (body) {
        payload = body;
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Use custom payload if provided (e.g., change tracking data)
  const finalPayload = customPayload || (payload ? JSON.stringify(payload) : null);

  // ── Audit insert ต้อง fail-soft ────────────────────────────────────────────
  // ⚠️ `await next()` ทำงานไปแล้ว (business operation สำเร็จ) ถ้า insert audit
  //    โยน error ตรงนี้ → ขึ้น app.onError → client ได้ 500 ทั้งที่งานจริงสำเร็จ
  //    (admin จะเห็น "เกิดข้อผิดพลาด" แล้วกด retry → งานซ้ำ)
  //
  //    ตัวอย่างที่ทำให้เกิดได้จริง: audit_logs.admin_id เป็น FK → admin_users(id)
  //    ON DELETE RESTRICT → ถ้า adminId ไม่มีใน admin_users insert จะ fail
  //
  //    Pattern เดียวกับ PDF_DOWNLOAD (admin.routes.ts) และ writeExportAudit
  //    (excel-export.service.ts): log error → ไม่ block response
  try {
    await db.insert(auditLogs).values({
      id: uuidv4(),
      adminId: user.id,
      action,
      entityType,
      entityId,
      payload: finalPayload,
      ipAddress: c.req.header('cf-connecting-ip') || 'unknown',
    });
  } catch (auditErr) {
    console.error('[AUDIT_MIDDLEWARE] Failed to write audit log:', auditErr);
  }
});

/**
 * Sets a custom audit payload for change tracking.
 * Call this in route handlers before returning.
 */
export function setAuditPayload(c: any, payload: string | null): void {
  c.set('auditPayload', payload);
}

// =============================================================================
// Login audit (LOGIN / LOGIN_FAILED / ACCOUNT_LOCKED)
// =============================================================================
// ⚠️ POST /admin/auth/login อยู่ *ก่อน* authMiddleware → ไม่มี jwtPayload และ
//    auditMiddleware ใช้ไม่ได้ (มัน return ทิ้งทุก response ที่ status >= 400
//    ซึ่งคือ 401/423 ของ login พอดี) จึงเขียน audit ตรงใน handler
//    ตาม pattern PDF_DOWNLOAD (admin.routes.ts) และ writeExportAudit
//    (excel-export.service.ts)
//
// SECURITY: entry type ไม่มี field สำหรับ password / password hash / JWT /
// token / temporary password เลยตั้งแต่ระดับ type — ใส่เข้ามาไม่ได้
//
// FAIL-SOFT: audit พังได้ แต่ login ห้ามพัง → กลืน error แล้ว log อย่างเดียว
// =============================================================================

export type LoginAuditAction = 'LOGIN' | 'LOGIN_FAILED' | 'ACCOUNT_LOCKED';

export interface LoginAuditEntry {
  action: LoginAuditAction;
  /** ต้องเป็น admin_users.id ที่มีจริง — audit_logs.admin_id เป็น FK NOT NULL */
  adminId: string;
  email: string;
  failedAttempts?: number;
  lockReason?: string;
  /** ISO 8601 */
  lockedUntil?: string;
}

export async function writeLoginAudit(c: any, entry: LoginAuditEntry): Promise<void> {
  try {
    const db = drizzle(c.env.DB);

    const payload: Record<string, unknown> = { email: entry.email };
    if (entry.failedAttempts !== undefined) payload.failedAttempts = entry.failedAttempts;
    if (entry.lockReason !== undefined) payload.lockReason = entry.lockReason;
    if (entry.lockedUntil !== undefined) payload.lockedUntil = entry.lockedUntil;

    await db.insert(auditLogs).values({
      id: uuidv4(),
      adminId: entry.adminId,
      action: entry.action,
      entityType: 'ADMIN_USER',
      entityId: entry.adminId,
      payload: JSON.stringify(payload),
      ipAddress: c.req.header('cf-connecting-ip') || 'unknown',
    });
  } catch (auditErr) {
    // audit ล้มไม่ block login — ตาม pattern PDF_DOWNLOAD / writeExportAudit
    console.error('[LOGIN_AUDIT] Failed to write audit log:', auditErr);
  }
}
