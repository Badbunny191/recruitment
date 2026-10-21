'use client';

/**
 * useAvailableHeight
 * -----------------------------------------------------------------
 * Document Composer — ความสูงพื้นที่ทำงานที่เหลือจาก viewport
 *
 * ทำไมต้องวัดเอง?
 *   - Header ของ AdminNavbar เป็น `sticky` (สูง h-14) → offset ขึ้นกับ layout
 *   - หน้า Composer มี header + alert ของตัวเองอีกชั้น
 *   - การ hard-code `calc(100vh - 64px)` เปราะเกินไป (พังทันทีที่ header เปลี่ยน)
 *
 * วิธีนี้จึงวัด `getBoundingClientRect().top` ของ container จริง แล้วเอา
 * `viewportHeight - top - bottomPadding` → ไม่มี magic number ใด ๆ
 *
 * bottomPadding มาจาก page container จริง (ปกติคือ `p-4 md:p-6`)
 * → หาโดยเดินขึ้น ancestor ที่มี padding-bottom (จำกัดจำนวนชั้น)
 *
 * คืนค่า:
 *   - `ref`  → ติดกับ element ที่ต้องการวัด
 *   - `height` → ค่าสูงที่ใช้ตั้ง style (px) หรือ undefined ระหว่างยังไม่ได้วัด
 */

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

export interface UseAvailableHeightResult {
  ref: MutableRefObject<HTMLDivElement | null>;
  /** ความสูงที่เหลือ (px) — undefined ก่อน mount/วัด */
  height: number | undefined;
  /** ความสูงขั้นต่ำ (px) เพื่อไม่ให้พื้นที่ทำงานหายไปบนจอเล็กมาก */
  minHeight: number;
}

const DEFAULT_MIN_HEIGHT = 320;
/** จำนวนชั้น ancestor ที่จะไล่หา padding-bottom ของ page container */
const MAX_ANCESTOR_DEPTH = 6;

export function useAvailableHeight(
  minHeight: number = DEFAULT_MIN_HEIGHT,
  /** dependency เพิ่มเติม — ใช้วัดใหม่เมื่อโครงสร้างเปลี่ยน (เช่น สลับโหมด) */
  deps: unknown[] = []
): UseAvailableHeightResult {
  const ref = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);
  /**
   * รวม deps เป็นค่าเดียว (string) เพื่อไม่ให้ React เตือนเรื่อง
   * "dependency array มีขนาดเปลี่ยน" เมื่อผู้เรียกส่ง array คนละจำนวน
   */
  const depsKey = deps.map((d) => String(d)).join('|');

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    // ความสูง viewport ที่ใช้ได้จริง (หัก scrollbar แนวนอนของ document)
    const viewportHeight =
      document.documentElement.clientHeight || window.innerHeight;

    const bottomPadding = findBottomPadding(el);
    const available = viewportHeight - rect.top - bottomPadding;

    setHeight(Math.max(minHeight, Math.floor(available)));
  }, [minHeight]);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    if (typeof ResizeObserver !== 'undefined' && ref.current) {
      const observer = new ResizeObserver(() => measure());
      observer.observe(ref.current);
      return () => {
        observer.disconnect();
        window.removeEventListener('resize', measure);
      };
    }
    return () => window.removeEventListener('resize', measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, depsKey]);

  return { ref, height, minHeight };
}

/**
 * หา padding-bottom ของ page container (ancestor ที่ใกล้ที่สุดที่มี padding)
 * → คืน 0 ถ้าหาไม่เจอ (ไม่ throw)
 */
function findBottomPadding(element: HTMLElement): number {
  try {
    let current: HTMLElement | null = element.parentElement;
    let depth = 0;
    while (current && depth < MAX_ANCESTOR_DEPTH) {
      const style = window.getComputedStyle(current);
      const paddingBottom = parseFloat(style.paddingBottom);
      if (Number.isFinite(paddingBottom) && paddingBottom > 0) {
        return paddingBottom;
      }
      current = current.parentElement;
      depth += 1;
    }
  } catch {
    return 0;
  }
  return 0;
}
