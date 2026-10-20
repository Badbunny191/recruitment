/**
 * Template Descriptor API Client
 * --------------------------------
 * Document Composer V1 — Frontend API Layer
 *
 * Thin wrapper for Document Composer endpoints:
 *   GET    /admin/template-versions/:id/descriptor
 *   PUT    /admin/template-versions/:id/descriptor
 *   POST   /admin/template-versions/:id/descriptor/preview
 *   POST   /admin/template-versions/:id/descriptor/generate
 *
 * Design:
 *   - Returns typed responses (no throwing on API errors — caller decides)
 *   - Uses adminFetch() from useAdminAuth for auth + auto-logout
 *   - Centralizes base URL + JSON parsing
 */

import { adminFetch } from '@/lib/useAdminAuth';

// =============================================================================
// Types
// =============================================================================

export type Align = 'left' | 'center' | 'right';
export type Size = 'small' | 'medium' | 'large';
export type BlockType =
  | 'heading'
  | 'field'
  | 'table'
  | 'logo'
  | 'signature'
  /** ข้อมูลระบบ (เลขที่ใบสมัคร / ชื่อรอบ / วันที่) */
  | 'systemData';

/** รูปแบบวันที่ (ใช้กับ APPLICATION_DATE / PRINT_DATE เท่านั้น) */
export type DateFormat = 'thai_long' | 'thai_short' | 'iso' | 'numeric';

export interface BaseBlock {
  id: string;
  type: BlockType;
  align?: Align;
  marginTop?: number;
  marginBottom?: number;
}

/**
 * Heading / Text Block
 *
 * - `text` รองรับหลายบรรทัด (`\n`) และผสม token ได้
 *   - System Token: `{APPLICATION_NO}`, `{ROUND_NAME}`, … (ดู INSERTABLE_TOKENS)
 *   - Application Field: `{FIELD:<fieldId>}` (fieldId = field_master.id)
 */
export interface HeadingBlock extends BaseBlock {
  type: 'heading';
  text: string;
  size: Size;
  bold?: boolean;
  /** italic (optional — BC กับ descriptor เก่าที่ไม่มี field นี้) */
  italic?: boolean;
}

/**
 * System Data Block — ข้อมูลระบบ 1 รายการเป็น block แยก
 *
 * ทุก field optional นอกจาก `key` → descriptor เก่ายัง load ได้
 */
export type SystemDataKey =
  | 'APPLICATION_NO'
  | 'ROUND_NAME'
  | 'APPLICATION_DATE'
  | 'PRINT_DATE'
  | 'POSITION_NAME';

export interface SystemDataBlock extends BaseBlock {
  type: 'systemData';
  key: SystemDataKey;
  /** override ของ label (default = SYSTEM_DATA_LABELS[key]) */
  label?: string;
  showLabel?: boolean;
  layout?: 'stacked' | 'inline';
  labelStyle?: Size;
  valueStyle?: Size;
  dateFormat?: DateFormat;
}

/**
 * Field Block — ข้อมูลที่ผู้สมัครกรอกจริง
 *
 * Form Preview → form control / Document+PDF → label + value แบบ read-only
 */
export interface FieldBlock extends BaseBlock {
  type: 'field';
  /** field_master.id — ไม่ใช่ template_fields.id (UUID) */
  fieldId: string;
  /** custom label (ว่าง = ใช้ชื่อจาก Field Master) */
  label?: string;
  showLabel?: boolean;
  showRequired?: boolean;
  layout?: 'stacked' | 'inline';
  valueStyle?: Size;
}

/**
 * Table Block — ใช้**เฉพาะ** field ที่มีค่าเป็นหลายรายการจริง (repeatable)
 *
 * ดู `@/lib/document-composer/field-capabilities` เป็น single source of truth
 * ของกฎ repeatable (Table Picker ต้อง filter ตามนี้)
 */
export interface TableBlock extends BaseBlock {
  type: 'table';
  fieldId: string;
  label?: string;
  showLabel?: boolean;
  /** ข้อความเมื่อไม่มีข้อมูล (default: "(ไม่มีข้อมูล)") */
  emptyText?: string;
}

