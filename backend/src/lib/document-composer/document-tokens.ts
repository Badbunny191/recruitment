/**
 * Document Composer V1 — Document Token Resolver
 * --------------------------------------------
 * ขอบเขตของ token ในเอกสารที่ประกอบด้วย block เช่น PDF:
 *   - {APPLICATION_NO}      → เลขที่ใบสมัครจริง
 *   - {APPLICATION_DATE}    → วันที่สมัคร (พ.ศ.)
 *   - {PRINT_DATE}          → วันที่พิมพ์เอกสาร (พ.ศ.)
 *   - {ROUND_NAME}          → ชื่อรอบการสมัคร
 *   - {ROUND_CODE}          → รหัสรอบ (ยังรองรับเพื่อ BC — ไม่บังคับให้ใช้)
 *   - {POSITION_NAME}       → ชื่อตำแหน่ง (เฉพาะเมื่อมี source จริง)
 *   - {POSITION_NUMBER}     → เลขตำแหน่ง (ระบบยังไม่มีข้อมูล)
 *   - {POSITION_LEVEL}      → ระดับตำแหน่ง (เก็บไว้เพื่อ BC — ไม่แสดงใน UI)
 *   - {FIELD:<fieldId>}     → ค่า Application Field ที่ผู้สมัครกรอก
 *
 * ── Resolution order (field-first, ตามที่ผู้ใช้เลือก) ────────────────────
 *   1. field ของ template version (fieldId หรือ pdfMappingKey ที่ match)
 *   2. fallback → recruitment round / positions (ข้อมูลระบบ ไม่ต้องเพิ่ม column)
 *   3. ยังไม่มี → placeholder token เดิม (เพื่อให้ผู้ใช้รู้ว่า token ยังไม่ได้ผูก)
 *
 * ── หลักการ ──────────────────────────────────────────────────────────────
 *   - Pure function — ไม่อ่าน DB, ไม่มี side effect
 *   - ไม่แตะ migrations / schema (Requirement J)
 *   - Token ที่ไม่รู้จักจะคงไว้เดิม ไม่ถูกลบทิ้ง (กันเอกสารพังเงียบ ๆ)
 *   - ห้ามนำข้อมูลคนละความหมายมา substitute token ที่ resolve ไม่ได้
 *
 * NOTE: {YEAR} / {RUNNING:n} ไม่ใช่ token ของเอกสาร — เป็นของ
 *       application number pattern (utils/application-pattern.ts) ซึ่ง
 *       resolve เสร็จแล้วก่อนถึง layer นี้
 */

import type { ApplicationContext, FieldData } from "../pdf-types";
import type { DocumentBlock } from "./types";

// =============================================================================
// Token vocabulary
// =============================================================================

/**
 * Token ที่ระบบรู้จัก — ใช้เป็น allowlist ตอน resolve
 *
 * เพิ่ม token ใหม่ได้ที่นี่ที่เดียว (single source of truth)
 *
 * BACKWARD COMPATIBILITY (Requirement J):
 *   ลำดับเดิม APPLICATION_NO, POSITION_NUMBER, POSITION_NAME, POSITION_LEVEL,
 *   ROUND_CODE ถูกเก็บไว้ทั้ง 5 ตัว (ไม่ลบ) — descriptor/preview ที่บันทึกไว้แล้ว
 *   และ UI ที่ยังอ้างถึง token เหล่านี้ต้องยังทำงานได้
 *   token ใหม่ (APPLICATION_DATE / PRINT_DATE / ROUND_NAME) ต่อท้าย
 */
export const DOCUMENT_TOKENS = [
  "APPLICATION_NO",
  "POSITION_NUMBER",
  "POSITION_NAME",
  "POSITION_LEVEL",
  "ROUND_CODE",
  "APPLICATION_DATE",
  "PRINT_DATE",
  "ROUND_NAME",
] as const;

export type DocumentToken = (typeof DOCUMENT_TOKENS)[number];

