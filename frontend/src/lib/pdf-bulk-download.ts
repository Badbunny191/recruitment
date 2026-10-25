/**
 * Bulk PDF download (Browser ZIP) — Phase 1
 * ============================================================================
 * สถาปัตยกรรมที่อนุมัติ (2026-10-25): วนเรียก endpoint เดิม
 * GET /admin/applications/:id/pdf ทีละใบ (Concurrency = 2) แล้วรวมเป็น ZIP
 * ฝั่งเบราว์เซอร์ — backend ไม่ถูกแตะแม้แต่บรรทัดเดียว
 *
 * นโยบายที่ยึดตามผลวิเคราะห์:
 *   - Backend เป็น Source of Truth ของชื่อไฟล์ทุกใบ (อ่านจาก Content-Disposition
 *     ด้วย parseContentDispositionFilename เดิมจาก pdf-download.ts)
 *     fallback ต่อใบ = `${applicationNo || id}.pdf` เหมือนดาวน์โหลดรายคน
 *     (ApplicationDetailClient.tsx handleDownloadPdf)
 *   - Concurrency = 2 ห้ามเพิ่ม (เพดานที่ production พิสูจน์แล้ว — วิเคราะห์ 2026-10-25)
 *   - Streaming ZIP (fflate Zip) — ได้ไฟล์ใบละชิ้นเข้า ZIP แล้วปล่อยทันที
 *     ห้ามถือ blob ทุกใบแล้ว zip รวดเดียว (STORE mode — PDF ถูก compress อยู่แล้ว
 *     การ deflate ซ้ำได้แค่ 1-2% แต่จ่าย CPU เบราว์เซอร์เต็ม ๆ โดยไม่จำเป็น)
 *   - เขียนลง ZIP ตามลำดับ input เสมอ (in-order writer) → ลำดับ entry และ
 *     การเติม suffix ชื่อซ้ำ deterministic ทุกครั้ง แม้ response กลับไม่ตามลำดับ
 *   - Partial failure: ไฟล์ใดล้ม (404/403/5xx/header เสีย) → ข้าม ทำต่อ แล้วสรุปผล
 *   - Cap 100 รายการต่อครั้ง (resolveBulkTarget reject ก่อนเริ่ม)
 *   - ชื่อ ZIP = ใบสมัคร_{roundCode}_{YYYYMMDD-HHmmss}.zip — รับเฉพาะ roundCode
 *     จาก backend ไม่มีทางมี fullname/email/phone/nationalId ได้เลยตาม type
 */

import { Zip, ZipPassThrough } from 'fflate';
import { parseContentDispositionFilename } from './pdf-download';

/** เพดานจำนวน PDF ต่อการดาวน์โหลดหนึ่งครั้ง (ตามข้อกำหนดที่อนุมัติ) */
export const BULK_PDF_LIMIT = 100;

/** จำนวน request พร้อมกันสูงสุด — ห้ามแก้เป็น 3/5/10 โดยไม่ผ่านการวิเคราะห์ใหม่ */
export const BULK_PDF_CONCURRENCY = 2;

/** ขนาดโดยประมาณต่อใบ (ไบต์) — ใช้แสดงใน dialog ก่อนยืนยันเท่านั้น */
export const BULK_PDF_EST_BYTES_PER_FILE = 200_000;

/** เกณฑ์ "ใกล้ Limit" สำหรับคำเตือนใน dialog */
export const BULK_PDF_NEAR_LIMIT = 80;

// ── Target / Resolve ────────────────────────────────────────────────────────

export interface PdfBulkTarget {
  id: string;
  /** เลขที่ใบสมัคร — ใช้เป็น fallback ชื่อไฟล์ให้ตรงกับดาวน์โหลดรายคน */
  applicationNo?: string | null;
}

export type BulkDownloadMode = 'selected' | 'filtered';

export type ResolveBulkTargetResult =
  | { ok: true; targets: PdfBulkTarget[] }
  | { ok: false; reason: 'empty' | 'over-limit' | 'none-selected'; count: number };

/**
 * ตัดสินรายการปลายทางของแต่ละโหมด:
 *   - selected = เฉพาะ ID ที่เลือก (คงลำดับเดิมของรายการบนจอ)
 *   - filtered = ทุกรายการที่ตรงตัวกรองปัจจุบัน (ทุกหน้า)
 * เกิน BULK_PDF_LIMIT → ok: false (UI ต้องแจ้งและไม่เริ่มดาวน์โหลด)
 */