/**
 * Logo Block — แหล่งโลโก้ของเอกสาร
 *
 * - `organization` → โลโก้หน่วยงาน (ยังไม่มี source จริงในระบบ →
 *   renderer แสดง "ยังไม่มีโลโก้" แทนการแสดงกรอบรูปว่าง)
 * - `upload`       → forward-compatible (โครงสร้างข้อมูลรองรับไว้ล่วงหน้า
 *   แต่ UI disable เพราะยังไม่มีช่องทางอัปโหลด — ไม่มี upload API/R2/Base64)
 * - `none`         → ไม่แสดงโลโก้
 */
export type LogoSource = 'organization' | 'upload' | 'none';

export interface LogoBlock extends BaseBlock {
  type: 'logo';
  source?: LogoSource;
  /** px ใน preview / pt ใน PDF (default: 70) */
  width?: number;
  /** undefined/null = auto (คง aspect ratio จากรูปต้นฉบับ) */
  height?: number;
  alt?: string;
  /** forward-compatible — ยังไม่มี asset storage */
  imageUrl?: string;
}

/**
 * Signature Block — ส่วนจัดหน้าชื่อ / วันที่ / เส้นลงลายมือชื่อ
 *
 * ไม่ใช่ช่องลายเซ็นดิจิทัล และไม่ใช่ Application Field ที่ผู้สมัครกรอก
 */
export type SignatureDateSource = 'APPLICATION_DATE' | 'PRINT_DATE' | 'none';

export interface SignatureBlock extends BaseBlock {
  type: 'signature';
  /** ป้ายกำกับบทบาท (default: "ผู้สมัคร") */
  roleLabel?: string;
  /** label ก่อนเส้นลงลายมือชื่อ (default: "ลงลายมือชื่อ") */
  lineLabel?: string;
  /** รูปแบบเส้นลงลายมือชื่อ (default: "........................................") */
  lineStyle?: string;
  /** label ก่อนวันที่ (default: "วันที่") */
  dateLabel?: string;
  /**
   * Application Field สำหรับชื่อผู้สมัคร
   * เก็บเป็น `field_master.id` (stable mapping key) ไม่ผูกด้วย label ไทย
   * ไม่กำหนด → fallback ไป `application.fullname`
   */
  nameFieldId?: string;
  /** legacy — ยังรองรับเพื่อ BC */
  signerNameSource?: 'application';
  /** legacy literal — ยังรองรับเพื่อ BC (backend map → APPLICATION_DATE) */
  dateSource?: SignatureDateSource | 'application';
  /** แสดง "(ชื่อผู้สมัคร)" หรือไม่ (default: true) */
  showName?: boolean;
  showParentheses?: boolean;
  showDate?: boolean;
  showTime?: boolean;
  /** legacy — ยังรองรับเพื่อ BC */
  timeSource?: 'application';
}

export type DocumentBlock =
  | HeadingBlock
  | SystemDataBlock
  | FieldBlock
  | TableBlock
  | LogoBlock
  | SignatureBlock;

export interface DocumentDescriptor {
  version: 1;
  blocks: DocumentBlock[];
}

export interface DescriptorMeta {
  source: 'db' | 'default';
  loadedAt: number;
  reason?: 'NO_DESCRIPTOR' | 'VERSION_MISMATCH' | 'NOT_FOUND' | 'INVALID_JSON';
}

export interface LoadDescriptorResponse {
  descriptor: DocumentDescriptor;
  schemaVersion: number | null;
  meta: DescriptorMeta;
}

export interface PreviewMeta {
  blockCount: number;
  fieldRefCount: number;
  missingFieldIds: string[];
  renderedBlocks: Array<{
    blockId: string;
    type: BlockType;
    align: Align;
    marginTop: number;
    marginBottom: number;
    fieldStatus?: 'resolved' | 'missing';
  }>;
}

/**
 * โหมดของ Live Preview
 * - `form`     → body field เป็น form control จริง (input/textarea/select/…)
 * - `document` → body field เป็น label + value เหมือน PDF
 */
export type PreviewMode = 'form' | 'document';

/**
 * Token value (สำหรับแผง diagnostics)
 *
 * `empty === true` → ยังไม่มีข้อมูลจริง (renderer แสดง placeholder สีเทา)
 */
export interface PreviewTokenInfo {
  token: string;
  label: string;
  text: string;
  /** true = ยังไม่มีข้อมูลจริง → ใช้ placeholder */
  empty: boolean;
}

// =============================================================================
// Document Token Vocabulary (mirror backend document-tokens.ts)
// =============================================================================

