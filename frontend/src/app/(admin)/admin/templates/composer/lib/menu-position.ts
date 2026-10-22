/**
 * Dropdown positioning (pure helper)
 * ----------------------------------
 * Document Composer — เมนู "แทรกข้อมูล" ไม่ถูกตัดด้านขวา
 *
 * ⚠️ ขอบเขต
 *   - แก้เฉพาะ **ตำแหน่ง** ของเมนู (positioning) — ไม่แตะพฤติกรรมการแทรก token
 *   - ไม่แตะ Workspace independent scroll
 *   - ไม่ติดตั้ง package ใหม่
 *
 * ── Root cause ───────────────────────────────────────────────────────────────
 * เมนูเดิม render ด้วย `position: absolute; left: 0` อยู่ภายใน wrapper ของปุ่ม
 * → เมื่อปุ่มอยู่ใกล้ขอบขวาของ Visual Composer เมนู (กว้าง 340px) จะ
 *   ล้นออกไปนอกขอบ container → ถูก `overflow` ของ parent ตัด
 *
 * ── วิธีแก้ ───────────────────────────────────────────────────────────────────
 * ย้ายเมนูไปอยู่ใน Portal (document.body) และใช้ `position: fixed`
 * → ไม่ถูกตัดโดย parent overflow และไม่ทำให้ body มี horizontal scrollbar
 *  + จัดตำแหน่งให้ **ชิดขอบขวาของปุ่ม** (right-aligned) และ clamp เข้า viewport
 *  + ถ้าพื้นที่ด้านล่างไม่พอ → พลิกขึ้นด้านบน
 */

export interface RectLike {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

export interface ViewportLike {
  width: number;
  height: number;
}

export interface MenuPosition {
  /** position: fixed → top (px) */
  top: number;
  /** position: fixed → left (px) */
  left: number;
  /** true เมื่อพลิกขึ้นด้านบน (ไม่มีพื้นที่ด้านล่าง) */
  flipped: boolean;
  /** true เมื่อต้อง clamp ขอบซ้ายเข้า viewport */
  clamped: boolean;
}

/** ระยะขั้นต่ำระหว่างปุ่มกับเมนู (px) */
export const MENU_ANCHOR_GAP = 6;

/**
 * คำนวณตำแหน่งของเมนูแบบ right-aligned (ชิดขอบขวาของปุ่ม)
 *
 * @param anchorRect - ตำแหน่งของปุ่ม (จาก getBoundingClientRect)
 * @param menuWidth - ความกว้างที่ต้องการของเมนู (px)
 * @param menuHeight - ความสูงโดยประมาณของเมนู (px) — ใช้ตัดสินว่าจะพลิกขึ้นไหม
 * @param viewport - ขนาด viewport (px)
 * @param gap - ระยะห่างจากปุ่ม (px)
 */
export function computeMenuPosition(
  anchorRect: RectLike,
  menuWidth: number,
  menuHeight: number,
  viewport: ViewportLike,
  gap: number = MENU_ANCHOR_GAP
): MenuPosition {
  // ── right-aligned: ขอบขวาของเมนู = ขอบขวาของปุ่ม ──────────────────
  let left = anchorRect.right - menuWidth;

  // ── clamp ขอบซ้ายเข้า viewport (ไม่ให้ล้นซ้าย) ───────────────────────
  let clamped = false;
  if (left < 8) {
    left = 8;
    clamped = true;
  }
  // ขอบขวาต้องไม่เกิน viewport - 8px
  if (left + menuWidth > viewport.width - 8) {
    left = Math.max(8, viewport.width - 8 - menuWidth);
    clamped = true;
  }

  // ── เลือกด้านวาง: ล่างก่อน ถ้าไม่พอ → พลิกขึ้นบน ─────────────────────
  const spaceBelow = viewport.height - anchorRect.bottom - gap;
  const spaceAbove = anchorRect.top - gap;
  const flipped = menuHeight > spaceBelow && spaceAbove > spaceBelow;

  const top = flipped
    ? Math.max(8, anchorRect.top - gap - menuHeight)
    : anchorRect.bottom + gap;

  return { top, left, flipped, clamped };
}
