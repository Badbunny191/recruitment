/**
 * Quote/comment-aware SQL statement splitter for d1 export dumps.
 *
 * ทำไมต้อง state machine ระดับตัวอักษร: raw dump มี `;` และ newline จริง ๆ อยู่
 * "ใน" string (พบ 10/66 INSERT ใน dump 2026-10-31) และมี `''` escape — regex
 * ต่อบรรทัดแตก statement เป็นเสี่ยง ๆ ไม่ได้ รายละเอียดกฎอยู่ที่ ../SPEC.md §2
 */

export interface RawStatement {
  /** Statement text รวม `;` ปิดท้าย, trim ขอบแล้ว (เนื้อใน byte-identical) */
  text: string;
  /** บรรทัดแรกที่ code ของ statement เริ่ม (1-based) — ใช้ใน error message */
  startLine: number;
  endLine: number;
}

export class SqlParseError extends Error {
  readonly line?: number;
  constructor(message: string, line?: number) {
    super(message);
    this.name = 'SqlParseError';
    this.line = line;
  }
}

const Mode = {
  Normal: 'Normal',
  SingleQuote: 'SingleQuote',
  DoubleQuote: 'DoubleQuote',
  Backtick: 'Backtick',
  Bracket: 'Bracket',
  LineComment: 'LineComment',
  BlockComment: 'BlockComment',
} as const;
type Mode = (typeof Mode)[keyof typeof Mode];

export function splitStatements(sql: string): RawStatement[] {
  const statements: RawStatement[] = [];
  let mode: Mode = Mode.Normal;
  let stmtStart = 0;
  let stmtStartLine = 1;
  let blockCommentStartLine = 0;
  let line = 1;
  const n = sql.length;
  let i = 0;

  const pushStatement = (endIdxExclusive: number) => {
    const raw = sql.slice(stmtStart, endIdxExclusive);
    const text = raw.trim();
    if (text.length === 0) return;
    const leadingWs = /^\s*/.exec(raw)![0];
    const codeStartLine = stmtStartLine + (leadingWs.match(/\n/g)?.length ?? 0);
    statements.push({ text, startLine: codeStartLine, endLine: line });
  };

  while (i < n) {
    const ch = sql[i];
    // newline: จัดการก่อน switch — ยกเว้น LineComment ซึ่ง newline คือ "จบ comment"
    // (ถ้ากลืนไปก่อน mode จะไม่มีวันกลับเป็น Normal)
    if (ch === '\n' && mode !== Mode.LineComment) {
      line++;
      i++;
      continue;
    }
    const next = i + 1 < n ? sql[i + 1] : '';

    switch (mode) {
      case Mode.LineComment:
        if (ch === '\n') {
          mode = Mode.Normal;
          line++;
        }
        i++;
        break;
      case Mode.BlockComment:
        if (ch === '*' && next === '/') {
          mode = Mode.Normal;
          i += 2;
        } else {
          i++;
        }
        break;
      case Mode.SingleQuote:
        if (ch === "'") {
          if (next === "'") {
            i += 2;
          } else {
            mode = Mode.Normal;
            i++;
          }
        } else {
          i++;
        }
        break;
      case Mode.DoubleQuote:
        if (ch === '"') {
          if (next === '"') {
            i += 2;
          } else {
            mode = Mode.Normal;
            i++;
          }
        } else {
          i++;
        }
        break;
      case Mode.Backtick:
        if (ch === '`') {
          if (next === '`') {
            i += 2;
          } else {
            mode = Mode.Normal;
            i++;
          }
        } else {
          i++;
        }
        break;
      case Mode.Bracket:
        if (ch === ']') {
          if (next === ']') {
            i += 2;
          } else {
            mode = Mode.Normal;
            i++;
          }
        } else {
          i++;
        }
        break;
      case Mode.Normal:
        if (ch === '-' && next === '-') {
          mode = Mode.LineComment;
          i += 2;
        } else if (ch === '/' && next === '*') {
          mode = Mode.BlockComment;
          blockCommentStartLine = line;
          i += 2;
        } else if (ch === "'") {
          mode = Mode.SingleQuote;
          i++;
        } else if (ch === '"') {
          mode = Mode.DoubleQuote;
          i++;
        } else if (ch === '`') {
          mode = Mode.Backtick;
          i++;
        } else if (ch === '[') {
          mode = Mode.Bracket;
          i++;
        } else if (ch === ';') {
          pushStatement(i + 1);
          i++;
          stmtStart = i;
          stmtStartLine = line;
        } else {
          i++;
        }
        break;
    }
  }

  // EOF กลาง block comment = ไฟล์ truncated — ปกติ SQLite จะ error ตอน restore
  // จึงต้องล้มดังที่นี่ ไม่ใช่ปล่อยผ่านเป็น epilogue เงียบ ๆ
  if (mode === Mode.BlockComment) {
    throw new SqlParseError(
      `unterminated block comment '/*' (opened at line ${blockCommentStartLine})`,
      blockCommentStartLine,
    );
  }

  // Residual หลัง `;` ตัวสุดท้าย: comment/whitespace ล้วน = epilogue, มี code = ไฟล์ไม่สมบูรณ์
  if (stmtStart < n) {
    const residual = sql.slice(stmtStart).trim();
    if (residual.length > 0) {
      if (isCommentOrWhitespaceOnly(residual)) {
        statements.push({ text: residual, startLine: stmtStartLine, endLine: line });
      } else {
        throw new SqlParseError(
          `unterminated statement: no ';' before end of file (starts at line ${stmtStartLine})`,
          stmtStartLine,
        );
      }
    }
  }

  return statements;
}

/**
 * true เมื่อ text มีแต่ whitespace + comment — โดย string quote ใด ๆ นับเป็น
 * "content" (เช่น `';'` ไม่ใช่ comment-only) เพื่อไม่กลืน statement จริงเป็น epilogue
 */
export function isCommentOrWhitespaceOnly(text: string): boolean {
  let mode: 'Normal' | 'LineComment' | 'BlockComment' = 'Normal';
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    const next = i + 1 < n ? text[i + 1] : '';
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
      case 'Normal':
        if (ch === '-' && next === '-') {
          mode = 'LineComment';
          i += 2;
        } else if (ch === '/' && next === '*') {
          mode = 'BlockComment';
          i += 2;
        } else if (/\s/.test(ch)) {
          i++;
        } else {
          return false;
        }
        break;
    }
  }
  return true;
}