/**
 * System Token ที่ UI เสนอให้ Admin แทรกได้
 *
 * ตั้งใจ EXCLUDE (mirror backend `INSERTABLE_DOCUMENT_TOKENS`):
 *   - `POSITION_LEVEL` → ระบบไม่ได้เก็บระดับตำแหน่งเป็นข้อมูลแยก
 *   - `ROUND_CODE`    → ไม่บังคับให้ใช้ (ให้ใช้ ROUND_NAME)
 *   - `POSITION_NUMBER` → ระบบไม่มีข้อมูลเลขตำแหน่ง
 *
 * ทั้ง 3 ตัวยัง resolve ได้ฝั่ง backend (back-compat) แต่ไม่แสดงในเมนู
 */
export const INSERTABLE_TOKENS = [
  'APPLICATION_NO',
  'ROUND_NAME',
  'APPLICATION_DATE',
  'PRINT_DATE',
  'POSITION_NAME',
] as const;

export type InsertableToken = (typeof INSERTABLE_TOKENS)[number];

/** Label ภาษาไทยของ token ที่แทรกได้ (single source — ใช้กับ InsertDataMenu) */
export const INSERTABLE_TOKEN_LABELS: Record<InsertableToken, string> = {
  APPLICATION_NO: 'เลขที่ใบสมัคร',
  ROUND_NAME: 'ชื่อรอบการสมัคร',
  APPLICATION_DATE: 'วันที่สมัคร',
  PRINT_DATE: 'วันที่พิมพ์',
  POSITION_NAME: 'ชื่อตำแหน่ง',
};

/** Label มาตรฐานของ System Data key (default ของ `label` ใน SystemDataBlock) */
export const SYSTEM_DATA_LABELS: Record<SystemDataKey, string> = {
  APPLICATION_NO: 'เลขที่ใบสมัคร',
  ROUND_NAME: 'ชื่อรอบการสมัคร',
  APPLICATION_DATE: 'วันที่สมัคร',
  PRINT_DATE: 'วันที่พิมพ์',
  POSITION_NAME: 'ชื่อตำแหน่ง',
};

/** System Data key ที่เป็น "วันที่" → จึงมีตัวเลือก dateFormat */
export const SYSTEM_DATE_KEYS: readonly SystemDataKey[] = [
  'APPLICATION_DATE',
  'PRINT_DATE',
];

/** ข้อความเมื่อไม่มีโลโก้ (ห้ามแสดงกรอบรูปว่าง) */
export const NO_LOGO_TEXT = 'ยังไม่มีโลโก้';

// =============================================================================
// Default block factories
// =============================================================================

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

/**
 * ค่าเริ่มต้นของ block แต่ละประเภท — mirror backend defaults
 *
 * ทุก field ที่เพิ่มเข้ามาในรอบนี้เป็น optional ใน descriptor
 * → การสร้าง block ใหม่ใส่ default ชัดเจน เพื่อให้ admin เห็นค่าที่จะได้
 */
export function createHeadingBlock(overrides: Partial<HeadingBlock> = {}): HeadingBlock {
  return {
    id: makeId('h'),
    type: 'heading',
    text: 'หัวข้อใหม่',
    size: 'medium',
    bold: false,
    italic: false,
    align: 'left',
    ...overrides,
  };
}

export function createSystemDataBlock(
  key: SystemDataKey = 'APPLICATION_NO',
  overrides: Partial<SystemDataBlock> = {}
): SystemDataBlock {
  return {
    id: makeId('sd'),
    type: 'systemData',
    key,
    layout: 'inline',
    showLabel: true,
    labelStyle: 'small',
    valueStyle: 'medium',
    ...(SYSTEM_DATE_KEYS.includes(key) ? { dateFormat: 'thai_long' } : {}),
    align: 'left',
    ...overrides,
  };
}

export function createFieldBlock(
  fieldId: string,
  overrides: Partial<FieldBlock> = {}
): FieldBlock {
  return {
    id: makeId('f'),
    type: 'field',
    fieldId,
    showLabel: true,
    showRequired: true,
    layout: 'stacked',
    valueStyle: 'medium',
    align: 'left',
    ...overrides,
  };
}

export function createTableBlock(
  fieldId: string,
  overrides: Partial<TableBlock> = {}
): TableBlock {
  return {
    id: makeId('t'),
    type: 'table',
    fieldId,
    showLabel: true,
    align: 'left',
    ...overrides,
  };
}

