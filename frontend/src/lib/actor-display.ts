/**
 * Actor classification — APPLICANT / ADMIN / SYSTEM (ฝั่ง client)
 * ============================================================================
 * คู่แฝดของ backend/src/lib/actor-display.ts — ต้องมีค่าคงที่และกติกา
 * เหมือนกันเป๊ะ (monorepo แยก BE/FE จึงประกาศซ้ำ ไม่ import ข้าม package)
 *
 *   APPLICANT — ผู้สมัครทำเอง (audit เขียนด้วย reserved SYSTEM row)
 *   ADMIN     — เจ้าหน้าที่ทำ
 *   SYSTEM    — ระบบทำอัตโนมัติ
 *
 * `system@audit.local` เป็นรายละเอียดทางเทคนิคของ reserved row — ห้ามแสดง
 * ต่อผู้ใช้ทุกกรณี (timeline / audit log / export)
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
];

export type ActorType = 'APPLICANT' | 'ADMIN' | 'SYSTEM';

export function isApplicantAction(action: string): boolean {
  return APPLICANT_ACTIONS.includes(action);
}

/**
 * แยกประเภท actor ของ 1 audit log
 *
 * - adminId ไม่ใช่ reserved row → ADMIN
 * - reserved row + action ฝั่งผู้สมัคร → APPLICANT
 * - reserved row + action อื่น → SYSTEM
 */
export function classifyActorType(
  adminId: string | null | undefined,
  action: string,
): ActorType {
  if (adminId !== SYSTEM_ACTOR_ID) return 'ADMIN';
  return isApplicantAction(action) ? 'APPLICANT' : 'SYSTEM';
}

/**
 * ค่า label สำรองต่อประเภท — ใช้เมื่อไม่มีชื่อจริงให้แสดง
 * (ห้าม fallback ไปที่ email ของ reserved row หรือ UUID ดิบ)
 */
export const ACTOR_TYPE_FALLBACK_LABEL: Record<ActorType, string> = {
  APPLICANT: 'ผู้สมัคร',
  ADMIN: 'เจ้าหน้าที่',
  SYSTEM: 'ระบบ',
};

/** badge สั้น ๆ ต่อประเภท — ให้ HR แยกด้วยสายตาเมื่อ timeline ยาว */
export const ACTOR_TYPE_BADGE: Record<ActorType, string> = {
  APPLICANT: 'ผู้สมัคร',
  ADMIN: 'เจ้าหน้าที่',
  SYSTEM: 'ระบบ',
};

/**
 * กัน reserved email หลุด: คืน true เมื่อค่าที่จะแสดงเป็น email ของ reserved row
 * ใช้เป็นด่านสุดท้ายก่อน render (ข้อมูลเก่าอาจส่งค่ามาแล้ว)
 */
export function isReservedActorEmail(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.trim().toLowerCase() === SYSTEM_ACTOR_EMAIL;
}
