'use client';

/**
 * useTemplateDescriptor Hook
 * --------------------------------
 * Document Composer V1 — React Hook for Descriptor state management
 *
 * จัดการ 4 operations:
 *   - load:    GET descriptor จาก template version
 *   - save:    PUT descriptor เข้า template version
 *   - preview: POST descriptor เพื่อ render HTML preview
 *   - generate: POST เพื่อ generate default descriptor from template
 *
 * State:
 *   - descriptor:     current DocumentDescriptor (single source of truth)
 *   - descriptorText: raw text mirror (สำหรับ Advanced JSON Editor)
 *   - schemaVersion:  server-side schema version
 *   - loading flags per action
 *   - previewResult:  HTML preview result
 *   - lastError, lastIssues: error details (lastError เป็น string เสมอ — ป้องกัน React #31)
 *
 * Returns:
 *   - setDescriptorText(text) : อัปเดตจาก JSON editor
 *   - setDescriptor(descriptor) : อัปเดตจาก Visual Composer (object)
 *   - load(), save(), runPreview(), generate()
 *   - loading flags per action
 *
 * UAT Hardening Notes (Final):
 *   - ไม่มี local mirror state ใน component → hook เป็น source of truth เดียว
 *   - ทุก setter sync text + object พร้อมกัน → ป้องกัน state desync bug
 *   - ปิด optimistic locking ใน FE (ส่ง schemaVersion ที่โหลดมาเสมอ, null → save ได้)
 *     เพราะ Composer V1 ใช้ admin คนเดียว — concurrent edit ไม่มี
 *   - lastError normalize เป็น string เสมอก่อนเก็บใน state → ป้องกัน React Error #31
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadTemplateDescriptor as apiLoad,
  saveTemplateDescriptor as apiSave,
  previewTemplateDescriptor as apiPreview,
  generateTemplateDescriptor as apiGenerate,
  parseDescriptor,
  createEmptyDescriptor,
  type DocumentDescriptor,
  type ValidationIssue,
  type PreviewResponse,
  type PreviewOptions,
} from '@/lib/api/template-descriptor';

export type ActionKind = 'load' | 'save' | 'preview' | 'generate';

export interface UseTemplateDescriptorReturn {
  /** Current descriptor object (parsed) — single source of truth */
  descriptor: DocumentDescriptor | null;
  /** Raw textarea text (mirror of descriptor JSON) */
  descriptorText: string;
  /** Setter that re-validates and updates descriptor from text */
  setDescriptorText: (text: string) => void;
  /**
   * Setter that updates descriptor from object — ใช้โดย Visual Composer
   * sync text ให้อัตโนมัติ (object → JSON.stringify)
   */
  setDescriptor: (descriptor: DocumentDescriptor) => void;
  /** Schema version returned by server (สำหรับ optimistic locking) */
  schemaVersion: number | null;
  /** Source of currently loaded descriptor */
  source: 'db' | 'default' | null;
  /** Server-side fallback reason (when source === 'default') */
  fallbackReason: string | null;
  /** Last preview result */
  previewResult: PreviewResponse | null;
  /** Validation issues from client-side parse */
  parseIssues: ValidationIssue[];
  /** Whether text is parseable JSON (no client-side validation issues) */
  isTextValid: boolean;
  /** Loading flags per action */
  loading: Record<ActionKind, boolean>;
  /** Last error from any action (always string — ป้องกัน React Error #31) */
  lastError: string | null;
  /** Detailed issues from server validation */
  lastIssues: ValidationIssue[];
  /** Latest meta from generate call */
  generateMeta: { sectionCount: number; fieldCount: number; blockCount: number } | null;
  /** Actions */
  load: () => Promise<boolean>;
  save: () => Promise<boolean>;
  /**
   * Render preview ที่ระบุ mode + header options
   * - default: 'form' mode + includeHeader=false (preview thumbnail ขวา)
   * - สำหรับ modal: เรียกด้วย { mode: 'document' | 'form', includeHeader: true }
   * - applicationId: ถ้าใส่ → โหลดข้อมูลผู้สมัครจริง ถ้าไม่ใส่ → ใช้ข้อมูลตัวอย่าง
   *
   * @returns PreviewResponse ล่าสุด (ยังเขียนลง previewResult state ปกติ)
   */
  runPreview: (options?: PreviewOptions, applicationId?: string) => Promise<boolean>;
  generate: () => Promise<boolean>;
  /** รีเซ็ต error state */
  clearError: () => void;
}

// =============================================================================
// Helpers — normalize error เป็น string เสมอ (defense in depth)
// =============================================================================