export function createLogoBlock(overrides: Partial<LogoBlock> = {}): LogoBlock {
  return {
    id: makeId('l'),
    type: 'logo',
    source: 'organization',
    width: 70,
    alt: 'โลโก้หน่วยงาน',
    align: 'left',
    ...overrides,
  };
}

export function createSignatureBlock(
  overrides: Partial<SignatureBlock> = {}
): SignatureBlock {
  return {
    id: makeId('s'),
    type: 'signature',
    roleLabel: 'ผู้สมัคร',
    lineLabel: 'ลงลายมือชื่อ',
    lineStyle: '........................................',
    dateLabel: 'วันที่',
    dateSource: 'APPLICATION_DATE',
    showName: true,
    showParentheses: true,
    showDate: true,
    showTime: false,
    align: 'center',
    ...overrides,
  };
}

/**
 * Render options (ส่งไป backend)
 */
export interface PreviewOptions {
  mode?: PreviewMode;
  includeHeader?: boolean;
  title?: string;
}

export interface PreviewResponse {
  html: string;
  body: string;
  /** Document header block (logo placeholder + title + token strip) */
  header: string;
  meta: PreviewMeta;
  /** โหมดที่ใช้ render (UI ใช้ toggle Form ↔ Document) */
  mode: PreviewMode;
  /** resolved tokens (สำหรับแผง diagnostics) */
  tokens: PreviewTokenInfo[];
}

export interface GeneratorMeta {
  sectionCount: number;
  fieldCount: number;
  blockCount: number;
}

export interface GenerateResponse {
  descriptor: DocumentDescriptor;
  meta: GeneratorMeta;
}

// =============================================================================
// Errors
// =============================================================================

export interface ApiError {
  status: number;
  error: string;
  issues?: Array<{ path: string; message: string }>;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

// =============================================================================
// Helpers
// =============================================================================

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || '';
}

function authHeaders(): Record<string, string> {
  return {};
}

/**
 * Normalize an error payload (string | object | undefined) into a string.
 *
 * Backend อาจส่ง `body.error` กลับมาเป็น:
 *   - string  → ใช้ตรงๆ
 *   - object  → เช่น ZodError `{ issues: [...], name: 'ZodError' }`
 *                จาก @hono/zod-validator → serialize เป็น human-readable string
 *   - undefined/null → fallback
 *
 * ถ้าไม่ normalize จะเก็บ object ใน state → render ใน JSX → React error #31
 *   "Objects are not valid as a React child (found: object with keys {issues, name})"
 */
function normalizeErrorMessage(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && raw.trim().length > 0) return raw;
  if (raw && typeof raw === 'object') {
    const obj = raw as { issues?: unknown; message?: unknown; name?: unknown };
    if (Array.isArray(obj.issues) && obj.issues.length > 0) {
      const first = obj.issues[0] as { path?: unknown; message?: unknown };
      const path = typeof first?.path === 'string' && first.path ? first.path : '(root)';
      const msg = typeof first?.message === 'string' ? first.message : 'Invalid value';
      const more = obj.issues.length > 1 ? ` (+${obj.issues.length - 1} more)` : '';
      return `Validation error at \`${path}\`: ${msg}${more}`;
    }
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (typeof obj.name === 'string' && obj.name) return `${obj.name}`;
  }
  return fallback;
}

// =============================================================================
// GET /admin/template-versions/:id/descriptor
// =============================================================================

export async function loadTemplateDescriptor(
  templateVersionId: string
): Promise<ApiResult<LoadDescriptorResponse>> {
  try {
    const res = await adminFetch(
      `${getBaseUrl()}/admin/template-versions/${templateVersionId}/descriptor`,
      {
        method: 'GET',
        headers: authHeaders(),
      }
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        ok: false,
        error: {
          status: res.status,
          error: normalizeErrorMessage(body.error, `Load failed (${res.status})`),
          issues: body.issues,
        },
      };
    }

    const body = await res.json();
    return { ok: true, data: body.data as LoadDescriptorResponse };
  } catch (err) {
    return {
      ok: false,
      error: {
        status: 0,
        error: err instanceof Error ? err.message : 'Network error',
      },
    };
  }
}

// =============================================================================
// PUT /admin/template-versions/:id/descriptor
// =============================================================================

