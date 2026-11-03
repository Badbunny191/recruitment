/**
 * GET /public/rounds/active — contract + grouping (RV = Rounds Visibility)
 * ========================================================================
 *
 * Bug (analysis 2026-11-03):
 *   Section "รอบรับสมัครที่เปิดอยู่" บนหน้าแรกมีรอบที่ปิดไปแล้วปนอยู่
 *   เพราะ endpoint กรองแค่ status = 'ACTIVE' ไม่เทียบ closeDate
 *   → รอบ ACTIVE ที่เลยกำหนดปิดยังถูกส่งขึ้นหน้าแรก
 *
 * ครอบคลุม (RV):
 *   RV1. response มี groups { open, upcoming, closed } + serverTime
 *   RV2. ACTIVE ที่เลย closeDate → อยู่ closed ไม่ใช่ open (เคส bug หลัก)
 *   RV3. ACTIVE ที่ยังไม่ถึง openDate → อยู่ upcoming
 *   RV4. status CLOSED → อยู่ closed แม้อยู่ในช่วงวันที่
 *   RV5. status DRAFT → ไม่ปรากฏในกลุ่มใดเลย
 *   RV6. deletedAt ไม่ null → ไม่ปรากฏ (archived)
 *   RV7. ลำดับ: open = closeDate ASC, upcoming = openDate ASC, closed = closeDate DESC
 *   RV8. legacy `data` = เฉพาะรอบที่เปิดจริง (backward compatible กับ /lookup)
 *   RV9. boundary: closeDate พอดี → open, เกิน 1 วินาที → closed
 *
 * รัน SQL จริงบน better-sqlite3 ผ่าน D1 adapter + mount publicRoutes จริง
 *
 * Run: node --import tsx src/routes/__tests__/rounds-visibility.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { publicRoutes } from '../public.routes';

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
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertArrayEqual(actual: any[], expected: any[], msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`);
}

// ── D1-compatible adapter ──
function createD1Adapter(sqlite: Database.Database) {
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
  CREATE TABLE templates (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE template_versions (id TEXT PRIMARY KEY, template_id TEXT NOT NULL, version_number INTEGER NOT NULL, status TEXT DEFAULT 'DRAFT');
  CREATE TABLE template_sections (id TEXT PRIMARY KEY, template_version_id TEXT NOT NULL, name TEXT NOT NULL, display_order INTEGER NOT NULL, is_active INTEGER DEFAULT 1, created_at INTEGER, updated_at INTEGER);
  CREATE TABLE field_master (
    id TEXT PRIMARY KEY, field_type TEXT NOT NULL, label_th TEXT NOT NULL,
    default_options TEXT, pdf_mapping_key TEXT, section TEXT, help_text TEXT,
    placeholder TEXT, validation_type TEXT, validation_message TEXT,
    file_config TEXT, allow_other INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1
  );
  CREATE TABLE template_fields (
    id TEXT PRIMARY KEY, template_version_id TEXT NOT NULL, field_id TEXT NOT NULL,
    section_id TEXT, display_order INTEGER NOT NULL, is_required INTEGER DEFAULT 1,
    override_options TEXT, override_label_th TEXT, allow_other INTEGER,
    help_text TEXT, placeholder TEXT, validation_message TEXT,
    rows INTEGER, min_length INTEGER, max_length INTEGER
  );
  CREATE TABLE recruitment_rounds (
    id TEXT PRIMARY KEY, template_version_id TEXT NOT NULL, title TEXT NOT NULL,
    position_level TEXT NOT NULL, open_date INTEGER NOT NULL, close_date INTEGER NOT NULL,
    status TEXT DEFAULT 'ACTIVE', created_at INTEGER, deleted_at INTEGER,
    announcement_title TEXT, announcement_description TEXT, contact_information TEXT,
    remark TEXT, application_pattern TEXT, round_code TEXT
  );
`);

const NOW = Date.now();
const SEC = 1000;
const DAY = 24 * 60 * 60 * SEC;
/** unix seconds จาก offset (วัน) เทียบกับตอนนี้ */
const at = (days: number) => Math.floor((NOW + days * DAY) / SEC);

