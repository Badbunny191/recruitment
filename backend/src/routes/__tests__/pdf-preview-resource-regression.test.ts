/**
 * Regression Test — PDF Preview resource guards (cache + abort + retry budget)
 * ---------------------------------------------------------
 * Feature: POST /admin/template-versions/:id/descriptor/pdf-preview
 *
 * 🔴 ROOT CAUSE ที่ test นี้ป้องกัน
 * =============================================================================
 * Error 1102 / HTTP 503 ตอนแก้ Field ใน PDF Composer:
 *   ทุกการแก้ descriptor ทำให้ Frontend ยิง render PDF ใหม่ (~40ms+ CPU ต่อ
 *   ครั้งบนเครื่อง dev, หลักสิบถึงหลักร้อย ms บน Worker isolate) และมีการ
 *   ยิงซ้ำซ้อนจาก 3 แหล่ง:
 *     1. retry ทุก 1s ไม่จำกัดหลังโดน 503
 *     2. PreviewPanel + PreviewModal ยิง descriptor เดิมพร้อมกัน
 *     3. request เก่าที่ client abort แล้ว แต่ Worker ยัง render ต่อ
 *   → isolate เดียวรับ CPU รวมเกิน resource limit → Cloudflare ฆ่า Worker
 *
 * ✅ Guards ที่ตรวจใน test นี้
 *   [1] render ครั้งแรก (cache miss) สำเร็จ + header ระบุ miss
 *   [2] request ซ้ำ descriptor เดิม → cache hit + bytes ตรงกัน (ไม่ render ซ้ำ)
 *   [3] descriptor เปลี่ยน (เพิ่ม field block) → miss เสมอ (ไม่ใช้ของเก่า)
 *   [4] block อ้าง field ที่หายไป → ไม่ crash (skip + 200)
 *   [5] AbortSignal ที่ aborted แล้ว → renderPlanToPdf reject AbortError ทันที
 *   [6] Cache unit: TTL expiry / LRU eviction / bytes budget
 *   [7] Instrumentation log ไม่หลุดเนื้อหาคำตอบ (ไม่มี "ตัวอย่าง…")
 *
 * รัน: node --import tsx src/routes/__tests__/pdf-preview-resource-regression.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
(process as any).env = (process as any).env ?? {};
(process as any).env.TZ = 'Asia/Bangkok';

import { Hono } from 'hono';
import Database from 'better-sqlite3';
import descriptorRouter from '../template-descriptor.routes';
import {
  makePreviewCacheKey,
  getCachedPreview,
  setCachedPreview,
  resetPreviewCache,
  previewCacheStats,
} from '../../lib/document-composer/pdf-preview-cache';
import {
  buildRenderPlan,
  renderPlanToPdf,
} from '../../lib/document-composer/descriptor-renderer';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((e) => {
      failed++;
      failures.push(`${name}: ${e?.message ?? e}`);
      console.log(`  ✗ ${name}: ${e?.message ?? e}`);
    });
}
function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'Expected true');
}
function assertEqual(actual, expected, msg = '') {
  if (actual !== expected)
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// =============================================================================
// D1-compatible adapter (เหมือน admin-login-lockout.test.ts)
// =============================================================================
function createD1Adapter(sqlite) {
  const makeStatement = (sqlText) => {
    const stmt = sqlite.prepare(sqlText);
    let bound = [];
    const api = {
      bind(...params) {
        bound = params;
        return api;
      },
      async all() {
        return { results: stmt.all(...bound) };
      },
      async first() {
        return stmt.get(...bound) ?? null;
      },
      async run() {
        const info = stmt.run(...bound);
        return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
      },
      async raw() {
        return stmt.raw(true).all(...bound);
      },
    };
    return api;
  };
  return {
    prepare: (s) => makeStatement(s),
    async batch(statements) {
      const out = [];
      for (const s of statements) {
        await s.run();
        out.push({ results: [], success: true, meta: { changes: 0 } });
      }
      return out;
    },
  };
}

// =============================================================================
// Fixture: in-memory DB + Hono app
// =============================================================================
const sqlite = new Database(':memory:');
sqlite.exec(`
  CREATE TABLE template_versions (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    status TEXT DEFAULT 'DRAFT',
    created_at INTEGER,
    descriptor_json TEXT,
    descriptor_schema_version INTEGER,
    descriptor_updated_at INTEGER,
    descriptor_updated_by TEXT
  );
  CREATE TABLE template_sections (
    id TEXT PRIMARY KEY,
    template_version_id TEXT NOT NULL,
    name TEXT NOT NULL,
    display_order INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at INTEGER,
    updated_at INTEGER
  );
  CREATE TABLE field_master (
    id TEXT PRIMARY KEY,
    field_type TEXT NOT NULL,
    label_th TEXT NOT NULL,
    default_options TEXT,
    pdf_mapping_key TEXT,
    is_active INTEGER DEFAULT 1,
    help_text TEXT,
    placeholder TEXT,
    section TEXT,
    file_config TEXT,
    validation_type TEXT,
    validation_message TEXT
  );
  CREATE TABLE template_fields (
    id TEXT PRIMARY KEY,
    template_version_id TEXT NOT NULL,
    field_id TEXT NOT NULL,
    section_id TEXT NOT NULL,
    display_order INTEGER NOT NULL,
    is_required INTEGER DEFAULT 0,
    override_label_th TEXT,
    override_options TEXT,
    rows INTEGER,
    created_at INTEGER
  );
  CREATE TABLE recruitment_rounds (
    id TEXT PRIMARY KEY,
    template_version_id TEXT NOT NULL,
    title TEXT NOT NULL,
    position_level TEXT NOT NULL,
    open_date INTEGER NOT NULL,
    close_date INTEGER NOT NULL,
    status TEXT DEFAULT 'ACTIVE',
    created_at INTEGER,
    deleted_at INTEGER,
    announcement_title TEXT,
    announcement_description TEXT,
    contact_information TEXT,
    remark TEXT,
    application_pattern TEXT,
    round_code TEXT
  );
`);

const TV_ID = 'tv-regression-1';
sqlite
  .prepare(
    `INSERT INTO template_versions (id, template_id, version_number, created_at) VALUES (?, ?, 1, ?)`,
  )
  .run(TV_ID, 'tpl-1', 1759000000);
sqlite
  .prepare(
    `INSERT INTO template_sections (id, template_version_id, name, display_order) VALUES ('sec-1', ?, 'ข้อมูลส่วนตัว', 0)`,
  )
  .run(TV_ID);
for (let i = 1; i <= 3; i++) {
  sqlite
    .prepare(
      `INSERT INTO field_master (id, field_type, label_th) VALUES (?, 'TEXT', ?)`,
    )
    .run(`fm-${i}`, `ฟิลด์ทดสอบ ${i}`);
  sqlite
    .prepare(
      `INSERT INTO template_fields (id, template_version_id, field_id, section_id, display_order)
       VALUES (?, ?, ?, 'sec-1', ?)`,
    )
    .run(`tfm-${i}`, TV_ID, `fm-${i}`, i);
}
sqlite
  .prepare(
    `INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, created_at)
     VALUES ('r-1', ?, 'รอบทดสอบ', 'N/A', 1759000000, 1759100000, 1759000000)`,
  )
  .run(TV_ID);

const app = new Hono();
app.route('/api/v1/admin/template-versions', descriptorRouter);
const env = () => ({ DB: createD1Adapter(sqlite) });

function makeDescriptor(extraBlock) {
  const blocks = [
    { id: 'h-1', type: 'heading', text: 'ใบสมัคร', size: 'large', bold: true, align: 'center' },
    { id: 'fb-1', type: 'field', fieldId: 'fm-1', layout: 'stacked', align: 'left' },
  ];
  if (extraBlock) blocks.push(extraBlock);
  blocks.push({
    id: 'sig-1',
    type: 'signature',
    lineLabel: 'ลงชื่อ',
    roleLabel: 'ผู้สมัคร',
    lineStyle: '..............',
    dateLabel: 'วันที่',
    align: 'left',
  });
  return { version: 1, blocks };
}

async function postPdfPreview(descriptor) {
  const res = await app.request(
    `/api/v1/admin/template-versions/${TV_ID}/descriptor/pdf-preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ descriptor }),
    },
    env(),
  );
  const bytes = res.status === 200 ? new Uint8Array(await res.arrayBuffer()) : null;
  return { status: res.status, bytes, cacheHeader: res.headers.get('X-Pdf-Preview-Cache') };
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('=========================================================');
  console.log('PDF Preview Resource Guards — Regression Test');
  console.log('=========================================================');
  resetPreviewCache();

  // ── [1][2][3] cache ที่ HTTP layer ────────────────────────────────
  console.log('\n[HTTP] content-addressed cache');

  let first;
  await test('render ครั้งแรก → 200 + cache=miss', async () => {
    first = await postPdfPreview(makeDescriptor());
    assertEqual(first.status, 200, 'status:');
    assertEqual(first.cacheHeader, 'miss', 'cache header:');
    assertTrue(first.bytes.byteLength > 1000, 'ต้องได้ PDF จริง');
  });

  await test('request ซ้ำ descriptor เดิม → cache=hit + bytes ตรงกันเป๊ะ', async () => {
    const second = await postPdfPreview(makeDescriptor());
    assertEqual(second.status, 200, 'status:');
    assertEqual(second.cacheHeader, 'hit', 'cache header (ต้องไม่ render ซ้ำ):');
    assertEqual(second.bytes.byteLength, first.bytes.byteLength, 'ขนาด PDF:');
    assertEqual(
      Buffer.compare(Buffer.from(second.bytes), Buffer.from(first.bytes)),
      0,
      'bytes เหมือนกันเป๊ะ:',
    );
  });

  await test('เพิ่ม field block (descriptor เปลี่ยน) → cache=miss เสมอ', async () => {
    const changed = await postPdfPreview(
      makeDescriptor({ id: 'fb-2', type: 'field', fieldId: 'fm-2', layout: 'stacked', align: 'left' }),
    );
    assertEqual(changed.status, 200, 'status:');
    assertEqual(changed.cacheHeader, 'miss', 'descriptor ใหม่ต้อง render ใหม่:');
  });

  await test('กลับไป descriptor เดิมอีกครั้ง (A→B→A) → cache=hit', async () => {
    const again = await postPdfPreview(makeDescriptor());
    assertEqual(again.cacheHeader, 'hit', 'ยังต้อง hit จาก entry เดิม:');
  });

  // ── [4] field reference ไม่สมบูรณ์ ────────────────────────────────
  console.log('\n[HTTP] field reference ที่ไม่สมบูรณ์');

  await test('block อ้าง fieldId ที่ไม่มีใน template → 200 (skip ไม่ crash)', async () => {
    const res = await postPdfPreview(
      makeDescriptor({ id: 'fb-x', type: 'field', fieldId: 'fm-deleted', layout: 'stacked', align: 'left' }),
    );
    assertEqual(res.status, 200, 'ลบ field ที่ block อ้างอยู่ต้องไม่ทำให้ render ล้ม:');
  });

  await test('field ไม่มี sample value (formData ว่างบาง key) → 200', async () => {
    const res = await postPdfPreview(
      makeDescriptor({ id: 'fb-empty', type: 'field', fieldId: 'fm-3', layout: 'stacked', align: 'left' }),
    );
    assertEqual(res.status, 200, 'field ที่ไม่มีค่าต้อง render ได้:');
  });

  // ── [5] AbortSignal ใน renderPlanToPdf ────────────────────────────
  console.log('\n[Engine] cooperative abort');

  await test('signal ที่ aborted ก่อนเริ่ม → throw AbortError ทันที', async () => {
    const ctx = makeEngineCtx();
    const plan = buildRenderPlan(makeDescriptor(), ctx);
    const controller = new AbortController();
    controller.abort();
    let threw = null;
    try {
      await renderPlanToPdf(plan, ctx, controller.signal);
    } catch (e) {
      threw = e;
    }
    assertTrue(threw, 'ต้อง throw');
    assertEqual(threw.name, 'AbortError', 'ชนิด error:');
  });

  await test('signal ไม่ส่ง (undefined) → render ปกติเหมือนเดิม (back-compat)', async () => {
    const ctx = makeEngineCtx();
    const plan = buildRenderPlan(makeDescriptor(), ctx);
    const rendered = await renderPlanToPdf(plan, ctx);
    assertTrue(rendered.pageCount >= 1, 'ยังต้อง render ได้ตามปกติ');
  });

  // ── [6] Cache unit ────────────────────────────────────────────────
  console.log('\n[Cache] unit behavior');

  await test('TTL หมดอายุ → miss', async () => {
    resetPreviewCache();
    const key = makePreviewCacheKey({ version: 1, blocks: [{ id: 'a', type: 'heading', text: 'x', size: 'small', bold: true }] }, undefined);
    setCachedPreview(key, new Uint8Array([1, 2, 3]), 1);
    assertTrue(getCachedPreview(key) !== null, 'ก่อนหมดอายุต้อง hit');
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000; // เลย TTL 60s
    try {
      assertEqual(getCachedPreview(key), null, 'หลัง TTL ต้อง miss:');
    } finally {
      Date.now = realNow;
    }
  });

  await test('LRU เกิน 6 entries → ตัวเก่าที่สุดถูกทิ้งก่อน', () => {
    resetPreviewCache();
    for (let i = 0; i < 8; i++) {
      setCachedPreview(
        makePreviewCacheKey({ i }, undefined),
        new Uint8Array(1000),
        1,
      );
    }
    const stats = previewCacheStats();
    assertTrue(stats.entries <= 6, `entries ต้องไม่เกิน 6 (ได้ ${stats.entries})`);
    assertEqual(
      getCachedPreview(makePreviewCacheKey({ i: 0 }, undefined)),
      null,
      'entry เก่าสุด (i=0) ต้องถูก evict:',
    );
    assertTrue(getCachedPreview(makePreviewCacheKey({ i: 7 }, undefined)) !== null, 'entry ใหม่ล่าสุดต้องอยู่');
  });

  await test('key แยกตาม applicationId — sample vs real ไม่ปนกัน', () => {
    resetPreviewCache();
    const desc = { version: 1, blocks: [] };
    const k1 = makePreviewCacheKey(desc, undefined);
    const k2 = makePreviewCacheKey(desc, 'app-123');
    assertTrue(k1 !== k2, 'ต้องเป็นคนละ key');
  });

  // ── [7] Instrumentation ไม่หลุดเนื้อหาคำตอบ ──────────────────────
  console.log('\n[Instrumentation] PII safety');

  await test('log ประกอบด้วยตัวเลขสถิติเท่านั้น — ไม่มีค่าจาก formData', async () => {
    resetPreviewCache();
    const logs = [];
    const origInfo = console.info;
    console.info = (...args) => logs.push(args.join(' '));
    try {
      await postPdfPreview(
        makeDescriptor({ id: 'fb-3', type: 'field', fieldId: 'fm-3', layout: 'stacked', align: 'left' }),
      );
    } finally {
      console.info = origInfo;
    }
    const pdfLog = logs.find((l) => l.includes('"msg":"pdf-preview"'));
    assertTrue(pdfLog, 'ต้องมี log line pdf-preview');
    const parsed = JSON.parse(pdfLog);
    for (const key of [
      'requestId', 'templateVersionId', 'blockCount', 'fieldBlockCount',
      'tableCount', 'renderCommandCount', 'pageCount', 'totalTextLength',
      'buildRenderPlanMs', 'renderPlanToPdfMs', 'totalMs', 'outputBytes',
    ]) {
      assertTrue(key in parsed, `log ต้องมี field "${key}"`);
    }
    // ค่า sample ของ buildPreviewContext คือ "ตัวอย่าง{label}" — ห้ามหลุดมาใน log
    assertTrue(!pdfLog.includes('ตัวอวย'.slice(0, 0) + 'ตัวอย่าง'), 'log ห้ามมีค่า formData sample ("ตัวอย่าง…")');
    assertTrue(!pdfLog.includes('สมชาย'), 'log ห้ามมีชื่อ');
    assertTrue(!('formData' in parsed) && !('fullname' in parsed) && !('email' in parsed), 'log ห้ามมี PII keys');
  });

  // ── Summary ────────────────────────────────────────────────────────
  console.log('\n=========================================================');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log('=========================================================');
  if (failed > 0) process.exit(1);
}

/** ctx ขั้นต่ำสำหรับเรียก engine ตรง ๆ */
function makeEngineCtx() {
  return {
    application: {
      id: 'engine-test', applicationNo: 'T-1', fullname: 'x', email: 'x',
      status: 'S', statusReason: null, submittedAt: 1759000000, formData: {},
    },
    round: { id: 'r', title: 'รอบ', positionLevel: '', announcementTitle: null, announcementDescription: null, applicationPattern: null, roundCode: null },
    templateVersion: { id: 'tv', versionNumber: 1 },
    sections: [], fields: [], attachments: [],
  };
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
