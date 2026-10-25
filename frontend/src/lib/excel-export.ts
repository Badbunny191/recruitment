/**
 * Excel Export helpers (frontend)
 * ============================================================================
 * ใช้ร่วมกันทั้ง Export ตามตัวกรอง (GET) และ Export ที่เลือก (POST):
 *   - parseContentDispositionFilename: ถอดชื่อไฟล์จาก header Content-Disposition
 *     ที่ backend สร้าง (filename= เป็น ASCII fallback, filename*=UTF-8''...
 *     เป็นชื่อจริงภาษาไทยตาม RFC 5987)
 *   - Selection helpers: พฤติกรรม checkbox ระดับหน้าปัจจุบัน (select all page)
 *     โดย selection เก็บเป็น Set ของ ID — อยู่ข้ามหน้า (pagination) ได้
 */

/** fallback เมื่อ header ไม่มีชื่อที่ใช้ได้ (backend สร้างชื่อให้เสมอในทางปกติ) */
export const DEFAULT_EXPORT_FILENAME = 'ใบสมัคร.xlsx';

/** ตัดอักขระที่หลุดเข้ามาในชื่อไฟล์ไม่ได้ (กัน CR/LF header injection + quote) */
function stripHeaderUnsafe(name: string): string {
  return name.replace(/[\r\n"\\]/g, '').trim();
}

/**
 * ถอดชื่อไฟล์จาก Content-Disposition:
 *   1. filename*=UTF-8''... (ชื่อจริง Unicode) → decodeURIComponent
 *   2. filename="..." / filename=... (ASCII fallback)
 *   3. ไม่มี / decode พัง → null (caller ใช้ DEFAULT_EXPORT_FILENAME)
 */
export function parseContentDispositionFilename(disposition: string): string | null {
  if (!disposition) return null;

  const star = disposition.match(/filename\*\s*=\s*(?:utf-8|UTF-8)''([^;]*)/);
  if (star?.[1]) {
    try {
      const decoded = stripHeaderUnsafe(decodeURIComponent(star[1].trim()));
      if (decoded) return decoded;
    } catch {
      // percent encoding เสีย → ไป fallback ที่ filename=
    }
  }

  const plain = disposition.match(/filename\s*=\s*(?:"([^"]*)"|([^;]+))/i);
  const raw = (plain?.[1] ?? plain?.[2] ?? '').trim();
  return stripHeaderUnsafe(raw) || null;
}

/** หน้าปัจจุบันถูกเลือกครบทุกแถวหรือไม่ (header checkbox checked) */
export function areAllPageSelected(pageIds: string[], selectedIds: Set<string>): boolean {
  return pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
}

/** หน้าปัจจุบันเลือกบางส่วน (header checkbox indeterminate) */
export function isPagePartiallySelected(pageIds: string[], selectedIds: Set<string>): boolean {
  return pageIds.some((id) => selectedIds.has(id)) && !areAllPageSelected(pageIds, selectedIds);
}

/**
 * สลับ "เลือกทั้งหมดในหน้าปัจจุบัน":
 *   - ครบอยู่แล้ว → ถอดเฉพาะ ID ในหน้านี้ (ID หน้าอื่นที่เลือกไว้คงเดิม)
 *   - ยังไม่ครบ → เพิ่ม ID ทั้งหน้านี้เข้า selection
 * คืน Set ใหม่ ไม่แก้ของเดิม
 */
export function togglePageSelection(pageIds: string[], selectedIds: Set<string>): Set<string> {
  const next = new Set(selectedIds);
  if (areAllPageSelected(pageIds, selectedIds)) {
    pageIds.forEach((id) => next.delete(id));
  } else {
    pageIds.forEach((id) => next.add(id));
  }
  return next;
}
