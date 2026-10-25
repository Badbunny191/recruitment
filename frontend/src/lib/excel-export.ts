/**
 * Excel Export helpers (frontend)
 * ============================================================================
 * ใช้ร่วมกันทั้ง Export ตามตัวกรอง (GET) และ Export ที่เลือก (POST):
 *   - parseContentDispositionFilename: ถอดชื่อไฟล์จาก header Content-Disposition
 *     ที่ backend สร้าง (filename= เป็น ASCII fallback, filename*=UTF-8''...
 *     เป็นชื่อจริงภาษาไทยตาม RFC 5987)
 *   - Selection helpers: พฤติกรรม "เลือกทั้งหมด" ของ Header Checkbox ทำงานกับ
 *     ผลลัพธ์ตามตัวกรองปัจจุบัน "ทุกหน้า" (filtered result ก่อน pagination)
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

// ── Selection helpers (scope = ผลลัพธ์ตามตัวกรองทั้งหมด ทุกหน้า) ───────────────
// allFilteredIds คือ collection หลังใช้ Recruitment Round + Search + View/Status
// filter และเรียงลำดับแล้ว "ก่อนทำ pagination" (sortedApps ใน ApplicationsClient)

/** ผลลัพธ์ตามตัวกรองทั้งหมดถูกเลือกครบทุก ID หรือยัง (header checkbox checked) */
export function areAllFilteredSelected(allFilteredIds: string[], selectedIds: Set<string>): boolean {
  return allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.has(id));
}

/** มีบาง ID ในผลลัพธ์ตามตัวกรองถูกเลือกแต่ยังไม่ครบทั้งหมด (indeterminate) */
export function isFilteredPartiallySelected(allFilteredIds: string[], selectedIds: Set<string>): boolean {
  return allFilteredIds.some((id) => selectedIds.has(id)) && !areAllFilteredSelected(allFilteredIds, selectedIds);
}

/**
 * สลับ "เลือกทั้งหมดตามตัวกรอง":
 *   - ยังไม่ครบ → เพิ่มทุก ID ของ filtered result เข้า selection
 *     (selection อื่นที่มีอยู่คงเดิม — ปกติไม่มี เพราะ filter เปลี่ยนจะล้าง selection)
 *   - ครบแล้ว → ลบทุก ID ของ filtered result ออก
 * คืน Set ใหม่ ไม่แก้ของเดิม และไม่มีทางมี ID ซ้ำ (เป็น Set)
 */
export function toggleAllFilteredSelection(allFilteredIds: string[], selectedIds: Set<string>): Set<string> {
  const next = new Set(selectedIds);
  if (areAllFilteredSelected(allFilteredIds, selectedIds)) {
    allFilteredIds.forEach((id) => next.delete(id));
  } else {
    allFilteredIds.forEach((id) => next.add(id));
  }
  return next;
}
