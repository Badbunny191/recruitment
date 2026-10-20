/**
 * Document Composer V1 — Document Token Resolver
 * --------------------------------------------
 * Feature: Live Preview — real document data (application number / position)
 *
 * ขอบเขตของ token ในเอกสารที่ประกอบด้วย block เช่น PDF:
 *   - {APPLICATION_NO} → เลขที่ใบสมัครจริง (เช่น 2026-CHM01-0001)
 *   - {POSITION_NUMBER} → เลขตำแหน่ง (ถ้า template มี field นี้)
 *   - {POSITION_NAME}   → ชื่อตำแหน่ง
 *   - {POSITION_LEVEL}  → ระดับตำแหน่ง (จาก recruitment round)
 *   - {ROUND_CODE}      → รหัสรอบ
 *
 * ── Resolution order (field-first, ตามที่ผู้ใช้เลือก) ────────────────────
 *   1. field ของ template version (fieldId หรือ pdfMappingKey ที่ match)
 *   2. fallback → recruitment round / positions (ข้อมูลระบบ ไม่ต้องเพิ่ม column)
 *   3. ยังไม่มี → placeholder token เดิม (เพื่อให้ผู้ใช้รู้ว่า token ยังไม่ได้ผูก)
 *
 * ── หลักการ ──────────────────────────────────────────────────────────────
 *   - Pure function — ไม่อ่าน DB, ไม่มี side effect
 *   - ไม่แตะ migrations / schema (Requirement 8)
 *   - Token ที่ไม่รู้จักจะคงไว้เดิม ไม่ถูกลบทิ้ง (กันเอกสารพังเงียบ ๆ)
 *
 * NOTE: {YEAR} / {RUNNING:n} ไม่ใช่ token ของเอกสาร — เป็นของ
 *       application number pattern (utils/application-pattern.ts) ซึ่ง
 *       resolve เสร็จแล้วก่อนถึง layer นี้
 */

import type { ApplicationContext, FieldData } from "../pdf-types";

// =============================================================================
// Token vocabulary
// =============================================================================

/**
 * Token ที่ระบบรู้จัก — ใช้เป็น allowlist ตอน resolve
 *
 * เพิ่ม token ใหม่ได้ที่นี่ที่เดียว (single source of truth)
 */
export const DOCUMENT_TOKENS = [
  "APPLICATION_NO",
  "POSITION_NUMBER",
  "POSITION_NAME",
  "POSITION_LEVEL",
  "ROUND_CODE",
] as const;

export type DocumentToken = (typeof DOCUMENT_TOKENS)[number];

// =============================================================================
// Token values — ผลลัพธ์ที่ resolve ได้จริง
// =============================================================================

/**
 * ค่าที่ resolve ได้ของแต่ละ token
 *
 * - `text`  = ค่าที่จะแสดง (ใช้กับ heading)
 * - `empty` = true เมื่อไม่มีข้อมูลจริง → renderer เลือก fallback เอง
 */
export interface TokenValue {
  text: string;
  /** true = ไม่มีข้อมูลจริงในระบบ (ใช้ placeholder) */
  empty: boolean;
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
};

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
 * @returns Record<DocumentToken, TokenValue>
 */
export function resolveDocumentTokens(
  ctx: ApplicationContext,
  formData?: Record<string, unknown>
): Record<DocumentToken, TokenValue> {
  const fd = formData ?? ((ctx.application.formData ?? {}) as Record<string, unknown>);

  const byFieldId = indexFieldsById(ctx.fields);

  const result = {} as Record<DocumentToken, TokenValue>;
  for (const token of DOCUMENT_TOKENS) {
    result[token] = resolveOne(token, ctx, fd, byFieldId);
  }
  return result;
}

/**
 * แทนที่ {TOKEN} ในข้อความด้วยค่าจริง
 *
 * - Token ที่รู้จัก → แทนด้วยค่า (หรือ placeholder เดิมถ้าไม่มีข้อมูล)
 * - Token ที่ไม่รู้จัก → คงไว้เดิม (ไม่ลบ)
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
 * ลำดับ: field (template) → system fallback → placeholder
 */
