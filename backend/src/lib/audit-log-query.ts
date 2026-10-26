/**
 * Audit Log Query Builder — WHERE builder กลางสำหรับ GET /admin/audit-logs
 * ============================================================================
 * แยกออกจาก route handler เพื่อให้ regression test ยิง query จริงกับ
 * SQLite in-memory ได้ตรงจุด (pattern เดียวกับ audit-display.service)
 *
 *   - action/entity รองรับทั้งค่าเดี่ยวและ comma-separated จาก multi-select
 *     (frontend audit-logs/page.tsx ส่ง join(','))
 *   - search ครอบ adminId / entityId / ipAddress + อีเมลผู้ใช้งาน
 *     (actor display ที่ resolve ได้คือ email — admin_users ไม่มีคอลัมน์ชื่อ)
 *     ผ่าน subquery IN (SELECT id FROM admin_users WHERE email LIKE ...)
 *     จึงไม่โดน D1 bind limit ไม่ว่า admin จะกี่คน
 */

import { and, eq, inArray, like, or, type SQL } from 'drizzle-orm';
import type { drizzle as drizzleFn } from 'drizzle-orm/d1';
import { adminUsers, auditLogs } from '../db/schema';

type DB = ReturnType<typeof drizzleFn<any>>;

export interface AuditLogQueryParams {
  actions: string[];
  entities: string[];
  search: string;
}

/** แยก filter multi-select: "A, B" → ['A', 'B'] (ตัดช่องว่าง + ค่าว่าง) */
export function parseMultiParam(raw: string | undefined | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function buildAuditLogWhere(db: DB, params: AuditLogQueryParams): SQL | undefined {
  const filters: SQL[] = [];

  // ค่าเดียวใช้ eq (คงพฤติกรรมเดิม) — หลายค่าใช้ inArray
  if (params.actions.length === 1) filters.push(eq(auditLogs.action, params.actions[0]));
  else if (params.actions.length > 1) filters.push(inArray(auditLogs.action, params.actions));

  if (params.entities.length === 1) filters.push(eq(auditLogs.entityType, params.entities[0]));
  else if (params.entities.length > 1) filters.push(inArray(auditLogs.entityType, params.entities));

  // Search: LIKE %...% บนคอลัมน์ตรง + email ผ่าน subquery (admin ไม่ match → IN ว่าง = false)
  if (params.search) {
    const likePattern = `%${params.search}%`;
    const searchOr = or(
      like(auditLogs.adminId, likePattern),
      like(auditLogs.entityId, likePattern),
      like(auditLogs.ipAddress, likePattern),
      inArray(
        auditLogs.adminId,
        db
          .select({ id: adminUsers.id })
          .from(adminUsers)
          .where(like(adminUsers.email, likePattern))
      )
    );
    if (searchOr) filters.push(searchOr);
  }

  return filters.length > 0 ? and(...filters) : undefined;
}