function normalizeError(raw: unknown, fallback: string): string {
  if (raw == null) return fallback;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }
  if (typeof raw === 'object') {
    const obj = raw as { issues?: unknown; message?: unknown; name?: unknown };
    if (Array.isArray(obj.issues) && obj.issues.length > 0) {
      const first = obj.issues[0] as { path?: unknown; message?: unknown };
      const path =
        typeof first?.path === 'string' && first.path ? first.path : '(root)';
      const msg =
        typeof first?.message === 'string' ? first.message : 'Invalid value';
      const more = obj.issues.length > 1 ? ` (+${obj.issues.length - 1} more)` : '';
      return `Validation error at \`${path}\`: ${msg}${more}`;
    }
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (typeof obj.name === 'string' && obj.name) return obj.name;
  }
  return fallback;
}

/**
 * Normalize validation issue array — กัน React Error #31
 * ถ้า backend ส่ง object ที่ไม่ใช่ string → filter ออก
 */
function normalizeIssues(raw: unknown): ValidationIssue[] {
  if (!Array.isArray(raw)) return [];
  const out: ValidationIssue[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as { path?: unknown }).path === 'string' &&
      typeof (item as { message?: unknown }).message === 'string'
    ) {
      out.push({
        path: (item as ValidationIssue).path,
        message: (item as ValidationIssue).message,
      });
    }
  }
  return out;
}

