/**
 * Benchmark: GET /admin/applications/summary
 * ==========================================
 * วัด "ก่อน vs หลัง" ของ endpoint summary บน SQLite จริง (better-sqlite3)
 *
 * สิ่งที่วัด
 *   1. จำนวน query ที่ต้องยิง (round trips)
 *   2. EXPLAIN QUERY PLAN — scan หรือ search, ใช้ index ตัวไหน
 *   3. เวลา CPU ฝั่ง SQLite (median ของหลายรอบ)
 *   4. rows examined โดยประมาณ
 *
 * ข้อจำกัดที่ต้องพูดตรง ๆ: better-sqlite3 เป็น in-memory ไม่มี network hop
 * แบบ D1 ดังนั้น "ms สัมบูรณ์" จะน้อยกว่าบน production มาก — ที่เทียบได้จริง
 * คือ "สัดส่วนก่อน/หลัง" กับ "plan ที่ DB เลือกใช้"
 *
 * Run: node --import tsx scripts/bench-applications-summary.ts
 */

import Database from 'better-sqlite3';

// ── schema: คอลัมน์ครบตาม production (รวม form_data ที่เป็น TEXT ก้อนใหญ่) ──
function createSchema(sqlite: Database.Database, opts: { coveringIndex: boolean }) {
  sqlite.exec(`
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

    -- index ชุดเดียวกับ migrations จริง
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

  if (opts.coveringIndex) {
    // สมมติฐานที่ต้องการพิสูจน์: index ที่พา deleted_at มาด้วย
    sqlite.exec(`
      CREATE INDEX idx_apps_round_status_deleted
        ON applications(round_id, status, deleted_at);
    `);
  }
}

// ── seed: จำลองภาระจริง — หลายรอบ รอบหนึ่งใหญ่ ๆ ──
function seed(sqlite: Database.Database, opts: { rounds: number; perRound: number }) {
  const insert = sqlite.prepare(`
    INSERT INTO applications
      (id, application_no, round_id, email, fullname, status, form_data,
       submitted_at, deleted_at, year, round_code, seq_in_round)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const statuses = ['SUBMITTED', 'SUBMITTED', 'SUBMITTED', 'QUALIFIED', 'REJECTED', 'CANCELED', 'DRAFT', 'ARCHIVED'];
  const now = Math.floor(Date.now() / 1000);

  // form_data ก้อนใหญ่พอสมควร — ให้ row width ใกล้ production
  const formData = JSON.stringify({
    fields: Array.from({ length: 24 }, (_, i) => ({
      id: `f${i}`,
      label: `field ${i}`,
      value: 'x'.repeat(40),
    })),
  });

  const tx = sqlite.transaction(() => {
    for (let r = 0; r < opts.rounds; r++) {
      const roundId = `round-${r}`;
      for (let i = 0; i < opts.perRound; i++) {
        const status = statuses[(r + i) % statuses.length];
        insert.run(
          `app-${r}-${i}`,
          `APP-2026-${r}-${i}`,
          roundId,
          `u${r}-${i}@test.com`,
          `ผู้สมัคร ${r}-${i}`,
          status,
          formData,
          now - (i % 400) * 86_400,
          i % 97 === 0 ? now - 86_400 : null, // ~1% ถูกลบ
          2026,
          `RC-${r}`,
          i,
        );
      }
    }
  });
  tx();
}

// ── query ชุดปัจจุบัน: 2 query เรียงกัน (sequential) ──
const Q_TOTAL = `SELECT count(*) AS count FROM applications WHERE deleted_at IS NULL AND round_id = ?`;
const Q_GROUPS = `SELECT status, count(*) AS count FROM applications WHERE deleted_at IS NULL AND round_id = ? GROUP BY status`;

// ── query ที่เสนอ: GROUP BY ครั้งเดียว total = ผลบวกทุก group ──
const Q_COMBINED = `SELECT status, count(*) AS count FROM applications WHERE deleted_at IS NULL AND round_id = ? GROUP BY status`;

function plan(sqlite: Database.Database, sqlText: string) {
  return sqlite
    .prepare(`EXPLAIN QUERY PLAN ${sqlText}`)
    .all('round-0')
    .map((r: any) => r.detail)
    .join(' | ');
}

function timeIt(fn: () => void, iterations: number): { median: number; min: number } {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    const t1 = process.hrtime.bigint();
    samples.push(Number(t1 - t0) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return { median: samples[Math.floor(samples.length / 2)], min: samples[0] };
}

function runScenario(label: string, coveringIndex: boolean, rounds: number, perRound: number) {
  const sqlite = new Database(':memory:');
  createSchema(sqlite, { coveringIndex });
  seed(sqlite, { rounds, perRound });

  const totalRows = (sqlite.prepare('SELECT count(*) AS n FROM applications').get() as any).n;
  const roundRows = (sqlite
    .prepare('SELECT count(*) AS n FROM applications WHERE round_id = ?')
    .get('round-0') as any).n;

  const stmtTotal = sqlite.prepare(Q_TOTAL);
  const stmtGroups = sqlite.prepare(Q_GROUPS);

  // BEFORE: 2 query เรียงกัน
  const before = timeIt(() => {
    stmtTotal.get('round-0');
    stmtGroups.all('round-0');
  }, 40);

  // AFTER: 1 query
  const after = timeIt(() => {
    stmtGroups.all('round-0');
  }, 40);

  // parity: total จาก count(*) ต้องเท่ากับผลบวกของ groups
  const totalRow = stmtTotal.get('round-0') as any;
  const groups = stmtGroups.all('round-0') as any[];
  const sumOfGroups = groups.reduce((acc, g) => acc + Number(g.count), 0);

  console.log(`\n=== ${label} ===`);
  console.log(`  rows: total=${totalRows.toLocaleString()}  in round-0=${roundRows.toLocaleString()}`);
  console.log(`  plan TOTAL  : ${plan(sqlite, Q_TOTAL)}`);
  console.log(`  plan GROUPS : ${plan(sqlite, Q_GROUPS)}`);
  console.log(`  BEFORE (2 queries sequential): median ${before.median.toFixed(2)} ms  min ${before.min.toFixed(2)} ms`);
  console.log(`  AFTER  (1 query)             : median ${after.median.toFixed(2)} ms  min ${after.min.toFixed(2)} ms`);
  console.log(`  speedup: ${(before.median / after.median).toFixed(2)}x`);
  console.log(`  parity: count(*)=${totalRow.count}  sum(groups)=${sumOfGroups}  match=${totalRow.count === sumOfGroups}`);

  sqlite.close();
  return { before: before.median, after: after.median };
}

console.log('Applications Summary — query benchmark');
console.log('หมายเหตุ: in-memory SQLite ไม่มี network hop ของ D1 —');
console.log('          ดู "สัดส่วน" และ "plan" ไม่ใช่ ms สัมบูรณ์');

// สถานการณ์จริง: รอบที่เปิดใช้งานมีผู้สมัครหลักพัน, ทั้งระบบหลักหมื่น
runScenario('A. production-shaped (no covering index)', false, 20, 2500);
runScenario('B. production-shaped (with covering index)', true, 20, 2500);

// สถานการณ์โตขึ้น 10 เท่า — ดูว่า scan เป็นตัวปัญหาเมื่อไหร่
runScenario('C. 10x data (no covering index)', false, 40, 6000);