sqlite.exec(`
  INSERT INTO templates VALUES ('tpl-1','ฟอร์มทดสอบ visibility');
  INSERT INTO template_versions VALUES ('tv-1','tpl-1',1,'PUBLISHED');
`);

// helper: ใส่รอบ 1 แถว
function seedRound(id: string, title: string, openDays: number, closeDays: number, status = 'ACTIVE', deletedAt: number | null = null) {
  sqlite.prepare(`
    INSERT INTO recruitment_rounds
      (id, template_version_id, title, position_level, open_date, close_date, status, round_code, deleted_at)
    VALUES (?, 'tv-1', ?, 'ระดับต้น', ?, ?, ?, ?, ?)
  `).run(id, title, at(openDays), at(closeDays), status, id.toUpperCase(), deletedAt);
}

// ── Seed ──
// open: 2 รอบ (ใกล้ปิด / ไกลปิด)
seedRound('open-near', 'เปิดอยู่ (ใกล้ปิด)', -5, 2);
seedRound('open-far', 'เปิดอยู่ (ไกลปิด)', -1, 20);
// upcoming: 2 รอบ
seedRound('up-late', 'จะเปิด (ช้า)', 10, 40);
seedRound('up-soon', 'จะเปิด (เร็ว)', 3, 30);
// closed: 3 รอบ (ปิดล่าสุด / กลาง / นานแล้ว)
seedRound('closed-recent', 'ปิดแล้ว (ล่าสุด)', -40, -5);
seedRound('closed-mid', 'ปิดแล้ว (กลาง)', -70, -30);
seedRound('closed-old', 'ปิดแล้ว (นาน)', -200, -150);
// closed by status แม้อยู่ในช่วงวันที่
seedRound('closed-by-status', 'ปิดโดย status', -5, 10, 'CLOSED');
// draft — ต้องไม่โผล่
seedRound('draft-1', 'ร่าง', -5, 10, 'DRAFT');
// archived — ต้องไม่โผล่
seedRound('archived-1', 'ถูกลบ', -5, 10, 'ACTIVE', Math.floor(NOW / SEC));

const app = new Hono();
app.route('/api/v1/public', publicRoutes);

const d1 = createD1Adapter(sqlite);
const env = () => ({ DB: d1, JWT_SECRET: 'test-secret', RATE_LIMIT_PER_MINUTE: '1000' });

async function getActive() {
  const res = await app.request('/api/v1/public/rounds/active', {}, env());
  assertEqual(res.status, 200, 'status');
  return res.json();
}

const ids = (rows: any[]) => rows.map((r) => r.id);

