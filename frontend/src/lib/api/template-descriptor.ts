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
export type BlockType = 'heading' | 'field' | 'table' | 'logo' | 'signature';

export interface BaseBlock {
  id: string;
  type: BlockType;
  align?: Align;
  marginTop?: number;
  marginBottom?: number;
}

export interface HeadingBlock extends BaseBlock {
  type: 'heading';
  text: string;
  size: Size;
  bold?: boolean;
}

export interface FieldBlock extends BaseBlock {
  type: 'field';
  fieldId: string;
  label?: string;
}

export interface TableBlock extends BaseBlock {
  type: 'table';
  fieldId: string;
}

export interface LogoBlock extends BaseBlock {
  type: 'logo';
}

/**
 * Signature Block — Document Block ที่ใช้ข้อมูลจาก Application
 * (ไม่ใช่ Form/Application Field)
 *
 * - ไม่ต้องให้ผู้สมัครกรอก
 * - resolve ค่าจาก ApplicationContext ตอน render (PDF + Preview)
 *
 * Visibility toggles (mirror backend):
 *   - showName (default true)
 *   - showDate (default true)
 *   - showTime (default false) — เอกสารราชการ/สมัครงานส่วนใหญ่ไม่แสดงเวลา
 */
export interface SignatureBlock extends BaseBlock {
  type: 'signature';
  roleLabel?: string;
  signerNameSource?: 'application';
  dateSource?: 'application';
  timeSource?: 'application';
  showName?: boolean;
  showDate?: boolean;
  showTime?: boolean;
}

export type DocumentBlock =
  | HeadingBlock
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

export interface PreviewResponse {
  html: string;
  body: string;
  meta: PreviewMeta;
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
  tableFieldIds?: string[];
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

/**
 * Lightweight client-side JSON validation.
 *
 * Performs structural checks only — full block-level validation is
 * delegated to the backend (validateDescriptor). Client-side check
 * ensures we don't send obviously invalid payloads.
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
    if (!b.type || !['heading', 'field', 'table', 'logo', 'signature'].includes(b.type as string)) {
      issues.push({ path: `${path}.type`, message: 'type must be heading|field|table|logo|signature' });
    }
    if (b.type === 'heading') {
      if (typeof b.text !== 'string') {
        issues.push({ path: `${path}.text`, message: 'text is required' });
      }
      if (!['small', 'medium', 'large'].includes(b.size as string)) {
        issues.push({ path: `${path}.size`, message: 'size must be small|medium|large' });
      }
    }
    if (b.type === 'field' || b.type === 'table') {
      if (!b.fieldId || typeof b.fieldId !== 'string') {
        issues.push({ path: `${path}.fieldId`, message: 'fieldId is required' });
      }
    }
  });

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, value: parsed as DocumentDescriptor, issues: [] };
}