/**
 * Token ที่ UI เสนอให้ Admin แทรกได้ (ปุ่ม "แทรกข้อมูล")
 *
 * ตั้งใจ EXCLUDE:
 *   - POSITION_LEVEL → ระบบไม่ได้เก็บระดับตำแหน่งเป็นข้อมูลแยก
 *     (Requirement A: "ไม่ต้องมี POSITION_LEVEL")
 *   - ROUND_CODE    → ไม่บังคับใช้ (Requirement A: "ให้ใช้ ROUND_NAME")
 *   - POSITION_NUMBER → ระบบไม่มีข้อมูลเลขตำแหน่งเลย
 *
 * ทั้ง 3 ตัวยัง resolve ได้เหมือนเดิม (back-compat) แต่ไม่แสดงใน UI
 */
export const INSERTABLE_DOCUMENT_TOKENS = [
  "APPLICATION_NO",
  "ROUND_NAME",
  "APPLICATION_DATE",
  "PRINT_DATE",
  "POSITION_NAME",
] as const;

export type InsertableDocumentToken = (typeof INSERTABLE_DOCUMENT_TOKENS)[number];

/**
 * Label ภาษาไทยของ token ที่ UI แสดง (single source — ใช้ทั้งใน insert menu
 * และ diagnostics panel เพื่อไม่ให้ถ้อยคำไม่ตรงกัน)
 */
export const DOCUMENT_TOKEN_LABELS: Record<DocumentToken, string> = {
  APPLICATION_NO: "เลขที่ใบสมัคร",
  POSITION_NUMBER: "เลขที่ตำแหน่ง",
  POSITION_NAME: "ชื่อตำแหน่ง",
  POSITION_LEVEL: "ระดับตำแหน่ง",
  ROUND_CODE: "รหัสรอบ",
  APPLICATION_DATE: "วันที่สมัคร",
  PRINT_DATE: "วันที่พิมพ์",
  ROUND_NAME: "ชื่อรอบการสมัคร",
};

// =============================================================================
// Token values — ผลลัพธ์ที่ resolve ได้จริง
// =============================================================================

/**
 * ค่าที่ resolve ได้ของแต่ละ token
 *
 * - `text`  = ค่าที่จะแสดง (ใช้กับ heading)
 * - `empty` = true เมื่อไม่มีข้อมูลจริง → renderer เลือก fallback เอง
 * - `isPlaceholder` = true เมื่อ `text` คือรูป {TOKEN} ที่ยังไม่ได้ผูก
 *   (renderer ใช้ class สีเทา + italic ตาม Requirement I.9)
 */
export interface TokenValue {
  text: string;
  /** true = ไม่มีข้อมูลจริงในระบบ (ใช้ placeholder) */
  empty: boolean;
  /** true = text เป็น placeholder literal (ไม่ใช่ค่าจริง) */
  isPlaceholder?: boolean;
}

/**
 * fieldId / pdfMappingKey ที่ถือว่า "เป็น" token นั้นๆ
 *
 * ทำเป็น allowlist แบบ explicit (ไม่ใช่ substring match) เพื่อกัน false positive
 * เช่น field ชื่อ "ตำแหน่งปัจจุบันที่เคยทำงาน" ไม่ควรถูก match เป็น POSITION_NAME
 */
const TOKEN_FIELD_ALIASES: Record<DocumentToken, readonly string[]> = {
  APPLICATION_NO: [
    "application_no",
    "applicationNo",
    "application_number",
    "เลขที่ใบสมัคร",
    "เลขใบสมัคร",
  ],
  POSITION_NUMBER: [
    "position_number",
    "position_no",
    "positionNumber",
    "position_no_position",
    "เลขที่ตำแหน่ง",
    "เลขตำแหน่ง",
    "ตำแหน่งที่ประกาศรับสมัคร",
  ],
  POSITION_NAME: [
    "position_name",
    "positionName",
    "position_title",
    "position",
    "ชื่อตำแหน่ง",
    "ตำแหน่ง",
  ],
  POSITION_LEVEL: [
    "position_level",
    "positionLevel",
    "ระดับตำแหน่ง",
  ],
  ROUND_CODE: ["round_code", "roundCode", "รหัสรอบ"],
  // ── token ใหม่ ──────────────────────────────────────────────────────
  // ไม่ผูก alias กับ form field ใด ๆ โดยเจตนา:
  //   Requirement A.5 + D — ห้ามสร้าง Application Field ปลอมสำหรับ
  //   วันที่สมัคร / วันที่พิมพ์ / ชื่อรอบ
  //   ค่ามาจากระบบโดยตรง (applications.submitted_at, เวลาสร้าง PDF, rounds.title)
  APPLICATION_DATE: [],
  PRINT_DATE: [],
  ROUND_NAME: [],
};