async function main() {
  console.log('\n=== RV: GET /public/rounds/active ===\n');

  const json = await getActive();

  await test('RV1: response มี groups {open, upcoming, closed} + serverTime', () => {
    if (!json.groups) throw new Error('missing groups');
    if (!Array.isArray(json.groups.open)) throw new Error('groups.open not array');
    if (!Array.isArray(json.groups.upcoming)) throw new Error('groups.upcoming not array');
    if (!Array.isArray(json.groups.closed)) throw new Error('groups.closed not array');
    if (typeof json.serverTime !== 'number') throw new Error('serverTime not a number');
  });

  await test('RV2: ACTIVE ที่เลย closeDate → closed ไม่ใช่ open (เคส bug หลัก)', () => {
    const openIds = ids(json.groups.open);
    if (openIds.includes('closed-recent')) throw new Error('closed-recent leaked into open');
    if (openIds.includes('closed-mid')) throw new Error('closed-mid leaked into open');
    if (openIds.includes('closed-old')) throw new Error('closed-old leaked into open');
    const closedIds = ids(json.groups.closed);
    if (!closedIds.includes('closed-recent')) throw new Error('closed-recent missing from closed');
  });

  await test('RV3: ACTIVE ที่ยังไม่ถึง openDate → upcoming', () => {
    assertArrayEqual(ids(json.groups.upcoming), ['up-soon', 'up-late'], 'upcoming order');
  });

  await test('RV4: status CLOSED → closed แม้อยู่ในช่วงวันที่', () => {
    if (!ids(json.groups.closed).includes('closed-by-status')) {
      throw new Error('closed-by-status missing from closed');
    }
    if (ids(json.groups.open).includes('closed-by-status')) {
      throw new Error('closed-by-status leaked into open');
    }
  });

  await test('RV5: status DRAFT → ไม่ปรากฏในกลุ่มใดเลย', () => {
    const all = [...ids(json.groups.open), ...ids(json.groups.upcoming), ...ids(json.groups.closed)];
    if (all.includes('draft-1')) throw new Error('draft-1 must not appear');
  });

  await test('RV6: deletedAt ไม่ null → ไม่ปรากฏ (archived)', () => {
    const all = [...ids(json.groups.open), ...ids(json.groups.upcoming), ...ids(json.groups.closed)];
    if (all.includes('archived-1')) throw new Error('archived-1 must not appear');
  });

  await test('RV7a: open เรียง closeDate ASC (ใกล้ปิดก่อน)', () => {
    assertArrayEqual(ids(json.groups.open), ['open-near', 'open-far'], 'open order');
  });

  await test('RV7b: closed เรียง closeDate DESC (ปิดล่าสุดก่อน)', () => {
    // closed-by-status มี closeDate = now+10d (ยังไม่ถึงกำหนด แต่ status = CLOSED)
    // → closeDate ล่าสุดจริง จึงต้องมาก่อน closed-recent (now-5d)
    assertArrayEqual(
      ids(json.groups.closed),
      ['closed-by-status', 'closed-recent', 'closed-mid', 'closed-old'],
      'closed order',
    );
  });

  await test('RV8: legacy data = เฉพาะรอบที่เปิดจริง (backward compatible)', () => {
    assertArrayEqual(ids(json.data), ['open-near', 'open-far'], 'legacy data');
  });

  await test('RV9: boundary — closeDate พอดี → open, เกิน 1 วินาที → closed', async () => {
    // closeDate ต้องเป็นอนาคตเล็กน้อย: close_date เก็บเป็นวินาที (ปัดลง)
    // ถ้าตั้ง = now พอดี ค่าที่ปัดลงจะกลายเป็นอดีตไปแล้ว
    const closeSec = Math.floor(Date.now() / SEC) + 2;
    sqlite.prepare(`
      INSERT INTO recruitment_rounds
        (id, template_version_id, title, position_level, open_date, close_date, status, round_code)
      VALUES ('boundary-now','tv-1','ขอบเขต','ระดับต้น',?,?,'ACTIVE','BND01')
    `).run(closeSec - 3600, closeSec);

    const j1 = await getActive();
    if (!ids(j1.groups.open).includes('boundary-now')) {
      throw new Error('ยังไม่ถึง closeDate ต้องอยู่ open');
    }

    // ขยับ closeDate ถอยไปในอดีต → ต้องกลายเป็น closed ทันที
    sqlite.prepare(`UPDATE recruitment_rounds SET close_date = ? WHERE id = 'boundary-now'`)
      .run(Math.floor(Date.now() / SEC) - 2);

    const j2 = await getActive();
    if (ids(j2.groups.open).includes('boundary-now')) {
      throw new Error('เลย closeDate แล้วต้องไม่อยู่ open');
    }
    if (!ids(j2.groups.closed).includes('boundary-now')) {
      throw new Error('เลย closeDate แล้วต้องอยู่ closed');
    }
  });

  await test('RV10: ไม่มีรอบที่ปิดแล้วหลุดเข้า open เลย (ทั้งชุด)', () => {
    const nowMs = Date.now();
    for (const r of json.groups.open) {
      const closeMs = new Date(r.closeDate).getTime();
      if (closeMs < nowMs) {
        throw new Error(`${r.id} ปิดแล้วแต่ยังอยู่ใน open`);
      }
      if (String(r.status).toUpperCase() !== 'ACTIVE') {
        throw new Error(`${r.id} status ไม่ใช่ ACTIVE แต่อยู่ใน open`);
      }
    }
  });

  console.log('\n=== Summary ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  if (failed > 0) process.exit(1);
}

main();
