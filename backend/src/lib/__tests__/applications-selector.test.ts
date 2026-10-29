/**
 * Phase 2: Applications Selector — equivalence + resolve tests
 * =======================================================================
 *
 * สิ่งที่ต้องพิสูจน์:
 *   SE1.  normalizeSelectorInput: { ids } เดิม → kind 'ids' (backward compatible)
 *   SE2.  normalizeSelectorInput: { applicationIds } เดิม → kind 'ids'
 *   SE3.  normalizeSelectorInput: { selector: {kind:'ids'} } → kind 'ids'
 *   SE4.  normalizeSelectorInput: { selector: {kind:'filter'} } → kind 'filter'
 *   SE5.  ส่งทั้ง selector และ ids พร้อมกัน → reject (fail closed)
 *   SE6.  ไม่ส่งอะไรเลย → reject
 *   SE7.  selector.kind ผิด / roundId หาย → reject
 *   SE8.  resolveSelectorWhere(kind 'ids') → เฉพาะ id นั้น + ตัด deleted
 *   SE9.  resolveSelectorWhere(kind 'filter') → ชุดเดียวกับ buildApplicationsListWhere
 *   SE10. EQUIVALENCE: kind 'filter' ให้ id ชุดเดียวกับ GET /admin/applications/ids
 *         (นี่คือหัวใจของ Phase 2 — "เลือกทั้งหมดตามตัวกรอง" ต้องเท่ากับที่ตาเห็น)
 *   SE11. kind 'ids' ที่มี id ซ้ำ → dedupe
 *   SE12. kind 'ids' ว่าง → ไม่มีแถวใดตรง (ไม่ตีความเป็น "ทั้งหมด")
 *   SE13. describeSelector ไม่มี PII (ไม่เก็บ id ทั้งก้อน)
 *
 * ใช้ D1 จำลอง in-memory แบบเดียวกับ applications-list-pagination.test.ts
 *
 * รัน: node --import tsx src/lib/__tests__/applications-selector.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { sign } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { adminRoutes } from '../../routes/admin.routes';
import { __resetRateLimitStoreForTests } from '../../middlewares/rate-limit.middleware';
import {
  canonicalizeSelector,
  dedupeIds,
  describeSelector,
  MAX_SELECTOR_EXCLUDE_IDS,
  normalizeSelectorInput,
  resolveSelectorWhere,
} from '../applications-selector';
import { buildApplicationsListWhere } from '../applications-list-query';
import { buildExportWhere } from '../../services/excel-export.service';
import { applications } from '../../db/schema';

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  ✗ ${name}: ${e?.message ?? e}`);
  }
}

function assertEqual(actual: any, expected: any, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`);
}

function assertTrue(cond: any, msg = '') {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// ── D1-compatible adapter ──────────────────────────────────────────────────
function createD1Adapter(sqlite: any) {
  return {
    prepare: (sqlText: string) => {
      const stmt = sqlite.prepare(sqlText);
      let bound: any[] = [];
      return {
        bind(...params: any[]) { bound = params; return this; },
        async all() { return { results: stmt.all(...bound) }; },
        async first() { return stmt.get(...bound) ?? null; },
        async run() {
          const info = stmt.run(...bound);
          return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
        },
        async raw() { return stmt.raw(true).all(...bound); },
      };
    },
    async batch(statements: any[]) {
      const results = [];
      for (const s of statements) { await s.run(); results.push({ results: [], success: true }); }
      return results;
    },
  };
}

const sqlite = new Database(':memory:');
sqlite.exec(`
  CREATE TABLE applications (
    id TEXT PRIMARY KEY,
    application_no TEXT,
    round_id TEXT NOT NULL,
    email TEXT,
    fullname TEXT,
    national_id TEXT,
    status TEXT DEFAULT 'DRAFT',
    status_reason TEXT,
    verified_by TEXT,
    verified_at INTEGER,
    form_data TEXT,
    submitted_at INTEGER,
    deleted_at INTEGER,
    year INTEGER,
    round_code TEXT,
    seq_in_round INTEGER
  );
`);

const db = drizzle(createD1Adapter(sqlite) as any);

// ── Seed: 2 รอบ + สถานะต่าง ๆ + แถวถูกลบ ─────────────────────────────────
const NOW = 1760000000;
function insertApp(id: string, opts: {
  roundId?: string; status?: string; fullname?: string; submittedAt?: number | null; deleted?: boolean;
}) {
  sqlite.prepare(
    `INSERT INTO applications (id, application_no, round_id, email, fullname, status, form_data, submitted_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
  ).run(
    id,
    `APP-${id}`,
    opts.roundId ?? 'round-1',
    `${id}@t.t`,
    opts.fullname ?? `name-${id}`,
    opts.status ?? 'SUBMITTED',
    opts.submittedAt === undefined ? NOW : opts.submittedAt,
    opts.deleted ? NOW : null,
  );
}

insertApp('a1', { status: 'SUBMITTED', submittedAt: NOW + 1 });
insertApp('a2', { status: 'QUALIFIED', submittedAt: NOW + 2 });
insertApp('a3', { status: 'REJECTED', submittedAt: NOW + 3 });
insertApp('a4', { status: 'CANCELED', submittedAt: NOW + 4 });
insertApp('a5', { status: 'ARCHIVED', submittedAt: NOW + 5 });
insertApp('a6', { status: 'DRAFT', submittedAt: null });
insertApp('a7', { status: 'SUBMITTED', submittedAt: NOW + 7, deleted: true });
insertApp('b1', { roundId: 'round-2', status: 'SUBMITTED', submittedAt: NOW + 8 });

const TEST_JWT_SECRET = 'test-secret-selector';
const env = () => ({ DB: createD1Adapter(sqlite), JWT_SECRET: TEST_JWT_SECRET } as any);

// ── Helper: รัน where clause จริงบน sqlite ผ่าน drizzle ────────────────────
async function idsFromWhere(where: any): Promise<string[]> {
  const rows = await db.select({ id: applications.id }).from(applications).where(where);
  return rows.map((r: any) => r.id).sort();
}

async function runAll() {
  console.log('=================================================');
  console.log('Phase 2: Applications Selector — Tests');
  console.log('=================================================\n');

  __resetRateLimitStoreForTests();

  // ── normalizeSelectorInput ──────────────────────────────────────────────
  await test('SE1: { ids } เดิม → kind ids (backward compatible)', () => {
    const r = normalizeSelectorInput({ ids: ['a1', 'a2'] }, 'ids');
    assertTrue(r.ok, r.error);
    assertEqual(r.selector, { kind: 'ids', ids: ['a1', 'a2'] });
  });

  await test('SE2: { applicationIds } เดิม → kind ids', () => {
    const r = normalizeSelectorInput({ applicationIds: ['a1'] }, 'applicationIds');
    assertTrue(r.ok, r.error);
    assertEqual(r.selector, { kind: 'ids', ids: ['a1'] });
  });

  await test('SE3: { selector: {kind:"ids"} } → kind ids', () => {
    const r = normalizeSelectorInput({ selector: { kind: 'ids', ids: ['a3'] } }, 'ids');
    assertTrue(r.ok, r.error);
    assertEqual(r.selector, { kind: 'ids', ids: ['a3'] });
  });

  await test('SE4: { selector: {kind:"filter"} } → kind filter (canonical nested)', () => {
    const r = normalizeSelectorInput(
      { selector: { kind: 'filter', roundId: 'round-1', status: 'QUALIFIED' } },
      'ids',
    );
    assertTrue(r.ok, r.error);
    assertEqual(r.selector, {
      kind: 'filter',
      filter: { roundId: 'round-1', status: 'QUALIFIED', search: null },
    });
  });

  await test('SE5: ส่ง selector + ids พร้อมกัน → reject (fail closed)', () => {
    const r = normalizeSelectorInput(
      { selector: { kind: 'ids', ids: ['a1'] }, ids: ['a2'] },
      'ids',
    );
    assertEqual(r.ok, false, 'ต้อง reject');
    assertTrue(/ห้ามส่ง selector พร้อมกับ ids/.test(r.error ?? ''), `error: ${r.error}`);
  });

  await test('SE6: ไม่ส่งอะไรเลย → reject', () => {
    assertEqual(normalizeSelectorInput({}, 'ids').ok, false);
    assertEqual(normalizeSelectorInput(null, 'ids').ok, false);
    assertEqual(normalizeSelectorInput({ status: 'QUALIFIED' }, 'ids').ok, false);
  });

  await test('SE7: kind ผิด / filter ไม่มี roundId → reject', () => {
    assertEqual(normalizeSelectorInput({ selector: { kind: 'nope' } }, 'ids').ok, false);
    assertEqual(
      normalizeSelectorInput({ selector: { kind: 'filter' } }, 'ids').ok,
      false,
      'filter ไม่มี roundId ต้อง reject',
    );
    assertEqual(
      normalizeSelectorInput({ selector: { kind: 'filter', roundId: '   ' } }, 'ids').ok,
      false,
      'roundId whitespace ต้อง reject',
    );
  });

  // ── resolveSelectorWhere ────────────────────────────────────────────────
  await test('SE8: kind ids → เฉพาะ id นั้น + ตัด deleted', async () => {
    const ids = await idsFromWhere(resolveSelectorWhere({ kind: 'ids', ids: ['a1', 'a2', 'a7'] }));
    assertEqual(ids, ['a1', 'a2'], 'a7 ถูกลบแล้วต้องไม่ถูกเลือก');
  });

  await test('SE9: kind filter → ชุดเดียวกับ buildApplicationsListWhere', async () => {
    const selectorIds = await idsFromWhere(
      resolveSelectorWhere({
        kind: 'filter',
        filter: { roundId: 'round-1', status: 'SUBMITTED' },
      }),
    );
    const listIds = await idsFromWhere(
      buildApplicationsListWhere({ roundId: 'round-1', status: 'SUBMITTED' }),
    );
    assertEqual(selectorIds, listIds, 'selector ต้องเท่ากับ list query เป๊ะ');
    assertEqual(selectorIds, ['a1'], 'เฉพาะ SUBMITTED ที่ยังไม่ถูกลบ');
  });

  await test('SE10: EQUIVALENCE — kind filter = GET /admin/applications/ids', async () => {
    const app = new Hono();
    app.route('/api/v1/admin', adminRoutes);

    const token = await sign(
      { id: 'admin-1', email: 'admin@test.local', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 },
      TEST_JWT_SECRET,
    );

    const combos: Array<{ status?: string; search?: string }> = [
      {},
      { status: 'SUBMITTED' },
      { status: 'QUALIFIED' },
      { status: 'ARCHIVED' },
      { search: 'a' },
      { status: 'SUBMITTED', search: 'a1' },
    ];

    for (const combo of combos) {
      const params = new URLSearchParams({ roundId: 'round-1' });
      if (combo.status) params.append('status', combo.status);
      if (combo.search) params.append('search', combo.search);

      const res = await app.request(
        `/api/v1/admin/applications/ids?${params}`,
        { headers: { Authorization: `Bearer ${token}` } },
        env(),
      );
      assertEqual(res.status, 200, `HTTP status สำหรับ ${JSON.stringify(combo)}`);
      const body = await res.json();
      const endpointIds = (body.data as string[]).slice().sort();

      const selectorIds = await idsFromWhere(
        resolveSelectorWhere({
          kind: 'filter',
          filter: {
            roundId: 'round-1',
            status: combo.status ?? null,
            search: combo.search ?? null,
          },
        }),
      );

      assertEqual(
        selectorIds,
        endpointIds,
        `selector ต้องเท่ากับ /ids สำหรับ ${JSON.stringify(combo)}`,
      );
    }
  });

  await test('SE11: kind ids ที่มี id ซ้ำ → dedupe', async () => {
    assertEqual(dedupeIds(['a1', 'a1', 'a2']), ['a1', 'a2']);
    const ids = await idsFromWhere(resolveSelectorWhere({ kind: 'ids', ids: ['a1', 'a1', 'a2'] }));
    assertEqual(ids, ['a1', 'a2'], 'ผลลัพธ์ไม่มีแถวซ้ำ');
  });

  await test('SE12: kind ids ว่าง → ไม่มีแถวใดตรง (ไม่ตีความเป็นทั้งหมด)', async () => {
    const ids = await idsFromWhere(resolveSelectorWhere({ kind: 'ids', ids: [] }));
    assertEqual(ids, [], 'ต้องไม่ได้ทุกแถว');
  });

  await test('SE13: describeSelector ไม่เก็บ id ทั้งก้อน (ไม่มี PII)', () => {
    const idsDesc = describeSelector({ kind: 'ids', ids: ['a1', 'a2', 'a3'] });
    assertEqual(idsDesc, { kind: 'ids', requestedCount: 3 });
    assertTrue(!('ids' in idsDesc), 'ห้ามมี id array ใน audit');

    const filterDesc = describeSelector({
      kind: 'filter',
      filter: { roundId: 'round-1', status: 'QUALIFIED', search: 'สมชาย' },
    });
    assertEqual(filterDesc, {
      kind: 'filter',
      roundId: 'round-1',
      status: 'QUALIFIED',
      search: 'สมชาย',
      excludeCount: 0,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 5 — canonical nested selector + excludeIds
  // ═══════════════════════════════════════════════════════════════════════

  await test('SE14: nested { filter: {...} } → canonical (roundId/status/search)', () => {
    const r = normalizeSelectorInput(
      {
        selector: {
          kind: 'filter',
          filter: { roundId: ' round-1 ', status: ' QUALIFIED ', search: '  สมชาย ' },
        },
      },
      'ids',
    );
    assertTrue(r.ok, r.error);
    assertEqual(r.selector, {
      kind: 'filter',
      filter: { roundId: 'round-1', status: 'QUALIFIED', search: 'สมชาย' },
    });
  });

  await test('SE15: flat (Phase 2) และ nested (Phase 5) ให้ selector เดียวกันเป๊ะ', () => {
    const flat = normalizeSelectorInput(
      { selector: { kind: 'filter', roundId: 'round-1', status: 'SUBMITTED', search: 'x' } },
      'ids',
    );
    const nested = normalizeSelectorInput(
      {
        selector: {
          kind: 'filter',
          filter: { roundId: 'round-1', status: 'SUBMITTED', search: 'x' },
        },
      },
      'ids',
    );
    assertTrue(flat.ok && nested.ok, 'ทั้งสองต้องผ่าน');
    assertEqual(nested.selector, flat.selector, 'canonical form ต้องเท่ากัน');
  });

  await test('SE16: nested ที่ไม่มี roundId → reject', () => {
    const r = normalizeSelectorInput(
      { selector: { kind: 'filter', filter: { status: 'SUBMITTED' } } },
      'ids',
    );
    assertEqual(r.ok, false, 'ต้อง reject');
    assertTrue(/roundId/.test(r.error ?? ''), `error: ${r.error}`);
  });

  await test('SE17: excludeIds ถูก dedupe + ตัดค่าว่าง', () => {
    const r = normalizeSelectorInput(
      {
        selector: {
          kind: 'filter',
          filter: { roundId: 'round-1' },
          excludeIds: ['a1', 'a1', '', 'a2'],
        },
      },
      'ids',
    );
    assertTrue(r.ok, r.error);
    assertEqual(r.selector.excludeIds, ['a1', 'a2']);
  });

  await test('SE18: excludeIds ว่าง → ไม่มี key (ไม่ bind NOT IN เปล่า)', () => {
    const r = normalizeSelectorInput(
      { selector: { kind: 'filter', filter: { roundId: 'round-1' }, excludeIds: [] } },
      'ids',
    );
    assertTrue(r.ok, r.error);
    assertTrue(!('excludeIds' in r.selector), 'ต้องไม่มี key excludeIds');
  });

  await test('SE19: excludeIds ไม่ใช่ array → reject', () => {
    const r = normalizeSelectorInput(
      { selector: { kind: 'filter', filter: { roundId: 'round-1' }, excludeIds: 'a1' } },
      'ids',
    );
    assertEqual(r.ok, false, 'ต้อง reject');
  });

  await test('SE20: excludeIds เกิน cap → reject (fail closed ไม่ตัดทิ้งเงียบ ๆ)', () => {
    const tooMany = Array.from({ length: MAX_SELECTOR_EXCLUDE_IDS + 1 }, (_, i) => `x-${i}`);
    const r = normalizeSelectorInput(
      { selector: { kind: 'filter', filter: { roundId: 'round-1' }, excludeIds: tooMany } },
      'ids',
    );
    assertEqual(r.ok, false, 'เกิน cap ต้อง reject');
    assertTrue(
      String(r.error).includes(String(MAX_SELECTOR_EXCLUDE_IDS)),
      `error ต้องบอก cap: ${r.error}`,
    );

    // ที่ cap พอดี → ผ่าน
    const atCap = normalizeSelectorInput(
      {
        selector: {
          kind: 'filter',
          filter: { roundId: 'round-1' },
          excludeIds: tooMany.slice(0, MAX_SELECTOR_EXCLUDE_IDS),
        },
      },
      'ids',
    );
    assertTrue(atCap.ok, atCap.error);
    assertEqual(atCap.selector.excludeIds.length, MAX_SELECTOR_EXCLUDE_IDS);
  });

  await test('SE21: resolveSelectorWhere(filter + excludeIds) → ตัด id ที่ยกเลิกออกจริง', async () => {
    const all = await idsFromWhere(
      resolveSelectorWhere({ kind: 'filter', filter: { roundId: 'round-1' } }),
    );
    assertEqual(all, ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'], 'ฐาน: ทุกใบในรอบ 1 ที่ยังไม่ถูกลบ');

    const excluded = await idsFromWhere(
      resolveSelectorWhere({
        kind: 'filter',
        filter: { roundId: 'round-1' },
        excludeIds: ['a2', 'a4'],
      }),
    );
    assertEqual(excluded, ['a1', 'a3', 'a5', 'a6'], 'a2/a4 ต้องหลุดออก');
  });

  await test('SE22: excludeIds ที่ไม่ตรงชุดไม่ทำให้ชุดเพี้ยน (แค่ไม่มีผล)', async () => {
    const ids = await idsFromWhere(
      resolveSelectorWhere({
        kind: 'filter',
        filter: { roundId: 'round-1', status: 'SUBMITTED' },
        excludeIds: ['b1', 'not-exist'],
      }),
    );
    assertEqual(ids, ['a1'], 'ยังคงเป็น SUBMITTED ในรอบ 1');
  });

  await test('SE23: filter + status comma-separated → union ของสถานะ', async () => {
    const ids = await idsFromWhere(
      resolveSelectorWhere({
        kind: 'filter',
        filter: { roundId: 'round-1', status: 'SUBMITTED,QUALIFIED' },
      }),
    );
    assertEqual(ids, ['a1', 'a2'], 'ได้ทั้ง SUBMITTED และ QUALIFIED');
  });

  await test('SE24: status ที่ไม่รู้จักทั้งหมด → 0 แถว (ไม่ใช่ทั้งรอบ)', async () => {
    const ids = await idsFromWhere(
      resolveSelectorWhere({
        kind: 'filter',
        filter: { roundId: 'round-1', status: 'NOPE,ALSO_NOPE' },
      }),
    );
    assertEqual(ids, [], 'ค่าที่ไม่รู้จักต้องไม่ match อะไรเลย');
  });

  await test('SE25: excludeDraft → ตัด DRAFT ออก (export semantics)', async () => {
    const withDraft = await idsFromWhere(
      resolveSelectorWhere({ kind: 'filter', filter: { roundId: 'round-1' } }),
    );
    assertTrue(withDraft.includes('a6'), 'ฐานต้องมี DRAFT (a6)');

    const withoutDraft = await idsFromWhere(
      resolveSelectorWhere({ kind: 'filter', filter: { roundId: 'round-1' } }, { excludeDraft: true }),
    );
    assertTrue(!withoutDraft.includes('a6'), 'excludeDraft ต้องตัด a6 ออก');
    assertEqual(withoutDraft, ['a1', 'a2', 'a3', 'a4', 'a5']);
  });

  await test('SE26: status=DRAFT (ไม่ใช่ selectable status) → 0 แถว เหมือน buildExportWhere', async () => {
    // DRAFT ไม่ได้อยู่ใน SELECTABLE_APPLICATION_STATUSES → ค่าที่ไม่รู้จัก
    // ไม่ match แถวไหน (semantics เดิมของ buildExportWhere)
    const viaSelector = await idsFromWhere(
      resolveSelectorWhere(
        { kind: 'filter', filter: { roundId: 'round-1', status: 'DRAFT' } },
        { excludeDraft: true },
      ),
    );
    const viaExportWhere = await idsFromWhere(
      buildExportWhere({ roundId: 'round-1', status: 'DRAFT' }),
    );
    assertEqual(viaSelector, [], 'selector ต้องไม่คืน DRAFT');
    assertEqual(viaSelector, viaExportWhere, 'ต้องตรงกับ buildExportWhere เป๊ะ');
  });

  await test('SE27: excludeDraft ไม่มีผลกับ kind ids (contract เดิม)', async () => {
    const ids = await idsFromWhere(
      resolveSelectorWhere({ kind: 'ids', ids: ['a1', 'a6'] }, { excludeDraft: true }),
    );
    assertEqual(ids, ['a1', 'a6'], 'kind ids ไม่กรอง status');
  });

  await test('SE28: canonicalizeSelector — flat → nested, ids ผ่านเดิม', () => {
    assertEqual(
      canonicalizeSelector({ kind: 'filter', roundId: 'r1', status: 'S', search: null } as any),
      { kind: 'filter', filter: { roundId: 'r1', status: 'S', search: null } },
    );
    // nested อยู่แล้ว → ค่าเดิม
    assertEqual(
      canonicalizeSelector({ kind: 'filter', filter: { roundId: 'r1' } }),
      { kind: 'filter', filter: { roundId: 'r1', status: null, search: null } },
    );
    // ids → ไม่แตะ
    assertEqual(canonicalizeSelector({ kind: 'ids', ids: ['a1'] }), { kind: 'ids', ids: ['a1'] });
  });

  await test('SE29: describeSelector ของ filter + excludeIds ไม่เก็บ id (เก็บแค่จำนวน)', () => {
    const desc = describeSelector({
      kind: 'filter',
      filter: { roundId: 'round-1' },
      excludeIds: ['a1', 'a2'],
    });
    assertEqual(desc.excludeCount, 2, 'excludeCount');
    assertTrue(!('excludeIds' in desc), 'ห้ามเก็บ excludeIds ทั้งก้อน');
    assertTrue(!JSON.stringify(desc).includes('a1'), 'ห้ามมี id ใน audit');
  });

  console.log('');
  if (failed > 0) {
    console.log(`FAILED: ${failed}/${passed + failed}`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`PASSED: ${passed}/${passed + failed}`);
}

runAll().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
