/**
 * Ordering invariants — ตรวจลำดับ output แบบ "อ่านใหม่" อิสระจาก pipeline
 * (guard ชั้นที่ 2 ของ SPEC.md §5) เป็นโมดูล pure ไม่พึ่ง better-sqlite3
 */

import type { ClassifiedStatement } from './classify';
import { extractReferences } from './fk-graph';

/** ลำดับ output ผ่าน pipeline แล้วแต่ยังขัด invariant — บั๊กของ pipeline เอง */
export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantError';
  }
}

// Math.min/max(...spread) กับ array ใหญ่ (>~100k args) ล้น call stack ของ V8 —
// dump จริงโตได้ระดับแสน statements จึงต้องห้าม spread เป็นลายลักษณ์อักษร
function minOf(values: number[], initial: number): number {
  let m = initial;
  for (const v of values) if (v < m) m = v;
  return m;
}

function maxOf(values: number[], initial: number): number {
  let m = initial;
  for (const v of values) if (v > m) m = v;
  return m;
}

export function checkOrderingInvariants(seq: ClassifiedStatement[]): string[] {
  const violations: string[] = [];
  const positions = seq.map((_, i) => i);

  const tablePos = new Map<string, number>();
  seq.forEach((c, i) => {
    if (c.kind === 'table' && !tablePos.has(c.table!)) tablePos.set(c.table!, i);
  });

  const idxOf = (pred: (c: ClassifiedStatement) => boolean): number[] =>
    positions.filter((i) => pred(seq[i]));

  // R1: CREATE TABLE ทุกตัวมาก่อน index/view/dml ทุกตัว
  const lastTable = maxOf(idxOf((c) => c.kind === 'table'), -1);
  const firstAfterTables = minOf(
    idxOf((c) => c.kind === 'index' || c.kind === 'view' || c.kind === 'dml'),
    Infinity,
  );
  if (lastTable > firstAfterTables) {
    violations.push(
      `CREATE TABLE at position ${lastTable} appears after index/view/dml at position ${firstAfterTables}`,
    );
  }

  // R2: schema แม่มาก่อนลูก (คำนวณ FK ใหม่จาก output เอง)
  seq.forEach((c, i) => {
    if (c.kind !== 'table') return;
    for (const parent of new Set(extractReferences(c.stmt.text))) {
      if (parent === c.table) continue;
      const parentPos = tablePos.get(parent);
      if (parentPos !== undefined && parentPos > i) {
        violations.push(`table '${c.table}' (position ${i}) references '${parent}' at later position ${parentPos}`);
      }
    }
  });

  // R3: DML ต้องมาหลัง CREATE TABLE ของตารางปลายทาง
  seq.forEach((c, i) => {
    if (c.kind !== 'dml') return;
    const createPos = tablePos.get(c.table!);
    if (createPos !== undefined && createPos > i) {
      violations.push(`dml into '${c.table}' at position ${i} appears before its CREATE TABLE at position ${createPos}`);
    }
  });

  // R4: sqlite_sequence ต้องอยู่หลัง DML ของตารางอื่นทั้งหมด
  const otherDml = idxOf((c) => c.kind === 'dml' && c.table !== 'sqlite_sequence');
  const seqDml = idxOf((c) => c.kind === 'dml' && c.table === 'sqlite_sequence');
  if (otherDml.length > 0 && seqDml.length > 0) {
    const lastOther = maxOf(otherDml, -1);
    const firstSeq = minOf(seqDml, Infinity);
    if (lastOther > firstSeq) {
      violations.push(`sqlite_sequence dml at position ${firstSeq} appears before other dml at position ${lastOther}`);
    }
  }

  // R5: PRAGMA ทุกตัวต้องมาก่อน statement อื่นที่ไม่ใช่ PRAGMA/BEGIN
  const lastPragma = maxOf(idxOf((c) => c.kind === 'pragma'), -1);
  const firstReal = minOf(
    idxOf((c) => c.kind !== 'pragma' && c.kind !== 'txnBegin'),
    Infinity,
  );
  if (lastPragma > firstReal) {
    violations.push(`pragma at position ${lastPragma} appears after other statements at position ${firstReal}`);
  }

  return violations;
}
