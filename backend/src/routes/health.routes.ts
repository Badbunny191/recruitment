/**
 * Health Routes — liveness vs readiness
 * ============================================================================
 * แยกสอง endpoint โดยเจตนา:
 *
 *   GET /health        (liveness)  — อยู่ใน src/index.ts เดิม ไม่แตะ DB
 *                                    ตอบเร็ว ไม่มี dependency
 *   GET /health/ready  (readiness) — ไฟล์นี้ ตรวจ D1 จริง + secret ที่จำเป็น
 *
 * ## ทำไมต้องแยก
 *
 * ถ้า uptime monitor ยิง endpoint ที่พึ่ง D1 ทุก 1 นาที แล้ว D1 มี blip
 * 2 วินาที จะได้ alert ปลอมทันที และทีมจะเริ่มชินกับ alert (alert fatigue)
 * จนพลาดของจริงไปด้วย
 *
 * liveness ที่นิ่งช่วยแยกได้ว่า "Worker ตาย" กับ "DB มีปัญหา" — สองอย่างนี้
 * แก้ต่างกันคนละทาง:
 *   - Worker ตาย      → ดู deploy ล่าสุด / rollback
 *   - D1 ไม่ตอบ       → ดู Cloudflare status / binding
 *
 * ## ต้นทุน
 *
 * `SELECT 1` อ่าน 0 rows → ไม่กิน D1 quota (free = 5M rows read/วัน)
 * และ D1 query เป็น I/O wait ไม่ใช่ CPU → ไม่ชนเพดาน CPU 10 ms ของ Workers Free
 *
 * ⚠️ ห้ามเปลี่ยนเป็น `SELECT COUNT(*) FROM applications` — จะกลายเป็น full
 *    table scan และกิน rows_read ตามจำนวนแถวจริงทุกครั้งที่ monitor ยิง
 *
 * ## ความปลอดภัย
 *
 * endpoint นี้ไม่ต้อง auth (monitor ต้องเรียกได้) จึงเป็น public
 * → ห้ามใส่ error message / stack / SQL / ชื่อ binding ลง response เด็ดขาด
 *   คืนได้แค่สถานะระดับหมวด ('ok' | 'error' | 'timeout' | 'missing')
 *   รายละเอียดจริงให้ console.error ฝั่ง server ซึ่งไปลง Workers Logs
 */

import { Hono } from 'hono';
import { Bindings } from '../types';

export const healthRoutes = new Hono<{ Bindings: Bindings }>();

/**
 * เพดานเวลารอ D1 probe
 *
 * Cloudflare Workers ไม่มี hard timeout ของ HTTP request แต่ถ้า D1 ค้าง
 * (ไม่ throw ไม่ return) request จะค้างจน client timeout เอง ซึ่งทำให้
 * monitor เห็นเป็น "timeout" ที่แยกไม่ออกว่า Worker ตายหรือ DB ค้าง
 *
 * 3 วินาที: D1 query ปกติใช้ ~0.1 ms (วัดจาก production) → 3 วิคือ 30,000 เท่า
 * ของค่าปกติ ถ้าเกินนี้ถือว่าผิดปกติแน่นอน และยังต่ำกว่า timeout ของ
 * uptime monitor (10-15 วิ) พอที่จะได้ 503 กลับไปก่อน monitor ตัดเอง
 */
export const DB_PROBE_TIMEOUT_MS = 3000;

type CheckStatus = 'ok' | 'error' | 'timeout' | 'missing';

/**
 * Race promise กับ timeout
 *
 * หมายเหตุ: promise เดิมยังทำงานต่อหลัง timeout (ยกเลิก D1 query ไม่ได้)
 * แต่เราทิ้งผลลัพธ์ไปแล้ว — ยอมรับได้เพราะ query เป็น read-only `SELECT 1`
 * ไม่มี side effect ที่ต้องกังวล
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('HEALTH_PROBE_TIMEOUT')), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * ตรวจ D1 ด้วย `SELECT 1`
 *
 * คืนสถานะระดับหมวดเท่านั้น ไม่คืน error message ออก client
 * (endpoint เป็น public — ดูหัวไฟล์)
 */
async function probeD1(env: Bindings): Promise<CheckStatus> {
  try {
    const row = await withTimeout(
      env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>(),
      DB_PROBE_TIMEOUT_MS
    );

    if (row && row.ok === 1) return 'ok';

    // query สำเร็จแต่ผลไม่ตรงที่คาด — binding ผิดตัว หรือ DB ว่างผิดปกติ
    console.error('[HEALTH] d1_probe_unexpected_result', { got: row ?? null });
    return 'error';
  } catch (err) {
    const isTimeout = (err as Error)?.message === 'HEALTH_PROBE_TIMEOUT';

    // log ฝั่ง server เท่านั้น — ห้ามหลุดออก response
    console.error('[HEALTH] d1_probe_failed', {
      reason: isTimeout ? 'timeout' : 'error',
      name: (err as Error)?.name,
    });

    return isTimeout ? 'timeout' : 'error';
  }
}

/**
 * GET /health/ready
 *
 * 200 → ทุกอย่างพร้อมรับ traffic
 * 503 → dependency ไม่พร้อม (ไม่ใช่ 500 เพราะ 503 บอก "ยังไม่พร้อม" ตรงกว่า
 *        และ monitor ส่วนใหญ่ตีความ 503 ว่า down ถูกต้องอยู่แล้ว)
 */
healthRoutes.get('/ready', async (c) => {
  const startedAt = Date.now();

  const checks: Record<string, CheckStatus> = {};

  // 1) D1 — dependency ที่เจ็บที่สุดถ้าล่ม
  checks.db = await probeD1(c.env);

  // 2) JWT_SECRET — ตรวจใน memory ราคา 0
  //    ถ้าหาย login พังทั้งระบบ แต่ /health เดิมไม่มีทางรู้
  checks.jwt_secret = c.env.JWT_SECRET ? 'ok' : 'missing';

  const healthy = Object.values(checks).every((v) => v === 'ok');

  return c.json(
    {
      status: healthy ? 'ok' : 'degraded',
      checks,
      latency_ms: Date.now() - startedAt,
      timestamp: Math.floor(Date.now() / 1000),
    },
    healthy ? 200 : 503
  );
});
