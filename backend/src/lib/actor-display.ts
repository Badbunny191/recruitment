/**
 * Actor classification — APPLICANT / ADMIN / SYSTEM
 * ============================================================================
 * audit_logs.admin_id เป็น NOT NULL FK → admin_users(id) ทุกแถวต้องมี actor
 * ที่มีจริง เหตุการณ์ฝั่งผู้สมัครจึงยืม reserved row (Migration 032) ที่มี
 * email `system@audit.local` — email นั้นเป็นรายละเอียดทางเทคนิค ไม่ใช่
 * ตัวตนที่ผู้ใช้ควรเห็น
 *
 * โมดูลนี้เป็น Single Source of Truth ของการแยก "ใครทำ":
 *
 *   APPLICANT — ผู้สมัครทำเอง (ยืม SYSTEM row เพราะยังไม่มี admin account)
 *   ADMIN     — เจ้าหน้าที่ทำ (admin_users.id จริง)
 *   SYSTEM    — ระบบทำอัตโนมัติ (ยังไม่มีผู้เขียนในระบบปัจจุบัน — เผื่ออนาคต)
 *
 * กติกา: ตัดสินจาก (adminId, action) คู่กัน ไม่ใช่ adminId อย่างเดียว
 * เพราะ reserved row ถูกยืมใช้ทั้งความหมาย APPLICANT และ SYSTEM
 *
 * ไฟล์นี้ต้องเหมือนกับ frontend/src/lib/actor-display.ts (ฝั่ง BE/FE แยกกัน
 * ตามโครง monorepo) — แก้ที่หนึ่งต้องแก้อีกที่
 */

/** ค่าคงที่เดียวกับ reserved row ใน Migration 032 */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

/** email ของ reserved row — ห้ามหลุดถึงผู้ใช้ */
export const SYSTEM_ACTOR_EMAIL = 'system@audit.local';

/** action ที่เกิดจากผู้สมัคร (เขียนด้วย SYSTEM_ACTOR_ID) */
export const APPLICANT_ACTIONS: readonly string[] = [
  'APPLICATION_SUBMIT',
  'ATTACHMENT_UPLOAD',
  'ATTACHMENT_DELETE',
  // C-attach: canonical event เขียนตอน submit ด้วย SYSTEM row — ถ้าไม่รวมไว้
  // จะถูกจัดเป็น SYSTEM แล้ว timeline ขึ้นว่า "ระบบ" ทั้งที่ผู้สมัครเป็นคนแนบ
  'ATTACHMENT_LINK',
];

export type ActorType = 'APPLICANT' | 'ADMIN' | 'SYSTEM';

export function isApplicantAction(action: string): boolean {
  return APPLICANT_ACTIONS.includes(action);
}

/**
 * แยกประเภท actor ของ 1 audit log
 *
 * - adminId ไม่ใช่ reserved row → ADMIN (แม้ action จะอยู่ใน APPLICANT_ACTIONS
 *   ก็ตาม: ถ้าเจ้าหน้าที่เป็นคนเขียน ถือว่าเป็น ADMIN ตามความจริงของข้อมูล)
 * - adminId เป็น reserved row + action ฝั่งผู้สมัคร → APPLICANT
 * - adminId เป็น reserved row + action อื่น → SYSTEM
 */
export function classifyActorType(
  adminId: string | null | undefined,
  action: string,
): ActorType {
  if (adminId !== SYSTEM_ACTOR_ID) return 'ADMIN';
  return isApplicantAction(action) ? 'APPLICANT' : 'SYSTEM';
}
