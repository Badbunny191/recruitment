/**
 * Audit Service — จุดเขียน audit log กลาง (Audit Log Foundation — Phase 1)
 * ---------------------------------------------------------------------------
 * ทุกการเขียน audit_logs ต้องผ่าน writeAudit() ที่เดียว:
 *
 *   - audit.middleware.ts       (mutations ทั่วไป + writeLoginAudit)
 *   - admin.routes.ts           (PDF_DOWNLOAD, ROUND_CLONED — manual insert เดิม)
 *   - excel-export.service.ts   (EXPORT_EXCEL)
 *   - public.routes.ts          (APPLICATION_SUBMIT — ใหม่)
 *   - upload.routes.ts          (ATTACHMENT_UPLOAD / ATTACHMENT_DELETE — ใหม่)
 *
 * รวมพฤติกรรมที่ต้องคงเดิมไว้ 3 อย่าง:
 *
 *   1. FAIL-SOFT — audit ล้มได้ แต่ธุรกรรมจริงห้ามพัง (กลืน error + console.error
 *      + คืน boolean) ตาม pattern เดิมของ PDF_DOWNLOAD / writeExportAudit /
 *      writeLoginAudit / auditMiddleware
 *
 *   2. PAYLOAD SINGLE-ENCODE — คอลัมน์ payload เป็น drizzle `text mode json`
 *      (mapToDriverValue = JSON.stringify) โค้ดเดิมส่ง JSON string เข้ามา
 *      จึงถูก stringify ซ้ำเป็น double-encode ทั้งระบบ → normalizeAuditPayload()
 *      แปลงให้เหลือ encode ครั้งเดียว ณ จุดเดียวนี้ (แถวเก่าที่ double-encoded
 *      ยังอ่านได้ เพราะ read side ทั้ง BE/FE รองรับทั้ง string และ object)
 *
 *   3. batch_id (Migration 032) — ใส่ลง INSERT เฉพาะเมื่อผู้เรียกส่งมา
 *      (omitted เมื่อไม่มี → INSERT ไม่อ้างคอลัมน์ จึงยังทำงานได้แม้ตาราง
 *      ยังไม่มีคอลัมน์ เช่น test DDL เก่า)
 *
 * ข้อจำกัดทาง schema ที่คงเดิม (ห้าม redesign ตาม scope Phase 1):
 *   audit_logs.admin_id เป็น NOT NULL FK → admin_users(id) จึงต้องมี actor id
 *   ที่มีจริงเสมอ เหตุการณ์ฝั่งผู้สมัคร (APPLICATION_SUBMIT / ATTACHMENT_*)
 *   ใช้ SYSTEM_ADMIN_ID — แถว reserved ที่ Migration 032 สร้างให้:
 *   role VIEWER, is_active = 0 (login ตอบ 403 ก่อนถึง bcrypt) และ password_hash
 *   เป็น bcrypt ของค่าสุ่มที่ไม่มีใครเก็บ preimage ไว้
 */

import { drizzle as drizzleFn } from 'drizzle-orm/d1';
import { auditLogs } from '../db/schema';
import { v4 as uuidv4 } from 'uuid';

type DB = ReturnType<typeof drizzleFn<any>>;

/** แถว admin_users reserved สำหรับ actor เสมือน (Migration 032) */
export const SYSTEM_ADMIN_ID = '00000000-0000-0000-0000-000000000000';

export interface WriteAuditInput {
  db: DB;
  action: string;
  entityType: string;
  entityId: string;
  /** admin_users.id ที่มีจริง — เหตุการณ์ฝั่งผู้สมัครใช้ SYSTEM_ADMIN_ID */
  actorId: string;
  /** object (แนะนำ) หรือ JSON string (โค้ดเดิม) — normalize ให้เอง */
  payload?: unknown;
  ipAddress?: string | null;
  /** ใช้กับ bulk operations — 1 ค่าต่อ 1 request */
  batchId?: string | null;
}

/**
 * แปลง payload ให้เป็น object ที่ drizzle จะ stringify ครั้งเดียว
 *
 *   - object            → ตามเดิม
 *   - JSON string       → parse กลับ (พฤติกรรมของผู้เรียกแบบเก่า เช่น
 *                          setAuditPayload(JSON.stringify(...)))
 *   - string แปลงไม่ได้ → ห่อเป็น { raw } เพื่อคงเนื้อหาไว้โดยไม่พัง
 *   - null/undefined    → null (คอลัมน์ nullable)
 */
export function normalizeAuditPayload(payload: unknown): Record<string, unknown> | null {
  if (payload === null || payload === undefined) return null;
  if (typeof payload === 'object') return payload as Record<string, unknown>;
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // string ธรรมดา (ไม่ใช่ JSON) — ห่อเก็บตามเดิมด้านล่าง
    }
    return { raw: payload };
  }
  return { raw: String(payload) };
}

/**
 * เขียน audit log 1 แถว — fail-soft เสมอ
 * @returns true = เขียนสำเร็จ, false = ล้ม (error ถูก log แล้ว)
 */
export async function writeAudit(input: WriteAuditInput): Promise<boolean> {
  try {
    const values: Record<string, unknown> = {
      id: uuidv4(),
      adminId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      payload: normalizeAuditPayload(input.payload),
      // undefined = ผู้เรียกไม่สนใจ IP → 'unknown' (พฤติกรรมเดิมของ middleware/
      // login/export), null = ผู้เรียกตั้งใจเว้น (เช่น ROUND_CLONED เดิมเขียน NULL)
      ipAddress: input.ipAddress === undefined ? 'unknown' : input.ipAddress,
    };
    // เฉพาะเมื่อมี batchId — ไม่ใส่คีย์ = drizzle ไม่อ้างคอลัมน์ใน INSERT
    // (ตาราง/DDL ที่ยังไม่มี batch_id ยังเขียนได้ตามปกติ)
    if (input.batchId) {
      values.batchId = input.batchId;
    }
    await input.db.insert(auditLogs).values(values as any);
    return true;
  } catch (auditErr) {
    console.error('[AUDIT_SERVICE] Failed to write audit log:', auditErr);
    return false;
  }
}
