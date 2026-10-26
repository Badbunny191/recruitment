'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useForm, Controller, SubmitHandler, useWatch } from 'react-hook-form';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FileUpload, UploadedFileMeta } from '@/components/FileUpload';
import { ApplyBackBar } from '@/components/ApplyBackBar';
import { attachmentDisplayName } from '@/lib/filename';
import { SearchableDropdown } from '@/components/SearchableDropdown';
import {
  loadApplyDraft,
  saveApplyDraft,
  type FileAttachmentDraft,
} from '@/lib/applyDraft';
import {
  getOrCreateSubmissionToken,
} from '@/lib/submissionToken';
import {
  otherKey,
  isOtherValue,
  supportsOtherOption,
  effectiveOptions,
} from '@/lib/otherOption';
import {
  countUtf16Units,
  counterLevel,
  formatCounter,
  getTextareaMaxLength,
  getTextareaMinLength,
  getTextareaRows,
  textareaMaxLengthValidator,
  textareaMinLengthValidator,
  textareaNotBlankValidator,
} from '@/lib/textareaField';

type FieldType = 'TEXT' | 'TEXTAREA' | 'DROPDOWN' | 'RADIO' | 'FILE' | 'NUMBER' | 'CHECKBOX' | 'DATE' | 'MASTER_DATA';
type ValidationType = 'NONE' | 'EMAIL' | 'PHONE' | 'NUMBER' | 'URL' | 'CITIZEN_ID' | 'REGEX';

// Phase 1 supports only 'organizations'. Keep in sync with MASTER_DATA_SOURCES in
// backend/src/schemas/validators.ts
type MasterDataSource = 'organizations';

type MasterDataValue = { id: string; name: string } | null;

interface MasterDataOption {
  id: string;
  name: string;
}

interface FileConfig {
  allowedFileTypes?: string[];
  maxFiles?: number;
  maxSizeMB?: number;
}

interface SchemaField {
  fieldId: string;
  sectionId: string | null; // Sprint 4: ref to section (null = no section)
  type: FieldType;
  label: string;
  overrideLabel: string | null;
  options: string[] | null;
  overrideOptions: string[] | null;
  // MASTER_DATA fields store { source: 'organizations' } here instead of string[]
  masterDataSource?: MasterDataSource | null;
  isRequired: boolean;
  helpText?: string;
  placeholder?: string;
  validationType?: ValidationType;
  validationMessage?: string;
  fileConfig?: FileConfig;
  section?: string; // Legacy: fieldMaster.section (for fallback)
  // ✅ Other Option Support — field รองรับตัวเลือก "อื่นๆ (โปรดระบุ)" หรือไม่
  allowOther?: boolean;
  // ✅ Rich Field Metadata (TEXT/TEXTAREA) — null = ไม่ได้กำหนด
  // rows = ความสูงเริ่มต้นของช่องกรอกบนหน้าจอ (ไม่มีผลต่อ PDF)
  rows?: number | null;
  minLength?: number | null;
  maxLength?: number | null;
}

interface TemplateSection {
  id: string;
  name: string;
  displayOrder: number;
}

interface FormValues {
  [key: string]: any;
}

/**
 * Parse ค่า options ที่มาจาก API (อาจเป็น string[] | JSON string | null)
 *
 * ประกาศเป็น module-level function เพื่อให้เรียกใช้ก่อนถึงจุดที่
 * component re-render (เช่น useMemo สำหรับ Other Option Support)
 */
function parseSchemaOptions(input: string[] | string | null | undefined): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

// Validation patterns
const VALIDATION_PATTERNS: Record<ValidationType, RegExp | null> = {
  NONE: null,
  EMAIL: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
  PHONE: /^(0[0-9]{2}-?[0-9]{3}-?[0-9]{4}|0[0-9]{9})$/,
  NUMBER: /^[0-9]+$/,
  URL: /^https?:\/\/.+/i,
  CITIZEN_ID: /^[0-9]{13}$/,
  REGEX: null, // Custom, handled separately
};

// Default validation messages
const DEFAULT_MESSAGES: Record<ValidationType, string> = {
  NONE: '',
  EMAIL: 'รูปแบบอีเมลไม่ถูกต้อง',
  PHONE: 'รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง (ตัวอย่าง: 0812345678)',
  NUMBER: 'กรุณากรอกตัวเลขเท่านั้น',
  URL: 'รูปแบบ URL ไม่ถูกต้อง',
  CITIZEN_ID: 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก',
  REGEX: 'รูปแบบไม่ถูกต้อง',
};

function FormInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const roundId = searchParams.get('id');

  // Format a Date to Thai Buddhist wall clock (Asia/Bangkok, UTC+7).
  //
  // IMPORTANT: Admin form saves the openDate/closeDate as a wall-clock value
  // entered in Thai time. The backend stores it as `unixepoch()` seconds,
  // which D1 interprets as UTC. So the stored integer is *already* the
  // "Bangkok wall clock" (shifted by -7h relative to the true UTC instant).
  //
  // To display the value the admin entered, we add the Bangkok offset
  // (+7h) back to the timestamp and then read it as if it were UTC. This
  // avoids using the client machine's local timezone and matches the
  // server-side gate math (see backend/src/routes/public.routes.ts).
  const formatThaiDateTime = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined || value === '') return '-';
    let d: Date;
    if (typeof value === 'number') {
      // epoch seconds (DB stores integer unixepoch()) OR epoch ms
      d = new Date(value < 1e12 ? value * 1000 : value);
    } else {
      d = new Date(value);
    }
    if (isNaN(d.getTime())) return String(value);

    // Shift +7h so that getUTC*() returns the Thai wall clock the admin entered.
    const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
    const dThai = new Date(d.getTime() + BANGKOK_OFFSET_MS);

    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const day = dThai.getUTCDate();
    const month = months[dThai.getUTCMonth()];
    const year = dThai.getUTCFullYear() + 543; // CE -> BE
    const hh = String(dThai.getUTCHours()).padStart(2, '0');
    const mm = String(dThai.getUTCMinutes()).padStart(2, '0');
    return `${day} ${month} ${year} ${hh}:${mm}`;
  };
  const [schema, setSchema] = useState<SchemaField[]>([]);
  const [sections, setSections] = useState<TemplateSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Round lifecycle gate (DRAFT/CLOSED => 403 from /schema and /submit).
  // When set, the page shows a friendly error card instead of the form.
  const [roundError, setRoundError] = useState<{ message: string; status: string } | null>(null);

  // Round detail fetched from /public/rounds/:id/detail (works for all statuses
  // including DRAFT/CLOSED — unlike /rounds/active which only lists ACTIVE).
  // Used by the announcement block (ACTIVE) and the Error Page (DRAFT/CLOSED).
  interface RoundInfo {
    id: string;
    title: string;
    positionLevel: string;
    status: string;
    openDate: string;  // ISO
    closeDate: string; // ISO
    announcementTitle: string | null;
    announcementDescription: string | null;
    contactInformation: string | null;
    remark: string | null;
  }
  const [roundInfo, setRoundInfo] = useState<RoundInfo | null>(null);

  // MASTER_DATA options (Phase 1: organizations)
  const [organizations, setOrganizations] = useState<MasterDataOption[]>([]);
  const [masterDataError, setMasterDataError] = useState<string | null>(null);

  const { register, handleSubmit, control, formState: { errors }, reset, getValues } = useForm<FormValues>();

  // ✅ Double-submit guard (ช่วง A): re-entry flag for the "ตรวจสอบข้อมูล"
  // flow. `isSubmitting` (React state) re-renders asynchronously, so a rapid
  // double-click / Enter before the re-render lands could invoke `onSubmit`
  // twice — re-saving the draft and pushing the same route twice. The ref
  // closes that window synchronously, independent of the disabled attribute.
  const submitInFlightRef = useRef(false);

  // ✅ Back-button guard (ปุ่ม "กลับ"): re-entry flag for the back flow.
  // Same rationale as `submitInFlightRef` — the ref closes the synchronous
  // window between the click and the disabled attribute landing. It also
  // makes "กลับ" and "ตรวจสอบข้อมูล" mutually exclusive so navigation and
  // review-prepare can never race.
  const backInFlightRef = useRef(false);
  // Set when saving the draft on "กลับ" fails. The user stays on the page
  // with their form values intact (nothing is cleared) and the error is
  // announced — data loss must never be silent.
  const [backError, setBackError] = useState<string | null>(null);

  // ✅ Other Option Support — ค่าที่เลือกของ field ที่รองรับ "อื่นๆ (โปรดระบุ)"
  // ใช้สำหรับตัดสินว่าจะแสดงช่อง Text Input `[________________]` หรือไม่
  //
  // ดูเฉพาะ field ที่รองรับ "อื่นๆ" เท่านั้น (ไม่ watch ทั้งฟอร์ม)
  // → ไม่ทำให้ฟอร์ม re-render ทุกครั้งที่พิมพ์
  const otherCapableFieldIds = useMemo(
    () =>
      schema
        .filter((f) => {
          const options = effectiveOptions(
            parseSchemaOptions(f.options),
            parseSchemaOptions(f.overrideOptions),
            f.allowOther
          );
          return f.allowOther || supportsOtherOption(options);
        })
        .map((f) => f.fieldId),
    [schema]
  );
  const watchedOtherValues = useWatch({ control, name: otherCapableFieldIds });

  // ✅ Character Counter ของ TEXTAREA — watch เฉพาะ field TEXTAREA (ไม่ watch
  // ทั้งฟอร์ม) ตามรูปแบบเดียวกับ watchedOtherValues; ค่ามาจาก RHF state เดียวกับ
  // textarea จึงถูกต้องทั้งพิมพ์, paste, และ draft rehydration (reset)
  const textareaFieldIds = useMemo(
    () => schema.filter((f) => f.type === 'TEXTAREA').map((f) => f.fieldId),
    [schema]
  );
  const watchedTextareaValues = useWatch({ control, name: textareaFieldIds });

  const isOtherSelected = (field: SchemaField): boolean => {
    const options = effectiveOptions(
      parseSchemaOptions(field.options),
      parseSchemaOptions(field.overrideOptions),
      field.allowOther
    );
    // รองรับทั้งกรณีที่มี flag allowOther และกรณีที่ผู้ดูแลพิมพ์ label เอง
    if (!field.allowOther && !supportsOtherOption(options)) return false;
    const idx = otherCapableFieldIds.indexOf(field.fieldId);
    const value = idx >= 0 ? watchedOtherValues?.[idx] : undefined;
    return isOtherValue(value);
  };

  const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787/api/v1';

  // Load master data options once (organizations)
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${getApiUrl()}/public/master-data/organizations`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((res) => setOrganizations(res.data || []))
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        console.error('Failed to load master data:', err);
        setMasterDataError('ไม่สามารถโหลดข้อมูลหน่วยงานได้ กรุณาลองใหม่อีกครั้ง');
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!roundId) {
      setLoading(false);
      return;
    }
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787/api/v1';
    fetch(`${apiUrl}/public/rounds/${roundId}/schema`)
    .then(res => {
      // ✅ Business rule gate: if the backend returns 403, it means the round is
      // DRAFT (not yet published) or CLOSED. Extract the human-readable message
      // from the response body instead of showing a generic HTTP error.
      if (res.status === 403) {
        return res.json().then((body: any) => {
          setRoundError({
            message: body?.error ?? 'ขณะนี้ยังไม่เปิดรับสมัคร',
            status: body?.status ?? 'DRAFT',
          });
          setLoading(false);
          return null; // signal: stop processing
        });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((res) => {
      // null means we already handled a 403 above; skip the rest of the pipeline.
      if (res === null) return;

      console.log('Schema loaded:', res.data);
      
      // Parse and normalize schema data
      const parseSchemaField = (field: any): SchemaField => {
        // Parse options
        let options: string[] = [];
        let masterDataSource: MasterDataSource | null = null;

        // ✅ BUG 1 FIX: Backend /public/rounds/:id/schema now sends `masterDataSource`
        // as a top-level camelCase field (resolved by the server-side normalization in
        // public.routes.ts). Trust that first; fall back to parsing `field.options` only
        // if the server didn't provide it (legacy responses).
        if (field.masterDataSource) {
          if (field.masterDataSource === 'organizations') {
            masterDataSource = 'organizations';
          } else {
            // Unknown / unsupported source — keep as null so the renderer falls into the
            // "ไม่รองรับแหล่งข้อมูล" branch instead of silently rendering wrong data.
            masterDataSource = null;
          }
        } else if (field.options) {
          if (Array.isArray(field.options)) options = field.options;
          else if (typeof field.options === 'string') {
            try {
              const parsed = JSON.parse(field.options);
              if (Array.isArray(parsed)) options = parsed;
              else if (parsed && typeof parsed === 'object' && parsed.source) {
                if (parsed.source === 'organizations') {
                  masterDataSource = 'organizations';
                }
              }
            } catch { options = []; }
          } else if (typeof field.options === 'object' && (field.options as any).source) {
            // Drizzle { mode: 'json' } may hand back a parsed object
            if ((field.options as any).source === 'organizations') {
              masterDataSource = 'organizations';
            }
          }
        }
        
        let overrideOptions: string[] = [];
        if (field.overrideOptions) {
          if (Array.isArray(field.overrideOptions)) overrideOptions = field.overrideOptions;
          else if (typeof field.overrideOptions === 'string') {
            try { overrideOptions = JSON.parse(field.overrideOptions); } catch { overrideOptions = []; }
          }
        }
        
        // Parse fileConfig
        let fileConfig: FileConfig | undefined;
        if (field.fileConfig) {
          if (typeof field.fileConfig === 'string') {
            try { fileConfig = JSON.parse(field.fileConfig); } catch { fileConfig = undefined; }
          } else {
            fileConfig = field.fileConfig;
          }
        }
        
        return {
          fieldId: field.fieldId,
          sectionId: field.sectionId ?? null, // Sprint 4
          type: field.type,
          label: field.label || '',
          overrideLabel: field.overrideLabel,
          options: options.length > 0 ? options : null,
          overrideOptions: overrideOptions.length > 0 ? overrideOptions : null,
          masterDataSource,
          isRequired: field.isRequired || false,
          helpText: field.helpText,
          placeholder: field.placeholder,
          validationType: field.validationType,
          validationMessage: field.validationMessage,
          fileConfig,
          // ✅ Other Option Support — flag จาก backend (effective: override ?? master)
          allowOther: !!field.allowOther,
          // ✅ Rich Field Metadata (TEXT/TEXTAREA) — null = ผู้ดูแลไม่ได้กำหนด
          // (ต้อง copy ผ่านทุกครั้ง ไม่งั้น counter/limit จะ fallback 5000 เสมอ)
          rows: field.rows ?? null,
          minLength: field.minLength ?? null,
          maxLength: field.maxLength ?? null,
          // Legacy fallback - keep fieldMaster.section if backend still returns it
          section: field.section,
        };
      };

      // Sprint 4: Response shape = { sections: [...], fields: [...] } OR legacy flat array
      // Hybrid Mode: support BOTH
      let fields: SchemaField[];
      let sectionList: TemplateSection[] = [];
      if (res.data && Array.isArray(res.data.fields)) {
        // New shape (Sprint 4)
        fields = res.data.fields.map(parseSchemaField);
        sectionList = res.data.sections || [];
      } else if (Array.isArray(res.data)) {
        // Legacy shape - fallback to fieldMaster.section
        fields = res.data.map(parseSchemaField);
        sectionList = [];
      } else {
        fields = [];
        sectionList = [];
      }
      setSections(sectionList);
      setSchema(fields);
      setLoading(false);
    })
    .catch(err => {
      console.error('Failed to load schema:', err);
      alert('ไม่สามารถโหลดแบบฟอร์มได้: ' + err.message);
      setLoading(false);
    });
  }, [roundId]);

  // Fetch round detail (announcement / contact / remark / dates / status) from
  // /public/rounds/:id/detail. This endpoint works for ALL statuses including
  // DRAFT and CLOSED — unlike /rounds/active which filters ACTIVE only. The
  // page uses it for both the announcement block (ACTIVE) and the Error Page
  // (DRAFT/CLOSED).
  useEffect(() => {
    if (!roundId) return;
    const controller = new AbortController();
    fetch(`${getApiUrl()}/public/rounds/${roundId}/detail`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((res) => {
        // Response shape: { success: true, data: { id, title, positionLevel, status, openDate, closeDate, announcementTitle, ... } }
        if (res && res.success && res.data) {
          setRoundInfo(res.data as RoundInfo);
        } else {
          setRoundInfo(null);
        }
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        console.warn('Failed to load round detail:', err);
        setRoundInfo(null);
      });
    return () => controller.abort();
  }, [roundId]);

  // =========================================================================
  //  PR #2 — Draft restoration
  // =========================================================================
  // When the user lands on /apply with a `?id=<roundId>` in the URL, we
  // check sessionStorage for an existing draft for that round (saved when
  // they last clicked "ตรวจสอบข้อมูล"). If present, we rehydrate the
  // form values AND the file-upload metadata so the FILE field shows the
  // previously uploaded file name. The attachmentMeta map is the
  // authoritative source of {name, contentType, url} for FILE fields —
  // `useForm` only stores the URL.
  const [attachmentMeta, setAttachmentMeta] = useState<Record<string, UploadedFileMeta[]>>({});
  // Two-stage restoration flag: we want to wait until the schema is
  // loaded before we run the FILE-field rehydration. `draftRestored` is
  // flipped to `true` after the schema-aware pass completes; the
  // "no-schema" early-return still flips it to avoid infinite re-runs.
  const [draftRestored, setDraftRestored] = useState(false);

  useEffect(() => {
    if (!roundId) return;
    if (draftRestored) return; // only run once
    // We need the schema to know which fields are FILE. If the schema
    // hasn't loaded yet, defer — the effect will re-run when it does.
    if (schema.length === 0) return;
    const draft = loadApplyDraft(roundId);
    if (!draft) {
      setDraftRestored(true);
      return;
    }
    // Rehydrate react-hook-form values.
    //
    // Pass-through: the draft format and the RHF format are the SAME for every
    // field (including MASTER_DATA = `{ id, name } | null`). We do NOT remap
    // here. The legacy string-id normalisation belongs to the Controller's
    // read-side (defensive against old drafts); the write-side is already
    // shape-correct thanks to the Controller onChange.
    const rehydrated: Record<string, unknown> = { ...draft.formData };
    // For FILE fields the stored value is the URL string/array. We feed
    // it back into the form so the FileUpload component sees "value" =
    // url, and the user can still see the file name from `attachmentMeta`.
    schema.forEach((field) => {
      if (field.type === 'FILE') {
        const att = draft.attachments.find((a) => a.fieldId === field.fieldId);
        if (att) {
          rehydrated[field.fieldId] = field.fileConfig?.maxFiles && field.fileConfig.maxFiles > 1
            ? draft.attachments.filter((a) => a.fieldId === field.fieldId).map((a) => a.fileUrl)
            : att.fileUrl;
        }
      }
    });
    reset(rehydrated as FormValues);

    // Rehydrate file metadata so the FILE rows show the file name.
    const meta: Record<string, UploadedFileMeta[]> = {};
    draft.attachments.forEach((att) => {
      if (!meta[att.fieldId]) meta[att.fieldId] = [];
      meta[att.fieldId].push({
        name: attachmentDisplayName({ fileName: att.fileName, fileUrl: att.fileUrl }) || 'ไฟล์แนบ',
        url: att.fileUrl,
        contentType: att.contentType,
        // Attachment Lifecycle — คง capability ลบไฟล์จริง + signed view URL
        // ข้าม draft save/restore (undefined = draft รูปแบบเก่า)
        ledgerId: att.ledgerId,
        deleteToken: att.deleteToken,
        viewUrl: att.viewUrl,
      });
    });
    setAttachmentMeta(meta);
    setDraftRestored(true);
  }, [roundId, schema, reset, draftRestored]);

  // Serialize the form state into the draft payload (formData + attachment
  // metadata). Extracted into a helper so `onSubmit` can wrap the entire
  // prepare step — including this serialization — in one error boundary:
  // any throw here must reset the pending state, not strand the button.
  //
  // NEW MODE: Send formData only (no root fields)
  // Core fields are already included in formData from schema
  const buildDraftPayload = (
    data: FormValues
  ): { formData: Record<string, any>; attachments: FileAttachmentDraft[] } => {
    const formData: Record<string, any> = {};
    const attachments: FileAttachmentDraft[] = [];

    schema.forEach(field => {
      if (field.type === 'FILE') {
        const value = data[field.fieldId];
        const meta = attachmentMeta[field.fieldId] || [];
        if (field.fileConfig?.maxFiles && field.fileConfig.maxFiles > 1) {
          // Multi-file: meta is the source of truth.
          meta.forEach((m) => {
            attachments.push({
              fieldId: field.fieldId,
              fileUrl: m.url,
              fileName: m.name,
              contentType: m.contentType,
              // Attachment Lifecycle — คง capability ไว้ใช้ต่อหลังกลับมาแก้
              ledgerId: m.ledgerId,
              deleteToken: m.deleteToken,
              viewUrl: m.viewUrl,
            });
          });
        } else if (value) {
          // Single-file: prefer meta (has name + type); fall back to bare URL.
          const m = meta[0];
          attachments.push({
            fieldId: field.fieldId,
            fileUrl: value,
            fileName: m?.name,
            contentType: m?.contentType,
            ledgerId: m?.ledgerId,
            deleteToken: m?.deleteToken,
            viewUrl: m?.viewUrl,
          });
        }
      } else if (field.type === 'CHECKBOX') {
        // ✅ Other Option Support — CHECKBOX แบบกลุ่มเก็บเป็น string[]
        // (ฟิลด์เดิมไม่มี allowOther → ยังเป็น boolean แบบเดิม)
        const isCheckboxGroup =
          !!field.allowOther &&
          effectiveOptions(
            parseSchemaOptions(field.options),
            parseSchemaOptions(field.overrideOptions),
            field.allowOther
          ).length > 0;
        if (isCheckboxGroup) {
          const raw = data[field.fieldId];
          const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
          formData[field.fieldId] = list;
        } else {
          formData[field.fieldId] = data[field.fieldId] === true;
        }
      } else if (field.type === 'MASTER_DATA') {
        // =================================================================
        //  PR #fix-masterdata-dual-rep: SINGLE REPRESENTATION (pass-through)
        // =================================================================
        // RHF state is already `{ id, name } | null` thanks to the Controller
        // above. We pass it straight through to the draft — no remap, no
        // lookup, no `organizations.find()` that could silently fail.
        //
        // Why no lookup here?
        //   - The Controller's onChange already validated the id by resolving
        //     it against the live `organizations` list before writing to RHF.
        //   - If a user picked something, it was a real org; if they cleared,
        //     RHF holds `null`. Both are valid draft values.
        //   - We DO still defensively normalise legacy string-ids and refs
        //     to orgs that may have been deleted since the draft was saved.
        const value = data[field.fieldId] as unknown;
        if (value && typeof value === 'object' && 'id' in (value as object)) {
          const obj = value as { id?: string; name?: string };
          if (obj.id && obj.name) {
            formData[field.fieldId] = { id: obj.id, name: obj.name };
          } else if (obj.id) {
            // Legacy / partially-populated: resolve name from current orgs
            const match = organizations.find((o) => o.id === obj.id);
            formData[field.fieldId] = match
              ? { id: match.id, name: match.name }
              : { id: obj.id, name: '' };
          } else {
            formData[field.fieldId] = null;
          }
        } else if (typeof value === 'string' && value) {
          // Legacy draft that was saved as a bare string id. Upgrade to object
          // shape so the rest of the pipeline (server, review) sees a uniform
          // representation. Resolve the name from the live orgs list.
          const match = organizations.find((o) => o.id === value);
          formData[field.fieldId] = match
            ? { id: match.id, name: match.name }
            : { id: value, name: '' };
        } else {
          formData[field.fieldId] = null;
        }
      } else {
        formData[field.fieldId] = data[field.fieldId];
      }

      // ✅ Other Option Support — ข้อความเพิ่มเติมเก็บใน key พี่น้อง `${fieldId}__other`
      // (เก็บเฉพาะเมื่อมีค่าจริง → แบบฟอร์มเดิมไม่มี key นี้เลย)
      if (isOtherSelected(field)) {
        const otherValue = data[otherKey(field.fieldId)];
        if (typeof otherValue === 'string' && otherValue.trim()) {
          formData[otherKey(field.fieldId)] = otherValue.trim();
        }
      }
    });

    return { formData, attachments };
  };

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    // PR #2 — Two-step flow:
    //   1. Validate the form (handled by react-hook-form via zodResolver-equivalent rules)
    //   2. Build the payload (formData + attachments) and SAVE IT as a draft
    //   3. Redirect to /apply/review where the user confirms + submits
    //
    // The actual POST /public/applications/submit is moved to the
    // review page so we can show a confirm-checkbox + double-submit guard.

    // ✅ Double-submit guard: ignore re-entry while this flow is in flight
    // (rapid double-click or Enter before the disabled attribute lands).
    if (submitInFlightRef.current) return;

    if (!roundId) {
      alert('ไม่พบรหัสรอบสมัคร');
      return;
    }

    // Pending state ONLY after validation passed: react-hook-form invokes
    // onSubmit exclusively for a valid form, so a failed validation never
    // reaches here and the button never gets stuck loading.
    submitInFlightRef.current = true;
    setIsSubmitting(true);

    try {
      const { formData, attachments } = buildDraftPayload(data);

      // Ensure we have a submissionToken for the upcoming review page.
      // get-or-create: the SAME token is reused on retries and by the
      // review-page submit (backend idempotency contract).
      const token = getOrCreateSubmissionToken();

      // Persist the draft to sessionStorage. The review page will read
      // it back to render the read-only summary. We deliberately do NOT
      // call the submit API yet — that happens after the user ticks the
      // confirmation checkbox on the review page.
      saveApplyDraft({
        roundId,
        formData,
        attachments,
        submissionToken: token,
      });

      router.push('/apply/review');

      // Success: keep the spinner visible until the route change unmounts
      // this page. Do NOT reset the pending state here — `setIsSubmitting(true)`
      // and a reset in the same synchronous block would be batched by React 18
      // and the spinner would never paint (the original no-feedback bug).
    } catch (error) {
      console.error('Save draft error:', error);
      alert('เกิดข้อผิดพลาด: ' + (error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ'));
      // Release the guard + pending state so the user can retry.
      submitInFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  // ✅ ปุ่ม "กลับ" (ApplyBackBar): save the CURRENT form values with the
  // SAME draft mechanism as "ตรวจสอบข้อมูล" BEFORE leaving the page, then
  // navigate to `/` — the round list page, which is the closest thing to
  // a "round detail" this app has (there is no dedicated /rounds/[id]
  // route; the round card on the home page IS the detail). A fixed
  // destination also makes Direct-URL entry safe: no router.back(), no
  // dependency on browser history.
  //
  // Contract:
  //   - formData / dynamic fields / attachment metadata are preserved
  //     (buildDraftPayload serialises exactly what "ตรวจสอบข้อมูล" saves).
  //   - NO submit, NO re-upload (FILE values are already R2 URLs),
  //     NO draft clearing, submissionToken untouched (get-or-create).
  //   - Never runs while the review-prepare flow (isSubmitting /
  //     submitInFlightRef) is in flight — the two navigations must not race.
  //   - On save failure: stay on the page, re-enable the button, surface
  //     the error. Form values are untouched, so nothing is lost silently.
  const handleBack = () => {
    if (backInFlightRef.current || submitInFlightRef.current) return;
    if (!roundId) {
      router.push('/');
      return;
    }
    backInFlightRef.current = true;
    setBackError(null);
    try {
      const { formData, attachments } = buildDraftPayload(getValues());
      const token = getOrCreateSubmissionToken();
      saveApplyDraft({
        roundId,
        formData,
        attachments,
        submissionToken: token,
      });
      router.push('/');
      // Success: keep the guard latched until the route change unmounts
      // this page (same pattern as the submit flow).
    } catch (error) {
      console.error('Save draft on back error:', error);
      setBackError(
        'บันทึกฉบับร่างก่อนกลับไม่สำเร็จ — ข้อมูลที่กรอกยังอยู่ครบ กรุณาลองอีกครั้ง'
      );
      backInFlightRef.current = false;
    }
  };

  // Validate field value based on validationType
  const validateField = (value: any, validationType?: ValidationType): boolean => {
    // If empty/null, let required handle it
    if (!value || (typeof value === 'string' && !value.trim())) {
      return true;
    }

    const strValue = String(value);
    const pattern = VALIDATION_PATTERNS[validationType || 'NONE'];
    
    if (!pattern) return true;
    
    return pattern.test(strValue);
  };

  // Get validation message
  const getValidationMessage = (validationType?: ValidationType, customMessage?: string): string => {
    if (customMessage) return customMessage;
    return DEFAULT_MESSAGES[validationType || 'NONE'];
  };

  // Build validation rules for react-hook-form
  const getValidationRules = (field: SchemaField) => {
    const rules: any = {};

    // ✅ Other Option Support — CHECKBOX แบบกลุ่ม (เลือกได้หลายค่า)
    const isCheckboxGroup =
      field.type === 'CHECKBOX' && !!field.allowOther &&
      effectiveOptions(
        parseSchemaOptions(field.options),
        parseSchemaOptions(field.overrideOptions),
        field.allowOther
      ).length > 0;

    if (field.isRequired) {
      if (field.type === 'CHECKBOX' && !isCheckboxGroup) {
        rules.validate = (value: boolean) => value === true || 'กรุณายอมรับเงื่อนไข';
      } else if (field.type === 'CHECKBOX' && isCheckboxGroup) {
        // กลุ่ม checkbox: ต้องเลือกอย่างน้อย 1 รายการ
        rules.required = 'กรุณาเลือกอย่างน้อย 1 รายการ';
      } else {
        rules.required = 'กรุณากรอกข้อมูล';
      }
    }
    
    // Add validation type check
    if (field.validationType && field.validationType !== 'NONE') {
      rules.validate = {
        ...(rules.validate || {}),
        validationType: (value: any) => {
          // If not required and empty, skip validation
          if (!field.isRequired && (!value || (typeof value === 'string' && !value.trim()))) {
            return true;
          }
          return validateField(value, field.validationType) || getValidationMessage(field.validationType, field.validationMessage);
        }
      };
    }

    // ✅ TEXTAREA — Rich Field Metadata (minLength / maxLength)
    // นับความยาวแบบ UTF-16 (String.length) ตรงกับ native maxlength และ backend
    if (field.type === 'TEXTAREA') {
      const min = getTextareaMinLength(field);
      const max = getTextareaMaxLength(field);
      rules.validate = {
        ...(rules.validate || {}),
        // required ที่เป็น whitespace ล้วน = ไม่มีคำตอบ (RHF required จับแค่ "")
        textareaNotBlank: textareaNotBlankValidator(!!field.isRequired),
        ...(min != null
          ? { textareaMinLength: textareaMinLengthValidator(min) }
          : {}),
        textareaMaxLength: textareaMaxLengthValidator(max),
      };
    }

    return rules;
  };

  // Get placeholder text
  const getPlaceholder = (field: SchemaField) => {
    return field.placeholder || '';
  };

  // Get file accept types
  const getFileAccept = (field: SchemaField) => {
    const fileTypes = parseSchemaOptions(field.fileConfig?.allowedFileTypes as any);
    if (!fileTypes || fileTypes.length === 0) return 'application/pdf';
    return fileTypes.map(t => {
      switch(t.toLowerCase()) {
        case 'pdf': return 'application/pdf';
        case 'jpg':
        case 'jpeg': return 'image/jpeg';
        case 'png': return 'image/png';
        case 'doc':
        case 'docx': return 'application/msword';
        default: return t;
      }
    }).join(',');
  };

  // Render a single field
  const renderField = (field: SchemaField) => {
    const label = field.overrideLabel || field.label;
    const options = effectiveOptions(
      parseSchemaOptions(field.options),
      parseSchemaOptions(field.overrideOptions),
      field.allowOther
    );
    const validationRules = getValidationRules(field);
    const placeholder = getPlaceholder(field);
    const isCheckbox = field.type === 'CHECKBOX';
    // ✅ Other Option Support — แสดงช่อง Text Input เพิ่มเติมเมื่อเลือก "อื่นๆ"
    const showOtherInput = isOtherSelected(field);
    const otherKeyName = otherKey(field.fieldId);
    // CHECKBOX แบบกลุ่ม (เลือกได้หลายค่า) — เปิดใช้เฉพาะเมื่อมี allowOther
    // (ฟิลด์เดิมที่ไม่มี flag นี้ยังเป็น boolean checkbox แบบเดิม)
    const isCheckboxGroup =
      field.type === 'CHECKBOX' && !!field.allowOther && options.length > 0;

    // ✅ TEXTAREA Character Counter — อ่านค่าจาก useWatch (RHF state เดียวกับ
    // textarea) → ถูกต้องทั้งพิมพ์, paste, และ draft rehydration
    const textareaCounter = field.type === 'TEXTAREA'
      ? (() => {
          const idx = textareaFieldIds.indexOf(field.fieldId);
          const value = idx >= 0 ? watchedTextareaValues?.[idx] : undefined;
          const len = countUtf16Units(value);
          const max = getTextareaMaxLength(field);
          return { len, max, level: counterLevel(len, max) };
        })()
      : null;

    const otherInput = showOtherInput ? (
      <div className="space-y-1 pl-6">
        <Input
          id={otherKeyName}
          {...register(otherKeyName, {
            validate: (value: string) => {
              // บังคับกรอกเฉพาะเมื่อ field เป็น Required และเลือก "อื่นๆ"
              if (!field.isRequired) return true;
              return (value || '').trim() !== '' || 'กรุณาระบุรายละเอียดเพิ่มเติม';
            },
          })}
          placeholder="กรุณาระบุรายละเอียดเพิ่มเติม"
          className={errors[otherKeyName] ? 'border-red-500' : ''}
        />
        {errors[otherKeyName] && (
          <p className="text-xs text-red-500">
            {(() => {
              const err = errors[otherKeyName];
              if (typeof err?.message === 'string') return err.message;
              return 'กรุณาระบุรายละเอียดเพิ่มเติม';
            })()}
          </p>
        )}
      </div>
    ) : null;

    return (
      <div key={field.fieldId} className="space-y-2">
        {/* ✅ Other Option Support — CHECKBOX แบบกลุ่มต้องแสดง label ของ field
            (boolean checkbox แสดง label ติดกับตัว checkbox ตามเดิม) */}
        {(!isCheckbox || isCheckboxGroup) && (
          <Label htmlFor={field.fieldId}>
            {label}
            {field.isRequired && <span className="text-red-500 ml-1">*</span>}
          </Label>
        )}

        {field.helpText && !isCheckbox && (
          <p className="text-xs text-gray-500 -mt-1">{field.helpText}</p>
        )}
        
        {field.type === 'TEXT' && (
          <Input 
            id={field.fieldId}
            {...register(field.fieldId, validationRules)}
            placeholder={placeholder}
            className={errors[field.fieldId] ? 'border-red-500' : ''}
          />
        )}
        
        {field.type === 'NUMBER' && (
          <Input 
            id={field.fieldId}
            type="number"
            {...register(field.fieldId, {
              ...validationRules,
              valueAsNumber: true,
            })}
            placeholder={placeholder}
            className={errors[field.fieldId] ? 'border-red-500' : ''}
          />
        )}
        
        {field.type === 'DATE' && (
          <Input 
            id={field.fieldId}
            type="date"
            {...register(field.fieldId, validationRules)}
            className={errors[field.fieldId] ? 'border-red-500' : ''}
          />
        )}
        
        {field.type === 'TEXTAREA' && (
          <>
            <Textarea
              id={field.fieldId}
              rows={getTextareaRows(field)}
              minLength={field.minLength ?? undefined}
              maxLength={getTextareaMaxLength(field)}
              wrap="soft"
              aria-describedby={`${field.fieldId}-counter`}
              {...register(field.fieldId, validationRules)}
              placeholder={placeholder}
              className={`resize-none overflow-y-auto overflow-x-hidden min-h-0 ${
                errors[field.fieldId] ? 'border-red-500' : ''
              }`}
            />
            {textareaCounter && (
              <div
                id={`${field.fieldId}-counter`}
                className={`text-xs text-right ${
                  textareaCounter.level === 'max'
                    ? 'text-red-500'
                    : textareaCounter.level === 'warning'
                      ? 'text-amber-600'
                      : 'text-slate-400'
                }`}
              >
                {formatCounter(textareaCounter.len, textareaCounter.max)}
              </div>
            )}
          </>
        )}
        
        {field.type === 'DROPDOWN' && (
          <>
            <select 
              id={field.fieldId}
              {...register(field.fieldId, validationRules)}
              className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ${errors[field.fieldId] ? 'border-red-500' : ''}`}
            >
              <option value="">{placeholder || '-- กรุณาเลือก --'}</option>
              {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
            {otherInput}
          </>
        )}
        
        {field.type === 'RADIO' && (
          <div className="space-y-2">
            {options.map(opt => (
              <div key={opt} className="flex items-center space-x-2">
                <input 
                  type="radio" 
                  id={`${field.fieldId}-${opt}`}
                  value={opt}
                  {...register(field.fieldId, validationRules)}
                  className="w-4 h-4"
                />
                <Label htmlFor={`${field.fieldId}-${opt}`} className="font-normal cursor-pointer">
                  {opt}
                </Label>
              </div>
            ))}
            {otherInput}
          </div>
        )}
        
        {field.type === 'MASTER_DATA' && (
          <Controller
            name={field.fieldId}
            control={control}
            rules={validationRules}
            render={({ field: rhfField }) => {
              // =================================================================
              //  PR #fix-masterdata-dual-rep: SINGLE REPRESENTATION
              // =================================================================
              // RHF state for MASTER_DATA fields is **always** `{ id, name } | null`.
              // We never store a raw string id here. This is the SINGLE source of
              // truth that flows through:
              //   1. User picks an option  → onChange writes { id, name }
              //   2. Draft save (onSubmit) → already in that shape, no remap needed
              //   3. Draft restore (reset) → pass-through, no remap needed
              //   4. Review page           → reads { id, name } directly
              //
              // `legacyValue` below is ONLY a defensive read for old drafts that
              // may have been written before this fix (or for accidental raw-id
              // inputs from external code). In normal flow `rhfField.value` is
              // either `{ id, name }` or `null`, so the dropdown receives a clean
              // string id via the `.id` lookup.
              const rawValue = rhfField.value as unknown;
              const selectedId =
                rawValue && typeof rawValue === 'object' && 'id' in (rawValue as object)
                  ? ((rawValue as { id?: string }).id ?? null)
                  : (typeof rawValue === 'string' && rawValue) || null;

              if (field.masterDataSource !== 'organizations') {
                return (
                  <p className="text-xs text-red-500">
                    ไม่รองรับแหล่งข้อมูล: {field.masterDataSource || 'ไม่ระบุ'}
                  </p>
                );
              }

              return (
                <>
                  <SearchableDropdown
                    options={organizations.map((o) => ({ id: o.id, label: o.name }))}
                    value={selectedId}
                    onChange={(id) => {
                      // ✅ Single representation: write the SAME shape into RHF
                      // that the draft persists and the review page reads.
                      // No more dual `string | { id, name }` ambiguity.
                      if (id === null) {
                        rhfField.onChange(null);
                        return;
                      }
                      const selected = organizations.find((o) => o.id === id);
                      rhfField.onChange(
                        selected ? { id: selected.id, name: selected.name } : null
                      );
                    }}
                    placeholder={placeholder || 'พิมพ์เพื่อค้นหาหน่วยงาน...'}
                    emptyText="ไม่พบหน่วยงานที่ค้นหา"
                  />
                  {masterDataError && (
                    <p className="text-xs text-red-500 mt-1">{masterDataError}</p>
                  )}
                </>
              );
            }}
          />
        )}

        {field.type === 'CHECKBOX' && isCheckboxGroup && (
          // ✅ Other Option Support — CHECKBOX แบบกลุ่ม (เลือกได้หลายค่า)
          <div className="space-y-2">
            {options.map(opt => (
              <div key={opt} className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id={`${field.fieldId}-${opt}`}
                  value={opt}
                  {...register(field.fieldId, validationRules)}
                  className="w-4 h-4"
                />
                <Label htmlFor={`${field.fieldId}-${opt}`} className="font-normal cursor-pointer">
                  {opt}
                </Label>
              </div>
            ))}
            {otherInput}
          </div>
        )}

        {field.type === 'CHECKBOX' && !isCheckboxGroup && (
          <div className="flex items-start space-x-2">
            <Checkbox
              id={field.fieldId}
              {...register(field.fieldId, validationRules)}
            />
            <Label htmlFor={field.fieldId} className="font-normal cursor-pointer">
              {field.helpText || placeholder || label}
              {field.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
          </div>
        )}
        
        {field.type === 'FILE' && (
          <Controller
            name={field.fieldId}
            control={control}
            rules={validationRules}
            render={({ field: { onChange, value } }) => (
              <FileUpload
                onUploadSuccess={onChange}
                onFilesChange={(files) => {
                  setAttachmentMeta((prev) => ({ ...prev, [field.fieldId]: files }));
                }}
                defaultFiles={attachmentMeta[field.fieldId]}
                accept={getFileAccept(field)}
                maxSizeMB={field.fileConfig?.maxSizeMB}
                maxFiles={field.fileConfig?.maxFiles || 1}
              />
            )}
          />
        )}
        
        {errors[field.fieldId] && (
          <p className="text-xs text-red-500 mt-1">
            {(() => {
              const err = errors[field.fieldId];
              if (typeof err?.message === 'string') return err.message;
              if (err?.type === 'required') return 'กรุณากรอกข้อมูล';
              return 'กรุณากรอกข้อมูลให้ถูกต้อง';
            })()}
          </p>
        )}
      </div>
    );
  };

  // Sprint 4: Hybrid Mode
  // - If sections[] exists → render sectioned layout (Sprint 4)
  // - Else → fallback to legacy fieldMaster.section (Sprint 3 behavior)
  const hasTemplateSections = sections.length > 0;

  // Group fields by sectionId (Sprint 4) or section string (legacy)
  const getFieldsBySection = () => {
    const grouped: Record<string, SchemaField[]> = {};
    const ungrouped: SchemaField[] = [];

    schema.forEach(field => {
      // Sprint 4 mode: use sectionId
      if (hasTemplateSections && field.sectionId) {
        if (!grouped[field.sectionId]) grouped[field.sectionId] = [];
        grouped[field.sectionId].push(field);
      } else if (hasTemplateSections && !field.sectionId) {
        ungrouped.push(field);
      } else if (!hasTemplateSections && field.section) {
        // Legacy fallback: use fieldMaster.section
        if (!grouped[field.section]) grouped[field.section] = [];
        grouped[field.section].push(field);
      } else {
        ungrouped.push(field);
      }
    });

    return { grouped, ungrouped };
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-blue-500 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-500">กำลังโหลดแบบฟอร์ม...</p>
        </div>
      </div>
    );
  }
  
  if (!roundId) return <div className="p-8 text-center text-red-500">ไม่พบรหัสรอบรับสมัคร</div>;

  const { grouped, ungrouped } = getFieldsBySection();
  
  // Check if there are any fields in the schema
  const hasSchemaFields = schema.length > 0;

  // ✅ UX: When the round is DRAFT/CLOSED, the page renders an Error Page
  // ONLY — no form card, no announcement block, no submit button. This
  // matches the business rule: applicants should immediately see why they
  // cannot apply, when the round opened/closed, and which position it is.
  if (roundError) {
    return (
      <div className="max-w-3xl mx-auto p-4 md:p-8">
        <Card>
          <CardHeader className="bg-amber-50 border-b border-amber-200">
            <CardTitle className="text-xl text-amber-800">
              ไม่สามารถเปิดใบสมัครได้
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            {/* Round identity (works for DRAFT/CLOSED too because /rounds/:id/detail
                returns all statuses) */}
            {roundInfo && (
              <div className="space-y-2">
                {roundInfo.announcementTitle && (
                  <h2 className="text-base md:text-lg font-semibold text-slate-900">
                    {roundInfo.announcementTitle}
                  </h2>
                )}
                {roundInfo.title && (
                  <p className="text-sm text-slate-700">
                    <span className="font-medium">ชื่อรอบ:</span> {roundInfo.title}
                  </p>
                )}
                {roundInfo.positionLevel && (
                  <p className="text-sm text-slate-700">
                    <span className="font-medium">ตำแหน่ง:</span> {roundInfo.positionLevel}
                  </p>
                )}
                {roundInfo.openDate && (
                  <p className="text-sm text-slate-700">
                    <span className="font-medium">เปิดรับสมัคร:</span> {formatThaiDateTime(roundInfo.openDate)}
                  </p>
                )}
                {roundInfo.closeDate && (
                  <p className="text-sm text-slate-700">
                    <span className="font-medium">ปิดรับสมัคร:</span> {formatThaiDateTime(roundInfo.closeDate)}
                  </p>
                )}
                <p className="text-sm text-slate-700">
                  <span className="font-medium">สถานะ:</span> {roundError.status}
                </p>
              </div>
            )}

            {/* Reason message from backend */}
            <div className="rounded-md bg-amber-100 border border-amber-300 px-4 py-3 text-base text-amber-900">
              {roundError.message}
            </div>

            <p className="text-sm text-slate-500">
              หากคุณคิดว่าเป็นข้อผิดพลาด กรุณาติดต่อเจ้าหน้าที่
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-8">
      {/* ✅ ปุ่ม "กลับ" — ส่วนหัวของหน้าสมัคร เห็นชัดทั้ง Desktop และ Mobile
          (h-10 touch target, aria-label, focus ring จาก Button base styles)
          Disabled ระหว่าง "กำลังเตรียมข้อมูล..." เพื่อไม่ให้ navigation
          แข่งกับการเตรียมไปหน้า Review */}
      <ApplyBackBar onBack={handleBack} disabled={isSubmitting} error={backError} />

      {/* ✅ BUG 2 FIX: Round announcement / contact / remark block.
          Rendered ABOVE the application form (per spec). Only shows when
          roundInfo loaded and the matching field is non-empty. */}
      {roundInfo && (roundInfo.announcementTitle || roundInfo.announcementDescription || roundInfo.contactInformation || roundInfo.remark) && (
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50/60 p-4 md:p-5 space-y-3">
          {roundInfo.announcementTitle && (
            <div>
              <h2 className="text-base md:text-lg font-semibold text-slate-900">
                {roundInfo.announcementTitle}
              </h2>
            </div>
          )}
          {roundInfo.announcementDescription && (
            <div className="text-sm text-slate-700 whitespace-pre-line">
              {roundInfo.announcementDescription}
            </div>
          )}
          {roundInfo.contactInformation && (
            <div className="text-sm text-slate-700">
              <span className="font-medium">ข้อมูลติดต่อ: </span>
              <span className="whitespace-pre-line">{roundInfo.contactInformation}</span>
            </div>
          )}
          {roundInfo.remark && (
            <div className="text-sm text-slate-600">
              <span className="font-medium">หมายเหตุ: </span>
              <span className="whitespace-pre-line">{roundInfo.remark}</span>
            </div>
          )}
        </div>
      )}

      <Card>
        <CardHeader className="bg-slate-50 border-b">
          <CardTitle className="text-xl">ใบสมัครคัดเลือกบุคลากร</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
            {/* NO MORE HARDCODED PERSONAL INFO SECTION */}
            {/* All fields are rendered from Schema via Round Snapshot */}
            
            {/* Sprint 4: Hybrid Mode - sections[] + fallback to legacy fieldMaster.section */}
            {hasSchemaFields ? (
              <div className="space-y-8">
                {/* Ungrouped fields (sectionId = null, no legacy section) */}
                {ungrouped.length > 0 && (
                  <div className="space-y-6">
                    <h3 className="font-semibold text-lg border-b pb-2 flex items-center gap-2">
                      <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {hasTemplateSections ? 'ข้อมูลอื่น ๆ' : 'ข้อมูลประกอบการพิจารณา'}
                    </h3>
                    <div className="grid grid-cols-1 gap-6">
                      {ungrouped.map(renderField)}
                    </div>
                  </div>
                )}

                {/* Grouped fields by section (Sprint 4: sectionId, Legacy: section string) */}
                {hasTemplateSections ? (
                  // Sprint 4 mode: render sections[] in order
                  sections.map((section) => {
                    const sectionFields = grouped[section.id] || [];
                    if (sectionFields.length === 0) return null;
                    return (
                      <div key={section.id} className="space-y-6">
                        <h3 className="font-semibold text-lg border-b pb-2 flex items-center gap-2">
                          <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                          </svg>
                          {section.name}
                        </h3>
                        <div className="grid grid-cols-1 gap-6">
                          {sectionFields.map(renderField)}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  // Legacy fallback: render using fieldMaster.section (Sprint 3)
                  Object.entries(grouped).map(([sectionName, sectionFields]) => (
                    <div key={sectionName} className="space-y-6">
                      <h3 className="font-semibold text-lg border-b pb-2 flex items-center gap-2">
                        <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                        {sectionName}
                      </h3>
                      <div className="grid grid-cols-1 gap-6">
                        {sectionFields.map(renderField)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <p>ไม่พบฟิลด์ในแบบฟอร์ม กรุณาติดต่อผู้ดูแลระบบ</p>
              </div>
            )}

            {/* Consent fields removed - Dynamic Template is the source of truth.
                If the template needs a consent checkbox, add a CHECKBOX field via Template Builder. */}
            {/* Submit Button — PR #2: this is now "ตรวจสอบข้อมูล" (review)
                which saves the draft and navigates to /apply/review.
                The actual API submission happens on the review page after
                the user ticks the confirmation checkbox. */}
            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 h-12 text-lg"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  กำลังเตรียมข้อมูล...
                </span>
              ) : 'ตรวจสอบข้อมูล'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ApplicationFormPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center">กำลังโหลดแบบฟอร์ม...</div>}>
      <FormInner />
    </Suspense>
  );
}
