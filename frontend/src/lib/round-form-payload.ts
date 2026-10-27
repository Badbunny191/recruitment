/**
 * R10 - Round Form PATCH Payload Builder
 * --------------------------------------------
 * ปัญหาเดิม: หน้า Rounds โหมดแก้ไข "ไม่เคยส่ง" roundCode และ applicationPattern
 * ใน PATCH เสมอ (ทั้งตอนที่รอบยังไม่มีผู้สมัครและ UI แสดงช่องกรอกเป็นแก้ไขได้)
 * → admin แก้ไขแล้วกดบันทึก "สำเร็จ" แต่ backend ไม่เคยได้รับค่า → ไม่มีอะไร save
 *
 * กติกา source of truth (backend PATCH /admin/rounds/:id):
 *   - มีผู้สมัครแล้ว  → ล็อก (backend ตอบ 409 PATTERN_LOCKED / ROUND_CODE_LOCKED)
 *     frontend จึง "ไม่ส่ง" field ทั้งสอง
 *   - ยังไม่มีผู้สมัคร → แก้ได้ ต้อง "ส่งค่าจริง" เพื่อให้ backend validate + บันทึก
 *   - legacy round (roundCode ว่าง / applicationPattern null) → ไม่ส่ง field นั้น
 *     (UI เป็นแบนเนอร์อ่านอย่างเดียว แก้ไม่ได้อยู่แล้ว)
 */

export interface RoundFormValues {
  title: string;
  positionLevel: string;
  templateVersionId: string;
  status: string;
  announcementTitle: string;
  announcementDescription: string;
  contactInformation: string;
  remark: string;
  applicationPattern: string | null;
  roundCode: string;
}

export interface RoundPatchOptions {
  /** true เมื่อรอบมีผู้สมัครแล้ว — numbering settings ถูกล็อก ไม่ส่งไป backend */
  isRoundLocked: boolean;
  openDateUnix: number;
  closeDateUnix: number;
}

export function buildRoundPatchPayload(
  form: RoundFormValues,
  opts: RoundPatchOptions,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: form.title,
    positionLevel: form.positionLevel,
    openDate: opts.openDateUnix,
    closeDate: opts.closeDateUnix,
    status: form.status,
    announcementTitle: form.announcementTitle || null,
    announcementDescription: form.announcementDescription || null,
    contactInformation: form.contactInformation || null,
    remark: form.remark || null,
    // templateVersionId: เปลี่ยนได้เฉพาะ DRAFT round
    ...(form.templateVersionId ? { templateVersionId: form.templateVersionId } : {}),
  };

  if (!opts.isRoundLocked) {
    if (form.roundCode) {
      payload.roundCode = form.roundCode;
    }
    if (form.applicationPattern) {
      payload.applicationPattern = form.applicationPattern;
    }
  }

  return payload;
}
