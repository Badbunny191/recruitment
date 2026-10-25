/**
 * Bulk PDF download (Browser ZIP) tests — Phase 1
 * ============================================================================
 * Run: node --import tsx src/lib/__tests__/pdf-bulk-download.test.ts
 *
 * ครอบคลุม:
 *   - buildBulkZipFilename: รูปแบบ ใบสมัคร_{roundCode}_{YYYYMMDD-HHmmss}.zip
 *     + sanitize + fallback (ห้ามมี PII — รับเฉพาะ roundCode)
 *   - nextUniqueFilename: suffix _(2) / _(3) แบบ deterministic
 *   - resolveBulkTarget: โหมด selected/filtered + เพดาน 100
 *   - bulkDownloadPdfs: partial failure (404 ข้าม), dedupe ใน ZIP, in-order
 *     mapping (response กลับก่อนหลังไม่ทำให้ไฟล์สลับกัน), fallback ชื่อไฟล์,
 *     ยกเลิก, ล้มทั้งชุด
 *
 * ชื่อไฟล์ต่อใบต้องตรงกับที่ backend ส่งมาใน Content-Disposition เสมอ
 * (header mock จำลองรูปแบบจริงจาก buildPdfContentDisposition ฝั่ง backend)
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing

import { unzipSync } from 'fflate';
import {
  BULK_PDF_CONCURRENCY,
  BULK_PDF_LIMIT,
  buildBulkZipFilename,
  nextUniqueFilename,
  resolveBulkTarget,
  bulkDownloadPdfs,
  formatBulkEstimate,
} from '../pdf-bulk-download';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`✗ ${name}: ${e?.message ?? e}`);
  }
}
async function testA(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`✗ ${name}: ${e?.message ?? e}`);
  }
}
function assertEqual(actual: any, expected: any, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assertTrue(cond: any, msg = '') { if (!cond) throw new Error(msg || 'Expected true'); }
function assertFalse(cond: any, msg = '') { assertTrue(!cond, msg || 'Expected false'); }

// header mock — รูปแบบเดียวกับ buildPdfContentDisposition ฝั่ง backend
function dispositionHeader(thaiName: string): string {
  return `attachment; filename="application-x.pdf"; filename*=UTF-8''${encodeURIComponent(thaiName)}`;
}
function okRes(bytes: Uint8Array, thaiName: string, cache: 'HIT' | 'MISS' = 'MISS') {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (key: string) =>
        key.toLowerCase() === 'content-disposition'
          ? dispositionHeader(thaiName)
          : key.toLowerCase() === 'x-cache'
            ? cache
            : null,
    },
    arrayBuffer: async () => bytes.slice().buffer,
    body: null,
  };
}
function errRes(status: number) {
  return { ok: false, status, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0), body: null };
}

// ═══════════════ buildBulkZipFilename ═══════════════

test('ZIP1: รูปแบบ ใบสมัคร_{roundCode}_{YYYYMMDD-HHmmss}.zip', () => {
  const name = buildBulkZipFilename('TST01', new Date(2026, 9, 25, 14, 5, 9));
  assertEqual(name, 'ใบสมัคร_TST01_20261025-140509.zip');
});

test('ZIP2: sanitize อักขระต้องห้ามใน roundCode (path separator ฯลฯ)', () => {
  const name = buildBulkZipFilename('../evil/..\\a:b', new Date(2026, 0, 2, 3, 4, 5));
  assertFalse(name.includes('..'), 'ห้ามมี ..');
  assertFalse(/[/\\:*?"<>|]/.test(name), 'ห้ามมีอักขระต้องห้าม');
  assertTrue(name.endsWith('.zip'));
});

test('ZIP3: roundCode ว่าง/ไม่มี → fallback รอบรับสมัคร (ไม่มี PII เข้าชื่อ ZIP เป็นไปไม่ได้เพราะรับเฉพาะ roundCode)', () => {
  assertEqual(buildBulkZipFilename(null, new Date(2026, 0, 1, 0, 0, 0)), 'ใบสมัคร_รอบรับสมัคร_20260101-000000.zip');
  assertEqual(buildBulkZipFilename('', new Date(2026, 0, 1, 0, 0, 0)), 'ใบสมัคร_รอบรับสมัคร_20260101-000000.zip');
});

// ═══════════════ nextUniqueFilename ═══════════════

test('DUP1: ชื่อแรกไม่มี suffix', () => {
  const used = new Map<string, number>();
  assertEqual(nextUniqueFilename(used, 'ใบสมัคร_APP-2026-0001.pdf'), 'ใบสมัคร_APP-2026-0001.pdf');
});

test('DUP2: ซ้ำครั้งที่ 2 → _(2), ครั้งที่ 3 → _(3) ก่อน .pdf (deterministic)', () => {
  const used = new Map<string, number>();
  nextUniqueFilename(used, 'a.pdf');
  assertEqual(nextUniqueFilename(used, 'a.pdf'), 'a_(2).pdf');
  assertEqual(nextUniqueFilename(used, 'a.pdf'), 'a_(3).pdf');
  // ผ่าน map เดิมซ้ำอีกรอบ → ได้ค่าเดิม (deterministic)
  const used2 = new Map<string, number>();
  nextUniqueFilename(used2, 'a.pdf');
  assertEqual(nextUniqueFilename(used2, 'a.pdf'), 'a_(2).pdf');
});

// ═══════════════ resolveBulkTarget ═══════════════

const targets = Array.from({ length: BULK_PDF_LIMIT + 10 }, (_, i) => ({
  id: `id-${i + 1}`,
  applicationNo: `APP-2026-${String(i + 1).padStart(4, '0')}`,
}));

test('SEL1: โหมด selected = เฉพาะที่เลือก คงลำดับรายการบนจอ', () => {
  const sel = new Set(['id-3', 'id-1']);
  const r = resolveBulkTarget('selected', targets, sel);
  assertTrue(r.ok);
  assertEqual(r.targets.map((t) => t.id).join(','), 'id-1,id-3');
});

test('SEL2: ไม่ได้เลือกอะไร → reject ก่อนเริ่ม', () => {
  const r = resolveBulkTarget('selected', targets, new Set());
  assertFalse(r.ok);
  assertEqual((r as any).reason, 'none-selected');
});

test('SEL3: เกิน 100 → over-limit (UI ต้องแจ้งและไม่เริ่ม)', () => {
  const r = resolveBulkTarget('filtered', targets, new Set());
  assertFalse(r.ok);
  assertEqual((r as any).reason, 'over-limit');
  assertEqual((r as any).count, BULK_PDF_LIMIT + 10);
});

test('SEL4: โหมด filtered ต่ำกว่าเพดาน → ได้ครบ', () => {
  const r = resolveBulkTarget('filtered', targets.slice(0, 50), new Set());
  assertTrue(r.ok);
  assertEqual(r.targets.length, 50);
});

test('LIM: ค่าคงที่ตามข้อกำหนด — limit 100, concurrency 2 ห้ามเปลี่ยน', () => {
  assertEqual(BULK_PDF_LIMIT, 100);
  assertEqual(BULK_PDF_CONCURRENCY, 2);
});

// ═══════════════ bulkDownloadPdfs ═══════════════

async function runBulk(opts: {
  targets: any[];
  fetchPdf: any;
  signal?: AbortSignal;
  onProgress?: any;
}) {
  return bulkDownloadPdfs({
    targets: opts.targets,
    fetchPdf: opts.fetchPdf,
    zipFilename: 'ใบสมัคร_TST01_20261025-000000.zip',
    signal: opts.signal,
    onProgress: opts.onProgress,
  });
}

// RUN tests อยู่ใน main() เพราะ tsx/CJS ไม่รองรับ top-level await
async function main() {
await testA('RUN1: partial failure — 1 ใบ 404 ถูกข้าม ส่วนที่เหลือรวม ZIP ครบ', async () => {
  const t = [
    { id: 't1', applicationNo: 'APP-2026-0001' },
    { id: 't2', applicationNo: 'APP-2026-0002' },
    { id: 't3', applicationNo: 'APP-2026-0003' },
    { id: 't4', applicationNo: 'APP-2026-0004' },
  ];
  const bytes = (s: string) => new TextEncoder().encode(`pdf-of-${s}`);
  const fetchPdf = async (target: any) => {
    if (target.id === 't3') return errRes(404);
    return okRes(bytes(target.id), `ใบสมัคร_${target.applicationNo}.pdf`);
  };
  const result = await runBulk({ targets: t, fetchPdf });
  assertEqual(result.status, 'completed');
  assertEqual(result.successCount, 3);
  assertEqual(result.failedCount, 1);
  assertEqual(result.failures[0]?.id, 't3');
  assertEqual(result.failures[0]?.status, 404);
  assertTrue(result.zip instanceof Blob, 'ต้องได้ ZIP');
  assertTrue(result.zip!.size > 0);

  // ตรวจเนื้อหา ZIP — ชื่อจาก Content-Disposition (backend SoT) ตรงเป๊ะ
  const zipBytes = new Uint8Array(await result.zip!.arrayBuffer());
  const entries = unzipSync(zipBytes);
  assertTrue('ใบสมัคร_APP-2026-0001.pdf' in entries);
  assertTrue('ใบสมัคร_APP-2026-0002.pdf' in entries);
  assertTrue('ใบสมัคร_APP-2026-0004.pdf' in entries);
  assertFalse('ใบสมัคร_APP-2026-0003.pdf' in entries, 'ใบที่ล้มต้องไม่อยู่ใน ZIP');
  assertEqual(new TextDecoder().decode(entries['ใบสมัคร_APP-2026-0001.pdf']), 'pdf-of-t1');
});

await testA('RUN2: ชื่อซ้ำใน ZIP → _(2) ตามลำดับ input (deterministic)', async () => {
  const t = [
    { id: 't1', applicationNo: 'APP-2026-0001' },
    { id: 't2', applicationNo: 'APP-2026-0002' },
  ];
  // สองใบถูก backend ตั้งชื่อเดียวกัน (สมมุติ pattern ชน) — ทั้งที่ pattern ต้องมี
  // {applicationNo} ซึ่ง unique — เคสนี้คือ defense-in-depth ของ dedupe
  const fetchPdf = async (target: any) =>
    okRes(new TextEncoder().encode(`pdf-${target.id}`), 'ใบสมัคร_ชื่อซ้ำ.pdf');
  const result = await runBulk({ targets: t, fetchPdf });
  assertEqual(result.successCount, 2);
  const zipBytes = new Uint8Array(await result.zip!.arrayBuffer());
  const entries = unzipSync(zipBytes);
  assertTrue('ใบสมัคร_ชื่อซ้ำ.pdf' in entries);
  assertTrue('ใบสมัคร_ชื่อซ้ำ_(2).pdf' in entries);
  // in-order writer: entry แรกต้องเป็นเนื้อหาของ t1 เสมอ (แม้ t2 กลับมาก่อน)
  assertEqual(new TextDecoder().decode(entries['ใบสมัคร_ชื่อซ้ำ.pdf']), 'pdf-t1');
  assertEqual(new TextDecoder().decode(entries['ใบสมัคร_ชื่อซ้ำ_(2).pdf']), 'pdf-t2');
});

await testA('RUN3: response กลับไม่ตามลำดับ — ไฟล์ไม่สลับกัน (in-order writer)', async () => {
  const t = [
    { id: 't1', applicationNo: 'APP-2026-0001' },
    { id: 't2', applicationNo: 'APP-2026-0002' },
    { id: 't3', applicationNo: 'APP-2026-0003' },
  ];
  const fetchPdf = async (target: any) => {
    if (target.id === 't1') {
      await new Promise((r) => setTimeout(r, 150)); // ช้าสุดแต่ index แรก
    }
    return okRes(new TextEncoder().encode(`pdf-${target.id}`), `ใบสมัคร_${target.applicationNo}.pdf`);
  };
  const result = await runBulk({ targets: t, fetchPdf });
  assertEqual(result.successCount, 3);
  const zipBytes = new Uint8Array(await result.zip!.arrayBuffer());
  const entries = unzipSync(zipBytes);
  assertEqual(new TextDecoder().decode(entries['ใบสมัคร_APP-2026-0001.pdf']), 'pdf-t1');
  assertEqual(new TextDecoder().decode(entries['ใบสมัคร_APP-2026-0002.pdf']), 'pdf-t2');
  assertEqual(new TextDecoder().decode(entries['ใบสมัคร_APP-2026-0003.pdf']), 'pdf-t3');
});

await testA('RUN4: header ไม่มีชื่อ → fallback applicationNo (เหมือนดาวน์โหลดรายคน)', async () => {
  const t = [{ id: 't1', applicationNo: 'APP-2026-0001' }];
  const fetchPdf = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    arrayBuffer: async () => new TextEncoder().encode('pdf-x').buffer,
    body: null,
  });
  const result = await runBulk({ targets: t, fetchPdf });
  assertEqual(result.successCount, 1);
  const zipBytes = new Uint8Array(await result.zip!.arrayBuffer());
  const entries = unzipSync(zipBytes);
  assertTrue('APP-2026-0001.pdf' in entries);
});

await testA('RUN5: ยกเลิก (signal) → canceled ไม่มี ZIP, สรุปส่วนที่ทำไปแล้ว', async () => {
  const t = [{ id: 't1', applicationNo: 'APP-1' }, { id: 't2', applicationNo: 'APP-2' }];
  const controller = new AbortController();
  controller.abort();
  const result = await runBulk({ targets: t, fetchPdf: async () => okRes(new Uint8Array(1), 'a.pdf'), signal: controller.signal });
  assertEqual(result.status, 'canceled');
  assertEqual(result.zip, null);
});

await testA('RUN6: ล้มทั้งชุด → completed แต่ไม่สร้าง ZIP ว่าง', async () => {
  const t = [{ id: 't1', applicationNo: 'APP-1' }, { id: 't2', applicationNo: 'APP-2' }];
  const result = await runBulk({ targets: t, fetchPdf: async () => errRes(500) });
  assertEqual(result.status, 'completed');
  assertEqual(result.successCount, 0);
  assertEqual(result.failedCount, 2);
  assertEqual(result.zip, null);
});

await testA('RUN7: progress รายงานครบทุกใบ (done = total ตอนจบ)', async () => {
  const t = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, applicationNo: `APP-${i}` }));
  let last = { done: 0, total: 0, failed: 0 };
  const result = await runBulk({
    targets: t,
    fetchPdf: async (target: any) =>
      target.id === 't3' ? errRes(403) : okRes(new Uint8Array(1), `ใบสมัคร_${target.applicationNo}.pdf`),
    onProgress: (p: any) => { last = p; },
  });
  assertEqual(last.done, 7);
  assertEqual(last.total, 7);
  assertEqual(last.failed, 1);
  assertEqual(result.successCount, 6);
});

await testA('RUN8: network failure — เก็บ err.name, err.message และ err.cause ไว้วินิจฉัย (UAT 2026-10-25: "Load failed")', async () => {
  const t = [{ id: 't1', applicationNo: 'APP-1' }];
  const inner = new Error('terminated');
  const networkErr = new TypeError('Load failed', { cause: inner });
  const result = await runBulk({ targets: t, fetchPdf: async () => { throw networkErr; } });
  assertEqual(result.status, 'completed');
  assertEqual(result.failedCount, 1);
  assertEqual(result.failures[0].status, 'TypeError: Load failed');
  assertTrue(result.failures[0].cause?.includes('terminated'), 'ต้องถอด cause จาก err.cause');
  assertTrue(typeof result.failures[0].durationMs === 'number');
});

await testA('RUN9: cacheStats — นับ X-Cache HIT/MISS ของใบที่สำเร็จ (แยกสาเหตุ HIT ตาย vs MISS หนัก)', async () => {
  const t = [
    { id: 't1', applicationNo: 'APP-1' },
    { id: 't2', applicationNo: 'APP-2' },
    { id: 't3', applicationNo: 'APP-3' },
  ];
  const fetchPdf = async (target: any) => {
    if (target.id === 't1') return okRes(new Uint8Array(1), 'a.pdf', 'HIT');
    if (target.id === 't2') return okRes(new Uint8Array(1), 'b.pdf', 'MISS');
    return errRes(500); // ล้มก่อนอ่าน header ไม่นับใน cacheStats
  };
  const result = await runBulk({ targets: t, fetchPdf });
  assertEqual(result.cacheStats.hit, 1);
  assertEqual(result.cacheStats.miss, 1);
  assertEqual(result.cacheStats.unknown, 0);
  assertEqual(result.successCount, 2);
});

// ═══════════════ formatBulkEstimate ═══════════════

test('EST1: ประมาณขนาดสำหรับ dialog', () => {
  assertEqual(formatBulkEstimate(10), '~2 MB');
  assertEqual(formatBulkEstimate(100), '~20 MB');
});

// ═══════════════ Summary ═══════════════

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main();
