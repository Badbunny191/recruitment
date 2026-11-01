/**
 * FK dependency graph จาก CREATE TABLE statements + Kahn topo-sort + cycle detection.
 *
 * กฎการนับ edge (SPEC.md §4): เฉพาะ token REFERENCES (case-insensitive) ที่
 * tokenize ยืนยันว่าอยู่นอก string/comment — ครอบทั้ง column-level และ
 * table-level FOREIGN KEY, ชื่อ quote ทุกแบบ, schema-qualified (เอาตัวสุดท้าย)
 */

import { tokenize } from './classify';
import type { ClassifiedStatement } from './classify';

export interface TableDef {
  /** normalized (lowercase) table name */
  name: string;
  /** ลำดับ statement เดิมใน dump — ใช้ tie-break ให้ output deterministic */
  originalIndex: number;
  stmt: ClassifiedStatement;
  /** REFERENCES ดิบทั้งหมดที่เจอ (normalized, ยังไม่กรอง missing/self) */
  rawParents: string[];
}

export function extractReferences(createTableText: string): string[] {
  const toks = tokenize(createTableText);
  const refs: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type !== 'word' || t.value.toUpperCase() !== 'REFERENCES') continue;
    // REFERENCES <ident>(.<ident>)* — เอาชื่อตาราง (ตัวสุดท้ายถ้า qualified)
    let j = i + 1;
    const first = identName(toks[j]);
    if (first === null) continue; // รูปแบบผิด — ไม่ crash, ปล่อยให้ replay เป็นคนจับ
    let name = first;
    j++;
    while (toks[j]?.type === 'punct' && toks[j].value === '.') {
      const nxt = identName(toks[j + 1]);
      if (nxt === null) break;
      name = nxt;
      j += 2;
    }
    refs.push(name.toLowerCase());
    i = j - 1;
  }
  return refs;
}

function identName(t: import('./classify').Token | undefined): string | null {
  return t && (t.type === 'quoted' || t.type === 'word') ? t.value : null;
}

export function extractTableDefs(tableStmts: ClassifiedStatement[]): TableDef[] {
  return tableStmts.map((c, i) => ({
    name: c.table!,
    originalIndex: i,
    stmt: c,
    rawParents: extractReferences(c.stmt.text),
  }));
}

export type TopoResult = { order: string[] } | { cycle: string[] };

/**
 * Topo-sort แบบ deterministic: พร้อมเลือกพร้อมกันหลายตัวเสมอเลือกตัวที่
 * originalIndex น้อยสุด — input เดิมให้ผลลัพธ์เดิมทุกครั้ง
 */
export function topoSort(defs: TableDef[]): TopoResult {
  const byName = new Map(defs.map((d) => [d.name, d]));
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  const inDeg = new Map<string, number>();

  for (const d of defs) {
    const parents = [...new Set(d.rawParents)].filter((p) => byName.has(p) && p !== d.name);
    parentsOf.set(d.name, parents);
    inDeg.set(d.name, parents.length);
    childrenOf.set(d.name, []);
  }
  for (const [child, parents] of parentsOf) {
    for (const p of parents) childrenOf.get(p)!.push(child);
  }

  const order: string[] = [];
  const ready = defs.filter((d) => inDeg.get(d.name) === 0).map((d) => d.name);
  while (ready.length > 0) {
    let bestIdx = 0;
    for (let k = 1; k < ready.length; k++) {
      if (byName.get(ready[k])!.originalIndex < byName.get(ready[bestIdx])!.originalIndex) {
        bestIdx = k;
      }
    }
    const [current] = ready.splice(bestIdx, 1);
    order.push(current);
    for (const child of childrenOf.get(current)!) {
      const remaining = inDeg.get(child)! - 1;
      inDeg.set(child, remaining);
      if (remaining === 0) ready.push(child);
    }
  }

  if (order.length < defs.length) {
    const remaining = defs.map((d) => d.name).filter((nm) => !order.includes(nm));
    return { cycle: findCycle(remaining, parentsOf) };
  }
  return { order };
}

/** ทุก node ที่เหลือมี parent ที่เหลืออยู่เสมอ (inDeg > 0) → เดิน parent จนเจอวงจร */
function findCycle(remainingNames: string[], parentsOf: Map<string, string[]>): string[] {
  const remaining = new Set(remainingNames);
  for (const start of remainingNames) {
    const path: string[] = [];
    const onPath = new Map<string, number>();
    let current: string | undefined = start;
    while (current !== undefined && remaining.has(current) && !onPath.has(current)) {
      onPath.set(current, path.length);
      path.push(current);
      const parents = (parentsOf.get(current) ?? []).filter((p) => remaining.has(p));
      const next = parents[0];
      if (next === undefined) break;
      if (onPath.has(next)) {
        return path.slice(onPath.get(next)!).concat(next);
      }
      current = next;
    }
  }
  return remainingNames; // fallback — ไม่ควรเกิด (เหลือไว้เพื่อไม่ crash)
}