export interface SaveDescriptorPayload {
  descriptor: DocumentDescriptor;
  expectedSchemaVersion?: number;
}

export async function saveTemplateDescriptor(
  templateVersionId: string,
  payload: SaveDescriptorPayload
): Promise<ApiResult<{ schemaVersion: number; savedAt: number }>> {
  try {
    const res = await adminFetch(
      `${getBaseUrl()}/admin/template-versions/${templateVersionId}/descriptor`,
      {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      }
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        ok: false,
        error: {
          status: res.status,
          error: normalizeErrorMessage(
            body.error,
            normalizeErrorMessage(body.details, `Save failed (${res.status})`)
          ),
          issues: body.issues,
        },
      };
    }

    const body = await res.json();
    return {
      ok: true,
      data: { schemaVersion: body.schemaVersion, savedAt: body.savedAt },
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        status: 0,
        error: err instanceof Error ? err.message : 'Network error',
      },
    };
  }
}

// =============================================================================
// POST /admin/template-versions/:id/descriptor/preview
// =============================================================================

export interface PreviewPayload {
  descriptor: DocumentDescriptor;
  options?: PreviewOptions;
}

export async function previewTemplateDescriptor(
  templateVersionId: string,
  payload: PreviewPayload
): Promise<ApiResult<PreviewResponse>> {
  try {
    const res = await adminFetch(
      `${getBaseUrl()}/admin/template-versions/${templateVersionId}/descriptor/preview`,
      {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      }
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        ok: false,
        error: {
          status: res.status,
          error: normalizeErrorMessage(body.error, `Preview failed (${res.status})`),
        },
      };
    }

    const body = await res.json();
    return { ok: true, data: body.data as PreviewResponse };
  } catch (err) {
    return {
      ok: false,
      error: {
        status: 0,
        error: err instanceof Error ? err.message : 'Network error',
      },
    };
  }
}

// =============================================================================
// POST /admin/template-versions/:id/descriptor/generate
// =============================================================================

export interface GeneratePayload {
  /**
   * Capability override — ระบุ field ที่ต้องการ render เป็น Table
   *
   * ⚠️ ความหมาย (Requirement G):
   *   นี่คือ **override** ไม่ใช่ "รายการที่ต้องเปิดเอง"
   *   - ไม่ระบุ → heuristic ตาม type (REPEATER / TABLE → Table, อื่น → Field)
   *   - ระบุ → บังคับให้ field นั้นเป็น Table **โดยไม่ตรวจซ้ำ**
   *     ว่าค่าจริงเป็นหลายรายการหรือไม่
   *   - MASTER_DATA แบบค่าเดียวจะกลายเป็น Table 1 แถวได้
   *     → จึงไม่ควรระบุ field แบบนั้น
   *
   * UI ปกติให้เลือกผ่าน Table Picker ซึ่งกรองเฉพาะ field ที่
   * repeatable จริง (ดู `@/lib/document-composer/field-capabilities`)
   */
  tableFieldIds?: string[];
  /**
   * Application Field สำหรับ "ชื่อผู้สมัคร" ใน Signature Block
   * เก็บเป็น `field_master.id` (stable mapping key)
   */
  signatureNameFieldId?: string;
}

export async function generateTemplateDescriptor(
  templateVersionId: string,
  payload: GeneratePayload = {}
): Promise<ApiResult<GenerateResponse>> {
  try {
    const res = await adminFetch(
      `${getBaseUrl()}/admin/template-versions/${templateVersionId}/descriptor/generate`,
      {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      }
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        ok: false,
        error: {
          status: res.status,
          error: normalizeErrorMessage(body.error, `Generate failed (${res.status})`),
          issues: body.issues,
        },
      };
    }

    const body = await res.json();
    return { ok: true, data: body.data as GenerateResponse };
  } catch (err) {
    return {
      ok: false,
      error: {
        status: 0,
        error: err instanceof Error ? err.message : 'Network error',
      },
    };
  }
}

// =============================================================================
// Default empty descriptor
// =============================================================================

export function createEmptyDescriptor(): DocumentDescriptor {
  return {
    version: 1,
    blocks: [],
  };
}

// =============================================================================
// Validation helpers (client-side pre-flight check)
// =============================================================================

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  value?: DocumentDescriptor;
  issues: ValidationIssue[];
}

