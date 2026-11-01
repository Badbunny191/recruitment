/**
 * Reorder pipeline: split → classify → FK topo → ประกอบลำดับ 7 ชั้น (SPEC.md §3)
 * → multiset parity → invariant re-check → คืน output text + report facts.
 *
 * Reorder-only: statement ถูกย้ายทั้งก้อน byte-identical ไม่มีการ rewrite SQL
 */

import { splitStatements } from './split-statements';
import { classifyAll, InvalidDumpError } from './classify';
import type { ClassifiedStatement } from './classify';
import { extractTableDefs, topoSort } from './fk-graph';
import { checkOrderingInvariants, InvariantError } from './invariants';

// re-export ให้ผู้เรียก (CLI/tests) import จาก reorder ที่เดียว
export { InvalidDumpError, InvariantError };

export class ReorderCycleError extends Error {
  readonly cycle: string[];
  constructor(cycle: string[]) {
    super(`foreign key dependency cycle: ${cycle.join(' -> ')} — an FK cycle can never be ` +
      'restored with foreign keys ON regardless of order; fix the schema (SPEC.md §4)');
    this.name = 'ReorderCycleError';
    this.cycle = cycle;
  }
}

export class ParityError extends Error {
  constructor(detail: string) {
    super(`multiset parity failed: ${detail} — output is not a pure permutation of input`);
    this.name = 'ParityError';
  }
}

export interface ReorderReport {
  statementCounts: {
    input: number;
    output: number;
    pragma: number;
    table: number;
    index: number;
    view: number;
    dml: number;
  };
  multisetParity: boolean;
  invariantsOk: boolean;
  tableOrder: string[];
  insertTableOrder: string[];
  warnings: string[];
}

export interface ReorderResult {
  outputSql: string;
  report: ReorderReport;
}

export function reorderDump(sql: string): ReorderResult {
  const classified = classifyAll(splitStatements(sql));

  // Guard: ไฟล์ว่าง/whitespace/comment ล้วน = dump ที่ไม่สมบูรณ์ (export ล้มครึ่งทาง)
  // — ห้ามผลิต ordered file ว่างที่ "สำเร็จเงียบ ๆ"
  if (classified.length === 0 || classified.every((c) => c.kind === 'epilogue')) {
    throw new InvalidDumpError(
      'input contains no SQL statements — empty, whitespace-only or comments-only file (truncated export?)',
    );
  }

  // ── ตาราง + FK graph ─────────────────────────────────────────────────────
  const tableStmts = classified.filter((c) => c.kind === 'table');
  const tableNameSet = new Set<string>();
  for (const t of tableStmts) {
    if (tableNameSet.has(t.table!)) {
      throw new InvalidDumpError(`duplicate CREATE TABLE for '${t.table}'`);
    }
    tableNameSet.add(t.table!);
  }
  const defs = extractTableDefs(tableStmts);
  const topo = topoSort(defs);
  if ('cycle' in topo) throw new ReorderCycleError(topo.cycle);
  const tableOrder = topo.order;

  const warnings: string[] = [];
  for (const d of defs) {
    for (const p of new Set(d.rawParents)) {
      if (p !== d.name && !tableNameSet.has(p)) {
        warnings.push(
          `table '${d.name}' REFERENCES '${p}' which has no CREATE TABLE in the dump ` +
            '(no edge created — restore with FK-ON will fail if rows reference it)',
        );
      }
    }
  }

  // ── DML จัดกลุ่มตามตาราง (คงลำดับเดิมภายในกลุ่ม) ───────────────────────────
  const dmlGroups = new Map<string, ClassifiedStatement[]>();
  for (const c of classified) {
    if (c.kind !== 'dml') continue;
    const group = dmlGroups.get(c.table!) ?? [];
    group.push(c);
    dmlGroups.set(c.table!, group);
  }
  for (const target of dmlGroups.keys()) {
    if (!tableNameSet.has(target) && target !== 'sqlite_sequence') {
      warnings.push(
        `dml targets '${target}' which has no CREATE TABLE in the dump — emitted after ` +
          'all known tables',
      );
    }
  }

  // ── ประกอบลำดับ 7 ชั้นตาม SPEC.md §3 ─────────────────────────────────────
  const out: ClassifiedStatement[] = [];
  const pushKind = (...kinds: ClassifiedStatement['kind'][]) => {
    for (const c of classified) if (kinds.includes(c.kind)) out.push(c);
  };

  pushKind('pragma');
  pushKind('txnBegin');
  for (const name of tableOrder) {
    out.push(tableStmts.find((t) => t.table === name)!);
  }
  pushKind('index', 'view');
  for (const name of tableOrder) {
    // push(...group) กับกลุ่ม >~100k statements ล้น call stack ของ V8 — ห้าม spread
    const group = dmlGroups.get(name);
    if (group) for (const c of group) out.push(c);
  }
  for (const [target, group] of dmlGroups) {
    if (!tableNameSet.has(target) && target !== 'sqlite_sequence') {
      for (const c of group) out.push(c);
    }
  }
  for (const c of classified) {
    if (c.kind === 'dml' && c.table === 'sqlite_sequence') out.push(c);
  }
  pushKind('epilogue');
  pushKind('txnCommit');

  // ── Guard 1: multiset parity (output ต้องเป็น permutation ของ input) ──────
  const inputTexts = classified.map((c) => c.stmt.text);
  const outputTexts = out.map((c) => c.stmt.text);
  if (!multisetEqual(inputTexts, outputTexts)) {
    throw new ParityError('sorted statement lists differ');
  }

  // ── Guard 2: invariant re-check แบบอ่าน output ใหม่ (อิสระจาก pipeline) ────
  const violations = checkOrderingInvariants(out);
  if (violations.length > 0) {
    throw new InvariantError(
      `ordering invariants violated after reorder: ${violations.join('; ')}`,
    );
  }

  const outputSql = out.map((c) => c.stmt.text).join('\n') + '\n';

  const report: ReorderReport = {
    statementCounts: {
      input: classified.length,
      output: out.length,
      pragma: classified.filter((c) => c.kind === 'pragma').length,
      table: tableStmts.length,
      index: classified.filter((c) => c.kind === 'index').length,
      view: classified.filter((c) => c.kind === 'view').length,
      dml: classified.filter((c) => c.kind === 'dml').length,
    },
    multisetParity: true,
    invariantsOk: true,
    tableOrder,
    insertTableOrder: tableOrder.filter((name) => dmlGroups.has(name)),
    warnings,
  };
  return { outputSql, report };
}

export function multisetEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const s of a) counts.set(s, (counts.get(s) ?? 0) + 1);
  for (const s of b) {
    const c = counts.get(s) ?? 0;
    if (c === 0) return false;
    counts.set(s, c - 1);
  }
  return true;
}