/**
 * ค่าที่ใช้แสดงแทนเมื่อไม่มีข้อมูลจริง
 *
 * คงรูป "{TOKEN}" ไว้ เพื่อให้ผู้ใช้เห็นว่า "token นี้ยังไม่ได้ผูกข้อมูล"
 * แทนการเห็นช่องว่างเงียบ ๆ (แล้วเข้าใจว่าเอกสารพัก)
 */
const EMPTY_PLACEHOLDER: Record<DocumentToken, string> = {
  APPLICATION_NO: "{APPLICATION_NO}",
  POSITION_NUMBER: "{POSITION_NUMBER}",
  POSITION_NAME: "{POSITION_NAME}",
  POSITION_LEVEL: "{POSITION_LEVEL}",
  ROUND_CODE: "{ROUND_CODE}",
  APPLICATION_DATE: "{APPLICATION_DATE}",
  PRINT_DATE: "{PRINT_DATE}",
  ROUND_NAME: "{ROUND_NAME}",
};

// =============================================================================
// Application Field token — {FIELD:<fieldId>}
// =============================================================================

/**
 * Regex สำหรับ Application Field token
 *
 * รูปแบบ: {FIELD:<field_master.id>}
 *
 * เลือกใช้ fieldId เป็น stable key (ไม่ใช้ label ไทย) ตาม Requirement A.6 / C.4
 * — label ไทยเปลี่ยนได้ แต่ fieldId ไม่เปลี่ยน
 *
 * หลักการ token syntax (Requirement A):
 *   - ตรวจของเดิมก่อนเปลี่ยน → ระบบเดิมมีแค่ `{TOKEN_NAME}` ไม่มีรูปแบบ
 *     สำหรับอ้าง Application Field → เพิ่มใหม่โดยไม่ซ้ำซ้อน
 *   - ใช้รูปแบบเดียวกัน (curly braces) เพื่อให้ parser เดียวกันใช้ได้
 */
const FIELD_TOKEN_PATTERN = /\{FIELD:([A-Za-z0-9_-]{1,128})\}/g;

/**
 * ข้อมูลของ Application Field ที่ resolve แล้ว 1 ตัว
 */
export interface ResolvedFieldValue {
  /** fieldId ที่ถูกอ้างถึง */
  fieldId: string;
  /** ค่าในรูปแบบข้อความ (อาจเป็น placeholder) */
  text: string;
  /** true เมื่อไม่มีข้อมูล (ใช้แสดงเป็น placeholder สีเทา) */
  empty: boolean;
}

/**
 * Resolve ค่าของ Application Field เดี่ยวจาก ApplicationContext
 *
 * Pure — ไม่อ่าน DB, ไม่มี side effect
 *
 * @param fieldId - field_master.id
 * @param ctx - ApplicationContext
 * @returns ResolvedFieldValue | null (null = ไม่พบ field นี้ใน template version)
 */
export function resolveFieldValue(
  fieldId: string,
  ctx: ApplicationContext
): ResolvedFieldValue | null {
  const field = ctx.fields.find((f) => f.fieldId === fieldId);
  if (!field) return null;

  const formData = (ctx.application.formData ?? {}) as Record<string, unknown>;
  const raw =
    formData[field.fieldId] ?? formData[field.pdfMappingKey ?? ""] ?? null;

  const text = normalizeTokenValue(raw, []);
  if (text === null) {
    return { fieldId, text: `{FIELD:${fieldId}}`, empty: true };
  }
  return { fieldId, text, empty: false };
}

/**
 * สร้าง token ของ Application Field (ใช้ฝั่ง UI เพื่อความสอดคล้องกัน)
 */
export function buildFieldToken(fieldId: string): string {
  return `{FIELD:${fieldId}}`;
}