/** Block type ที่ระบบรองรับ (single source of truth สำหรับ client validation) */
const KNOWN_BLOCK_TYPES: readonly BlockType[] = [
  'heading',
  'systemData',
  'field',
  'table',
  'logo',
  'signature',
];

/** key ที่ระบบรองรับใน SystemDataBlock */
const KNOWN_SYSTEM_DATA_KEYS: readonly SystemDataKey[] = [
  'APPLICATION_NO',
  'ROUND_NAME',
  'APPLICATION_DATE',
  'PRINT_DATE',
  'POSITION_NAME',
];

/**
 * Lightweight client-side JSON validation.
 *
 * Performs structural checks only — full block-level validation is
 * delegated to the backend (validateDescriptor). Client-side check
 * ensures we don't send obviously invalid payloads.
 *
 * ── Backward compatibility ────────────────────────────────────────────────
 * ทุก property ที่เพิ่มในรอบนี้ (italic, systemData.key, logo.source,
 * signature.lineLabel ฯลฯ) เป็น **optional** → descriptor เก่ายังผ่าน
 */
export function parseDescriptor(text: string): ValidationResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, issues: [{ path: '', message: 'Descriptor is empty' }] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return {
      ok: false,
      issues: [{ path: '', message: 'Invalid JSON: ' + (err instanceof Error ? err.message : 'parse error') }],
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, issues: [{ path: '', message: 'Descriptor must be a JSON object' }] };
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) {
    return { ok: false, issues: [{ path: 'version', message: 'version must be 1' }] };
  }

  if (!Array.isArray(obj.blocks)) {
    return { ok: false, issues: [{ path: 'blocks', message: 'blocks must be an array' }] };
  }

  if ((obj.blocks as unknown[]).length === 0) {
    return { ok: false, issues: [{ path: 'blocks', message: 'blocks must have at least one block' }] };
  }

  const issues: ValidationIssue[] = [];
  (obj.blocks as Array<unknown>).forEach((block, idx) => {
    const path = `blocks[${idx}]`;
    if (typeof block !== 'object' || block === null) {
      issues.push({ path, message: 'block must be an object' });
      return;
    }
    const b = block as Record<string, unknown>;
    if (!b.id || typeof b.id !== 'string') {
      issues.push({ path: `${path}.id`, message: 'id is required (string)' });
    }
    if (!b.type || !KNOWN_BLOCK_TYPES.includes(b.type as BlockType)) {
      issues.push({
        path: `${path}.type`,
        message: `type must be ${KNOWN_BLOCK_TYPES.join('|')}`,
      });
    }
    if (b.type === 'heading') {
      if (typeof b.text !== 'string') {
        issues.push({ path: `${path}.text`, message: 'text is required' });
      }
      if (!['small', 'medium', 'large'].includes(b.size as string)) {
        issues.push({ path: `${path}.size`, message: 'size must be small|medium|large' });
      }
    }
    if (b.type === 'systemData') {
      if (!b.key || !KNOWN_SYSTEM_DATA_KEYS.includes(b.key as SystemDataKey)) {
        issues.push({
          path: `${path}.key`,
          message: `key must be ${KNOWN_SYSTEM_DATA_KEYS.join('|')}`,
        });
      }
    }
    if (b.type === 'field' || b.type === 'table') {
      if (!b.fieldId || typeof b.fieldId !== 'string') {
        issues.push({ path: `${path}.fieldId`, message: 'fieldId is required' });
      }
    }
    if (b.type === 'logo') {
      // source เป็น optional — descriptor เก่าไม่มีก็ยังผ่าน (default = organization)
      if (b.source !== undefined && !['organization', 'upload', 'none'].includes(b.source as string)) {
        issues.push({
          path: `${path}.source`,
          message: 'source must be organization|upload|none',
        });
      }
    }
    if (b.type === 'signature') {
      // ยอมรับ legacy 'application' เพื่อ BC (backend map → APPLICATION_DATE)
      if (
        b.dateSource !== undefined &&
        !['APPLICATION_DATE', 'PRINT_DATE', 'none', 'application'].includes(
          b.dateSource as string
        )
      ) {
        issues.push({
          path: `${path}.dateSource`,
          message:
            'dateSource must be APPLICATION_DATE|PRINT_DATE|none (หรือ legacy "application")',
        });
      }
    }
  });

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, value: parsed as DocumentDescriptor, issues: [] };
}