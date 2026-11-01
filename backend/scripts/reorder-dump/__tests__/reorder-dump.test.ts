/**
 * Reorder Dump — unit tests (Restore Drill fix, Phase 0+1)
 * =======================================================================
 *
 * ครอบ matrix ตาม SPEC.md §9 — รหัสเคส:
 *   S1-S9  splitter (multi-line, ';' / newline / '' ใน string, comment, CRLF,
 *          epilogue, unterminated)
 *   C1-C5  classify (TRIGGER/unknown ล้มดัง, PRAGMA/BEGIN/COMMIT, ชื่อ quote
 *          ทุกแบบ, IF NOT EXISTS)
 *   G1-G7  fk-graph (REFERENCES ทุกรูปแบบ, CHECK/string ไม่ false edge,
 *          self-FK, topo, cycle path, missing parent)
 *   R1-R8  reorder (ลำดับ 7 ชั้น, parity, idempotent, deterministic, unknown
 *          DML, BEGIN/COMMIT pin)
 *   V1-V5  verify (raw ล้ม FK-ON = fail-before-fix, ordered ผ่าน FK-ON,
 *          foreign_key_check ว่าง, sqlite_sequence counter, raw↔ordered counts)
 *   L1-L4  CLI (exit codes, report schema, ไม่เขียน output เมื่อล้ม, --verify)
 *
 * หลักการ: ไม่มี network ไม่มี Cloudflare — replay ใช้ better-sqlite3 in-memory
 * fixture ทั้งหมดสังเคราะห์ ไม่มี PII (SPEC.md §9)
 *
 * รัน: node --import tsx scripts/reorder-dump/__tests__/reorder-dump.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';

import { splitStatements, SqlParseError } from '../lib/split-statements';
import { classifyStatement, classifyAll, UnsupportedStatementError } from '../lib/classify';
import { extractReferences, extractTableDefs, topoSort } from '../lib/fk-graph';
import { reorderDump, multisetEqual, ReorderCycleError, InvalidDumpError, InvariantError } from '../lib/reorder';
import { checkOrderingInvariants } from '../lib/invariants';
import { replay } from '../lib/verify';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES = join(HERE, 'fixtures');
const BACKEND_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const CLI = join(BACKEND_ROOT, 'scripts/reorder-dump/reorder-dump.ts');

const readFixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const mk = (text: string) => ({ text, startLine: 1, endLine: 1 });
const texts = (sql: string) => splitStatements(sql).map((s) => s.text);
const classifyTexts = (sql: string) => classifyAll(splitStatements(sql));

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  ✗ ${name}: ${e?.message ?? e}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(
      `${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertDeep(actual, expected, msg = '') {
  const norm = (v) => JSON.stringify(v, (_k, val) => (val instanceof Object && !Array.isArray(val) ? sortKeys(val) : val));
  const sortKeys = (o) => Object.keys(o).sort().reduce((acc, k) => ((acc[k] = o[k]), acc), {});
  if (norm(actual) !== norm(expected)) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition, msg = '') {
  if (!condition) throw new Error(msg || 'assertion failed');
}

function runCli(args: string[]) {
  try {
    const stdout = execFileSync(process.execPath, ['--import', 'tsx', CLI, ...args], {
      cwd: BACKEND_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    return {
      status: e.status ?? -1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? String(e.message),
    };
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'reorder-dump-test-'));

async function runAllTests() {
  console.log('── Splitter (S) ──────────────────────────────────────────');

  await test('S1 multi-line CREATE TABLE เป็น statement เดียว', () => {
    const stmts = splitStatements('CREATE TABLE `t` (\n\t`a` text,\n\t`b` text\n);');
    assertEqual(stmts.length, 1);
    assertTrue(stmts[0].text.includes('`a` text,') && stmts[0].text.includes('`b` text'));
    assertEqual(stmts[0].startLine, 1);
  });

  await test("S2 ';' ใน single-quoted string ไม่แตก statement", () => {
    const stmts = splitStatements("INSERT INTO t VALUES('a;b');\nINSERT INTO t VALUES('c');");
    assertEqual(stmts.length, 2);
  });

  await test("S3 '' escape ใน string", () => {
    const stmts = splitStatements("INSERT INTO t VALUES('it''s; fine');");
    assertEqual(stmts.length, 1);
    assertTrue(stmts[0].text.includes("it''s; fine"));
  });

  await test('S4 newline จริงใน string (multi-line INSERT แบบ dump จริง)', () => {
    const stmts = splitStatements("INSERT INTO t VALUES('line1\nline2; still');\nCREATE TABLE t2(a);");
    assertEqual(stmts.length, 2);
    assertTrue(stmts[0].text.includes('\n'));
  });

  await test("S5 '--' comment ที่มี ';' ไม่แตก statement", () => {
    const stmts = splitStatements('-- comment; with semicolon\nCREATE TABLE t(a);');
    assertEqual(stmts.length, 1);
  });

  await test('S6 block comment /* ; */ + statement หลายบรรทัด', () => {
    const stmts = splitStatements('/* a;b */ CREATE TABLE t(\n a /* ; */\n);');
    assertEqual(stmts.length, 1);
  });

  await test('S7 CRLF input', () => {
    const stmts = splitStatements('CREATE TABLE t(a);\r\nINSERT INTO t VALUES(1);\r\n');
    assertEqual(stmts.length, 2);
  });

  await test('S8 comment-only ท้ายไฟล์ = epilogue', () => {
    const stmts = splitStatements('CREATE TABLE t(a);\n-- trailing note\n');
    assertEqual(stmts.length, 2);
    assertEqual(classifyStatement(stmts[1]).kind, 'epilogue');
  });

  await test('S9 code ไม่ปิด ";" → SqlParseError', () => {
    let threw = false;
    try {
      splitStatements('CREATE TABLE t(a)');
    } catch (e) {
      threw = e instanceof SqlParseError;
    }
    assertTrue(threw, 'must throw SqlParseError');
  });

  console.log('── Classify (C) ──────────────────────────────────────────');

  await test('C1 CREATE TRIGGER → ล้มดัง (UnsupportedStatementError)', () => {
    let threw = false;
    try {
      classifyStatement(mk('CREATE TRIGGER trg AFTER INSERT ON t BEGIN INSERT INTO x VALUES(1); END;'));
    } catch (e) {
      threw = e instanceof UnsupportedStatementError;
      assertTrue(String(e.message).includes('TRIGGER'));
    }
    assertTrue(threw, 'CREATE TRIGGER must fail loudly');
  });

  await test('C2 statement นอกชุด d1 export (VACUUM) → ล้มดัง', () => {
    let threw = false;
    try {
      classifyStatement(mk('VACUUM;'));
    } catch (e) {
      threw = e instanceof UnsupportedStatementError;
    }
    assertTrue(threw);
  });

  await test('C3 PRAGMA / BEGIN / COMMIT / END TRANSACTION', () => {
    assertEqual(classifyStatement(mk('PRAGMA defer_foreign_keys=TRUE;')).kind, 'pragma');
    assertEqual(classifyStatement(mk('BEGIN TRANSACTION;')).kind, 'txnBegin');
    assertEqual(classifyStatement(mk('COMMIT;')).kind, 'txnCommit');
    assertEqual(classifyStatement(mk('END TRANSACTION;')).kind, 'txnCommit');
  });

  await test('C4 ชื่อตาราง quote ทุกแบบ + schema-qualified', () => {
    assertEqual(classifyStatement(mk('INSERT INTO "my table" VALUES(1);')).table, 'my table');
    assertEqual(classifyStatement(mk('DELETE FROM `x`;')).table, 'x');
    assertEqual(classifyStatement(mk('DELETE FROM [y];')).table, 'y');
    assertEqual(classifyStatement(mk('INSERT INTO main.z VALUES(1);')).table, 'z');
  });

  await test('C5 IF NOT EXISTS ทั้ง TABLE และ INDEX', () => {
    assertEqual(classifyStatement(mk('CREATE TABLE IF NOT EXISTS "apps" (id text);')).table, 'apps');
    const idx = classifyStatement(mk('CREATE UNIQUE INDEX IF NOT EXISTS i1 ON "apps" (id);'));
    assertEqual(idx.kind, 'index');
    assertEqual(idx.table, 'apps');
  });

  console.log('── FK graph (G) ──────────────────────────────────────────');

  await test('G1 column-level REFERENCES: backtick / double-quote / bare', () => {
    const refs = extractReferences(
      'CREATE TABLE "a" (\n `b_id` text REFERENCES `p`(`id`),\n "c_id" text REFERENCES "q"(`id`),\n d_id text REFERENCES r(id)\n)',
    );
    assertDeep(refs, ['p', 'q', 'r']);
  });

  await test('G2 table-level FOREIGN KEY + schema-qualified parent', () => {
    const refs = extractReferences(
      'CREATE TABLE a (x text, FOREIGN KEY (x) REFERENCES main.parent(id))',
    );
    assertDeep(refs, ['parent']);
  });

  await test('G3 CHECK ที่มีชื่อตาราง + REFERENCES ใน string = ไม่เป็น edge / lowercase references = เป็น edge', () => {
    const refs = extractReferences(
      'CREATE TABLE "notes" (\n body text,\n status text DEFAULT \'DRAFT\',\n CONSTRAINT "chk" CHECK("notes"."status" IN (\'DRAFT\', \'REFERENCES nothing\'))\n)',
    );
    assertDeep(refs, []);
    assertDeep(extractReferences('CREATE TABLE c (p text references parent(id))'), ['parent']);
  });

  await test('G4 self-FK ไม่นับเป็น cycle (raw-selfref topo ผ่าน)', () => {
    const defs = extractTableDefs(classifyTexts(readFixture('raw-selfref.sql')).filter((c) => c.kind === 'table'));
    const topo = topoSort(defs);
    assertDeep(topo.order, ['categories', 'items']);
  });

  await test('G5 raw-basic topo: แม่ (recruitment_rounds) มาก่อนลูก (applications)', () => {
    const defs = extractTableDefs(classifyTexts(readFixture('raw-basic.sql')).filter((c) => c.kind === 'table'));
    const topo = topoSort(defs);
    assertDeep(topo.order, ['recruitment_rounds', 'applications']);
  });

  await test('G6 cycle fixture → topo รายงานวงจร a -> b -> a', () => {
    const defs = extractTableDefs(classifyTexts(readFixture('raw-cycle.sql')).filter((c) => c.kind === 'table'));
    const topo = topoSort(defs);
    assertDeep(topo.cycle, ['a', 'b', 'a']);
  });

  await test('G7 FK ไปตารางนอก dump → warning ไม่ crash (raw-tricky orphans)', () => {
    const res = reorderDump(readFixture('raw-tricky.sql'));
    assertTrue(
      res.report.warnings.some((w) => w.includes("'orphans' REFERENCES 'missing_table'")),
      `warnings: ${JSON.stringify(res.report.warnings)}`,
    );
  });

  console.log('── Reorder (R) ───────────────────────────────────────────');

  await test('R1 raw-basic: ลำดับครบ 7 ชั้น pragma→create(แม่ก่อน)→index→dml(แม่ก่อน)', () => {
    const res = reorderDump(readFixture('raw-basic.sql'));
    const cs = classifyTexts(res.outputSql);
    assertEqual(cs.length, 7);
    // statement แรกคือ PRAGMA — fixture comment หัวไฟล์เดินทางมากับมันตามดีไซน์
    assertEqual(cs[0].kind, 'pragma');
    assertTrue(cs[0].stmt.text.endsWith('PRAGMA defer_foreign_keys=TRUE;'));
    assertDeep(cs.filter((c) => c.kind === 'table').map((c) => c.table), ['recruitment_rounds', 'applications']);
    const indexPositions = cs.map((c, i) => (c.kind === 'index' ? i : -1)).filter((i) => i >= 0);
    const lastTablePos = Math.max(...cs.map((c, i) => (c.kind === 'table' ? i : -1)));
    const firstDmlPos = cs.findIndex((c) => c.kind === 'dml');
    assertTrue(indexPositions.every((i) => i > lastTablePos && i < firstDmlPos), 'indexes ต้องอยู่หลัง CREATE ทุกตัว หน้า DML ทุกตัว');
    assertTrue(cs[5].stmt.text.includes("'round-1'"), 'insert แม่ก่อน');
    assertTrue(cs[6].stmt.text.includes("'app-1'"), 'insert ลูกทีหลัง');
  });

  await test('R2 raw-tricky: index หลังตารางครบ + กลุ่ม DML เรียง topo', () => {
    const res = reorderDump(readFixture('raw-tricky.sql'));
    const cs = classifyTexts(res.outputSql);
    assertDeep(cs.filter((c) => c.kind === 'table').map((c) => c.table), ['notes', 'note_links', 'orphans']);
    assertDeep(cs.filter((c) => c.kind === 'dml').map((c) => c.table), ['notes', 'note_links', 'orphans']);
    const indexPos = cs.findIndex((c) => c.kind === 'index');
    const lastTablePos = Math.max(...cs.map((c, i) => (c.kind === 'table' ? i : -1)));
    const firstDmlPos = cs.findIndex((c) => c.kind === 'dml');
    assertTrue(indexPos > lastTablePos && indexPos < firstDmlPos);
  });

  await test('R3 raw-selfref: sqlite_sequence อยู่ท้ายสุด DELETE ก่อน INSERT', () => {
    const res = reorderDump(readFixture('raw-selfref.sql'));
    const cs = classifyTexts(res.outputSql);
    const t = cs.map((c) => c.stmt.text);
    assertEqual(t[t.length - 2], 'DELETE FROM sqlite_sequence;');
    assertTrue(t[t.length - 1].startsWith('INSERT INTO "sqlite_sequence"'), t[t.length - 1]);
    const lastOtherDml = Math.max(...cs.map((c, i) => (c.kind === 'dml' && c.table !== 'sqlite_sequence' ? i : -1)));
    assertTrue(lastOtherDml < t.length - 2, 'sqlite_sequence ต้องมาหลัง DML อื่นทั้งหมด');
  });

  await test('R4 multiset parity ผ่านทุก fixture (reorder-only ไม่แตะเนื้อ statement)', () => {
    for (const f of ['raw-basic.sql', 'raw-tricky.sql', 'raw-selfref.sql']) {
      const raw = readFixture(f);
      const res = reorderDump(raw);
      assertTrue(multisetEqual(texts(raw), texts(res.outputSql)), f);
    }
  });

  await test('R5 idempotent: reorder(reorder(x)) === reorder(x) byte-identical', () => {
    for (const f of ['raw-basic.sql', 'raw-selfref.sql']) {
      const once = reorderDump(readFixture(f)).outputSql;
      const twice = reorderDump(once).outputSql;
      assertEqual(twice, once, f);
    }
  });

  await test('R6 deterministic: รัน 2 ครั้งได้ bytes เดิม', () => {
    const raw = readFixture('raw-tricky.sql');
    assertEqual(reorderDump(raw).outputSql, reorderDump(raw).outputSql);
  });

  await test('R7 DML ไปตารางที่ไม่มี CREATE → ท้ายกลุ่ม + warning', () => {
    const sql =
      'PRAGMA defer_foreign_keys=TRUE;\nCREATE TABLE t(a);\nINSERT INTO "t" VALUES(1);\nINSERT INTO "ghost" VALUES(2);';
    const res = reorderDump(sql);
    assertTrue(res.report.warnings.some((w) => w.includes("dml targets 'ghost'")));
    assertDeep(classifyTexts(res.outputSql).filter((c) => c.kind === 'dml').map((c) => c.table), ['t', 'ghost']);
  });

  await test('R8 BEGIN/COMMIT ปักหัว-ท้าย + reorder ข้างในได้ถูก', () => {
    const sql =
      'BEGIN TRANSACTION;\nCREATE TABLE child(p_id text REFERENCES p(id));\nINSERT INTO "child" VALUES(1);\nCREATE TABLE p(id text);\nINSERT INTO "p" VALUES(1);\nCOMMIT;';
    const res = reorderDump(sql);
    const cs = classifyTexts(res.outputSql);
    assertEqual(cs[0].kind, 'txnBegin');
    assertEqual(cs[cs.length - 1].kind, 'txnCommit');
    assertDeep(cs.filter((c) => c.kind === 'table').map((c) => c.table), ['p', 'child']);
  });

  await test('R9 cycle ผ่าน pipeline เต็ม → ReorderCycleError (ไม่เขียน output)', () => {
    let threw = false;
    try {
      reorderDump(readFixture('raw-cycle.sql'));
    } catch (e) {
      threw = e instanceof ReorderCycleError;
      assertTrue(String(e.message).includes('a -> b -> a'));
    }
    assertTrue(threw, 'must throw ReorderCycleError');
  });

  console.log('── Verify (V) — better-sqlite3 in-memory ────────────────');

  await test('V1 fail-before-fix: raw basic ล้มภายใต้ FK-ON (พ่อยังไม่ถูกสร้าง)', () => {
    let err = null;
    try {
      replay(readFixture('raw-basic.sql'), 'on');
    } catch (e) {
      err = e;
    }
    assertTrue(err !== null, 'raw dump ต้องล้มกับ FK-ON');
    assertTrue(String(err.message).includes('recruitment_rounds'), `unexpected: ${err?.message}`);
  });

  await test('V2 ordered basic ผ่าน FK-ON + foreign_key_check ว่าง + counts ถูก', () => {
    const ordered = reorderDump(readFixture('raw-basic.sql')).outputSql;
    const r = replay(ordered, 'on');
    assertEqual(r.foreignKeysSetting, 1);
    assertEqual(r.foreignKeyCheckRows, 0);
    assertDeep(r.counts, { applications: 1, recruitment_rounds: 1 });
  });

  await test('V3 ordered selfref: sqlite_sequence counter ถูก restore เป็น 5', () => {
    const ordered = reorderDump(readFixture('raw-selfref.sql')).outputSql;
    const r = replay(ordered, 'on');
    assertDeep(r.counts, { categories: 2, items: 1 });
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      db.exec(ordered);
      assertDeep(db.prepare('SELECT name, seq FROM sqlite_sequence ORDER BY name').all(), [
        { name: 'items', seq: 5 },
      ]);
    } finally {
      db.close();
    }
  });

  await test('V4 tricky (มี missing parent): raw↔ordered counts เท่ากันภายใต้ FK-OFF', () => {
    const raw = readFixture('raw-tricky.sql');
    const ordered = reorderDump(raw).outputSql;
    assertDeep(replay(ordered, 'off').counts, replay(raw, 'off').counts);
    assertEqual(replay(ordered, 'off').counts.notes, 1);
  });

  await test('V5 invariant checker จับลำดับที่ผิดจริง', () => {
    const bad = classifyTexts('INSERT INTO "c" VALUES(1);\nCREATE TABLE c(p text);');
    const violations = checkOrderingInvariants(bad);
    assertTrue(violations.some((v) => v.includes("dml into 'c'")), JSON.stringify(violations));
    const good = classifyTexts('PRAGMA foreign_keys=ON;\nCREATE TABLE c(p text);\nINSERT INTO "c" VALUES(1);');
    assertDeep(checkOrderingInvariants(good), []);
  });

  console.log('── Guards / Blocker fixes (B) ───────────────────────────');

  await test('B1 empty input → InvalidDumpError', () => {
    let threw = false;
    try {
      reorderDump('');
    } catch (e) {
      threw = e instanceof InvalidDumpError;
    }
    assertTrue(threw, 'empty input ต้องล้มดัง ไม่ผลิต ordered file ว่าง');
  });

  await test('B2 whitespace-only → InvalidDumpError', () => {
    let threw = false;
    try {
      reorderDump('   \n\n\t\n');
    } catch (e) {
      threw = e instanceof InvalidDumpError;
    }
    assertTrue(threw);
  });

  await test('B3 comments-only → InvalidDumpError', () => {
    let threw = false;
    try {
      reorderDump('/* header only — no SQL */\n-- และบรรทัด comment\n');
    } catch (e) {
      threw = e instanceof InvalidDumpError;
    }
    assertTrue(threw);
  });

  await test('B4 `;` หายกลางไฟล์ (statement กลืนกัน) → InvalidDumpError', () => {
    let threw = false;
    try {
      reorderDump('CREATE TABLE a(p text)\nCREATE TABLE b(q text REFERENCES a(p));\nINSERT INTO "b" VALUES(1);');
    } catch (e) {
      threw = e instanceof InvalidDumpError;
      assertTrue(String(e.message).includes("';'"), `message: ${e.message}`);
    }
    assertTrue(threw, 'สอง CREATE ที่กลืนกันต้องล้มดัง ไม่ใช่ classify ได้แค่ตารางแรก');
  });

  await test('B5 unterminated block comment → SqlParseError', () => {
    let threw = false;
    try {
      reorderDump('CREATE TABLE t(a);\n/* comment ไม่ปิด');
    } catch (e) {
      threw = e instanceof SqlParseError;
      assertTrue(String(e.message).includes('unterminated block comment'));
    }
    assertTrue(threw, 'ต้องล้มดัง ไม่ปล่อยผ่านเป็น epilogue เงียบ ๆ');
  });

  await test('B6 duplicate CREATE TABLE → InvalidDumpError', () => {
    let threw = false;
    try {
      reorderDump('CREATE TABLE t(a);\nCREATE TABLE t(b);');
    } catch (e) {
      threw = e instanceof InvalidDumpError;
      assertTrue(String(e.message).includes("duplicate CREATE TABLE for 't'"));
    }
    assertTrue(threw);
  });

  await test('B7 130k statements (P1 fix): ไม่ล้น call stack + invariants ผ่าน', () => {
    // เดิม: Math.min/max(...spread) พังที่ ~125k statements — ต้องผ่านด้วย loop
    const parts = ['PRAGMA defer_foreign_keys=TRUE;', 'CREATE TABLE t(id INTEGER PRIMARY KEY AUTOINCREMENT);'];
    for (let i = 0; i < 130000; i++) parts.push(`INSERT INTO "t" VALUES(${i});`);
    const res = reorderDump(parts.join('\n'));
    assertEqual(res.report.statementCounts.input, 130002);
    assertEqual(res.report.statementCounts.output, 130002);
    assertDeep(res.report.insertTableOrder, ['t']);
    assertTrue(res.report.multisetParity && res.report.invariantsOk);
  });

  await test('B8 InvariantError taxonomy: export จาก reorder + name ถูกต้อง', () => {
    const e = new InvariantError('probe');
    assertEqual(e.name, 'InvariantError');
    assertTrue(e instanceof Error);
    assertTrue(typeof InvalidDumpError === 'function');
  });

  console.log('── CLI (L) ───────────────────────────────────────────────');

  await test('L1 success: exit 0 + output + report ครบ field ที่ Phase 2 ใช้', () => {
    const out = join(tmp, 'basic.ordered.sql');
    const rep = join(tmp, 'basic.report.json');
    const r = runCli(['--input', join(FIXTURES, 'raw-basic.sql'), '--output', out, '--report', rep]);
    assertEqual(r.status, 0, `stderr: ${r.stderr}`);
    assertTrue(existsSync(out));
    assertTrue(r.stdout.includes('reorder-dump: OK'));
    const report = JSON.parse(readFileSync(rep, 'utf8'));
    assertEqual(report.ok, true);
    assertEqual(report.multisetParity, true);
    assertEqual(report.invariantsOk, true);
    assertDeep(report.tableOrder, ['recruitment_rounds', 'applications']);
    assertDeep(report.insertTableOrder, ['recruitment_rounds', 'applications']);
    assertEqual(report.outputSha256.length, 64);
    assertEqual(report.statementCounts.input, report.statementCounts.output);
  });

  await test('L2 cycle: exit 1 + ไม่เขียนไฟล์ output + report ระบุวงจร', () => {
    const out = join(tmp, 'cycle.ordered.sql');
    const rep = join(tmp, 'cycle.report.json');
    const r = runCli(['--input', join(FIXTURES, 'raw-cycle.sql'), '--output', out, '--report', rep]);
    assertEqual(r.status, 1);
    assertTrue(!existsSync(out), 'ต้องไม่เขียน output เมื่อล้ม');
    const report = JSON.parse(readFileSync(rep, 'utf8'));
    assertEqual(report.ok, false);
    assertEqual(report.error.code, 'CYCLE');
    assertTrue(report.error.message.includes('a -> b -> a'));
  });

  await test('L3 usage ผิด → exit 2', () => {
    assertEqual(runCli([]).status, 2);
    assertEqual(runCli(['--input', join(FIXTURES, 'raw-basic.sql')]).status, 2);
    assertEqual(runCli(['--bogus']).status, 2);
  });

  await test('L4 --verify: replay FK-ON + raw parity ลง report', () => {
    const out = join(tmp, 'basic.verify.sql');
    const rep = join(tmp, 'basic.verify.json');
    const r = runCli([
      '--input', join(FIXTURES, 'raw-basic.sql'),
      '--output', out,
      '--report', rep,
      '--verify',
    ]);
    assertEqual(r.status, 0, `stderr: ${r.stderr}`);
    const report = JSON.parse(readFileSync(rep, 'utf8'));
    assertEqual(report.verify.replayed, true);
    assertEqual(report.verify.orderedFkOn, true);
    assertEqual(report.verify.foreignKeyCheckRows, 0);
    assertEqual(report.verify.rawFkOffCountMatch, true);
    assertDeep(report.verify.rowCounts, { applications: 1, recruitment_rounds: 1 });
  });

  await test('L5 CLI: empty input → exit 1 + report INVALID + ไม่เขียน output', () => {
    const emptyPath = join(tmp, 'empty.sql');
    writeFileSync(emptyPath, '   \n\n');
    const out = join(tmp, 'empty.out.sql');
    const rep = join(tmp, 'empty.report.json');
    const r = runCli(['--input', emptyPath, '--output', out, '--report', rep]);
    assertEqual(r.status, 1, `stderr: ${r.stderr}`);
    assertTrue(!existsSync(out), 'ต้องไม่เขียน output');
    assertTrue(r.stderr.includes('[INVALID]'), r.stderr);
    const report = JSON.parse(readFileSync(rep, 'utf8'));
    assertEqual(report.ok, false);
    assertEqual(report.error.code, 'INVALID');
  });

  console.log('');
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    // temp cleanup best-effort
  }

  if (failed > 0) {
    console.log(`FAILED: ${failed}/${passed + failed}`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`PASSED: ${passed}/${passed + failed}`);
}

runAllTests().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
