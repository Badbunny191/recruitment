/**
 * Statement classification + identifier extraction สำหรับ d1 export dumps.
 *
 * tokenize() ข้าม string literal และ comment ทั้งหมด — คำว่า REFERENCES ใน
 * string ('REFERENCES nothing') จึงไม่มีทางกลายเป็น token และชื่อตารางใน
 * CHECK("t"."col" ...) ไม่มีทางถูกตีเป็น FK edge (กฎอยู่ที่ ../SPEC.md §4)
 */

import type { RawStatement } from './split-statements';
import { isCommentOrWhitespaceOnly } from './split-statements';

export type StatementKind =
  | 'pragma'
  | 'txnBegin'
  | 'txnCommit'
  | 'table'
  | 'index'
  | 'view'
  | 'dml'
  | 'epilogue';

export interface ClassifiedStatement {
  stmt: RawStatement;
  kind: StatementKind;
  /** normalized (lowercase, unquoted, schema ตัดออก) target table — kind ที่เกี่ยวกับตารางเท่านั้น */
  table?: string;
}

export class UnsupportedStatementError extends Error {
  readonly line?: number;
  constructor(message: string, line?: number) {
    super(message);
    this.name = 'UnsupportedStatementError';
    this.line = line;
  }
}

/** input ที่ parse ผ่านแต่ไม่ใช่ dump ที่สมบูรณ์ (ว่าง / `;` หายจน statement กลืนกัน / ชื่อซ้ำ) */
export class InvalidDumpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDumpError';
  }
}

/** คีย์เวิร์ดที่ขึ้นต้น statement ได้ — ใช้ตรวจ "statement เดียวกลืนหลาย statement" */
const STATEMENT_STARTERS = new Set([
  'CREATE',
  'INSERT',
  'REPLACE',
  'DELETE',
  'UPDATE',
  'PRAGMA',
  'BEGIN',
  'COMMIT',
]);

export interface Token {
  type: 'word' | 'quoted' | 'punct';
  value: string;
}

const WORD_CHARS = /[A-Za-z0-9_$]/;

/** Token stream ของ statement — string literal และ comment ถูกข้ามทิ้ง */
export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let mode: 'Normal' | 'LineComment' | 'BlockComment' = 'Normal';
  let wordBuf = '';
  let i = 0;
  const n = sql.length;

  const flushWord = () => {
    if (wordBuf.length > 0) {
      tokens.push({ type: 'word', value: wordBuf });
      wordBuf = '';
    }
  };
  const readQuoted = (open: string, close: string, escape: string): string => {
    // เรียกเมื่อ sql[i] === open; คืนเนื้อใน unescape แล้ว
    let content = '';
    i++; // เข้าข้างใน
    while (i < n) {
      const ch = sql[i];
      if (ch === close) {
        if (sql[i + 1] === escape) {
          content += ch;
          i += 2;
        } else {
          i++;
          return content;
        }
      } else {
        content += ch;
        i++;
      }
    }
    throw new UnsupportedStatementError(`unterminated ${open}-quoted identifier`);
  };

  while (i < n) {
    const ch = sql[i];
    const next = i + 1 < n ? sql[i + 1] : '';
    switch (mode) {
      case 'LineComment':
        if (ch === '\n') mode = 'Normal';
        i++;
        break;
      case 'BlockComment':
        if (ch === '*' && next === '/') {
          mode = 'Normal';
          i += 2;
        } else {
          i++;
        }
        break;
      case 'SingleQuote':
        if (ch === "'") {
          if (next === "'") {
            i += 2;
          } else {
            mode = 'Normal';
            i++;
          }
        } else {
          i++;
        }
        break;
      case 'Normal':
        if (ch === '-' && next === '-') {
          flushWord();
          mode = 'LineComment';
          i += 2;
        } else if (ch === '/' && next === '*') {
          flushWord();
          mode = 'BlockComment';
          i += 2;
        } else if (ch === "'") {
          flushWord();
          i++;
          while (i < n) {
            if (sql[i] === "'") {
              if (sql[i + 1] === "'") {
                i += 2;
              } else {
                i++;
                break;
              }
            } else {
              i++;
            }
          }
          if (i >= n) throw new UnsupportedStatementError('unterminated string literal');
        } else if (ch === '"') {
          flushWord();
          tokens.push({ type: 'quoted', value: readQuoted('"', '"', '"') });
        } else if (ch === '`') {
          flushWord();
          tokens.push({ type: 'quoted', value: readQuoted('`', '`', '`') });
        } else if (ch === '[') {
          flushWord();
          tokens.push({ type: 'quoted', value: readQuoted('[', ']', ']') });
        } else if (/[A-Za-z_]/.test(ch)) {
          wordBuf += ch;
          i++;
        } else if (WORD_CHARS.test(ch)) {
          wordBuf += ch;
          i++;
        } else if (/\s/.test(ch)) {
          flushWord();
          i++;
        } else if (ch === '(' || ch === ')' || ch === ',' || ch === '.' || ch === ';') {
          flushWord();
          tokens.push({ type: 'punct', value: ch });
          i++;
        } else {
          flushWord();
          i++;
        }
        break;
    }
  }
  flushWord();
  return tokens;
}

const isWord = (t: Token | undefined, word: string): boolean =>
  !!t && t.type === 'word' && t.value.toUpperCase() === word;

const identOf = (t: Token | undefined): string | null =>
  t && (t.type === 'quoted' || t.type === 'word') ? t.value : null;

