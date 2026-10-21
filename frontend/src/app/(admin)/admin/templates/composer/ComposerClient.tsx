'use client';

/**
 * Document Composer Client
 * --------------------------------
 * Document Composer V1 — Admin UI Orchestrator
 *
 * Layout (ก้อนที่ 2 — Responsive Composer Workspace):
 *   - Left:   Actions (Generate / Load / Save / Preview) — ย่อ/ขยายได้
 *   - Middle: Block Panel (Visual Composer) + Advanced JSON Editor
 *   - Divider: เส้นแบ่งที่ลากปรับขนาดได้
 *   - Right:  Live Preview
 *   - < 1024px → โหมดแท็บ [แก้ไขเอกสาร] [ดูตัวอย่าง]
 *
 * ⚠️ Layout state (splitRatio / sidebarCollapsed / tab) แยกจาก
 *    DocumentDescriptor เด็ดขัด — เก็บใน localStorage เป็น UI preference เท่านั้น
 *    (ไม่มี descriptor / token / ข้อมูลผู้สมัครถูกบันทึก)
 *
 * State Model (UAT Hardening):
 *   - useTemplateDescriptor hook เป็น single source of truth (ไม่มี local mirror)
 *   - Visual Composer เรียก hook.setDescriptor() — sync text ให้อัตโนมัติ
 *   - JSON Editor เรียก hook.setDescriptorText() — sync object ให้อัตโนมัติ
 *   - ป้องกัน state desync bug (แก้ align → preview ไม่เปลี่ยน)
 *
 * First Time Open Behavior (UAT):
 *   - NO_DESCRIPTOR → Auto Generate descriptor (silent, แสดง toast เมื่อสำเร็จ)
 *   - VERSION_MISMATCH → Warning banner + ปุ่ม [Regenerate Descriptor]
 *     (ไม่ auto-generate ทับ — user ตัดสินใจเอง)
 *   - NOT_FOUND / INVALID_JSON → Auto Generate เช่นกัน (เพราะใหม่ = ไม่มีของเก่า)
 *
 * Optimistic Locking (UAT):
 *   - ส่ง expectedSchemaVersion เฉพาะเมื่อ schemaVersion !== null
 *   - ถ้า schemaVersion = null (first save / generate) → ไม่ส่ง → backend
 *     path "overwrite" → save สำเร็จเสมอ
 *
 * Enterprise UX Pass:
 *   ✓ Loading state ทุก action (Spinner + disabled button)
 *   ✓ Success toast ทุก action ที่สำเร็จ
 *   ✓ Error toast ทุก action ที่ล้มเหลว (normalize เป็น string เสมอ)
 *   ✓ Disable ปุ่มระหว่าง submit
 *   ✓ Confirm ก่อน Delete Block
 *   ✓ Unsaved Changes Warning ก่อนออกจากหน้า
 *   ✓ Auto Save Indicator (Saved / Unsaved Changes / Saving...)
 *   ✓ Friendly Empty State
 */

