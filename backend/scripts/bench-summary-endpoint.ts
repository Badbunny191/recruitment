/**
 * Benchmark: GET /admin/applications/summary — end-to-end ผ่าน route จริง
 * ======================================================================
 * วัดบน SQLite จริง ผ่าน Hono จริง ครบ middleware chain
 * (authMiddleware → accountStateGate → handler)
 *
 * วัดอะไร
 *   - จำนวน query ที่ DB ต้องรับต่อ 1 request
 *   - เวลาแยกตาม query (per-statement)
 *   - เวลารวมของ handler
 *   - EXPLAIN QUERY PLAN ของ query ที่เป็นตัวปัญหา
 *   - parity: output ต้องเท่าเดิม
 *
 * Run: node --import tsx scripts/bench-summary-endpoint.ts
 */

// @ts-nocheck
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { adminRoutes } from '../src/routes/admin.routes';

const TEST_JWT_SECRET = 'bench-summary-secret';

// ── instrumented D1 adapter: นับ query + จับเวลาแต่ละ statement ──
function createInstrumentedD1(sqlite: Database.Database) {
  const log: { sql: string; ms: number }[] = [];

  const makeStatement = (sqlText: string) => {
    const stmt = sqlite.prepare(sqlText);
    let boundParams: any[] = [];
    const record = (fn: () => any) => {
      const t0 = process.hrtime.bigint();
      const out = fn();
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      log.push({ sql: sqlText.replace(/\s+/g, ' ').trim(), ms });
      return out;
    };
    const api = {
      bind(...params: any[]) {
        boundParams = params;
        return api;
      },
      async all() {
        return { results: record(() => stmt.all(...boundParams)) };
      },
      async first() {
        return record(() => stmt.get(...boundParams)) ?? null;
      },
      async run() {
        const info = record(() => stmt.run(...boundParams));
        return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
      },
      async raw() {
        return record(() => stmt.raw(true).all(...boundParams));
      },
    };
    return api;
  };

  return {
    d1: {
      prepare: (sqlText: string) => makeStatement(sqlText),
      async batch(statements: any[]) {
        const results = [];
        for (const s of statements) {
          await s.run();
          results.push({ results: [], success: true, meta: { changes: 0 } });
        }
        return results;
      },
    },
    reset: () => { log.length = 0; },
    log,
  };
}

// ── schema: คอลัมน์ครบ + index ชุดเดียวกับ migrations จริง ──
function createSchema(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE admin_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'ADMIN',
      created_at INTEGER DEFAULT (unixepoch()),
      is_active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      password_changed_at INTEGER,
      failed_login_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER,
      password_migrated INTEGER NOT NULL DEFAULT 0,
      last_login_at INTEGER
    );

    CREATE TABLE applications (
      id TEXT PRIMARY KEY,
      application_no TEXT,
      round_id TEXT NOT NULL,
      email TEXT NOT NULL,
      fullname TEXT NOT NULL,
      national_id TEXT,
      status TEXT DEFAULT 'SUBMITTED',
      status_reason TEXT,
      verified_by TEXT,
      verified_at INTEGER,
      form_data TEXT NOT NULL,
      submitted_at INTEGER,
      deleted_at INTEGER,
      year INTEGER,
      round_code TEXT,
      seq_in_round INTEGER
    );

    CREATE INDEX idx_apps_round ON applications(round_id);
    CREATE INDEX idx_apps_status ON applications(status);
    CREATE INDEX idx_apps_round_status ON applications(round_id, status);
    CREATE INDEX idx_apps_year ON applications(year);
    CREATE INDEX idx_apps_round_code ON applications(round_code);
    CREATE INDEX idx_apps_year_round_code ON applications(year, round_code);
    CREATE UNIQUE INDEX idx_apps_round_email
      ON applications(round_id, email)
      WHERE status != 'CANCELED' AND deleted_at IS NULL;
  `);
}

function seed(sqlite: Database.Database, rounds: number, perRound: number) {
  sqlite.prepare(`INSERT INTO admin_users (id, email, password_hash, role, is_active, must_change_password, failed_login_attempts, password_migrated) VALUES ('admin-1','admin@test.com','h','ADMIN',1,0,0,1)`).run();

  const insert = sqlite.prepare(`
    INSERT INTO applications
      (id, application_no, round_id, email, fullname, status, form_data,
       submitted_at, deleted_at, year, round_code, seq_in_round)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const statuses = ['SUBMITTED','SUBMITTED','SUBMITTED','QUALIFIED','REJECTED','CANCELED','DRAFT','ARCHIVED'];
  const now = Math.floor(Date.now() / 1000);
  const formData = JSON.stringify({ fields: Array.from({ length: 24 }, (_, i) => ({ id: `f${i}`, label: `field ${i}`, value: 'x'.repeat(40) })) });

  sqlite.transaction(() => {
    for (let r = 0; r < rounds; r++) {
      for (let i = 0; i < perRound; i++) {
        insert.run(
          `app-${r}-${i}`, `APP-2026-${r}-${i}`, `round-${r}`, `u${r}-${i}@test.com`,
          `ผู้สมัคร ${r}-${i}`, statuses[(r + i) % statuses.length], formData,
          now - (i % 400) * 86_400, i % 97 === 0 ? now - 86_400 : null, 2026, `RC-${r}`, i,
        );
      }
    }
  })();
}