function resolveOne(
  token: DocumentToken,
  ctx: ApplicationContext,
  formData: Record<string, unknown>,
  fieldTokenIndex: Map<string, DocumentToken>
): TokenValue {
  // ── 1) field-first: อ่านจาก template field ──────────────────────────
  const fieldValue = resolveFromFields(token, formData, fieldTokenIndex);
  if (fieldValue !== null) {
    return { text: fieldValue, empty: false };
  }

  // ── 2) fallback: system data (round / application) ──────────────────
  const systemValue = resolveFromSystem(token, ctx);
  if (systemValue !== null) {
    return { text: systemValue, empty: false };
  }

  // ── 3) ไม่มีข้อมูล → placeholder ────────────────────────────────────
  return { text: EMPTY_PLACEHOLDER[token], empty: true };
}

/**
 * Resolve จาก template field
 *
 * - เทียน alias ทั้งแบบ exact และ case-insensitive
 * - ค่าใน formData อาจมาจาก fieldId หรือ pdfMappingKey
 * - MASTER_DATA / array → ตัดชื่อ field ออกมาแสดง (ป้องกัน JSON ยาวในหัวเอกสาร)
 */
function resolveFromFields(
  token: DocumentToken,
  formData: Record<string, unknown>,
  fieldTokenIndex: Map<string, DocumentToken>
): string | null {
  const aliases = TOKEN_FIELD_ALIASES[token];
  const aliasesLower = aliases.map((a) => a.toLowerCase());

  for (const [fieldId, mapped] of fieldTokenIndex) {
    if (mapped !== token) continue;

    const raw =
      formData[fieldId] ??
      null;

    const text = normalizeTokenValue(raw, aliases);
    if (text !== null) return text;
  }

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
 * - APPLICATION_NO  → ctx.application.applicationNo
 * - POSITION_LEVEL  → ctx.round.positionLevel
 * - POSITION_NAME   → null (ไม่มีแหล่งข้อมูลที่ตรงความหมาย)
 * - ROUND_CODE      → ctx.round.roundCode
 * - POSITION_NUMBER → null (ไม่มีข้อมูลในระบบ)
 *
 * หมายเหตุ:
 *   Req 6 (Preview UX) ห้าม substitute ข้อมูลคนละความหมายมาทดแทน token
 *   ที่ resolve ไม่ได้ — render POSITION_NAME fallback เป็น
 *   round.positionLevel ("ระดับปฏิบัติการ") จะทำให้ผู้ใช้เข้าใจผิดว่า
 *   ระบบมีชื่อตำแหน่งแล้ว ทั้งที่จริงเป็นคนละข้อมูล
 *
 *   ตาราง `positions` มี `title` จริง แต่ไม่มี FK จาก round/template มา
 *   (เป็นตารางแยกอิสระที่หน้า admin ใช้ CRUD อย่างเดียว) จึงไม่มีทางรู้
 *   ว่า round นี้ใช้ position ไหนโดยไม่เพิ่ม column → คืน null ให้ renderer
 *   แสดง placeholder สีเทาว่า "ยังไม่มีข้อมูล"
 */
function resolveFromSystem(
  token: DocumentToken,
  ctx: ApplicationContext
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
  }
}

/**
 * แปลงค่าดิบจาก formData → ข้อความสำหรับ token
 *
 * - string → ตัดช่องว่าง
 * - number/boolean → String()
 * - array → join ด้วย ", " (เอาไม่เกิน 3 รายการ กันหัวเอกสารยาวเกิน)
 * - object (เช่น MASTER_DATA {label, value}) → ดึง label/name/value
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
    if (aliases.some((a) => a.toLowerCase() === t.toLowerCase())) return null;
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
    for (const key of ["label", "name", "value", "title"]) {
      const v = obj[key];
      if (typeof v === "string" && v.trim().length > 0) return v.trim();
    }
    return null;
  }

  return null;
}