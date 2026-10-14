'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { loadApplyDraft, clearApplyDraft, listDraftRoundIds, type ApplyDraft, type FileAttachmentDraft } from '@/lib/applyDraft';
import { clearSubmissionToken, getOrCreateSubmissionToken } from '@/lib/submissionToken';
import { usePublicConfig } from '@/lib/usePublicConfig';

type FieldType = 'TEXT' | 'TEXTAREA' | 'DROPDOWN' | 'RADIO' | 'FILE' | 'NUMBER' | 'CHECKBOX' | 'DATE' | 'MASTER_DATA';

interface SchemaField {
  fieldId: string;
  sectionId: string | null;
  type: FieldType;
  label: string;
  overrideLabel: string | null;
  options: string[] | null;
  overrideOptions: string[] | null;
  isRequired: boolean;
  masterDataSource?: string | null;
  fileConfig?: { maxFiles?: number; maxSizeMB?: number };
  section?: string;
}

interface TemplateSection {
  id: string;
  name: string;
  displayOrder: number;
}

function ReviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // The review page is invoked from /apply?id=<roundId>. We accept the
  // roundId via query param for a "deep link back to edit" affordance,
  // but the draft itself is the source of truth (sessionStorage is
  // tab-scoped, so a different roundId in the URL would be a stale tab).
  const urlRoundId = searchParams.get('id');

  const publicConfig = usePublicConfig();
  const [draft, setDraft] = useState<ApplyDraft | null>(null);
  const [schema, setSchema] = useState<SchemaField[]>([]);
  const [sections, setSections] = useState<TemplateSection[]>([]);
  const [loadingSchema, setLoadingSchema] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Mobile section collapse: track which section ids are open. Default:
  // desktop = all open; mobile = only the first open.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [isMobile, setIsMobile] = useState(false);

  // =========================================================================
  //  Load draft on mount
  // =========================================================================
  // The review page assumes the user came from /apply with a saved draft.
  //
  // Three ways the user can land here:
  //   1. From /apply (the normal flow) — `urlRoundId` is null, but a
  //      draft is in sessionStorage. We discover the roundId by listing
  //      stored drafts. F5 falls into this case too.
  //   2. Deep link `/apply/review?id=<roundId>` — explicit roundId.
  //   3. Direct visit with no draft and no id — error card.
  //
  // The effect is **idempotent**: once we've set `draft`, we exit so the
  // dep change from `setDraft` doesn't trigger a redundant second load.
  useEffect(() => {
    if (draft) return; // already loaded

    // Case 2: explicit roundId in the URL.
    if (urlRoundId) {
      const loaded = loadApplyDraft(urlRoundId);
      if (!loaded) {
        // No draft for the requested round — kick back to /apply.
        router.replace(`/apply?id=${encodeURIComponent(urlRoundId)}`);
        return;
      }
      setDraft(loaded);
      return;
    }

    // Case 1: no roundId in the URL but sessionStorage may have a draft.
    const stored = listDraftRoundIds();
    if (stored.length === 1) {
      const loaded = loadApplyDraft(stored[0]);
      if (loaded) {
        setDraft(loaded);
        return;
      }
    }
    if (stored.length > 1) {
      // More than one in-flight draft in this tab. We can't disambiguate
      // — treat as "no draft" and let the user pick a round on the home
      // page. This is an extremely rare edge case (user opened multiple
      // apply tabs and merged them) so we just show the error card.
    }

    // Case 3: nothing to load.
    setLoadError('ไม่พบข้อมูลฉบับร่าง กรุณากรอกแบบฟอร์มอีกครั้ง');
    setLoadingSchema(false);
  }, [urlRoundId, draft, router]);

  // =========================================================================
  //  Load the schema for the round so we can show field labels + sections.
  // =========================================================================
  useEffect(() => {
    if (!draft) return;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787/api/v1';
    const controller = new AbortController();
    fetch(`${apiUrl}/public/rounds/${draft.roundId}/schema`, { signal: controller.signal })
      .then((res) => res.json())
      .then((res: any) => {
        if (!res || !res.data) {
          setLoadError('ไม่สามารถโหลดแบบฟอร์มอ้างอิงได้');
          return;
        }
        const fields: SchemaField[] = Array.isArray(res.data?.fields) ? res.data.fields.map(normalizeField) : [];
        const sectionList: TemplateSection[] = Array.isArray(res.data?.sections) ? res.data.sections : [];
        setSchema(fields);
        setSections(sectionList);
      })
      .catch((err: any) => {
        if (err?.name === 'AbortError') return;
        console.error('Failed to load schema:', err);
        setLoadError('ไม่สามารถโหลดแบบฟอร์มอ้างอิงได้');
      })
      .finally(() => setLoadingSchema(false));
    return () => controller.abort();
  }, [draft]);

  // Mobile breakpoint detection — we collapse sections on narrow viewports
  // so the long review page stays navigable on phones.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 767px)');
    const handle = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile(e.matches);
    handle(mql);
    mql.addEventListener('change', handle);
    return () => mql.removeEventListener('change', handle);
  }, []);

  // Initialize collapse state once sections load. Desktop = all open;
  // mobile = only the first open, the rest collapsed.
  useEffect(() => {
    if (sections.length === 0) return;
    const init: Record<string, boolean> = {};
    sections.forEach((s, i) => {
      init[s.id] = isMobile ? i !== 0 : false;
    });
    setCollapsed(init);
  }, [sections, isMobile]);

  // =========================================================================
  //  Derived: field lookup by id
  // =========================================================================
  const fieldById = useMemo(() => {
    const map: Record<string, SchemaField> = {};
    schema.forEach((f) => { map[f.fieldId] = f; });
    return map;
  }, [schema]);

  // Group fields by section, mirroring the apply page's grouping logic.
  const grouped = useMemo(() => {
    const bySection: Record<string, SchemaField[]> = {};
    const ungrouped: SchemaField[] = [];
    const hasTemplateSections = sections.length > 0;
    schema.forEach((field) => {
      if (hasTemplateSections && field.sectionId) {
        if (!bySection[field.sectionId]) bySection[field.sectionId] = [];
        bySection[field.sectionId].push(field);
      } else if (hasTemplateSections && !field.sectionId) {
        ungrouped.push(field);
      } else if (!hasTemplateSections && field.section) {
        if (!bySection[field.section]) bySection[field.section] = [];
        bySection[field.section].push(field);
      } else {
        ungrouped.push(field);
      }
    });
    return { bySection, ungrouped, hasTemplateSections };
  }, [schema, sections]);

  // =========================================================================
  //  Render helpers
  // =========================================================================

  /**
   * Render a field's value as a human-readable string. The formData
   * stored in the draft mirrors what we'd POST to the server, so:
   *   - TEXT/TEXTAREA/NUMBER/DATE/URL/EMAIL → string
   *   - DROPDOWN/RADIO → string (option value)
   *   - CHECKBOX → boolean
   *   - MASTER_DATA → { id, name } (we render `name`)
   *   - FILE → not in formData; attachments[].fileUrl + name
   */
  const renderFieldValue = (field: SchemaField): { text: string; isEmpty: boolean } => {
    if (!draft) return { text: '', isEmpty: true };
    if (field.type === 'FILE') {
      // File fields are stored in `attachments`, not `formData`.
      const atts = draft.attachments.filter((a) => a.fieldId === field.fieldId);
      if (atts.length === 0) return { text: '', isEmpty: true };
      // We render the file list separately in `renderAttachmentList`, so
      // here we just emit a marker.
      return { text: `__FILE_LIST__${field.fieldId}`, isEmpty: false };
    }
    const raw = (draft.formData as Record<string, unknown>)[field.fieldId];
    if (raw === undefined || raw === null || raw === '') {
      return { text: '', isEmpty: true };
    }
    if (field.type === 'CHECKBOX') {
      return { text: raw === true ? '☑ ยอมรับ' : '☐ ไม่ยอมรับ', isEmpty: false };
    }
    if (field.type === 'MASTER_DATA' && typeof raw === 'object') {
      const obj = raw as { id?: string; name?: string };
      return { text: obj.name || obj.id || '', isEmpty: !obj.name && !obj.id };
    }
    return { text: String(raw), isEmpty: false };
  };

  const renderAttachmentList = (field: SchemaField) => {
    if (!draft) return null;
    const atts = draft.attachments.filter((a) => a.fieldId === field.fieldId);
    if (atts.length === 0) {
      return <span className="text-sm text-gray-400 italic">ไม่ได้แนบไฟล์</span>;
    }
    return (
      <ul className="space-y-2">
        {atts.map((att, idx) => (
          <li
            key={`${att.fieldId}-${idx}`}
            className="flex items-center gap-3 p-2 rounded-md border border-slate-200 bg-slate-50 min-w-0"
          >
            {/* File-type icon (PDF / image / generic) */}
            <div className="flex-shrink-0 w-8 h-8 rounded bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold uppercase">
              {guessTypeBadge(att)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">
                {att.fileName || filenameFromUrl(att.fileUrl)}
              </div>
              <div className="text-xs text-slate-500 truncate">{att.contentType || 'ไฟล์แนบ'}</div>
            </div>
            <a
              href={att.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 text-blue-600 hover:text-blue-800 text-sm font-medium underline whitespace-nowrap"
            >
              เปิดดู →
            </a>
          </li>
        ))}
      </ul>
    );
  };

  /**
   * Map a contentType or filename to a short uppercase badge.
   * Falls back to "FILE" for anything we don't recognize.
   */
  const guessTypeBadge = (att: FileAttachmentDraft): string => {
    const ct = (att.contentType || '').toLowerCase();
    const name = (att.fileName || att.fileUrl || '').toLowerCase();
    if (ct.includes('pdf') || name.endsWith('.pdf')) return 'PDF';
    if (ct.includes('jpeg') || ct.includes('jpg') || name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'JPG';
    if (ct.includes('png') || name.endsWith('.png')) return 'PNG';
    if (ct.includes('word') || name.endsWith('.doc') || name.endsWith('.docx')) return 'DOC';
    return 'FILE';
  };

  const filenameFromUrl = (url: string): string => {
    if (!url) return 'ไฟล์แนบ';
    const cleaned = url.split('?')[0].split('#')[0];
    const last = cleaned.split('/').pop() || '';
    const dashIdx = last.indexOf('-');
    return dashIdx >= 0 ? last.slice(dashIdx + 1) : last;
  };

  // =========================================================================
  //  Actions
  // =========================================================================

  const handleEdit = () => {
    if (!draft) return;
    // Draft is already in sessionStorage; just navigate back. The apply
    // page rehydrates from the same key on mount.
    router.push(`/apply?id=${encodeURIComponent(draft.roundId)}`);
  };

  const handleSubmit = async () => {
    if (!draft) return;
    if (!confirmed) return; // belt-and-suspenders: button is also disabled
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Ensure we have a token (the apply page already created one, but
      // a hard refresh between apply and review may have lost it).
      const token = getOrCreateSubmissionToken();
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787/api/v1';
      const res = await fetch(`${apiUrl}/public/applications/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roundId: draft.roundId,
          formData: draft.formData,
          attachments: draft.attachments.map((a) => ({ fieldId: a.fieldId, fileUrl: a.fileUrl })),
          submissionToken: token,
        }),
      });
      const result = await res.json();

      if (res.status === 403) {
        setSubmitError(result?.error ?? 'ขณะนี้ยังไม่เปิดรับสมัคร');
        return;
      }
      if (res.status === 409) {
        // Idempotency in-flight race — tell the user to try again.
        setSubmitError('มีการส่งคำขอซ้ำ กรุณารอสักครู่แล้วลองอีกครั้ง');
        return;
      }
      if (res.status === 429) {
        setSubmitError('มีการส่งคำขอมากเกินไป กรุณารอสักครู่');
        return;
      }
      if (res.status === 503) {
        setSubmitError('ระบบไม่สามารถสร้างเลขที่ใบสมัครได้ในขณะนี้ กรุณาลองอีกครั้ง');
        return;
      }

      if (result && result.success && result.data?.applicationNo) {
        // Success: clear draft + token, redirect.
        clearApplyDraft(draft.roundId);
        clearSubmissionToken();
        router.push(`/apply/success?appNo=${encodeURIComponent(result.data.applicationNo)}`);
        return;
      }
      setSubmitError(result?.error ?? 'ไม่สามารถส่งใบสมัครได้');
    } catch (err) {
      console.error('Submit error:', err);
      setSubmitError(err instanceof Error ? err.message : 'ไม่ทราบสาเหตุ');
    } finally {
      setSubmitting(false);
    }
  };

  // =========================================================================
  //  Loading / error states
  // =========================================================================

  if (loadError && !draft) {
    return (
      <div className="max-w-3xl mx-auto p-4 md:p-8">
        <Card>
          <CardHeader className="bg-amber-50 border-b border-amber-200">
            <CardTitle className="text-xl text-amber-800">ไม่สามารถเปิดหน้าตรวจสอบข้อมูลได้</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            <p className="text-slate-700">{loadError}</p>
            <div className="flex gap-3">
              <Link href="/">
                <Button variant="outline">กลับหน้าหลัก</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!draft || loadingSchema) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-blue-500 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-500">กำลังโหลดข้อมูลที่ตรวจสอบ...</p>
        </div>
      </div>
    );
  }

  // =========================================================================
  //  Render
  // =========================================================================

  const renderFieldRow = (field: SchemaField) => {
    const label = field.overrideLabel || field.label;
    const { text, isEmpty } = renderFieldValue(field);
    return (
      <div key={field.fieldId} className="grid grid-cols-1 md:grid-cols-3 gap-2 py-3 border-b border-slate-100 last:border-b-0">
        <div className="text-sm font-medium text-slate-600 md:col-span-1">
          {label}
          {field.isRequired && <span className="text-red-500 ml-1">*</span>}
        </div>
        <div className="text-sm text-slate-900 md:col-span-2 break-words">
          {text.startsWith('__FILE_LIST__')
            ? renderAttachmentList(field)
            : isEmpty
              ? <span className="text-slate-400 italic">— ไม่ได้กรอก —</span>
              : text}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-4">
      {/* Turnstile foundation — wire the widget here in a follow-up PR.
          We expose `publicConfig.data.turnstile` so the future component
          can read it without changing the page structure. */}
      {/* publicConfig.status === 'ready' && publicConfig.data.turnstile.enabled && <TurnstileWidget ... /> */}

      <Card>
        <CardHeader className="bg-slate-50 border-b">
          <CardTitle className="text-xl">ตรวจสอบข้อมูลการสมัคร</CardTitle>
          <p className="text-sm text-slate-500 mt-1">
            กรุณาตรวจสอบข้อมูลของท่านให้ถูกต้องก่อนกดยืนยันส่งใบสมัคร
          </p>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          {/* Ungrouped fields */}
          {grouped.ungrouped.length > 0 && (
            <section>
              <h3 className="font-semibold text-base border-b pb-2 mb-2">ข้อมูลอื่น ๆ</h3>
              <div>{grouped.ungrouped.map(renderFieldRow)}</div>
            </section>
          )}

          {/* Sectioned fields */}
          {grouped.hasTemplateSections ? (
            sections.map((section) => {
              const fields = grouped.bySection[section.id] || [];
              if (fields.length === 0) return null;
              const isCollapsed = collapsed[section.id] === true;
              return (
                <section key={section.id} className="border border-slate-200 rounded-md">
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() => setCollapsed((prev) => ({ ...prev, [section.id]: !prev[section.id] }))}
                    className="w-full flex items-center justify-between px-4 py-3 text-left font-semibold text-base bg-slate-50 hover:bg-slate-100 rounded-t-md"
                  >
                    <span>{section.name}</span>
                    <span className="text-slate-500 text-sm md:hidden">{isCollapsed ? '▾' : '▴'}</span>
                  </button>
                  {!isCollapsed && <div className="px-4 pb-3">{fields.map(renderFieldRow)}</div>}
                </section>
              );
            })
          ) : (
            // Legacy grouping (no template sections)
            Object.entries(grouped.bySection).map(([sectionName, fields]) => (
              <section key={sectionName}>
                <h3 className="font-semibold text-base border-b pb-2 mb-2">{sectionName}</h3>
                <div>{fields.map(renderFieldRow)}</div>
              </section>
            ))
          )}
        </CardContent>
      </Card>

      {/* Confirmation + sticky submit area */}
      <div className="sticky bottom-0 z-10 -mx-4 md:mx-0 px-4 md:px-0 pb-4 md:pb-0">
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id="confirm"
                checked={confirmed}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmed(e.target.checked)}
                disabled={submitting}
                className="mt-1"
              />
              <Label htmlFor="confirm" className="text-sm leading-relaxed cursor-pointer">
                ข้าพเจ้าขอยืนยันว่าข้อมูลทั้งหมดถูกต้องและเป็นความจริง
              </Label>
            </div>

            {submitError && (
              <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
                {submitError}
              </div>
            )}
          </CardContent>
          <CardFooter className="flex flex-col-reverse md:flex-row gap-3 md:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={handleEdit}
              disabled={submitting}
              className="w-full md:w-auto"
            >
              ← กลับไปแก้ไข
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={!confirmed || submitting}
              className="w-full md:w-auto bg-green-600 hover:bg-green-700 disabled:bg-slate-300"
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  กำลังส่งใบสมัคร...
                </span>
              ) : (
                'ยืนยันส่งใบสมัคร'
              )}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

// Light normalizer for the schema response. We only need the bits the
// review page consumes; we don't care about validation rules etc.
function normalizeField(raw: any): SchemaField {
  return {
    fieldId: raw.fieldId,
    sectionId: raw.sectionId ?? null,
    type: raw.type,
    label: raw.label || '',
    overrideLabel: raw.overrideLabel,
    options: Array.isArray(raw.options) ? raw.options : null,
    overrideOptions: Array.isArray(raw.overrideOptions) ? raw.overrideOptions : null,
    isRequired: !!raw.isRequired,
    masterDataSource: raw.masterDataSource ?? null,
    fileConfig: raw.fileConfig,
    section: raw.section,
  };
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center">กำลังโหลด...</div>}>
      <ReviewContent />
    </Suspense>
  );
}