async function main() {
  const sqlite = new Database(':memory:');
  createSchema(sqlite);
  seed(sqlite, 20, 2500); // 50,000 rows, 2,500 per round

  const inst = createInstrumentedD1(sqlite);
  const app = new Hono();
  app.route('/api/v1/admin', adminRoutes);

  const token = await sign({ id: 'admin-1', email: 'admin@test.com', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 }, TEST_JWT_SECRET);

  async function callSummary(roundId?: string) {
    const qs = roundId ? `?roundId=${roundId}` : '';
    return app.request(
      `/api/v1/admin/applications/summary${qs}`,
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
      { DB: inst.d1, JWT_SECRET: TEST_JWT_SECRET },
    );
  }

  // warm-up (ให้ prepared statement cache นิ่ง)
  await callSummary('round-0');

  // ── วัด 1: round-scoped (เส้นทางที่หน้าจริงใช้) ──
  const SAMPLES = 15;
  const times: number[] = [];
  let queryCount = 0;
  let lastBody: any = null;

  for (let i = 0; i < SAMPLES; i++) {
    inst.reset();
    const t0 = process.hrtime.bigint();
    const res = await callSummary('round-0');
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    times.push(ms);
    queryCount = inst.log.length;
    lastBody = await res.json();
  }
  times.sort((a, b) => a - b);

  console.log('=================================================');
  console.log('GET /admin/applications/summary?roundId=round-0');
  console.log('=================================================');
  console.log(`rows: 50,000 total / 2,500 in round-0`);
  console.log(`queries per request: ${queryCount}`);
  console.log(`median: ${times[Math.floor(times.length / 2)].toFixed(2)} ms`);
  console.log(`min:    ${times[0].toFixed(2)} ms`);
  console.log(`max:    ${times[times.length - 1].toFixed(2)} ms`);
  console.log('\n-- query breakdown (1 request) --');
  inst.reset();
  await callSummary('round-0');
  inst.log.forEach((q, i) => {
    console.log(`  [${i + 1}] ${q.ms.toFixed(3)} ms  ${q.sql.slice(0, 110)}`);
  });
  console.log('\n-- response body --');
  console.log(JSON.stringify(lastBody));

  // ── วัด 2: ไม่ส่ง roundId (ทั้งระบบ) ──
  const allTimes: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    inst.reset();
    const t0 = process.hrtime.bigint();
    await callSummary();
    allTimes.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  allTimes.sort((a, b) => a - b);
  console.log('\n-- no roundId (ทั้งระบบ 50,000 แถว) --');
  console.log(`queries per request: ${inst.log.length}`);
  console.log(`median: ${allTimes[Math.floor(allTimes.length / 2)].toFixed(2)} ms`);

  // ── query plan ──
  console.log('\n-- EXPLAIN QUERY PLAN --');
  const planOf = (sql: string, param: any) =>
    sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(param).map((r: any) => r.detail).join(' | ');
  console.log('  count(*):', planOf('SELECT count(*) FROM applications WHERE deleted_at IS NULL AND round_id = ?', 'round-0'));
  console.log('  group by:', planOf('SELECT status, count(*) FROM applications WHERE deleted_at IS NULL AND round_id = ? GROUP BY status', 'round-0'));

  sqlite.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
