'use client';

/**
 * useTemplateDescriptor Hook
 * --------------------------------
 * Document Composer V1 — React Hook for Descriptor state management
 *
 * จัดการ 4 operations:
 *   - load:   GET descriptor จาก template version
 *   - save:   PUT descriptor เข้า template version
 *   - preview: POST descriptor เพื่อ render HTML preview
 *   - generate: POST เพื่อ generate default descriptor from template
 *
 * State:
 *   - descriptor: current DocumentDescriptor
 *   - descriptorText: raw text (textarea source of truth)
 *   - schemaVersion: server-side schema version (for optimistic locking)
 *   - isLoading, isMutating: separate flags for read vs write
 *   - previewResult: HTML preview result
 *   - lastError, lastIssues: error details
 *
 * Returns:
 *   - setDescriptorText(text): update textarea → sync parseDescriptor
 *   - load(), save(), runPreview(), generate()
 *   - loading flags per action
 */

import { useCallback, useEffect, useState } from 'react';
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
} from '@/lib/api/template-descriptor';

export type ActionKind = 'load' | 'save' | 'preview' | 'generate';

export interface UseTemplateDescriptorReturn {
  /** Current descriptor object (parsed) */
  descriptor: DocumentDescriptor | null;
  /** Raw textarea text (source of truth for editing) */
  descriptorText: string;
  /** Setter that re-validates and updates descriptor */
  setDescriptorText: (text: string) => void;
  /** Schema version returned by server (for optimistic locking on save) */
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
  /** Last error from any action */
  lastError: string | null;
  /** Detailed issues from server validation */
  lastIssues: ValidationIssue[];
  /** Latest meta from generate call */
  generateMeta: { sectionCount: number; fieldCount: number; blockCount: number } | null;
  /** Actions */
  load: () => Promise<boolean>;
  save: () => Promise<boolean>;
  runPreview: () => Promise<boolean>;
  generate: () => Promise<boolean>;
}

export function useTemplateDescriptor(
  templateVersionId: string
): UseTemplateDescriptorReturn {
  const [descriptor, setDescriptor] = useState<DocumentDescriptor | null>(null);
  const [descriptorText, setDescriptorTextState] = useState<string>('');
  const [schemaVersion, setSchemaVersion] = useState<number | null>(null);
  const [source, setSource] = useState<'db' | 'default' | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<PreviewResponse | null>(null);
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
  // setter that auto-validates
  // ---------------------------------------------------------------------------
  const setDescriptorText = useCallback((text: string) => {
    setDescriptorTextState(text);
    setLastError(null);
    setLastIssues([]);

    if (!text.trim()) {
      setDescriptor(null);
      setParseIssues([]);
      return;
    }

    const result = parseDescriptor(text);
    if (result.ok && result.value) {
      setDescriptor(result.value);
      setParseIssues([]);
    } else {
      setDescriptor(null);
      setParseIssues(result.issues);
    }
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
      setLastError(res.error.error);
      return false;
    }

    const d = res.data.descriptor ?? createEmptyDescriptor();
    setDescriptor(d);
    setDescriptorTextState(JSON.stringify(d, null, 2));
    setSchemaVersion(res.data.schemaVersion);
    setSource(res.data.meta.source);
    setFallbackReason(res.data.meta.reason ?? null);
    setPreviewResult(null);
    return true;
  }, [templateVersionId]);

  // ---------------------------------------------------------------------------
  // action: save
  // ---------------------------------------------------------------------------
  const save = useCallback(async (): Promise<boolean> => {
    if (!descriptor) {
      setLastError('Descriptor is empty or invalid — fix errors first');
      return false;
    }

    setLoading((p) => ({ ...p, save: true }));
    setLastError(null);
    setLastIssues([]);

    const res = await apiSave(templateVersionId, {
      descriptor,
      expectedSchemaVersion: schemaVersion ?? undefined,
    });
    setLoading((p) => ({ ...p, save: false }));

    if (!res.ok) {
      setLastError(res.error.error);
      if (res.error.issues) setLastIssues(res.error.issues);
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
  const runPreview = useCallback(async (): Promise<boolean> => {
    if (!descriptor) {
      setLastError('Descriptor is empty or invalid — fix errors first');
      return false;
    }

    setLoading((p) => ({ ...p, preview: true }));
    setLastError(null);
    setLastIssues([]);

    const res = await apiPreview(templateVersionId, { descriptor });
    setLoading((p) => ({ ...p, preview: false }));

    if (!res.ok) {
      setLastError(res.error.error);
      return false;
    }

    setPreviewResult(res.data);
    return true;
  }, [descriptor, templateVersionId]);

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
      setLastError(res.error.error);
      if (res.error.issues) setLastIssues(res.error.issues);
      return false;
    }

    const d = res.data.descriptor;
    setDescriptor(d);
    setDescriptorTextState(JSON.stringify(d, null, 2));
    setSchemaVersion(null); // generate doesn't bump schema version
    setSource(null);
    setFallbackReason(null);
    setGenerateMeta(res.data.meta);
    setPreviewResult(null);
    return true;
  }, [templateVersionId]);

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
  };
}