/**
 * ตรวจว่า text ใดมี Application Field token อยู่บ้าง
 *
 * ใช้ใน diagnostics เพื่อรายงานว่า field token ตัวไหน resolve ไม่ได้
 */
export function listFieldTokensInText(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  // ใช้ exec() loop บน regex ที่คัดลอกมาเอง (ไม่แตะ lastIndex ของ
  // FIELD_TOKEN_PATTERN ตัวจริง) — กัน state ของ global regex หลุดร่วมกับ
  // applyFieldTokens() ที่ยังใช้ pattern ตัวเดิมอยู่
  const pattern = new RegExp(FIELD_TOKEN_PATTERN.source, "g");

  let match = pattern.exec(text);
  while (match !== null) {
    const id = match[1];
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
    match = pattern.exec(text);
  }

  return out;
}

/**
 * Collect all tokens used in a document descriptor
 *
 * Used by preview-renderer to filter diagnostics to only show
 * tokens that are actually used in the document.
 *
 * Requirement E: Diagnostics must show only tokens used by the descriptor,
 * not all DOCUMENT_TOKENS. Tokens not used should not be counted as "missing".
 *
 * @param descriptor - DocumentDescriptor to analyze
 * @returns Set of token names (e.g. "APPLICATION_NO", "FIELD:abc123")
 */
export function collectUsedTokens(descriptor: { blocks: DocumentBlock[] }): Set<string> {
  const used = new Set<string>();

  for (const block of descriptor.blocks) {
    if (block.type === "systemData") {
      used.add(block.key);
    } else if (block.type === "heading") {
      // Collect system tokens from heading text
      for (const token of DOCUMENT_TOKENS) {
        if (block.text.includes(`{${token}}`)) {
          used.add(token);
        }
      }
      // Collect field tokens from heading text
      for (const fieldId of listFieldTokensInText(block.text)) {
        used.add(`FIELD:${fieldId}`);
      }
    } else if (block.type === "field") {
      used.add(`FIELD:${block.fieldId}`);
    } else if (block.type === "table") {
      used.add(`FIELD:${block.fieldId}`);
    } else if (block.type === "signature") {
      if (block.nameFieldId) {
        used.add(`FIELD:${block.nameFieldId}`);
      }
    }
  }

  return used;
}

/**
 * แทนที่ {FIELD:<fieldId>} ทั้งหมดในข้อความด้วยค่าจริง
 *
 * - field ที่ไม่รู้จัก → คง token ไว้ (ไม่ลบ) เพื่อให้ผู้ใช้เห็นว่ายังไม่ได้ผูก
 * - field ที่มีแต่ไม่มีค่า → แสดงเป็น placeholder class (สีเทา)
 *
 * @param text - ข้อความดิบที่อาจมี token
 * @param ctx - ApplicationContext
 * @returns { text, unresolved: string[] }
 */