/** ชื่อที่อาจ schema-qualified: ident (. ident)* → เอาตัวสุดท้าย */
function qualifiedName(toks: Token[], startIdx: number): { name: string; next: number } | null {
  let idx = startIdx;
  let name = identOf(toks[idx]);
  if (name === null) return null;
  idx++;
  while (toks[idx]?.type === 'punct' && toks[idx].value === '.') {
    const nxt = identOf(toks[idx + 1]);
    if (nxt === null) break;
    name = nxt;
    idx += 2;
  }
  return { name, next: idx };
}

const skipIfNotExists = (toks: Token[], idx: number): number =>
  isWord(toks[idx], 'IF') && isWord(toks[idx + 1], 'NOT') && isWord(toks[idx + 2], 'EXISTS')
    ? idx + 3
    : idx;

export function classifyStatement(stmt: RawStatement): ClassifiedStatement {
  const toks = tokenize(stmt.text);
  if (toks.length === 0) {
    if (isCommentOrWhitespaceOnly(stmt.text)) {
      return { stmt, kind: 'epilogue' };
    }
    throw new UnsupportedStatementError(
      `statement contains no recognizable SQL (line ${stmt.startLine}): ${truncate(stmt.text)}`,
      stmt.startLine,
    );
  }

  const matched = matchStatementKind(toks, stmt);
  if (matched) {
    // Guard: statement ที่สมบูรณ์ต้องมี statement-starter ตัวเดียว — เจอหลายตัวแปลว่า
    // `;` หายกลางไฟล์จน statement กลืนกัน (truncated dump) → ล้มดัง ไม่แตกใบ้ให้ผ่านไป
    // นับเฉพาะ starter ที่ paren depth 0 เพราะ `ON DELETE cascade` ใน FK constraint
    // อยู่ในวงเล็บ body ของ CREATE TABLE และไม่ใช่ statement
    let starters = 0;
    let depth = 0;
    for (const t of toks) {
      if (t.type === 'punct') {
        if (t.value === '(') depth++;
        else if (t.value === ')' && depth > 0) depth--;
        continue;
      }
      if (depth === 0 && t.type === 'word' && STATEMENT_STARTERS.has(t.value.toUpperCase())) {
        starters++;
      }
    }
    if (starters > 1) {
      throw new InvalidDumpError(
        `statement starting at line ${stmt.startLine} contains ${starters} statement ` +
          'keywords — a \';\' is probably missing mid-file and statements merged together',
      );
    }
    return matched;
  }

  throw new UnsupportedStatementError(
    `unrecognized statement (line ${stmt.startLine}): ${truncate(stmt.text)}`,
    stmt.startLine,
  );
}

/** จับคู่ keyword แรกกับชนิด statement — คืน undefined ถ้าไม่ตรงชุดที่ d1 export สร้าง */
function matchStatementKind(toks: Token[], stmt: RawStatement): ClassifiedStatement | undefined {
  const first = toks[0];
  if (first.type !== 'word') return undefined;
  switch (first.value.toUpperCase()) {
    case 'PRAGMA':
      return { stmt, kind: 'pragma' };
    case 'BEGIN':
      return { stmt, kind: 'txnBegin' };
    case 'COMMIT':
      return { stmt, kind: 'txnCommit' };
    case 'END':
      if (isWord(toks[1], 'TRANSACTION')) return { stmt, kind: 'txnCommit' };
      return undefined; // bare END (trigger body fragment) → unsupported
    case 'CREATE': {
      let j = 1;
      if (isWord(toks[j], 'TEMP') || isWord(toks[j], 'TEMPORARY')) j++;
      if (isWord(toks[j], 'UNIQUE')) j++;
      if (isWord(toks[j], 'TRIGGER')) {
        throw new UnsupportedStatementError(
          `CREATE TRIGGER is not supported by reorder-dump (line ${stmt.startLine}) — ` +
            'trigger bodies contain nested \';\' and need a dedicated parser; ' +
            'fail loudly instead of guessing (see SPEC.md §8)',
          stmt.startLine,
        );
      }
      if (isWord(toks[j], 'TABLE')) {
        const q = qualifiedName(toks, skipIfNotExists(toks, j + 1));
        if (!q) return undefined;
        return { stmt, kind: 'table', table: q.name.toLowerCase() };
      }
      if (isWord(toks[j], 'INDEX')) {
        const idxName = qualifiedName(toks, skipIfNotExists(toks, j + 1));
        if (!idxName) return undefined;
        if (isWord(toks[idxName.next], 'ON')) {
          const target = qualifiedName(toks, idxName.next + 1);
          if (target) return { stmt, kind: 'index', table: target.name.toLowerCase() };
        }
        return undefined;
      }
      if (isWord(toks[j], 'VIEW')) {
        const q = qualifiedName(toks, skipIfNotExists(toks, j + 1));
        if (!q) return undefined;
        return { stmt, kind: 'view', table: q.name.toLowerCase() };
      }
      return undefined;
    }
    case 'INSERT':
    case 'REPLACE': {
      // INSERT INTO x / REPLACE INTO x — INTO อยู่ token เดียวกันทั้งคู่
      if (isWord(toks[1], 'INTO')) {
        const q = qualifiedName(toks, 2);
        if (q) return { stmt, kind: 'dml', table: q.name.toLowerCase() };
      }
      return undefined;
    }
    case 'DELETE':
      if (isWord(toks[1], 'FROM')) {
        const q = qualifiedName(toks, 2);
        if (q) return { stmt, kind: 'dml', table: q.name.toLowerCase() };
      }
      return undefined;
    case 'UPDATE': {
      const q = qualifiedName(toks, 1);
      if (q) return { stmt, kind: 'dml', table: q.name.toLowerCase() };
      return undefined;
    }
  }
  return undefined;
}

export function classifyAll(statements: RawStatement[]): ClassifiedStatement[] {
  return statements.map(classifyStatement);
}

function truncate(text: string, max = 80): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}