export function resolveBulkTarget(
  mode: BulkDownloadMode,
  allTargets: PdfBulkTarget[],
  selectedIds: Set<string>,
): ResolveBulkTargetResult {
  if (mode === 'selected' && selectedIds.size === 0) {
    return { ok: false, reason: 'none-selected', count: 0 };
  }
  const targets =
    mode === 'selected'
      ? allTargets.filter((t) => selectedIds.has(t.id))
      : allTargets;
  if (targets.length === 0) {
    return { ok: false, reason: 'empty', count: 0 };
  }
  if (targets.length > BULK_PDF_LIMIT) {
    return { ok: false, reason: 'over-limit', count: targets.length };
  }
  return { ok: true, targets };
}

// ── ชื่อไฟล์ ────────────────────────────────────────────────────────────────

/** อักขระต้องห้ามในชื่อไฟล์ (Windows reserved + path separator) */
const ZIP_NAME_FORBIDDEN_RE = /[/\\:*?"<>|]/g;
const ZIP_NAME_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** ประทับเวลาท้องถิ่น YYYYMMDD-HHmmss (แอดมินใช้เครื่องเวลาไทย) */
function localStamp(now: Date): string {
  return (
    `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}` +
    `-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  );
}

/**
 * ชื่อ ZIP: ใบสมัคร_{roundCode}_{YYYYMMDD-HHmmss}.zip
 * roundCode มาจาก backend (recruitment_rounds.round_code) เท่านั้น —
 * sanitize เชิงป้องกันอีกชั้น (ตัด path separator / control char / ..)
 * ว่าง → fallback "รอบรับสมัคร" (จิตวิญญาณเดียวกับ buildExportFilename ฝั่ง backend)
 */
export function buildBulkZipFilename(
  roundCode: string | null | undefined,
  now: Date = new Date(),
): string {
  let code = String(roundCode ?? '')
    .replace(ZIP_NAME_CONTROL_RE, ' ')
    .replace(ZIP_NAME_FORBIDDEN_RE, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
  if (!code || code === '.' || code === '..') code = 'รอบรับสมัคร';
  const chars = Array.from(code);
  if (chars.length > 40) code = chars.slice(0, 40).join('').trim() || 'รอบรับสมัคร';
  return `ใบสมัคร_${code}_${localStamp(now)}.zip`;
}

/**
 * กันชื่อไฟล์ซ้ำใน ZIP แบบ deterministic:
 *   ครั้งแรกคืนชื่อเดิม, ครั้งที่ 2 → ชื่อ_(2).pdf, ครั้งที่ 3 → ชื่อ_(3).pdf
 * (ใส่ suffix ก่อนนามสกุลเสมอ — ตามตัวอย่างข้อกำหนด)
 */
export function nextUniqueFilename(usedCounts: Map<string, number>, filename: string): string {
  const seen = usedCounts.get(filename);
  if (seen === undefined) {
    usedCounts.set(filename, 1);
    return filename;
  }
  const next = seen + 1;
  usedCounts.set(filename, next);
  const dot = filename.toLowerCase().lastIndexOf('.pdf');
  if (dot === -1) return `${filename}_(${next})`;
  return `${filename.slice(0, dot)}_(${next})${filename.slice(dot)}`;
}

// ── Runner ──────────────────────────────────────────────────────────────────

export interface BulkDownloadFailure {
  id: string;
  applicationNo?: string | null;
  /** HTTP status, หรือ `${Error.name}: ${Error.message}` จาก network layer
   *  (เช่น "TypeError: Load failed" = connection ถูกตัดก่อนได้ response) */
  status: number | string;
  /** รายละเอียดจาก err.cause (ถ้าเบราว์เซอร์ให้มา) — ตัวสาเหตุ network ที่แท้จริง */
  cause?: string;
  /** header X-Cache จาก backend (HIT|MISS) ถ้าได้ response header มา */
  cache?: string;
  /** ระยะเวลา request นี้ (ms) ก่อนสำเร็จหรือล้ม */
  durationMs?: number;
}

export interface BulkDownloadProgress {
  done: number;
  total: number;
  failed: number;
}

export interface BulkDownloadResult {
  status: 'completed' | 'canceled';
  successCount: number;
  failedCount: number;
  failures: BulkDownloadFailure[];
  /** null เมื่อยกเลิก */
  zip: Blob | null;
  zipFilename: string;
  /** diagnostics: นับ X-Cache ของใบที่สำเร็จ — ใช้เทียบ HIT/MISS กับใบที่ล้ม */
  cacheStats: { hit: number; miss: number; unknown: number };
}

export type FetchPdf = (target: PdfBulkTarget, signal: AbortSignal) => Promise<Response>;

interface EntryResult {
  ok: boolean;
  failure?: BulkDownloadFailure;
  filename?: string;
  bytes?: Uint8Array;
}

/** ชื่อจาก header ต้องเป็นไฟล์รากเดียวเท่านั้น (defensive ZIP-Slip) */
function isUnsafeZipEntryName(name: string): boolean {
  if (!name || name === '.' || name === '..') return true;
  return /[/\\]/.test(name);
}

/** ถอดสาเหตุจาก err.cause (Chromium ฝัง network error ตัวจริงไว้ตรงนี้) */
function describeErrorCause(err: unknown): string | undefined {
  const seen: string[] = [];
  let node: unknown = err;
  // ไล่ห่วง cause ลึกสูงสุด 2 ชั้น กัน chain ยาวแปลก ๆ
  for (let depth = 0; depth < 2 && node && typeof node === 'object'; depth++) {
    const cause = (node as { cause?: unknown }).cause;
    if (cause === undefined || cause === null) break;
    if (cause instanceof Error) {
      seen.push(`${cause.name}: ${cause.message}`);
      node = cause;
    } else if (typeof cause === 'string') {
      seen.push(cause);
      break;
    } else {
      break;
    }
  }
  return seen.length > 0 ? seen.join(' ← ') : undefined;
}

/**
 * ดาวน์โหลด PDF ทีละกลุ่ม (Concurrency = 2) แล้วรวมเป็น ZIP แบบ streaming
 *
 * การไหลของงาน:
 *   - 2 worker ดึงงานจาก cursor ร่วม → fetch → อ่าน bytes → ปล่อย response
 *   - ผลลัพธ์เข้าคิวตาม index แล้ว "ไรเตอร์" เขียนลง ZIP เรียงตามลำดับ input
 *     (ชื่อซ้ำจึงถูก suffix ตามลำดับที่แน่นอน ไม่ขึ้นกับลำดับ response)
 *   - ไฟล์ใดล้ม → บันทึก failure แล้วทำใบถัดไปต่อ (ห้ามล้มทั้งงาน)
 *   - signal ถูก abort → หยุดทันที คืน status 'canceled' (ไม่มี ZIP)
 */
export async function bulkDownloadPdfs(options: {
  targets: PdfBulkTarget[];
  fetchPdf: FetchPdf;
  zipFilename: string;
  onProgress?: (progress: BulkDownloadProgress) => void;
  signal?: AbortSignal;
}): Promise<BulkDownloadResult> {
  const { targets, fetchPdf, zipFilename, onProgress, signal } = options;
  const total = targets.length;

  const failures: BulkDownloadFailure[] = [];
  const usedCounts = new Map<string, number>();
  const entryOrder: string[] = [];
  let successCount = 0;
  let doneCount = 0;
  let canceled = false;
  // diagnostics — นับ X-Cache ของใบที่สำเร็จ เพื่อเทียบ HIT/MISS กับรายการที่ล้ม
  const cacheStats = { hit: 0, miss: 0, unknown: 0 };

  // Streaming ZIP — STORE mode ต่อไฟล์ (ZipPassThrough): PDF ถูก compress
  // อยู่แล้ว การ deflate ซ้ำไม่คุ้ม CPU; ไฟล์แต่ละใบเขียนเป็น stream แล้วปล่อย
  const zipChunks: Uint8Array[] = [];
  const zip = new Zip();
  let zipDoneResolve!: () => void;
  const zipDone = new Promise<void>((resolve) => {
    zipDoneResolve = resolve;
  });
  zip.ondata = (err, data, final) => {
    if (err) throw err;
    if (data) zipChunks.push(data);
    if (final) zipDoneResolve();
  };

  const reportProgress = () => {
    onProgress?.({ done: doneCount, total, failed: failures.length });
  };

  // เขียนลง ZIP เรียงตามลำดับ index — เรียกเมื่อผลของ index ถัดไปพร้อม
  const pendingResults: (EntryResult | undefined)[] = new Array(total);
  let writeIndex = 0;
  const flushReadyResults = () => {
    while (writeIndex < total && pendingResults[writeIndex] !== undefined) {
      const result = pendingResults[writeIndex]!;
      pendingResults[writeIndex] = undefined;
      const target = targets[writeIndex];
      if (result.ok && result.filename && result.bytes) {
        const uniqueName = nextUniqueFilename(usedCounts, result.filename);
        entryOrder.push(uniqueName);
        // fflate 0.8.3 API: add() รับ stream (ZipPassThrough = STORE) แล้ว
        // push ข้อมูลเข้า stream — add ก่อน push เสมอ
        const file = new ZipPassThrough(uniqueName);
        zip.add(file);
        file.push(result.bytes, true);
        successCount += 1;
      } else if (result.failure) {
        failures.push(result.failure);
      }
      doneCount += 1;
      writeIndex += 1;
    }
    reportProgress();
  };

  const readOne = async (index: number): Promise<void> => {
    const target = targets[index];
    const startedAt = performance.now();
    const describeFailure = (
      status: number | string,
      extra?: Pick<BulkDownloadFailure, 'cause' | 'cache'>,
    ): BulkDownloadFailure => ({
      id: target.id,
      applicationNo: target.applicationNo,
      status,
      durationMs: Math.round(performance.now() - startedAt),
      ...extra,
    });
    try {
      const res = await fetchPdf(target, signal ?? new AbortController().signal);
      if (!res.ok) {
        // ปล่อย body ทิ้งเพื่อไม่ค้าง socket ของเบราว์เซอร์
        res.body?.cancel().catch(() => {});
        const cache = res.headers.get('X-Cache') || undefined;
        console.warn(
          `[BulkPDF] HTTP ${res.status}${cache ? ` (X-Cache: ${cache})` : ''} — ${target.applicationNo || target.id} ` +
            `(${Math.round(performance.now() - startedAt)}ms)`,
        );
        pendingResults[index] = { ok: false, failure: describeFailure(res.status, { cache }) };
        return;
      }
      const buffer = await res.arrayBuffer();
      const cache = res.headers.get('X-Cache') || undefined;
      if (cache === 'HIT') cacheStats.hit += 1;
      else if (cache === 'MISS') cacheStats.miss += 1;
      else cacheStats.unknown += 1;
      const disposition = res.headers.get('Content-Disposition') || '';
      // Backend เป็น Source of Truth — อ่านจาก header เดิมทุกประการ
      const filename =
        parseContentDispositionFilename(disposition) ||
        `${target.applicationNo || target.id}.pdf`;
      if (isUnsafeZipEntryName(filename)) {
        pendingResults[index] = { ok: false, failure: describeFailure('invalid-filename') };
        return;
      }
      pendingResults[index] = { ok: true, filename, bytes: new Uint8Array(buffer) };
    } catch (err) {
      if (signal?.aborted) {
        canceled = true;
        return;
      }
      // "Load failed" (WebKit) / "Failed to fetch" (Chromium) = network-level
      // failure — รายละเอียดตัวจริงอยู่ใน err.cause จึงต้องเก็บแยกไว้วินิจฉัย
      const status = err instanceof Error ? `${err.name}: ${err.message}` : 'network-error';
      const cause = describeErrorCause(err);
      console.error(
        `[BulkPDF] request failed — ${target.applicationNo || target.id} ` +
          `(${Math.round(performance.now() - startedAt)}ms) ${status}` +
          (cause ? ` | cause: ${cause}` : ''),
        err,
      );
      pendingResults[index] = { ok: false, failure: describeFailure(status, { cause }) };
    }
  };

  // Worker pool — cursor ร่วม, ความกว้าง = BULK_PDF_CONCURRENCY (2) ห้ามแก้
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (!canceled && !(signal?.aborted ?? false)) {
      const index = cursor;
      if (index >= total) return;
      cursor += 1;
      await readOne(index);
      flushReadyResults();
      if (canceled || (signal?.aborted ?? false)) return;
    }
  };
  await Promise.all([worker(), worker()]);

  if (canceled || (signal?.aborted ?? false)) {
    // ปิด stream แล้วทิ้ง output — งานที่เหลือไม่ทำ, ผู้ใช้เห็นสรุปก่อนยกเลิก
    canceled = true;
    zip.end();
    await zipDone.catch(() => {});
    return {
      status: 'canceled',
      successCount,
      failedCount: failures.length,
      failures,
      zip: null,
      zipFilename,
      cacheStats,
    };
  }

  // กรณีทุกใบล้มเหลว → ไม่มีอะไรจะรวม — คืนผลล้มเหลวโดยไม่สร้าง ZIP ว่าง
  if (successCount === 0) {
    zip.end();
    await zipDone.catch(() => {});
    return {
      status: 'completed',
      successCount: 0,
      failedCount: failures.length,
      failures,
      zip: null,
      zipFilename,
      cacheStats,
    };
  }

  flushReadyResults();
  zip.end();
  await zipDone;
  // จุดนี้ entryOrder ต้องยาวเท่า successCount เสมอ (in-order writer)
  const zipBlob = new Blob(zipChunks as BlobPart[], { type: 'application/zip' });
  console.info(
    `[BulkPDF] completed — ${successCount}/${total} success, ${failures.length} failed, ` +
      `X-Cache HIT=${cacheStats.hit} MISS=${cacheStats.miss} unknown=${cacheStats.unknown}`,
  );
  return {
    status: 'completed',
    successCount,
    failedCount: failures.length,
    failures,
    zip: zipBlob,
    zipFilename,
    cacheStats,
  };
}

/** ขนาดโดยประมาณ (ข้อความ) สำหรับ dialog ก่อนยืนยัน — ใช้ฐาน 10 ตรงกับ ~200KB ต่อใบ */
export function formatBulkEstimate(count: number): string {
  const bytes = count * BULK_PDF_EST_BYTES_PER_FILE;
  if (bytes >= 1_000_000) {
    return `~${Math.round(bytes / 1_000_000)} MB`;
  }
  return `~${Math.max(1, Math.round(bytes / 1000))} KB`;
}
