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

  // Try to get entity ID from params
  const entityId = c.req.param('id') || 'BULK/NEW';
  
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