import {
  Suspense,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { useTemplateDescriptor } from '@/hooks/useTemplateDescriptor';
import { adminFetch } from '@/lib/useAdminAuth';
import type {
  DocumentDescriptor,
  ValidationIssue,
  PreviewMode,
} from '@/lib/api/template-descriptor';

import { BlockPanel } from './components/BlockPanel';
import { JsonEditor } from './components/JsonEditor';
import { PreviewPanel } from './components/PreviewPanel';
import { PreviewModal } from './components/PreviewModal';
import { DataSourceToolbar } from './components/DataSourceToolbar';
import { ComposerWorkspace } from './components/ComposerWorkspace';
import { useTemplateFields } from './hooks/useTemplateFields';
import { useWorkspaceLayout } from './hooks/useWorkspaceLayout';
import { useAvailableHeight } from './hooks/useAvailableHeight';
import { previewTriggerSignature } from './lib/workspace-layout';

// =============================================================================
// Template Version Meta
// =============================================================================

interface TemplateVersionMeta {
  id: string;
  versionNumber: number;
  status: string;
  templateId: string;
  templateName: string;
  templateDescription: string | null;
}

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
// Main Component (Suspense for useSearchParams)
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

// =============================================================================
// Save Status Indicator
// =============================================================================

type SaveStatus = 'idle' | 'saving' | 'saved' | 'unsaved';

/**
 * useSaveStatus — transition-based state machine
 *
 * Root cause: schemaVersion (CURRENT_DESCRIPTOR_SCHEMA_VERSION) เป็น constant = 1
 * ไม่ bump หลัง save → ใช้ schemaVersion เปรียบเทียบไม่ได้ → status ค้างที่ 'saving' ตลอด
 *
 * แก้: ใช้ **edge detection** ของ loading.save (true → false) เป็นสัญญาณ save เสร็จ
 * แล้วตรวจ lastError เพื่อแยก success/fail
 *
 * Precedence (single deterministic state machine, ไม่มี timeout/setTimeout):
 *   1) loading.save เพิ่ง false และ wasSavingRef เป็น true
 *        → เพิ่งจบ save → 'saved' (ถ้าไม่มี error) หรือ 'unsaved' (ถ้ามี error)
 *   2) loading.save === true
 *        → 'saving'  + mark wasSavingRef = true
 *   3) source เพิ่งเปลี่ยนเป็น 'default' (load() returned no descriptor)
 *        → 'idle'
 *   4) initial load เสร็จ (source='db' + sv!=null ครั้งแรก)
 *        → 'saved' + เก็บ savedAt
 *   5) otherwise → ไม่แตะ status
 */
function useSaveStatus(
  loading: { save: boolean },
  source: 'db' | 'default' | null,
  schemaVersion: number | null,
  lastError: string | null
) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const wasSavingRef = useRef(false);
  const prevLoadingSaveRef = useRef(false);
  const prevSourceRef = useRef<'db' | 'default' | null>(null);
  const prevSchemaVersionRef = useRef<number | null>(null);

  useEffect(() => {
    const prevLoadingSave = prevLoadingSaveRef.current;
    const prevSource = prevSourceRef.current;
    const prevSv = prevSchemaVersionRef.current;

    // Update refs (สำหรับ effect รอบหน้า)
    prevLoadingSaveRef.current = loading.save;
    prevSourceRef.current = source;
    prevSchemaVersionRef.current = schemaVersion;

    // 1) Edge: loading.save เพิ่ง false (true → false) → save เพิ่งจบ
    if (prevLoadingSave === true && loading.save === false) {
      wasSavingRef.current = false;
      if (lastError) {
        setStatus('unsaved');
      } else {
        setStatus('saved');
        setSavedAt(Date.now());
      }
      return;
    }

    // 2) loading.save === true → save in flight
    if (loading.save) {
      wasSavingRef.current = true;
      setStatus('saving');
      return;
    }

    // 3) source เพิ่งเปลี่ยนเป็น 'default' (load returned no descriptor)
    if (prevSource !== 'default' && source === 'default') {
      wasSavingRef.current = false;
      setStatus('idle');
      return;
    }

    // 4) initial load เสร็จ: source=null→'db' (หรือ default→'db') ครั้งแรก + sv != null
    //    → แสดง 'บันทึกแล้ว' ตามเวลาที่ load เสร็จ (ครั้งเดียว)
    if (
      source === 'db' &&
      schemaVersion !== null &&
      prevSource !== 'db' &&
      !wasSavingRef.current
    ) {
      setStatus('saved');
      setSavedAt(Date.now());
      return;
    }

    // 5) otherwise: ไม่แตะ status — preserve 'unsaved' ที่ user ยังไม่ได้ save
  }, [loading.save, source, schemaVersion, lastError]);

  const markUnsaved = useCallback(() => {
    // ใช้ functional updater กัน race กับ useEffect
    setStatus((s) => (s === 'saving' ? s : 'unsaved'));
  }, []);

  return { status, savedAt, markUnsaved };
}

