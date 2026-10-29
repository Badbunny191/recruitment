/**
 * Benchmark: แยกวัดแต่ละ lever ของ GET /admin/applications/summary
 * ================================================================
 * ต้องการตอบให้ชัดว่า lever ไหนได้ผลเท่าไร บนข้อมูลชุดเดียวกัน
 *
 *   L0  current            : count(*) แล้ว GROUP BY (2 query, sequential)
 *   L1  drop redundant     : GROUP BY ครั้งเดียว total = ผลบวก groups
 *   L2  L1 + covering index: (round_id, status, deleted_at)
 *
 * วัดทั้ง "เวลา" และ "จำนวน round trip" — บน D1 round trip คือต้นทุนจริง
 *
 * Run: node --import tsx scripts/bench-summary-levers.ts
 */

// @ts-nocheck
import Database from 'better-sqlite3';

const ROUNDS = 20;
const PER_ROUND = 2500;

function createSchema(sqlite: Database.Database, coveringIndex: boolean) {
  sqlite.exec(`
    CREATE TABLE applications (
      id TEXT PRIMARY KEY,
      application_no TEXT,
      round_id TEXT NOT NULL,
      email TEXT NOT NULL,
      fullname TEXT NOT NULL,
      status TEXT DEFAULT 'SUBMITTED',
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
    CREATE UNIQUE INDEX idx_apps_round_email
      ON applications(round_id, email)
      WHERE status != 'CANCELED' AND deleted_at IS NULL;
  `);
  if (coveringIndex) {
    sqlite.exec(`CREATE INDEX idx_apps_round_status_deleted ON applications(round_id, status, deleted_at);`);
  }
}

function seed(sqlite: Database.Database) {
  const insert = sqlite.prepare(`
    INSERT INTO applications (id, application_no, round_id, email, fullname, status, form_data, submitted_at, deleted_at, year, round_code, seq_in_round)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const statuses = ['SUBMITTED','SUBMITTED','SUBMITTED','QUALIFIED','REJECTED','CANCELED','DRAFT','ARCHIVED'];
  const now = Math.floor(Date.now() / 1000);
  const formData = JSON.stringify({ fields: Array.from({ length: 24 }, (_, i) => ({ id: `f${i}`, label: `field ${i}`, value: 'x'.repeat(40) })) });
  sqlite.transaction(() => {
    for (let r = 0; r < ROUNDS; r++) {
      for (let i = 0; i < PER_ROUND; i++) {
        insert.run(`app-${r}-${i}`, `APP-2026-${r}-${i}`, `round-${r}`, `u${r}-${i}@test.com`,
          `ผู้สมัคร ${r}-${i}`, statuses[(r + i) % statuses.length], formData,
          now - (i % 400) * 86_400, i % 97 === 0 ? now - 86_400 : null, 2026, `RC-${r}`, i);
      }
    }
  })();
}

function median(fn: () => void, iterations = 60) {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

const Q_COUNT = `SELECT count(*) AS count FROM applications WHERE deleted_at IS NULL AND round_id = ?`;
const Q_GROUPS = `SELECT status, count(*) AS count FROM applications WHERE deleted_at IS NULL AND round_id = ? GROUP BY status`;

function planOf(sqlite: Database.Database, sql: string) {
  return sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('round-0').map((r: any) => r.detail).join(' | ');
}

function scenario(label: string, coveringIndex: boolean) {
  const sqlite = new Database(':memory:');
  createSchema(sqlite, coveringIndex);
  seed(sqlite);

  const stmtCount = sqlite.prepare(Q_COUNT);
  const stmtGroups = sqlite.prepare(Q_GROUPS);

  const l0 = median(() => { stmtCount.get('round-0'); stmtGroups.all('round-0'); });
  const l1 = median(() => { stmtGroups.all('round-0'); });

  // parity
  const totalFromCount = (stmtCount.get('round-0') as any).count;
  const groups = stmtGroups.all('round-0') as any[];
  const sumGroups = groups.reduce((a, g) => a + Number(g.count), 0);

  console.log(`\n=== ${label} ===`);
  console.log(`  plan count(*) : ${planOf(sqlite, Q_COUNT)}`);
  console.log(`  plan group by : ${planOf(sqlite, Q_GROUPS)}`);
  console.log(`  L0 current (2 queries, 2 round trips): ${l0.toFixed(2)} ms`);
  console.log(`  L1 drop redundant count(*) (1 query) : ${l1.toFixed(2)} ms   → ${(l0 / l1).toFixed(2)}x`);
  console.log(`  parity: count(*)=${totalFromCount} sum(groups)=${sumGroups} match=${totalFromCount === sumGroups}`);
  sqlite.close();
  return { l0, l1 };
}

console.log(`Applications Summary — lever isolation  (${ROUNDS} rounds x ${PER_ROUND} = ${(ROUNDS * PER_ROUND).toLocaleString()} rows)`);
console.log('in-memory SQLite: ไม่มี network hop — ดูสัดส่วน + plan');

const noIdx = scenario('WITHOUT covering index (today)', false);
const withIdx = scenario('WITH covering index (round_id, status, deleted_at)', true);

console.log('\n─────────────────────────────────────────────');
console.log('สรุป');
console.log('─────────────────────────────────────────────');
console.log(`L0 → L1 (ตัด query ซ้ำ)          : ${(noIdx.l0 / noIdx.l1).toFixed(2)}x  + ลด 1 round trip`);
console.log(`L0 → L1+index (covering)         : ${(noIdx.l0 / withIdx.l1).toFixed(2)}x  + ลด 1 round trip`);
console.log(`L1 → L1+index (เฉพาะ index)      : ${(noIdx.l1 / withIdx.l1).toFixed(2)}x`);
