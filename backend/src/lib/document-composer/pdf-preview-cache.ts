/**
 * PDF Preview Cache — in-isolate LRU สำหรับ endpoint descriptor/pdf-preview
 * ----------------------------------------------------------------------------
 *
 * ทำไมต้องมี (Error 1102 / HTTP 503 ตอนแก้ Field ใน Composer):
 *   PDF preview หนึ่งครั้งใช้ CPU หลักสิบ ms ขึ้นไป (embed font ไทย 2 ตัว +
 *   doc.save ทุกครั้งต่อ PDFDocument ใหม่) และฝั่ง Frontend ยิง render ซ้ำ
 *   ง่ายมาก — retry หลัง transient error, PreviewPanel + PreviewModal
 *   mounted พร้อมกัน, หรือ preview descriptor เดิมซ้ำ ๆ — ทั้งหมดนี้ได้ผล
 *   เหมือนกันเป๊ะแต่จ่าย CPU เต็ม ๆ ทุก request จน isolate เกิน resource limit
 *
 * หลักการ:
 *   - key = เนื้อหา descriptor (JSON) + applicationId → เป็น cache by content:
 *     descriptor เปลี่ยนแม้แต่ตัวอักษรเดียว = key เปลี่ยน = render ใหม่เสมอ
 *     จึงไม่มี "invalidation" ที่ต้องจัดการ (ต่างจาก R2 PDF cache ของ
 *     ใบสมัคร — ระบบนั้นไม่เกี่ยวกับไฟล์นี้)
 *   - TTL สั้น (60s) เพราะ token {PRINT_DATE} ผูกกับเวลาจริง —
 *     preview อายุ ≤60 วินาทีถือวี่ยอมรับได้
 *   - LRU จำกัดจำนวน entry + ขนาด เพื่อไม่ให้ memory ของ isolate โต
 *   - อยู่ใน module scope = อายุเท่ากับ isolate (เหมือน font bytes cache)
 */

interface CacheEntry {
  bytes: Uint8Array;
  pageCount: number;
  storedAt: number;
}

const MAX_ENTRIES = 6;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024; // 2 MB
const TTL_MS = 60_000;

const store = new Map<string, CacheEntry>(); // Map iteration = insertion order → LRU by re-insert
let totalBytes = 0;

/**
 * สร้าง cache key จากเนื้อหาที่มีผลต่อผลลัพธ์ PDF ทั้งหมด
 * (descriptor + แหล่งข้อมูล) — ไม่มี PII ในตัว key เอง
 * (descriptor มีแต่ block config + fieldId)
 */
export function makePreviewCacheKey(
  descriptor: unknown,
  applicationId: string | undefined
): string {
  return `${applicationId ?? "sample"}|${JSON.stringify(descriptor)}`;
}

export function getCachedPreview(key: string): CacheEntry | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() - hit.storedAt > TTL_MS) {
    store.delete(key);
    totalBytes -= hit.bytes.byteLength;
    return null;
  }
  // refresh LRU position
  store.delete(key);
  store.set(key, hit);
  return hit;
}

export function setCachedPreview(
  key: string,
  bytes: Uint8Array,
  pageCount: number
): void {
  // entry เดิม (key ซ้ำ) → ถอดก่อนเพื่อเลิกนับ bytes
  const old = store.get(key);
  if (old) {
    store.delete(key);
    totalBytes -= old.bytes.byteLength;
  }
  store.set(key, { bytes, pageCount, storedAt: Date.now() });
  totalBytes += bytes.byteLength;
  evictIfNeeded();
}

function evictIfNeeded(): void {
  // เกินโควต้า → ทิ้งจากตัวเก่าที่สุดก่อน (Map insertion order)
  while (store.size > MAX_ENTRIES || totalBytes > MAX_TOTAL_BYTES) {
    const oldest = store.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const entry = store.get(oldest);
    store.delete(oldest);
    if (entry) totalBytes -= entry.bytes.byteLength;
  }
}

/** ล้างทั้งหมด (ใช้ใน test) */
export function resetPreviewCache(): void {
  store.clear();
  totalBytes = 0;
}

/** สถิติสำหรับ instrumentation (ไม่มีเนื้อหา) */
export function previewCacheStats(): { entries: number; totalBytes: number } {
  return { entries: store.size, totalBytes };
}