export function useTemplateDescriptor(
  templateVersionId: string
): UseTemplateDescriptorReturn {
  const [descriptor, setDescriptorState] = useState<DocumentDescriptor | null>(
    null
  );
  const [descriptorText, setDescriptorTextState] = useState<string>('');
  const [schemaVersion, setSchemaVersion] = useState<number | null>(null);
  const [source, setSource] = useState<'db' | 'default' | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<PreviewResponse | null>(
    null
  );
  const [parseIssues, setParseIssues] = useState<ValidationIssue[]>([]);
  const [loading, setLoading] = useState<Record<ActionKind, boolean>>({
    load: false,
    save: false,
    preview: false,
    generate: false,
  });
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastIssues, setLastIssues] = useState<ValidationIssue[]>([]);
  const [generateMeta, setGenerateMeta] = useState<{
    sectionCount: number;
    fieldCount: number;
    blockCount: number;
  } | null>(null);

  const isTextValid = parseIssues.length === 0 && descriptor !== null;

  // ---------------------------------------------------------------------------
  // setter: setDescriptorText (จาก JSON editor)
  // ---------------------------------------------------------------------------
  const setDescriptorText = useCallback((text: string) => {
    setDescriptorTextState(text);
    setLastError(null);
    setLastIssues([]);

    if (!text.trim()) {
      setDescriptorState(null);
      setParseIssues([]);
      return;
    }

    const result = parseDescriptor(text);
    if (result.ok && result.value) {
      setDescriptorState(result.value);
      setParseIssues([]);
    } else {
      setDescriptorState(null);
      setParseIssues(result.issues);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // setter: setDescriptor (จาก Visual Composer) — sync text ให้อัตโนมัติ
  // ---------------------------------------------------------------------------
  const setDescriptor = useCallback((next: DocumentDescriptor) => {
    setDescriptorState(next);
    setDescriptorTextState(JSON.stringify(next, null, 2));
    setParseIssues([]);
    setLastError(null);
    setLastIssues([]);
  }, []);

  // ---------------------------------------------------------------------------
  // action: load
  // ---------------------------------------------------------------------------
  const load = useCallback(async (): Promise<boolean> => {
    setLoading((p) => ({ ...p, load: true }));
    setLastError(null);
    setLastIssues([]);

    const res = await apiLoad(templateVersionId);
    setLoading((p) => ({ ...p, load: false }));

    if (!res.ok) {
      setLastError(
        normalizeError(res.error.error, `Load failed (${res.error.status})`)
      );
      return false;
    }

    const d = res.data.descriptor ?? createEmptyDescriptor();
    setDescriptorState(d);
    setDescriptorTextState(JSON.stringify(d, null, 2));
    setSchemaVersion(res.data.schemaVersion);
    setSource(res.data.meta.source);
    setFallbackReason(res.data.meta.reason ?? null);
    setParseIssues([]);
    setPreviewResult(null);
    return true;
  }, [templateVersionId]);

  // ---------------------------------------------------------------------------
  // action: save
  //
  // UAT Hardening: ปิด optimistic locking ในฝั่ง FE
  //   - ถ้ามี schemaVersion จาก load → ส่งไปกัน concurrent edit (best-effort)
  //   - ถ้า schemaVersion = null (first save) → ไม่ส่ง expectedVersion → backend
  //     จะทำ path "overwrite" (เส้นทาง 4a ใน service) → save ได้เสมอ
  //   - ถ้า backend ตอบ VERSION_MISMATCH (409) → แสดง toast ให้ user กด Load ใหม่
  // ---------------------------------------------------------------------------
  const save = useCallback(async (): Promise<boolean> => {
    if (!descriptor) {
      setLastError('Descriptor is empty or invalid — fix errors first');
      return false;
    }

    setLoading((p) => ({ ...p, save: true }));
    setLastError(null);
    setLastIssues([]);

    // ส่ง expectedSchemaVersion เฉพาะเมื่อ schemaVersion !== null
    // ถ้า null (first save) → ไม่ส่ง → backend path 4a (overwrite) → สำเร็จเสมอ
    const payload: Parameters<typeof apiSave>[1] = { descriptor };
    if (schemaVersion !== null) {
      payload.expectedSchemaVersion = schemaVersion;
    }

    const res = await apiSave(templateVersionId, payload);
    setLoading((p) => ({ ...p, save: false }));

    if (!res.ok) {
      setLastError(
        normalizeError(res.error.error, `Save failed (${res.error.status})`)
      );
      setLastIssues(normalizeIssues(res.error.issues));
      return false;
    }

    setSchemaVersion(res.data.schemaVersion);
    setSource('db');
    setFallbackReason(null);
    return true;
  }, [descriptor, schemaVersion, templateVersionId]);

  // ---------------------------------------------------------------------------
  // action: preview
  // ---------------------------------------------------------------------------
  // ── request sequencing: กัน response เก่าทับ response ใหม่ ────────────
// Race condition ที่เคยเกิด: ผู้ใช้แก้ align เร็ว ๆ (left → right) ภายใน debounce
// window เดียว → request เก่า (left) อาจกลับมาทับ request ใหม่ (right)
// → preview ค้างค่าเก่า แม้ผู้ใช้เห็น UI ว่าเป็น right
// ใช้เลขลำดับเพิ่ม: response ที่ seq ไม่ตรงกับ seq ล่าสุด → ทิ้ง
const previewSeqRef = useRef(0);

  const runPreview = useCallback(
    async (options?: PreviewOptions, applicationId?: string): Promise<boolean> => {
      if (!descriptor) {
        setLastError('Descriptor is empty or invalid — fix errors first');
        return false;
      }

      const seq = ++previewSeqRef.current;
      setLoading((p) => ({ ...p, preview: true }));
      setLastError(null);
      setLastIssues([]);

      const res = await apiPreview(templateVersionId, {
        descriptor,
        options: options ?? {},
        applicationId,
      });

      // ── stale response guard ──────────────────────────────────
      // ถ้าระหว่างรอ response มี request ใหม่เกิดขึ้นแล้ว
      // → response นี้เก่ากว่า → ทิ้ง ไม่เขียนทับ state
      if (seq !== previewSeqRef.current) {
        return false;
      }

      setLoading((p) => ({ ...p, preview: false }));

      if (!res.ok) {
        setLastError(
          normalizeError(res.error.error, `Preview failed (${res.error.status})`)
        );
        return false;
      }

      setPreviewResult(res.data);
      return true;
    },
    [descriptor, templateVersionId]
  );

  // ---------------------------------------------------------------------------
  // action: generate
  // ---------------------------------------------------------------------------
  const generate = useCallback(async (): Promise<boolean> => {
    setLoading((p) => ({ ...p, generate: true }));
    setLastError(null);
    setLastIssues([]);

    const res = await apiGenerate(templateVersionId, {});
    setLoading((p) => ({ ...p, generate: false }));

    if (!res.ok) {
      setLastError(
        normalizeError(res.error.error, `Generate failed (${res.error.status})`)
      );
      setLastIssues(normalizeIssues(res.error.issues));
      return false;
    }

    const d = res.data.descriptor;
    setDescriptorState(d);
    setDescriptorTextState(JSON.stringify(d, null, 2));
    setParseIssues([]);
    // generate ไม่ bump schema version (ยังไม่ save)
    // → ใช้ schemaVersion เดิม ถ้ามี — ป้องกัน VERSION_MISMATCH ตอน save หลัง generate
    setSource(null);
    setFallbackReason(null);
    setGenerateMeta(res.data.meta);
    setPreviewResult(null);
    return true;
  }, [templateVersionId]);

  // ---------------------------------------------------------------------------
  // clear error
  // ---------------------------------------------------------------------------
  const clearError = useCallback(() => {
    setLastError(null);
    setLastIssues([]);
  }, []);

  // ---------------------------------------------------------------------------
  // auto-load on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (templateVersionId) {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateVersionId]);

  return {
    descriptor,
    descriptorText,
    setDescriptorText,
    setDescriptor,
    schemaVersion,
    source,
    fallbackReason,
    previewResult,
    parseIssues,
    isTextValid,
    loading,
    lastError,
    lastIssues,
    generateMeta,
    load,
    save,
    runPreview,
    generate,
    clearError,
  };
}