function SaveIndicator({ status, savedAt }: { status: SaveStatus; savedAt: number | null }) {
  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-blue-700 font-medium">
        <Spinner /> กำลังบันทึก...
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-700 font-medium">
        ✅ บันทึกแล้ว
        {savedAt && (
          <span className="text-slate-500 font-normal">
            ({timeAgo(savedAt)})
          </span>
        )}
      </span>
    );
  }
  if (status === 'unsaved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-700 font-medium">
        ⚠️ มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก
      </span>
    );
  }
  return null;
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return 'เมื่อกี้';
  if (diff < 60) return `${diff} วินาทีที่แล้ว`;
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
  return `${Math.floor(diff / 3600)} ชั่วโมงที่แล้ว`;
}

// =============================================================================
// Inner Component
// =============================================================================

function ComposerInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const versionId =
    searchParams.get('versionId') || searchParams.get('id') || '';
  const { showToast } = useToast();

  const [meta, setMeta] = useState<TemplateVersionMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);

  // -------------------------------------------------------------------------
  // Hook — single source of truth
  // -------------------------------------------------------------------------
  const {
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
  } = useTemplateDescriptor(versionId);

  // -------------------------------------------------------------------------
  // Save Status Indicator
  // -------------------------------------------------------------------------
  const { status: saveStatus, savedAt, markUnsaved } = useSaveStatus(
    loading,
    source,
    schemaVersion,
    lastError
  );

  // -------------------------------------------------------------------------
  // Preview Data Source (Requirement A)
  // -------------------------------------------------------------------------
  const [previewDataSource, setPreviewDataSource] = useState<{
    mode: 'sample' | 'real';
    selectedRound: { id: string; title: string; positionLevel: string; templateVersionId: string; status: string; roundCode?: string | null } | null;
    selectedApplication: { id: string; applicationNo: string; fullname: string; email: string } | null;
    applicationId: string | null;
  }>({
    mode: 'sample',
    selectedRound: null,
    selectedApplication: null,
    applicationId: null,
  });

  // -------------------------------------------------------------------------
  // Workspace Layout (ก้อนที่ 2)
  //
  // ⚠️ Layout state แยกจาก DocumentDescriptor เด็ดขัด
  //    - เก็บใน localStorage เป็น UI preference เท่านั้น
  //    - ไม่มีการเขียนค่าใด ๆ กลับเข้า descriptor / backend
  // -------------------------------------------------------------------------
  const {
    splitRatio,
    sidebarCollapsed,
    layoutMode,
    activeTab,
    isDragging,
    setActiveTab,
    toggleSidebar,
    resetLayout,
    dividerProps,
    containerRef,
  } = useWorkspaceLayout();

  /** ความสูงพื้นที่ทำงานที่เหลือจาก viewport (วัดจริง ไม่ hard-code) */
  const { ref: heightRef, height: workspaceHeight } = useAvailableHeight(360, [
    layoutMode,
    // alert ที่แสดง/ซ่อนทำให้ความสูงพื้นที่ทำงานเปลี่ยน → วัดใหม่
    source,
    fallbackReason,
    lastError,
  ]);

  // Track: เมื่อ descriptor เปลี่ยนจากภายใน (Visual Composer) → mark unsaved
  // ห้าม mark ตอน load/generate เสร็จ (เพราะตอนนั้น source จะเปลี่ยน)
  const lastDescriptorRef = useRef<DocumentDescriptor | null>(null);
  const lastSourceRef = useRef(source);
  const isFirstRenderRef = useRef(true);
  useEffect(() => {
    // Skip ครั้งแรก — ป้องกัน false positive ตอน mount
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      lastSourceRef.current = source;
      lastDescriptorRef.current = descriptor;
      return;
    }
    // ถ้า source เพิ่งเปลี่ยน → ไม่ mark (เพราะเป็น load/generate ใหม่)
    if (lastSourceRef.current !== source) {
      lastSourceRef.current = source;
      lastDescriptorRef.current = descriptor;
      return;
    }
    // ถ้า descriptor เปลี่ยนจาก last → user แก้ → mark unsaved
    if (
      descriptor &&
      lastDescriptorRef.current &&
      descriptor !== lastDescriptorRef.current
    ) {
      // deep equality check แบบเร็ว: ใช้ JSON.stringify เปรียบเทียบ
      if (
        JSON.stringify(descriptor) !==
        JSON.stringify(lastDescriptorRef.current)
      ) {
        markUnsaved();
      }
    }
    lastDescriptorRef.current = descriptor;
  }, [descriptor, source, markUnsaved]);

  // -------------------------------------------------------------------------
  // Field library
  // -------------------------------------------------------------------------
  const { fields, loading: fieldsLoading } = useTemplateFields(
    metaLoading ? null : versionId
  );

  // -------------------------------------------------------------------------
  // Confirm Delete Block dialog
  // -------------------------------------------------------------------------
  const [confirmDelete, setConfirmDelete] = useState<{
    index: number;
    summary: string;
  } | null>(null);

  // -------------------------------------------------------------------------
  // Fullscreen Preview Modal (Live Preview UX — Req 2)
  // -------------------------------------------------------------------------
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  const handleDeleteRequest = useCallback(
    (index: number, summary: string) => {
      setConfirmDelete({ index, summary });
    },
    []
  );

  const handleConfirmDelete = useCallback(() => {
    if (!descriptor || !confirmDelete) return;
    const next = descriptor.blocks.slice();
    next.splice(confirmDelete.index, 1);
    setDescriptor({ ...descriptor, blocks: next });
    setConfirmDelete(null);
    showToast({ title: 'ลบ Block แล้ว', variant: 'success' });
  }, [descriptor, confirmDelete, setDescriptor, showToast]);

  // -------------------------------------------------------------------------
  // Load template version meta
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Auto Generate เมื่อ NO_DESCRIPTOR (UAT First Time Open)
  // -------------------------------------------------------------------------
  const autoGenerateAttemptedRef = useRef(false);
  useEffect(() => {
    if (!versionId) return;
    // รอ load เสร็จก่อน (source != null หมายถึง load() resolved)
    if (loading.load) return;
    if (autoGenerateAttemptedRef.current) return;

    // Auto Generate เมื่อ:
    //   - source === 'default' AND
    //   - fallbackReason in ['NO_DESCRIPTOR', 'NOT_FOUND', 'INVALID_JSON'] AND
    //   - descriptor ไม่มี block
    const shouldAutoGenerate =
      source === 'default' &&
      (fallbackReason === 'NO_DESCRIPTOR' ||
        fallbackReason === 'NOT_FOUND' ||
        fallbackReason === 'INVALID_JSON') &&
      (!descriptor || descriptor.blocks.length === 0);

    if (!shouldAutoGenerate) return;

    autoGenerateAttemptedRef.current = true;
    // eslint-disable-next-line no-console
    console.log('[Composer] Auto-generating descriptor (first time open)');
    (async () => {
      const ok = await generate();
      if (ok) {
        showToast({
          title: 'สร้าง Descriptor อัตโนมัติสำเร็จ',
          description: generateMeta
            ? `${generateMeta.blockCount} block(s) from template structure`
            : undefined,
          variant: 'success',
        });
      } else {
        showToast({
          title: 'Auto Generate ไม่สำเร็จ',
          description: 'กรุณากดปุ่ม Generate อีกครั้ง',
          variant: 'error',
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading.load, source, fallbackReason, descriptor, versionId]);

  // -------------------------------------------------------------------------
  // Action wrappers — ทุก action มี loading state + toast
  // -------------------------------------------------------------------------

  const handleLoad = async () => {
    if (loading.load) return;
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
    if (loading.save) return;
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

  const handleGenerate = async () => {
    if (loading.generate) return;
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

  const handleManualPreview = async () => {
    if (loading.preview) return;
    if (!isTextValid) {
      showToast({
        title: 'JSON ไม่ถูกต้อง',
        description: 'กรุณาแก้ไขก่อน Preview',
        variant: 'error',
      });
      return;
    }
    // [Live Preview UX — Req 2] เปิด Fullscreen A4 Modal
    // Modal จะเรียก runPreview({ mode, includeHeader: true }) ภายในเอง
    setPreviewModalOpen(true);
  };

  // Wrapper สำหรับ PreviewModal — เรียก hook.runPreview พร้อม options + applicationId
  const fetchPreviewForModal = useCallback(
    async (
      options: { mode: PreviewMode; includeHeader: true },
      applicationId?: string
    ) => {
      return await runPreview(options, applicationId);
    },
    [runPreview]
  );

  const handleRegenerate = async () => {
    // ใช้สำหรับ VERSION_MISMATCH — explicit regenerate
    const ok = await generate();
    if (ok) {
      showToast({
        title: 'Regenerate Descriptor สำเร็จ',
        variant: 'success',
      });
    } else {
      showToast({
        title: 'Regenerate ไม่สำเร็จ',
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

  // -------------------------------------------------------------------------
  // Unsaved Changes Warning ก่อนออกจากหน้า (UAT)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (saveStatus === 'unsaved') {
        e.preventDefault();
        // สำหรับ browser ส่วนใหญ่ — message ไม่ได้แสดง แต่ preventDefault พอ
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveStatus]);

  // -------------------------------------------------------------------------
  // Auto-refresh preview (debounced) — เมื่อ descriptor เปลี่ยน
  // หมายเหตุ: ใช้ ref กัน stale closure (useEffect dep = descriptor เท่านั้น)
  //
  // [ก้อนที่ 2] ใช้ "ลายเซ็น" (trigger signature) เป็น dependency แทน descriptor
  //   → การสลับแท็บ / ลาก divider / ย่อ sidebar **ไม่** ทำให้เกิด
  //     Preview request ซ้ำ (เพราะเหตุผลของ layout เพียงอย่างเดียว)
  // -------------------------------------------------------------------------
  const runPreviewRef = useRef(runPreview);
  const previewDataSourceRef = useRef(previewDataSource);
  useEffect(() => {
    runPreviewRef.current = runPreview;
  }, [runPreview]);
  useEffect(() => {
    previewDataSourceRef.current = previewDataSource;
  }, [previewDataSource]);

  const previewTrigger = previewTriggerSignature({
    descriptor,
    descriptorText,
    isTextValid,
    dataSource: previewDataSource,
  });

  useEffect(() => {
    if (!isTextValid || !descriptor) return;
    const timer = setTimeout(() => {
      const { selectedApplication } = previewDataSourceRef.current;
      const applicationId = selectedApplication?.id ?? undefined;
      runPreviewRef.current(undefined, applicationId);
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewTrigger]);

  // -------------------------------------------------------------------------
  // Render — no versionId yet
  // -------------------------------------------------------------------------

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

  // Loading skeleton ตอน load() ครั้งแรก (ก่อนได้ descriptor)
  if (loading.load && !descriptor) {
    return (
      <div className="p-8 text-center text-slate-500 flex items-center justify-center gap-2">
        <Spinner />
        <span>กำลังโหลด Descriptor...</span>
      </div>
    );
  }

  // Auto-generate in progress (first time open)
  const isAutoGenerating =
    source === 'default' &&
    (fallbackReason === 'NO_DESCRIPTOR' ||
      fallbackReason === 'NOT_FOUND' ||
      fallbackReason === 'INVALID_JSON') &&
    loading.generate;

  if (isAutoGenerating) {
    return (
      <div className="p-8 max-w-md mx-auto text-center space-y-3">
        <Spinner />
        <p className="text-slate-700 font-medium">
          กำลังสร้าง Descriptor อัตโนมัติจาก Template Structure...
        </p>
        <p className="text-[11px] text-slate-500">
          (เปิดครั้งแรก — ยังไม่มี descriptor ที่บันทึกไว้)
        </p>
      </div>
    );
  }

  // VERSION_MISMATCH guard (UAT) — ไม่ให้ user ใช้ empty descriptor
  const isVersionMismatch = source === 'default' && fallbackReason === 'VERSION_MISMATCH';

  const templateName = meta?.templateName ?? 'Template Version';
  const versionNumber = meta?.versionNumber ?? 0;
  const versionStatus = meta?.status ?? 'UNKNOWN';

  // -------------------------------------------------------------------------
  // Render — main 3-column layout
  // -------------------------------------------------------------------------

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* ===== HEADER ===== */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Button variant="ghost" size="sm" onClick={handleBack} className="shrink-0">
            ← กลับ
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-slate-900 leading-tight">
              <span className="truncate">จัดหน้าเอกสาร: {templateName}</span>
            </h1>
            <p className="text-[11px] text-slate-500 mt-0.5">
              จัดลำดับ Heading, Field, Table และ Logo ของเอกสาร — ไม่ต้องเขียน JSON
            </p>
            <p className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5 flex-wrap">
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
              <span>•</span>
              <SaveIndicator status={saveStatus} savedAt={savedAt} />
            </p>
          </div>
        </div>
      </div>

      {/* ===== STATUS ALERTS ===== */}

      {/* VERSION_MISMATCH → Warning + Regenerate ปุ่ม (ไม่ auto-generate) */}
      {isVersionMismatch && (
        <Alert className="bg-amber-50 border-amber-400 border-2">
          <AlertDescription className="text-amber-900 text-sm space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-lg shrink-0">⚠️</span>
              <div className="flex-1">
                <strong>Descriptor เวอร์ชันเก่า ไม่สามารถใช้งานได้</strong>
                <p className="mt-1 text-xs">
                  ระบบพบ descriptor ที่บันทึกด้วย schema version เก่า ซึ่งไม่ compatible กับเวอร์ชันปัจจุบัน
                  เพื่อความปลอดภัย ระบบไม่ fallback เป็น empty descriptor
                  กรุณากดปุ่ม <strong>Regenerate Descriptor</strong> เพื่อสร้างใหม่จาก template structure
                </p>
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <Button
                size="sm"
                onClick={handleRegenerate}
                disabled={loading.generate}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                {loading.generate ? <Spinner /> : <span>🔄</span>}
                <span>Regenerate Descriptor</span>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Error alert (จาก lastError) */}
      {lastError && (
        <Alert className="bg-red-50 border-red-300 border">
          <AlertDescription className="text-red-900 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
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
              </div>
              <button
                onClick={clearError}
                className="text-red-700 hover:text-red-900 text-sm shrink-0"
                aria-label="Close error"
              >
                ✕
              </button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* ===== WORKSPACE LAYOUT (ก้อนที่ 2) ===== */}
      {/*
        โครงสร้างใหม่:
          Desktop/Laptop: [Actions] [Visual Composer | Divider | Live Preview]
          Mobile:          [แท็บ: แก้ไขเอกสาร | ดูตัวอย่าง]

        ⚠️ แต่ละคอลัมน์เลื่อนแยกกัน (overflow-y-auto + min-h-0)
           หัวของแต่ละคอลัมน์อยู่นิ่ง และไม่ hard-code viewport offset
      */}
      <ComposerWorkspace
        layoutMode={layoutMode}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        onResetLayout={resetLayout}
        onGenerate={handleGenerate}
        onLoad={handleLoad}
        onSave={handleSave}
        onFullscreenPreview={handleManualPreview}
        loading={{
          generate: loading.generate,
          load: loading.load,
          save: loading.save,
          preview: loading.preview,
        }}
        canSave={isTextValid && !isVersionMismatch}
        canPreview={isTextValid && !isVersionMismatch}
        splitRatio={splitRatio}
        isDragging={isDragging}
        dividerProps={dividerProps}
        containerRef={containerRef}
        heightRef={heightRef}
        workspaceHeight={workspaceHeight}
        composerContent={
          <Card className="flex flex-col min-h-0 h-full overflow-hidden">
            <CardHeader className="pb-3 shrink-0">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span>🧩</span>
                  <span>Visual Composer</span>
                </CardTitle>
                <span className="text-[10px] text-slate-500">
                  {descriptor?.blocks.length ?? 0} block(s) · {fields.length}{' '}
                  field(s)
                </span>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-3 flex-1 min-h-0 overflow-y-auto">
              {/* Friendly Empty State */}
              {!isVersionMismatch &&
              (!descriptor || descriptor.blocks.length === 0) ? (
                <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center bg-slate-50">
                  <div className="text-4xl mb-2">📄</div>
                  <p className="text-sm font-medium text-slate-700">
                    ยังไม่มี Block ใน Descriptor
                  </p>
                  <p className="text-xs mt-2 text-slate-500 max-w-sm mx-auto">
                    กด <strong>Generate</strong> เพื่อสร้างอัตโนมัติจาก Template
                    Structure หรือเพิ่ม Block ทีละตัวจากแถบเครื่องมือด้านบน
                  </p>
                </div>
              ) : (
                <BlockPanel
                  descriptor={descriptor ?? { version: 1, blocks: [] }}
                  onChange={setDescriptor}
                  fields={fields}
                  fieldsLoading={fieldsLoading}
                  disabled={loading.save || loading.generate || isVersionMismatch}
                  onDeleteRequest={handleDeleteRequest}
                />
              )}

              <JsonEditor
                text={descriptorText}
                onTextChange={setDescriptorText}
                isValid={isTextValid}
                parseIssues={parseIssues}
                charCount={descriptorText.length}
                onFormatFromObject={() => {
                  if (descriptor) setDescriptor(descriptor);
                }}
              />
            </CardContent>
          </Card>
        }
        previewContent={
          <Card className="flex flex-col min-h-0 h-full overflow-hidden">
            <CardHeader className="pb-3 shrink-0 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span>👁</span>
                  <span>Live Preview</span>
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleManualPreview}
                  disabled={loading.preview || !isTextValid || isVersionMismatch}
                  className="h-7 text-[11px]"
                  title="เปิด Fullscreen A4 Preview"
                  aria-label="เปิด Fullscreen A4 Preview"
                >
                  {loading.preview ? (
                    <Spinner />
                  ) : (
                    <span aria-hidden="true">⛶</span>
                  )}
                  <span>Fullscreen</span>
                </Button>
              </div>

              {/* Data Source Toolbar (Requirement A) — อยู่ในหัว จึงไม่เลื่อนตาม */}
              <DataSourceToolbar
                value={previewDataSource}
                onChange={setPreviewDataSource}
                templateVersionId={versionId}
                disabled={loading.save || loading.generate || isVersionMismatch}
              />
            </CardHeader>
            {/*
              ⚠️ hierarchy ความสูง (ก้อนที่ 2 — UAT fix):
                 Card (flex-col) → CardHeader (shrink-0) → CardContent (flex-1 min-h-0 flex flex-col)
                 → PreviewPanel (flex-1 min-h-0) → wrapper (flex-1 min-h-0) → iframe (h-full)

                 - CardContent ต้องเป็น **flex column** ไม่ใช่ block
                   (ถ้าเป็น block → PreviewPanel ไม่ได้ flex-1/h-full → iframe จบกลางคอลัมน์)
                 - overflow-y-auto อยู่ที่ชั้นนี้ไม่ได้ (เอกสารยาวให้ scroll ภายใน iframe)
            */}
            <CardContent className="pt-0 !px-3 !pb-3 flex-1 min-h-0 flex flex-col overflow-hidden">
              <PreviewPanel preview={previewResult} loading={loading.preview} />
            </CardContent>
          </Card>
        }
      />

      {/* Confirm Delete Block Dialog */}
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยืนยันการลบ Block?</DialogTitle>
            <DialogDescription>
              คุณกำลังจะลบ Block นี้:
              <br />
              <code className="mt-2 inline-block px-2 py-1 bg-slate-100 rounded text-xs">
                {confirmDelete?.summary}
              </code>
              <br />
              <span className="text-amber-700">
                การลบไม่สามารถ undo ได้ — ต้องกด Save เพื่อบันทึกการเปลี่ยนแปลง
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(null)}
            >
              ยกเลิก
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleConfirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              🗑 ลบเลย
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fullscreen A4 Preview Modal (Live Preview UX — Req 2+) */}
      <PreviewModal
        open={previewModalOpen}
        onClose={() => setPreviewModalOpen(false)}
        currentPreview={previewResult}
        fetchPreview={fetchPreviewForModal}
        loading={loading.preview}
        dataSource={previewDataSource.mode}
        selectedApplication={previewDataSource.selectedApplication}
      />
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