export function applyFieldTokens(
  text: string,
  ctx: ApplicationContext
): { text: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const out = text.replace(
    FIELD_TOKEN_PATTERN,
    (whole: string, fieldId: string) => {
      const resolved = resolveFieldValue(fieldId, ctx);
      if (resolved === null) {
        // ไม่รู้จัก field → คง token ไว้ (Requirement K.6)
        unresolved.push(fieldId);
        return whole;
      }
      if (resolved.empty) unresolved.push(fieldId);
      return resolved.text;
    }
  );
  return { text: out, unresolved };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Resolve ค่าของ token ทั้งหมดจาก ApplicationContext
 *
 * Pure function — ไม่อ่าน DB
 *
 * @param ctx - ApplicationContext (preview หรือ PDF ก็ใช้ตัวเดียวกัน)
 * @param formData - formData ที่จะ override (ปกติคือ ctx.application.formData)
 * @param now - unix timestamp ที่ใช้ resolve PRINT_DATE (default: เวลาปัจจุบัน)
 * @returns Record<DocumentToken, TokenValue>
 */
export function resolveDocumentTokens(
  ctx: ApplicationContext,
  formData?: Record<string, unknown>,
  now?: number
): Record<DocumentToken, TokenValue> {
  const fd = formData ?? ((ctx.application.formData ?? {}) as Record<string, unknown>);

  const byFieldId = indexFieldsById(ctx.fields);
  const printDateUnix =
    typeof now === "number" && now > 0 ? now : Math.floor(Date.now() / 1000);

  const result = {} as Record<DocumentToken, TokenValue>;
  for (const token of DOCUMENT_TOKENS) {
    result[token] = resolveOne(token, ctx, fd, byFieldId, printDateUnix);
  }
  return result;
}

/**
 * แทนที่ {TOKEN} ในข้อความด้วยค่าจริง
 *
 * - Token ที่รู้จัก → แทนด้วยค่า (หรือ placeholder เดิมถ้าไม่มีข้อมูล)
 * - Token ที่ไม่รู้จัก → คงไว้เดิม (ไม่ลบ)
 * - {FIELD:<id>} → ดำเนินการแยกใน applyDocumentTokensWithFields()
 *   (ต้องมี ApplicationContext จึงแยกไปอีกชั้น)
 * - escape ทำที่ renderer layer (renderer ต้อง escape หลัง resolve)
 *
 * @param text - ข้อความดิบที่อาจมี token
 * @param tokens - ผลจาก resolveDocumentTokens()
 * @returns ข้อความที่ resolve แล้ว
 */
export function applyDocumentTokens(
  text: string,
  tokens: Record<DocumentToken, TokenValue>
): string {
  let out = text;
  for (const token of DOCUMENT_TOKENS) {
    // escape RegExp special chars ในชื่อ token (defensive — ปัจจุบันไม่มี แต่กันไว้)
    const pattern = new RegExp(`\\{${token}\\}`, "g");
    const value = tokens[token].empty ? EMPTY_PLACEHOLDER[token] : tokens[token].text;
    out = out.replace(pattern, value);
  }
  return out;
}

/**
 * Resolve ทั้ง System Token และ Application Field token ในข้อความเดียว
 *
 * เป็น entry point เดียวที่ renderer ทั้ง Preview และ PDF ใช้
 * → ไม่มี token resolver ซ้ำซ้อน (Requirement I.6)
 *
 * @param text - ข้อความดิบจาก Admin
 * @param ctx - ApplicationContext
 * @param tokens - ผลจาก resolveDocumentTokens() (คำนวณครั้งเดียวต่อ render)
 * @returns {
 *   text: ข้อความที่ resolve แล้วทั้งหมด
 *   hasPlaceholder: true ถ้ามีส่วนใดยังเป็น placeholder (ให้ renderer ลง style สีเทา)
 *   unresolvedFields: fieldId ที่ resolve ไม่ได้
 * }
 */
export function applyDocumentTokensWithFields(
  text: string,
  ctx: ApplicationContext,
  tokens: Record<DocumentToken, TokenValue>
): {
  text: string;
  hasPlaceholder: boolean;
  unresolvedFields: string[];
} {
  const withSystem = applyDocumentTokens(text, tokens);
  const withFields = applyFieldTokens(withSystem, ctx);
  return {
    text: withFields.text,
    hasPlaceholder: withFields.unresolved.length > 0,
    unresolvedFields: withFields.unresolved,
  };
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * สร้าง index ของ field ที่ match token
 *
 * key = fieldMaster.id, value = DocumentToken ที่ field นั้นแทน
 *
 * หนึ่ง field อาจ match ได้มากกว่า 1 token — เก็บแค่อันแรกที่เจอ
 * (deterministic: วนตาม DOCUMENT_TOKENS order)
 */
function indexFieldsById(
  fields: FieldData[]
): Map<string, DocumentToken> {
  const out = new Map<string, DocumentToken>();

  for (const token of DOCUMENT_TOKENS) {
    const aliases = TOKEN_FIELD_ALIASES[token];
    if (aliases.length === 0) continue;
    for (const field of fields) {
      const keys = [field.fieldId, field.pdfMappingKey].filter(
        (k): k is string => typeof k === "string" && k.length > 0
      );
      const hit = keys.some((k) => aliases.includes(k));
      if (!hit) continue;

      // ไม่ทับ field ที่ match token ก่อนหน้าแล้ว
      if (!out.has(field.fieldId)) {
        out.set(field.fieldId, token);
      }
    }
  }

  return out;
}

/**
 * Resolve token เดียว
 *
 * ลำดับ: field (template) → system data → placeholder
 */
function resolveOne(
  token: DocumentToken,
  ctx: ApplicationContext,
  formData: Record<string, unknown>,
  fieldTokenIndex: Map<string, DocumentToken>,
  printDateUnix: number
): TokenValue {
  // ── 1) field-first: อ่านจาก template field ──────────────────────────
  const fieldValue = resolveFromFields(
    token,
    formData,
    fieldTokenIndex,
    TOKEN_FIELD_ALIASES[token]
  );
  if (fieldValue !== null) {
    return { text: fieldValue, empty: false, isPlaceholder: false };
  }

  // ── 2) fallback: system data (round / application) ──────────────────
  const systemValue = resolveFromSystem(token, ctx, printDateUnix);
  if (systemValue !== null) {
    return { text: systemValue, empty: false, isPlaceholder: false };
  }

  // ── 3) ไม่มีข้อมูล → placeholder ────────────────────────────────────
  return { text: EMPTY_PLACEHOLDER[token], empty: true, isPlaceholder: true };
}

/**
 * Resolve จาก template field
 *
 * - เทียบ alias ทั้งแบบ exact และ case-insensitive
 * - ค่าใน formData อาจมาจาก fieldId หรือ pdfMappingKey
 * - MASTER_DATA / array → ตัดชื่อ field ออกมาแสดง (ป้องกัน JSON ยาวในหัวเอกสาร)
 */
function resolveFromFields(
  token: DocumentToken,
  formData: Record<string, unknown>,
  fieldTokenIndex: Map<string, DocumentToken>,
  aliases: readonly string[]
): string | null {
  if (aliases.length === 0) return null;
  const aliasesLower = aliases.map((a) => a.toLowerCase());

  // ใช้ forEach แทน for...of บน Map (ไม่ต้องเปิด downlevelIteration)
  // คงพฤติกรรมเดิม: เจอ field ที่ resolve ได้ "ตัวแรก" ก็หยุด (เก็บตัวแรกไว้)
  let resolvedText: string | null = null;
  fieldTokenIndex.forEach((mapped, fieldId) => {
    if (resolvedText !== null) return; // เจอแล้ว — ข้ามที่เหลือ
    if (mapped !== token) return;

    const raw = formData[fieldId] ?? null;

    const text = normalizeTokenValue(raw, aliases);
    if (text !== null) {
      resolvedText = text;
    }
  });

  if (resolvedText !== null) return resolvedText;

  // ── Fallback: scan formData ด้วย alias ตรง ๆ (กัน field ที่ไม่ได้อยู่ใน version) ──
  for (const [key, raw] of Object.entries(formData)) {
    const keyLower = key.toLowerCase();
    const matched = aliasesLower.includes(keyLower);
    if (!matched) continue;

    const text = normalizeTokenValue(raw, aliases);
    if (text !== null) return text;
  }

  return null;
}

/**
 * Resolve จาก system data (ไม่ต้องเพิ่ม migration)
 *
 * ── แหล่งข้อมูลจริง (ยืนยันจาก db/schema.ts แล้ว ไม่ได้เดาชื่อ column) ──
 *   - APPLICATION_NO   → applications.application_no → ctx.application.applicationNo
 *   - APPLICATION_DATE → applications.submitted_at   → ctx.application.submittedAt
 *   - PRINT_DATE      → เวลาที่สร้างเอกสาร (ctx ไม่มี field → ใช้ now)
 *   - ROUND_NAME      → recruitment_rounds.title   → ctx.round.title
 *   - ROUND_CODE      → recruitment_rounds.round_code → ctx.round.roundCode
 *   - POSITION_LEVEL  → recruitment_rounds.position_level → ctx.round.positionLevel
 *   - POSITION_NAME   → null (ไม่มีแหล่งข้อมูลที่ตรงความหมาย)
 *   - POSITION_NUMBER → null (ระบบไม่มีข้อมูลเลขตำแหน่ง)
 *
 * หมายเหตุ (Requirement A.5 / K.10):
 *   ตาราง `positions` มี `title` จริง แต่ไม่มี FK จาก round/template มา
 *   (เป็นตารางแยกอิสระที่หน้า admin ใช้ CRUD อย่างเดียว) จึงไม่มีทางรู้
 *   ว่า round นี้ใช้ position ไหนโดยไม่เพิ่ม column → คืน null ให้ renderer
 *   แสดง placeholder {POSITION_NAME} และห้ามนำข้อมูลอื่นมาแทน
 */
function resolveFromSystem(
  token: DocumentToken,
  ctx: ApplicationContext,
  printDateUnix: number
): string | null {
  const readString = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t.length > 0 ? t : null;
  };

  switch (token) {
    case "APPLICATION_NO":
      return readString(ctx.application?.applicationNo);

    case "POSITION_LEVEL":
      return readString(ctx.round?.positionLevel);

    case "POSITION_NAME":
      // ไม่มีแหล่งข้อมูลที่ตรงความหมาย → ห้ามใช้ positionLevel มาแทน
      return null;

    case "ROUND_CODE":
      return readString(ctx.round?.roundCode);

    case "POSITION_NUMBER":
      // ไม่มีข้อมูลเลขตำแหน่งในระบบ (ไม่มี column, ไม่มี field)
      // → คืน null ให้ไปใช้ placeholder
      return null;

    case "ROUND_NAME":
      return readString(ctx.round?.title);

    case "APPLICATION_DATE": {
      const submittedAt = ctx.application?.submittedAt;
      if (typeof submittedAt !== "number" || submittedAt <= 0) return null;
      return formatThaiDate(submittedAt);
    }

    case "PRINT_DATE":
      // วันที่พิมพ์ = เวลาที่ระบบสร้างเอกสาร (ไม่ใช่วันที่ผู้สมัครกรอก)
      return formatThaiDate(printDateUnix);
  }
}

/**
 * แปลงค่าดิบจาก formData → ข้อความสำหรับ token
 *
 * - string → ตัดช่องว่าง
 * - number/boolean → String()
 * - array → join ด้วย ", " (เอาไม่เกิน 3 รายการ กันหัวเอกสารยาวเกิน)
 * - object (เช่น MASTER_DATA {id, name}) → ดึง name/label/title/value
 * - null/empty → null (ให้ไป fallback ต่อ)
 */
function normalizeTokenValue(
  raw: unknown,
  aliases: readonly string[]
): string | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === "string") {
    const t = raw.trim();
    if (t.length === 0) return null;
    // กันค่าที่เป็น alias ตัวเอง (เช่น field ที่ยังไม่ได้กรอก)
    if (aliases.length > 0 && aliases.some((a) => a.toLowerCase() === t.toLowerCase())) {
      return null;
    }
    return t;
  }

  if (typeof raw === "number") {
    return Number.isFinite(raw) ? String(raw) : null;
  }

  if (typeof raw === "boolean") {
    return raw ? "ใช่" : "ไม่ใช่";
  }

  if (Array.isArray(raw)) {
    const parts = raw
      .map((v) => normalizeTokenValue(v, aliases))
      .filter((s): s is string => s !== null)
      .slice(0, 3);
    return parts.length > 0 ? parts.join(", ") : null;
  }

  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    // MASTER_DATA จริงเก็บเป็น { id, name } → ต้องดึง name ก่อน
    // (Requirement F.5 / F.6: ห้าม JSON.stringify ในเอกสาร)
    for (const key of ["name", "label", "title", "value"]) {
      const v = obj[key];
      if (typeof v === "string" && v.trim().length > 0) return v.trim();
    }
    return null;
  }

  return null;
}

// =============================================================================
// Thai date formatting (mirror descriptor-renderer / preview-renderer)
// =============================================================================

const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

/**
 * Format unix timestamp → Thai date string (พ.ศ.)
 * Example: 7 มกราคม 2569
 */
export function formatThaiDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const day = d.getDate();
  const month = THAI_MONTHS[d.getMonth()];
  const thaiYear = d.getFullYear() + 543;
  return `${day} ${month} ${thaiYear}`;
}