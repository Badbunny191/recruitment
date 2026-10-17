'use client';

/**
 * Document Composer Client
 * --------------------------------
 * Document Composer V1 — Admin UI Layer
 *
 * 3-Column Layout:
 *   - Left:   Actions (Generate / Load / Save / Preview)
 *   - Middle: Descriptor Editor (Textarea with JSON validation)
 *   - Right:  Live Preview (HTML iframe)
 *
 * Requirements:
 *   - ใช้ shadcn UI ที่มีอยู่
 *   - ไม่ใช้ TanStack Query (โปรเจกต์ไม่มี dep) — ใช้ useState/useEffect + custom hook
 *   - ห้ามลง dependency ใหม่
 *   - Reuse admin layout
 *   - Generate → API generate
 *   - Load → API load (GET descriptor)
 *   - Save → API save (PUT descriptor)
 *   - Preview → API preview (POST descriptor/preview)
 *   - Error / Success toast
 *   - Loading state
 */

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/components/ui/toast';
import { useTemplateDescriptor } from '@/hooks/useTemplateDescriptor';
import { adminFetch } from '@/lib/useAdminAuth';

// =============================================================================
// Template Version Meta (loaded via existing API endpoints)
// =============================================================================

interface TemplateVersionMeta {
  id: string;
  versionNumber: number;
  status: string;
  templateId: string;
  templateName: string;
  templateDescription: string | null;
}

/**
 * Load template version meta via existing API endpoints
 * - เรียก GET /admin/templates + GET /admin/templates/:id/versions
 * - หา versionId ที่ตรงกัน
 */
async function loadTemplateVersionMeta(
  versionId: string
): Promise<TemplateVersionMeta | null> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || '';

  try {
    const templatesRes = await adminFetch(
      `${baseUrl}/admin/templates?view=all`
    );
    if (!templatesRes.ok) return null;
    const templatesBody = await templatesRes.json();
    const templates = templatesBody.data || [];

    for (const tpl of templates as Array<{
      id: string;
      name: string;
      description: string | null;
    }>) {
      try {
        const versionsRes = await adminFetch(
          `${baseUrl}/admin/templates/${tpl.id}/versions`
        );
        if (!versionsRes.ok) continue;
        const versionsBody = await versionsRes.json();
        const versions = versionsBody.data || [];
        const found = versions.find(
          (v: { id: string; versionNumber: number; status: string }) =>
            v.id === versionId
        );
        if (found) {
          return {
            id: found.id,
            versionNumber: found.versionNumber,
            status: found.status,
            templateId: tpl.id,
            templateName: tpl.name,
            templateDescription: tpl.description,
          };
        }
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }

  return null;
}

// =============================================================================
// Main Component (with Suspense for useSearchParams)
// =============================================================================

export default function ComposerClient() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-slate-500 flex items-center justify-center gap-2">
          <Spinner />
          <span>กำลังโหลด...</span>
        </div>
      }
    >
      <ComposerInner />
    </Suspense>
  );
}

function ComposerInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const versionId = searchParams.get('versionId') || searchParams.get('id') || '';
  const { showToast } = useToast();

  const [meta, setMeta] = useState<TemplateVersionMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);

  const {
    descriptorText,
    setDescriptorText,
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
  } = useTemplateDescriptor(versionId);

  // ---------------------------------------------------------------------------
  // Load template version meta (via existing endpoints)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!versionId) {
      setMetaLoading(false);
      return;
    }
    let cancelled = false;
    setMetaLoading(true);
    loadTemplateVersionMeta(versionId).then((m) => {
      if (cancelled) return;
      setMeta(m);
      setMetaLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [versionId]);

  // ---------------------------------------------------------------------------
  // Action wrappers
  // ---------------------------------------------------------------------------

  const handleLoad = async () => {
    const ok = await load();
    if (ok) {
      showToast({ title: 'โหลด Descriptor สำเร็จ', variant: 'success' });
    } else {
      showToast({
        title: 'โหลดไม่สำเร็จ',
        description: lastError ?? 'Unknown error',
        variant: 'error',
      });
    }
  };

  const handleSave = async () => {
    if (!isTextValid) {
      showToast({
        title: 'JSON ไม่ถูกต้อง',
        description: 'กรุณาแก้ไขก่อนบันทึก',
        variant: 'error',
      });
      return;
    }
    const ok = await save();
    if (ok) {
      showToast({ title: 'บันทึก Descriptor สำเร็จ', variant: 'success' });
    } else {
      showToast({
        title: 'บันทึกไม่สำเร็จ',
        description: lastError ?? 'Unknown error',
        variant: 'error',
      });
    }
  };

  const handlePreview = async () => {
    if (!isTextValid) {
      showToast({
        title: 'JSON ไม่ถูกต้อง',
        description: 'กรุณาแก้ไขก่อน Preview',
        variant: 'error',
      });
      return;
    }
    const ok = await runPreview();
    if (ok) {
      showToast({ title: 'Preview พร้อมแล้ว', variant: 'success' });
    } else {
      showToast({
        title: 'Preview ไม่สำเร็จ',
        description: lastError ?? 'Unknown error',
        variant: 'error',
      });
    }
  };

  const handleGenerate = async () => {
    const ok = await generate();
    if (ok) {
      showToast({
        title: 'Generate Descriptor สำเร็จ',
        description: generateMeta
          ? `Sections: ${generateMeta.sectionCount}, Fields: ${generateMeta.fieldCount}, Blocks: ${generateMeta.blockCount}`
          : undefined,
        variant: 'success',
      });
    } else {
      showToast({
        title: 'Generate ไม่สำเร็จ',
        description: lastError ?? 'Unknown error',
        variant: 'error',
      });
    }
  };

  const handleBack = () => {
    if (meta?.templateId) {
      router.push(`/admin/templates/builder?id=${meta.templateId}`);
    } else {
      router.push('/admin/templates');
    }
  };

  // ---------------------------------------------------------------------------
  // Auto-refresh preview when descriptor changes (debounced)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isTextValid) return;
    const timer = setTimeout(() => {
      runPreview();
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptorText, isTextValid]);

  // ---------------------------------------------------------------------------
  // Render — no versionId yet
  // ---------------------------------------------------------------------------

  if (!versionId) {
    return (
      <div className="p-8 max-w-md mx-auto space-y-4">
        <Alert className="bg-amber-50 border-amber-300 border">
          <AlertDescription className="text-amber-900 text-sm">
            <strong>⚠️ ไม่พบ Template Version ID</strong>
            <p className="mt-1">
              กรุณาเปิด Document Composer จากหน้า Template Builder
              (คลิกปุ่ม 🧩 Document Composer ที่ version ที่ต้องการ)
            </p>
          </AlertDescription>
        </Alert>
        <div className="flex justify-center">
          <Button onClick={() => router.push('/admin/templates')}>
            ← กลับไปหน้า Templates
          </Button>
        </div>
      </div>
    );
  }

  if (metaLoading) {
    return (
      <div className="p-8 text-center text-slate-500 flex items-center justify-center gap-2">
        <Spinner />
        <span>กำลังโหลดข้อมูล Template Version...</span>
      </div>
    );
  }

  const templateName = meta?.templateName ?? 'Template Version';
  const versionNumber = meta?.versionNumber ?? 0;
  const versionStatus = meta?.status ?? 'UNKNOWN';

  // ---------------------------------------------------------------------------
  // Render — main 3-column layout
  // ---------------------------------------------------------------------------

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* ===== HEADER ===== */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Button variant="ghost" size="sm" onClick={handleBack} className="shrink-0">
            ← กลับ
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-slate-900 leading-tight flex items-center gap-2">
              <span>🧩</span>
              <span className="truncate">Document Composer: {templateName}</span>
            </h1>
            <p className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
              <span>v{versionNumber}</span>
              <span>•</span>
              <span
                className={
                  versionStatus === 'PUBLISHED'
                    ? 'text-emerald-600 font-medium'
                    : versionStatus === 'DRAFT'
                    ? 'text-amber-600 font-medium'
                    : 'text-slate-500'
                }
              >
                {versionStatus}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* ===== STATUS ALERTS ===== */}
      {source === 'default' && fallbackReason && (
        <Alert className="bg-amber-50 border-amber-300 border">
          <AlertDescription className="text-amber-900 text-sm flex items-center gap-2">
            <span>ℹ️</span>
            <span>
              ไม่มี Descriptor ที่บันทึกไว้ ({fallbackReason}) — ใช้ default empty descriptor
              กด <strong>Generate</strong> เพื่อสร้างจาก template structure
            </span>
          </AlertDescription>
        </Alert>
      )}

      {lastError && (
        <Alert className="bg-red-50 border-red-300 border">
          <AlertDescription className="text-red-900 text-sm">
            <strong>❌ Error:</strong> {lastError}
            {lastIssues.length > 0 && (
              <ul className="mt-2 ml-4 list-disc text-xs space-y-0.5">
                {lastIssues.map((iss, idx) => (
                  <li key={idx}>
                    <code className="text-red-700">{iss.path}</code>: {iss.message}
                  </li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* ===== 3-COLUMN LAYOUT ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr_1fr] gap-4">
        {/* ============================ */}
        {/* LEFT: Actions               */}
        {/* ============================ */}
        <Card className="lg:sticky lg:top-4 lg:self-start">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <span>⚡</span>
              <span>Actions</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            <Button
              variant="default"
              size="sm"
              onClick={handleGenerate}
              disabled={loading.generate || loading.load}
              className="w-full justify-start"
            >
              {loading.generate ? (
                <Spinner />
              ) : (
                <span className="shrink-0">✨</span>
              )}
              <span>Generate</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleLoad}
              disabled={loading.load}
              className="w-full justify-start"
            >
              {loading.load ? <Spinner /> : <span className="shrink-0">📥</span>}
              <span>Load</span>
            </Button>

            <Button
              variant="default"
              size="sm"
              onClick={handleSave}
              disabled={loading.save || !isTextValid}
              className="w-full justify-start bg-blue-600 hover:bg-blue-700"
            >
              {loading.save ? <Spinner /> : <span className="shrink-0">💾</span>}
              <span>Save</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handlePreview}
              disabled={loading.preview || !isTextValid}
              className="w-full justify-start"
            >
              {loading.preview ? <Spinner /> : <span className="shrink-0">👁</span>}
              <span>Preview</span>
            </Button>

            <div className="pt-3 mt-3 border-t border-slate-200">
              <p className="text-[10px] text-slate-500 leading-relaxed">
                <strong>Generate:</strong> สร้าง default descriptor จาก template structure
                <br />
                <strong>Load:</strong> โหลด descriptor ที่บันทึกไว้
                <br />
                <strong>Save:</strong> บันทึก descriptor เข้า template version
                <br />
                <strong>Preview:</strong> แสดง HTML preview จาก descriptor
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ============================ */}
        {/* MIDDLE: Descriptor Editor   */}
        {/* ============================ */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <span>📝</span>
                <span>Descriptor Editor</span>
              </CardTitle>
              <span className="text-[10px] text-slate-500">
                {descriptorText.length.toLocaleString()} chars
              </span>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            <Textarea
              value={descriptorText}
              onChange={(e) => setDescriptorText(e.target.value)}
              placeholder='{ "version": 1, "blocks": [...] }'
              className="font-mono text-xs min-h-[500px] resize-y"
              spellCheck={false}
            />

            {/* Validation Status */}
            <div className="flex items-center justify-between text-[11px]">
              {isTextValid ? (
                <span className="text-emerald-600 flex items-center gap-1">
                  <span>✓</span>
                  <span>JSON ถูกต้อง</span>
                </span>
              ) : (
                <span className="text-red-600 flex items-center gap-1">
                  <span>✗</span>
                  <span>{parseIssues.length} error(s)</span>
                </span>
              )}
              {generateMeta && (
                <span className="text-slate-500">
                  Generated: {generateMeta.sectionCount} sections,{' '}
                  {generateMeta.fieldCount} fields, {generateMeta.blockCount} blocks
                </span>
              )}
            </div>

            {/* Parse issues */}
            {parseIssues.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded p-2 text-[11px] space-y-1">
                <p className="font-semibold text-red-800">Validation Errors:</p>
                <ul className="space-y-0.5">
                  {parseIssues.map((iss, idx) => (
                    <li key={idx} className="text-red-700">
                      <code className="font-mono">{iss.path || '(root)'}</code>:{' '}
                      {iss.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ============================ */}
        {/* RIGHT: Live Preview         */}
        {/* ============================ */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <span>👁</span>
                <span>Live Preview</span>
              </CardTitle>
              {previewResult && (
                <span className="text-[10px] text-slate-500">
                  {previewResult.meta.blockCount} blocks
                  {previewResult.meta.missingFieldIds.length > 0 && (
                    <span className="text-amber-600 ml-2">
                      ⚠ {previewResult.meta.missingFieldIds.length} missing
                    </span>
                  )}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {loading.preview && !previewResult ? (
              <div className="flex items-center justify-center h-[500px] text-slate-500 text-sm">
                <Spinner />
                <span className="ml-2">กำลัง render preview...</span>
              </div>
            ) : previewResult ? (
              <PreviewFrame body={previewResult.body} />
            ) : (
              <div className="flex items-center justify-center h-[500px] text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded">
                กด <strong className="mx-1">Preview</strong> เพื่อดูผลลัพธ์
              </div>
            )}

            {/* Preview Meta */}
            {previewResult && previewResult.meta.missingFieldIds.length > 0 && (
              <div className="mt-3 bg-amber-50 border border-amber-200 rounded p-2 text-[11px]">
                <p className="font-semibold text-amber-800">Missing Fields:</p>
                <ul className="mt-1 space-y-0.5">
                  {previewResult.meta.missingFieldIds.map((fid) => (
                    <li key={fid} className="text-amber-700 font-mono">
                      {fid}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// =============================================================================
// Sub-Components
// =============================================================================

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function PreviewFrame({ body }: { body: string }) {
  // Use srcdoc for sandboxed HTML preview
  const srcDoc = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 16px;
          margin: 0;
          color: #1e293b;
          background: white;
          line-height: 1.5;
        }
        .dc-heading { font-weight: 600; margin: 0; }
        .dc-heading.size-small { font-size: 14px; }
        .dc-heading.size-medium { font-size: 18px; }
        .dc-heading.size-large { font-size: 24px; }
        .dc-field-label { font-weight: 500; color: #475569; font-size: 12px; margin-bottom: 4px; }
        .dc-field-value { font-size: 14px; }
        .dc-field-block, .dc-table-block, .dc-logo-block, .dc-heading-block { margin-bottom: 8px; }
        .dc-table-block table { border-collapse: collapse; width: 100%; font-size: 12px; }
        .dc-table-block th, .dc-table-block td { border: 1px solid #cbd5e1; padding: 4px 8px; text-align: left; }
        .dc-table-block th { background: #f1f5f9; font-weight: 600; }
        .dc-logo-block { display: flex; }
      </style>
    </head>
    <body>${body}</body>
    </html>
  `;

  return (
    <iframe
      srcDoc={srcDoc}
      title="Document Preview"
      className="w-full h-[500px] border border-slate-200 rounded bg-white"
      sandbox="allow-same-origin"
    />
  );
}