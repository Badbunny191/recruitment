/**
 * Application History — query helpers (Phase 3: performance & scalability)
 * ============================================================================
 * ใช้กับ GET /admin/applications/:id/history เท่านั้น
 *
 * ปัญหาเดิม (ก่อน Phase 3):
 *   1. ไม่มี LIMIT → คืนทุก audit log ของใบสมัครนั้น ใบที่ถูกดาวน์โหลด PDF
 *      ซ้ำ ๆ (PDF_DOWNLOAD เขียน log ทุกครั้งที่กด) จะสะสมได้เป็นพันแถว
 *      payload ต่อแถว 100–600 bytes → response โตถึง MB
 *   2. ORDER BY created_at DESC, id DESC แต่ index ที่มีคือ
 *      idx_audit_entity (entity_type, entity_id) ไม่มี created_at ต่อท้าย
 *      → SQLite `USE TEMP B-TREE FOR ORDER BY` (sort ใน memory)
 *   3. ไม่มีการบอกผู้ใช้ว่ายังมีต่อ — หน้า Detail ขึ้น "N รายการ" จากจำนวน
 *      ที่โหลดมา ซึ่งเคยเท่ากับจำนวนจริง ตอนนี้ต้องบอกตามจริง
 *
 * หลักการของ Phase 3:
 *   - limit whitelist เท่านั้น (10/25/50/100) ค่าแปลก ๆ ไม่ 400 แต่ dud เป็น
 *     default 50 — endpoint นี้เป็น endpoint อ่าน ไม่ควรพังเพราะ query string
 *     ผิดรูป และ frontend ที่ยังไม่ส่ง limit ต้องไม่พัง (backward compatible)
 *   - ใช้ keyset-free offset? ไม่ — หน้านี้ไม่ทำ infinite scroll (ห้ามตามสเปก)
 *     จึงใช้ limit + hasMore ผ่านการดึงเกินมา 1 แถว (limit+1) ซึ่งถูกกว่า
 *     COUNT(*) เพราะไม่ต้อง scan ทั้งชุดอีกครั้ง
 *   - total: ไม่คำนวณในพาธปกติ (ต้นทุน COUNT(*) บน entity ที่ไม่มี index
 *     รองรับ created_at = ต้องอ่านทั้งช่วง) แต่ "ถูก" เมื่อมี composite index;
 *     ดูรายละเอียดการตัดสินใจใน hasMore() ด้านล่าง
 */

// ── Pagination ─────────────────────────────────────────────────────────────

/** default limit ตามสเปก Phase 3 */
export const HISTORY_LIMIT_DEFAULT = 50;

/** whitelist เท่านั้น — ตัวอื่นทั้งหมดตกไป default */
export const HISTORY_LIMIT_ALLOWED = [10, 25, 50, 100] as const;

export type HistoryLimit = (typeof HISTORY_LIMIT_ALLOWED)[number];

/**
 * แปลง ?limit= → limit ที่อนุญาต
 * - ไม่ส่ง / ค่าว่าง / ไม่ใช่ตัวเลข / ไม่อยู่ใน whitelist → HISTORY_LIMIT_DEFAULT
 * - ไม่ throw ไม่ 400: endpoint อ่านต้องทน query string ที่ผิดรูป
 *   (ตรงกับ parseApplicationsListSort ที่ค่าว่าง → default เช่นกัน)
 */
export function parseHistoryLimit(raw?: string | null): HistoryLimit {
  if (raw === undefined || raw === null) return HISTORY_LIMIT_DEFAULT;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return HISTORY_LIMIT_DEFAULT;
  const value = Number(trimmed);
  return (HISTORY_LIMIT_ALLOWED as readonly number[]).includes(value)
    ? (value as HistoryLimit)
    : HISTORY_LIMIT_DEFAULT;
}

/**
 * ขอบเขต limit ของผู้ใช้ภายนอก (10..100) — ใช้ได้เฉพาะใน handler
 * ถ้าอนาคตมี caller ภายในที่ต้องดึงเกิน 100 ให้ใช้ clampHistoryLimitInternal
 */
export function clampHistoryLimitInternal(limit: number, max = 200): number {
  if (!Number.isFinite(limit) || limit < 1) return HISTORY_LIMIT_DEFAULT;
  return Math.min(Math.floor(limit), max);
}

// ── hasMore ────────────────────────────────────────────────────────────────

/**
 * ตัดสินใจ: total count หรือ hasMore
 *
 * ทางเลือกที่ชั่งแล้ว:
 *   total — ต้อง COUNT(*) บน (entity_type, entity_id) อีกครั้งต่อ request
 *     หลังมี composite index ต้นทุนนี้ ~0.8 ms บน 6,000 แถว (วัดจริง) ถูกราคา
 *     แต่ต้อง query ที่สองเพิ่มทุกครั้ง รวมถึงตอนที่ผู้ใช้ไม่ได้ต้องการตัวเลข
 *     และ COUNT(*) บน D1 = 1 subrequest เพิ่ม (Workers มีเพดาน subrequest)
 *   hasMore — ดึง limit+1 แถวใน query เดียว แล้วตัดทิ้ง → ไม่มี query ที่สอง
 *     ไม่มี subrequest เพิ่ม ต้นทุนเท่ากับ query เดิม + 1 แถว
 *
 * เลือก hasMore เพราะ:
 *   1. UI ที่ใช้ endpoint นี้ (application-detail) ไม่มีตัวเลข "ทั้งหมด N รายการ"
 *      ที่ต้องใช้ total — มันแสดง badge จากจำนวนที่โหลดมา (history.length)
 *      และ Phase 3 ห้าม redesign UI → total ไม่มีที่ใช้
 *   2. phase นี้ยังไม่สร้าง migration (ยังไม่พิสูจน์ว่าจำเป็น) → ก่อนมี index
 *      COUNT(*) คือ full scan ของช่วง entity นั้น ต้นทุนสูงกว่า limit+1 ชัดเจน
 *   3. ตอบคำถามจริงของผู้ใช้ ("มีต่อไหม") ด้วยข้อมูลที่แน่นอน ไม่ใช่ประมาณ
 *   4. ถ้าอนาคต UI ต้องการ total จริง ๆ เติมภายหลังได้โดยไม่ breaking
 *      (เพิ่ม key ใหม่ ไม่แก้ key เดิม)
 */
export function computeHasMore(rowCount: number, limit: number): boolean {
  return rowCount > limit;
}