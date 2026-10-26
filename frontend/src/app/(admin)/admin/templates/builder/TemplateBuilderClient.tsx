'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ViewVersionModal } from '@/components/ViewVersionModal';
import { CompareVersionModal } from '@/components/CompareVersionModal';
import { TemplatePreviewModal } from '@/components/TemplatePreviewModal';
import { FieldSortableItem } from '@/components/FieldSortableItem';
import { SectionFieldList } from '@/components/SectionFieldList';
import { useRole } from '@/lib/useRole';
import { OTHER_OPTION_LABEL, withOtherOption } from '@/lib/otherOption';
import { validateFieldSettings } from '@/lib/fieldSettings';
import {
  DEFAULT_PDF_FILENAME_PATTERN,
  PDF_FILENAME_TOKENS,
  PDF_TOKEN_LABELS,
  validatePdfFilenamePattern,
  buildPdfFilenamePreview,
} from '@/lib/pdf-filename-pattern';

interface MasterField {
  id: string;
  fieldType: string;
  labelTh: string;
  defaultOptions: string[] | null;
  isActive: boolean;
  helpText?: string;
  placeholder?: string;
  validationType?: string;
  validationMessage?: string;
  fileConfig?: any;
  pdfMappingKey?: string | null;
  // Other Option Support — Master field รองรับตัวเลือก "อื่นๆ (โปรดระบุ)" หรือไม่
  allowOther?: boolean;
}

interface TemplateVersion {
  id: string;
  versionNumber: number;
  status: string;
  createdAt: number;
  /** Migration 028 — รูปแบบชื่อไฟล์ PDF (null = ใช้ค่าเริ่มต้น) */
  pdfFilenamePattern?: string | null;
}

interface VersionField {
  id: string;
  fieldId: string;
  displayOrder: number;
  isRequired: boolean;
  overrideLabelTh: string | null;
  overrideOptions: string[] | null;
  helpText: string | null;
  placeholder: string | null;
  validationMessage: string | null;
  validationRules: Record<string, any> | null;
  // Rich Field Metadata
  rows: number | null;
  minLength: number | null;
  maxLength: number | null;
  // Other Option Support — effective value (override ?? master)
  allowOther?: boolean | null;
}

interface BuilderField {
  fieldId: string;
  displayOrder: number;
  isRequired: boolean;
  overrideLabelTh: string;
  overrideOptionsText: string;
  helpText: string;
  placeholder: string;
  validationMessage: string;
  validationRulesText: string;
  // Rich Field Metadata
  rows: string;
  minLength: string;
  maxLength: string;
  // Other Option Support (per-template override)
  allowOther: boolean;
  // metadata for UI
  fieldType?: string;
  label?: string;
  defaultOptions?: string[] | null;
  helpTextMaster?: string;
  placeholderMaster?: string;
  validationMessageMaster?: string;
  validationTypeOriginal?: string;
  // Sprint 4
  sectionId: string | null;
}

interface BuilderSection {
  id: string; // server uuid (for saved sections) OR tempId for new sections not yet saved
  name: string;
  displayOrder: number;
  isActive: boolean;
}

interface FormValues {
  fields: BuilderField[];
  sections: BuilderSection[];
}

// Helper to parse options from various formats
const parseOptions = (input: any): string[] => {
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
};

// Status badge helper
const StatusBadge = ({ status }: { status: string }) => {
  switch (status) {
    case 'PUBLISHED':
      return <Badge variant="default" className="bg-green-600">Published</Badge>;
    case 'DRAFT':
      return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 border-yellow-300">Draft</Badge>;
    case 'ARCHIVED':
      return <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-300">Archived</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};

/**
 * OverrideStatusBadge
 * -------------------
 * แสดงสถานะ "ใช้ค่าเริ่มต้น" vs "กำหนดค่าเอง" สำหรับ Help Text / Placeholder / Validation Message
 *
 * Logic:
 *   - ถ้า currentValue เท่ากับ masterValue (ทั้งคู่ว่าง หรือเหมือนกัน) → ✅ ใช้ค่าเริ่มต้น (เขียว)
 *   - ถ้า currentValue ต่างจาก masterValue → 🟠 กำหนดค่าเอง (ส้ม)
 *
 * Tooltip (HTML title):
 *   - "ใช้ค่าเริ่มต้น" → "ใช้ค่าที่กำหนดไว้จากคลังคำถาม"
 *   - "กำหนดค่าเอง" → "ฟิลด์นี้มีการกำหนดค่าเฉพาะสำหรับแบบฟอร์มนี้"
 */
const OverrideStatusBadge = ({
  currentValue,
  masterValue,
}: {
  currentValue: string;
  masterValue: string;
}) => {
  const isUsingDefault = (currentValue || '') === (masterValue || '');
  if (isUsingDefault) {
    return (
      <p
        className="text-[10px] text-green-700 mt-0.5"
        title="ใช้ค่าที่กำหนดไว้จากคลังคำถาม"
      >
        ✅ ใช้ค่าเริ่มต้น
      </p>
    );
  }
  return (
    <p
      className="text-[10px] text-orange-600 mt-0.5"
      title="ฟิลด์นี้มีการกำหนดค่าเฉพาะสำหรับแบบฟอร์มนี้"
    >
      🟠 กำหนดค่าเอง
    </p>
  );
};

function BuilderInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const templateId = searchParams.get('id') || '';
  const { canWrite } = useRole();

  const [masterFields, setMasterFields] = useState<MasterField[]>([]);

  const [template, setTemplate] = useState<{ id: string; name: string; description: string | null } | null>(null);
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [draftVersionId, setDraftVersionId] = useState<string | null>(null);
  const [publishedVersionId, setPublishedVersionId] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  // กันปิดแท็บ/รีเฟรชทั้งที่มี edit ค้าง (แบบเดียวกับ ComposerClient)
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  // Phase 1: Collapse state for field cards (default = all collapsed)
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());
  // Phase 2: Collapse state for Version History (default = collapsed)
  const [versionHistoryExpanded, setVersionHistoryExpanded] = useState(false);

  // View Version Modal
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [viewVersionId, setViewVersionId] = useState('');
  const [viewVersionNumber, setViewVersionNumber] = useState(0);
  const [viewVersionStatus, setViewVersionStatus] = useState('');

  // Compare Version Modal
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [compareFromVersionId, setCompareFromVersionId] = useState('');
  const [compareToVersionId, setCompareToVersionId] = useState('');
  const [compareFromVersionNumber, setCompareFromVersionNumber] = useState(0);
  const [compareToVersionNumber, setCompareToVersionNumber] = useState(0);

  // Template Preview Modal
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  const openViewModal = (v: TemplateVersion) => {
    setViewVersionId(v.id);
    setViewVersionNumber(v.versionNumber);
    setViewVersionStatus(v.status);
    setViewModalOpen(true);
  };

  const openCompareModal = (from: TemplateVersion, to: TemplateVersion) => {
    setCompareFromVersionId(from.id);
    setCompareToVersionId(to.id);
    setCompareFromVersionNumber(from.versionNumber);
    setCompareToVersionNumber(to.versionNumber);
    setCompareModalOpen(true);
  };

  const { control, register, handleSubmit, watch, reset, setValue } = useForm<FormValues>({
    defaultValues: { fields: [], sections: [] },
  });
  const { fields, append, remove, replace, move } = useFieldArray({ control, name: 'fields' });
  const { append: appendSection, remove: removeSection, replace: replaceSections } = useFieldArray({ control, name: 'sections' });

  // ✅ Rich Field Metadata — inline validation error ต่อ field (key = fieldId)
  // แสดงใน Advanced Settings; เคลียร์เมื่อบันทึกสำเร็จ
  const [fieldSettingsErrors, setFieldSettingsErrors] = useState<Record<string, string>>({});

  // ── Configurable PDF Filename (Migration 028) ──
  // แก้ได้เฉพาะ Draft; Published/Archived แสดงแบบอ่านอย่างเดียว
  // บันทึกพร้อม Save Draft (PUT/POST ส่ง pdfFilenamePattern)
  const [pdfFilenamePattern, setPdfFilenamePattern] = useState<string>(DEFAULT_PDF_FILENAME_PATTERN);

  const watchedFields = watch('fields');
  const watchedSections = watch('sections');

  const loadAll = async () => {
    if (!templateId) return;
    try {
      const [fieldsRes, versionsRes, templatesRes] = await Promise.all([
        fetch(process.env.NEXT_PUBLIC_API_URL + '/admin/fields', {
          headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
        }).then((r) => r.json()),
        fetch(process.env.NEXT_PUBLIC_API_URL + `/admin/templates/${templateId}/versions`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
        }).then((r) => r.json()),
        fetch(process.env.NEXT_PUBLIC_API_URL + '/admin/templates', {
          headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
        }).then((r) => r.json()),
      ]);
      
      setMasterFields((fieldsRes.data || []).filter((f: MasterField) => f.isActive));
      const t = (templatesRes.data || []).find((x: any) => x.id === templateId);
      setTemplate(t || null);
      
      const allVersions: TemplateVersion[] = versionsRes.data || [];
      setVersions(allVersions);
      
      // Find the latest Draft version (editable)
      const draftVersions = allVersions
        .filter(v => v.status === 'DRAFT')
        .sort((a, b) => b.versionNumber - a.versionNumber);
      
      // Find the latest Published version
      const publishedVersions = allVersions
        .filter(v => v.status === 'PUBLISHED')
        .sort((a, b) => b.versionNumber - a.versionNumber);
      
      const latestPublished = publishedVersions[0] || null;
      const latestDraft = draftVersions[0] || null;
      
      // Set published version ID
      if (latestPublished) {
        setPublishedVersionId(latestPublished.id);
      }
      
      // Priority: Draft > Published
      const targetVersion = latestDraft || latestPublished;
      
      if (targetVersion) {
        setCurrentVersionId(targetVersion.id);
        if (targetVersion.status === 'DRAFT') {
          setDraftVersionId(targetVersion.id);
        } else {
          setDraftVersionId(null); // Clear draft ID when showing published
        }

        // ── Configurable PDF Filename (Migration 028) ──
        // โหลด pattern ของ version ปัจจุบัน (null → แสดงค่าเริ่มต้นใน input)
        setPdfFilenamePattern(targetVersion.pdfFilenamePattern ?? DEFAULT_PDF_FILENAME_PATTERN);

        // Load fields for this version
        const fieldsDataRes = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/admin/template-fields/${targetVersion.id}`,
          { headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` } }
        ).then(r => r.json()).catch(() => ({ data: [] }));

        // Sprint 4: Load sections for this version
        const sectionsDataRes = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/admin/template-sections/${targetVersion.id}`,
          { headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` } }
        ).then(r => r.json()).catch(() => ({ data: [] }));

        const existingFields: VersionField[] = fieldsDataRes.data || [];
        const existingSections: any[] = sectionsDataRes.data || [];

        const formFields: BuilderField[] = existingFields.map((vf: VersionField) => {
          const mf = fieldsRes.data?.find((m: MasterField) => m.id === vf.fieldId);
          const opts = parseOptions(vf.overrideOptions);
          return {
            fieldId: vf.fieldId,
            displayOrder: vf.displayOrder,
            isRequired: vf.isRequired,
            overrideLabelTh: vf.overrideLabelTh || '',
            // ✅ Other Option Support — ซ่อน label "อื่นๆ (โปรดระบุ)" ที่ระบบ
            // เติมให้ออกจาก textarea (checkbox toggle เป็นตัวควบคุมเดียว)
            overrideOptionsText: opts.filter((o) => o !== OTHER_OPTION_LABEL).join('\n'),
            // Effective value = override ?? master (เพื่อให้ HR เห็นค่าที่ใช้จริง)
            helpText: vf.helpText ?? mf?.helpText ?? '',
            placeholder: vf.placeholder ?? mf?.placeholder ?? '',
            validationMessage: vf.validationMessage ?? mf?.validationMessage ?? '',
            validationRulesText: vf.validationRules ? JSON.stringify(vf.validationRules) : '',
            rows: vf.rows?.toString() || '',
            minLength: vf.minLength?.toString() || '',
            maxLength: vf.maxLength?.toString() || '',
            // ✅ Other Option Support — effective value (override ?? master)
            allowOther: !!vf.allowOther || !!mf?.allowOther,
            fieldType: mf?.fieldType,
            label: vf.overrideLabelTh || mf?.labelTh || '',
            defaultOptions: parseOptions(mf?.defaultOptions),
            // Master values (เก็บไว้เปรียบเทียบ)
            helpTextMaster: mf?.helpText,
            placeholderMaster: mf?.placeholder,
            validationMessageMaster: mf?.validationMessage,
            validationTypeOriginal: mf?.validationType,
            // Sprint 4
            sectionId: (vf as any).sectionId ?? null,
          };
        });

        const formSections: BuilderSection[] = existingSections.map((s: any) => ({
          id: s.id,
          name: s.name,
          displayOrder: s.displayOrder,
          isActive: s.isActive,
        }));

        replace(formFields);
        replaceSections(formSections);
        
        // Clear unsaved changes indicator after loading
        setHasUnsavedChanges(false);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [templateId]);

  const addField = (mf: MasterField, targetSectionId: string | null = null) => {
    // Allow adding fields even without a version (will be created with Save Draft)
    const opts = parseOptions(mf.defaultOptions);
    const currentFields = watch('fields');
    let currentSections = watch('sections');
    
    // Auto-create first section if none exists
    if (currentSections.length === 0) {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      appendSection({
        id: tempId,
        name: 'ข้อมูลทั่วไป',
        displayOrder: 1,
        isActive: true,
      });
      currentSections = [{ id: tempId, name: 'ข้อมูลทั่วไป', displayOrder: 1, isActive: true }];
    }
    
    // Default to first section
    const sectionId = targetSectionId ?? currentSections[0].id;
    append({
      fieldId: mf.id,
      displayOrder: currentFields.length + 1,
      isRequired: true,
      overrideLabelTh: '',
      overrideOptionsText: opts.join('\n'),
      helpText: mf.helpText || '',
      placeholder: mf.placeholder || '',
      validationMessage: mf.validationMessage || '',
      validationRulesText: '',
      rows: '',
      minLength: '',
      maxLength: '',
      // ✅ Other Option Support — inherit จาก Master field
      allowOther: !!mf.allowOther,
      fieldType: mf.fieldType,
      label: mf.labelTh,
      defaultOptions: opts,
      helpTextMaster: mf.helpText,
      placeholderMaster: mf.placeholder,
      validationMessageMaster: mf.validationMessage,
      validationTypeOriginal: mf.validationType,
      sectionId,
    });
    setHasUnsavedChanges(true);
  };

  const addSection = () => {
    // Allow adding sections even without a version (will be created with Save Draft)
    const currentSections = watch('sections');
    const name = window.prompt('ชื่อ Section ใหม่:', `ข้อมูลใหม่ ${currentSections.length + 1}`);
    if (!name || !name.trim()) return;
    // Use tempId (uuid-like) for new section - backend will replace with real uuid on save
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    appendSection({
      id: tempId,
      name: name.trim(),
      displayOrder: currentSections.length + 1,
      isActive: true,
    });
    setHasUnsavedChanges(true);
  };

  const removeSectionAction = async (index: number) => {
    const section = watchedSections[index];
    if (!confirm(`ต้องการลบ Section "${section.name}"?\n\nField ทั้งหมดใน Section นี้จะกลายเป็น "ไม่มี Section"`)) return;
    // Reassign fields in this section to null
    const updated = watchedFields.map(f =>
      f.sectionId === section.id ? { ...f, sectionId: null } : f
    );
    replace(updated);
    removeSection(index);
    setHasUnsavedChanges(true);
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= watchedSections.length) return;
    // Use react-hook-form move for sections array
    moveSectionArray(index, newIndex);
  };

  const moveSectionArray = (from: number, to: number) => {
    // Local reorder using useFieldArray's swap
    // useFieldArray v7+ supports `swap`
    const arr = [...watchedSections];
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
    const renumbered = arr.map((s, i) => ({ ...s, displayOrder: i + 1 }));
    replaceSections(renumbered);
    setHasUnsavedChanges(true);
  };

  // Phase 2: Move field within its Section only (per-Section displayOrder)
  // - sectionIdx: index of section in watchedSections array
  // - fieldIdxInSection: index of field WITHIN that section (0-based)
  const moveField = (sectionIdx: number, fieldIdxInSection: number, direction: -1 | 1) => {
    const section = watchedSections[sectionIdx];
    if (!section) return;

    // Build section-local list (preserving current global order)
    const allFields = watch('fields');
    const sectionFieldIds = allFields
      .filter((f) => f.sectionId === section.id)
      .map((f) => f.fieldId);

    const newIdx = fieldIdxInSection + direction;
    if (newIdx < 0 || newIdx >= sectionFieldIds.length) return;

    // Swap fieldIds within section
    const reordered = [...sectionFieldIds];
    [reordered[fieldIdxInSection], reordered[newIdx]] = [reordered[newIdx], reordered[fieldIdxInSection]];

    // Rebuild global array: keep sections in order, replace section's fields with reordered set
    const byId = new Map(allFields.map((f) => [f.fieldId, f]));
    const newFields: typeof allFields = [];
    const used = new Set<string>();

    // Iterate sections in order; for each section, append its fields in section-local order
    watchedSections.forEach((sec) => {
      const secFields = sec.id === section.id
        ? reordered.map((fid) => byId.get(fid)!).filter(Boolean)
        : allFields.filter((f) => f.sectionId === sec.id);
      secFields.forEach((f) => {
        newFields.push(f);
        used.add(f.fieldId);
      });
    });

    // Append any orphaned fields (no section) at the end
    allFields.forEach((f) => {
      if (!used.has(f.fieldId) && !f.sectionId) {
        newFields.push(f);
      }
    });

    // Renumber displayOrder globally (sequential 1..N)
    const renumbered = newFields.map((f, i) => ({ ...f, displayOrder: i + 1 }));
    replace(renumbered);
    setHasUnsavedChanges(true);
  };

  // Phase 3: Handle drag & drop reorder within a Section
  // - sectionIdx: index of section in watchedSections array
  // - newSectionOrderIds: section-local fieldIds in new order
  // - Same rebuild logic as moveField, but takes a full section-local order array
  const handleDragReorder = (sectionIdx: number, newSectionOrderIds: string[]) => {
    const section = watchedSections[sectionIdx];
    if (!section) return;

    const allFields = watch('fields');
    const reordered = newSectionOrderIds;

    // Rebuild global array: keep sections in order, replace section's fields with reordered set
    const byId = new Map(allFields.map((f) => [f.fieldId, f]));
    const newFields: typeof allFields = [];
    const used = new Set<string>();

    watchedSections.forEach((sec) => {
      const secFields = sec.id === section.id
        ? reordered.map((fid) => byId.get(fid)!).filter(Boolean)
        : allFields.filter((f) => f.sectionId === sec.id);
      secFields.forEach((f) => {
        newFields.push(f);
        used.add(f.fieldId);
      });
    });

    // Append any orphaned fields (no section) at the end
    allFields.forEach((f) => {
      if (!used.has(f.fieldId) && !f.sectionId) {
        newFields.push(f);
      }
    });

    // Renumber displayOrder globally (sequential 1..N)
    const renumbered = newFields.map((f, i) => ({ ...f, displayOrder: i + 1 }));
    replace(renumbered);
    setHasUnsavedChanges(true);
  };

  // Phase 2: Normalize displayOrder for ALL fields (utility — used after add/remove)
  const normalizeDisplayOrder = () => {
    const allFields = watch('fields');
    const renumbered = allFields.map((f, i) => ({ ...f, displayOrder: i + 1 }));
    if (renumbered.some((f, i) => f.displayOrder !== allFields[i].displayOrder)) {
      replace(renumbered);
      setHasUnsavedChanges(true);
    }
  };

  // Phase 1: Toggle field card collapse
  const toggleFieldExpanded = (fieldId: string) => {
    setExpandedFields(prev => {
      const next = new Set(prev);
      if (next.has(fieldId)) {
        next.delete(fieldId);
      } else {
        next.add(fieldId);
      }
      return next;
    });
  };

  // Save as Draft - RFC Phase 2
  // IF draftVersionId exists → PUT update
  // ELSE → POST create new
  const onSaveDraft = async (data: FormValues) => {
    if (data.fields.length === 0) {
      alert('กรุณาเพิ่มฟิลด์อย่างน้อย 1 ฟิลด์');
      return;
    }
    if (data.sections.length === 0) {
      alert('กรุณาเพิ่ม Section อย่างน้อย 1 Section');
      return;
    }

    // Validate templateId before making request
    if (!templateId || templateId.trim() === '') {
      alert('ไม่พบ Template ID');
      return;
    }

    // ✅ Rich Field Metadata — inline validation ก่อนส่ง (rows/minLength/maxLength)
    // Backend (zod) ปฏิเสธอยู่แล้ว แต่ต้องให้ผู้ดูแลเห็น error ตรง field
    const settingsErrors: Record<string, string> = {};
    for (const f of data.fields) {
      const err = validateFieldSettings(f);
      if (err) settingsErrors[f.fieldId] = err;
    }
    if (Object.keys(settingsErrors).length > 0) {
      setFieldSettingsErrors(settingsErrors);
      alert('พบค่าที่ไม่ถูกต้องใน Advanced Settings กรุณาแก้ไขตามข้อความสีแดงในแต่ละฟิลด์');
      return;
    }
    setFieldSettingsErrors({});

    // ── Configurable PDF Filename (Migration 028) ──
    // Inline validation ก่อนส่ง (backend validate อีกชั้นด้วยข้อความไทยชุดเดียวกัน)
    // ว่าง = ใช้ค่าเริ่มต้น (ส่ง null)
    const patternTrimmed = pdfFilenamePattern.trim();
    if (patternTrimmed !== '') {
      const patternErr = validatePdfFilenamePattern(pdfFilenamePattern);
      if (!patternErr.ok) {
        alert(`รูปแบบชื่อไฟล์ PDF ไม่ถูกต้อง: ${patternErr.message}`);
        return;
      }
    }

      setSubmitting(true);
      try {
        // ส่ง fieldId ตรง ๆ ไม่ต้องแปลง (FK migration เสร็จแล้ว — template_fields.field_id รับ UUID ได้แล้ว)
        const payload = {
          pdfFilenamePattern: patternTrimmed === '' ? null : pdfFilenamePattern,
          sections: data.sections.map((s) => ({
            tempId: s.id, // tempId for client-side mapping
            name: s.name,
            displayOrder: s.displayOrder,
          })),
          fields: data.fields.map((f) => {
          const isOtherCapable =
            f.fieldType === 'RADIO' ||
            f.fieldType === 'DROPDOWN' ||
            f.fieldType === 'CHECKBOX';

          // ✅ Other Option Support — ถ้า override options ถูกกำหนดเอง
          // ต้องเติม "อื่นๆ (โปรดระบุ)" กลับเข้าไป (ไม่งั้นจะหาย)
          const rawOverride = f.overrideOptionsText
            ? f.overrideOptionsText.split('\n').map((s) => s.trim()).filter(Boolean)
            : null;
          const overrideOptions =
            isOtherCapable && f.allowOther && rawOverride
              ? withOtherOption(rawOverride, true)
              : rawOverride;

          const fieldData: any = {
            fieldId: f.fieldId,
            displayOrder: f.displayOrder,
            isRequired: f.isRequired,
            overrideLabelTh: f.overrideLabelTh || null,
            overrideOptions,
            sectionId: f.sectionId || null,
            // ✅ Other Option Support — override ราย template
            // (null = ใช้ค่าจาก Master) — เก็บเฉพาะเมื่อ field type รองรับ
            allowOther: isOtherCapable ? !!f.allowOther : null,
          };
          // เก็บเฉพาะ "สิ่งที่แตกต่างจาก Master"
          // - ถ้าค่าที่ HR กรอก "เท่ากับค่า Master" → บันทึกเป็น null (ใช้ค่าเริ่มต้น)
          // - ถ้าค่าที่ HR กรอก "ต่างจากค่า Master" → บันทึกเป็น override
          // - ถ้าค่าว่าง → บันทึกเป็น null (ใช้ค่าเริ่มต้น)
          fieldData.helpText =
            f.helpText && f.helpText !== (f.helpTextMaster || '')
              ? f.helpText
              : null;
          fieldData.placeholder =
            f.placeholder && f.placeholder !== (f.placeholderMaster || '')
              ? f.placeholder
              : null;
          fieldData.validationMessage =
            f.validationMessage && f.validationMessage !== (f.validationMessageMaster || '')
              ? f.validationMessage
              : null;
          if (f.validationRulesText) {
            try {
              fieldData.validationRules = JSON.parse(f.validationRulesText);
            } catch {
              // Ignore invalid JSON
            }
          }
          if (f.rows && !isNaN(parseInt(f.rows))) {
            fieldData.rows = parseInt(f.rows);
          }
          if (f.minLength && !isNaN(parseInt(f.minLength))) {
            fieldData.minLength = parseInt(f.minLength);
          }
          if (f.maxLength && !isNaN(parseInt(f.maxLength))) {
            fieldData.maxLength = parseInt(f.maxLength);
          }
          return fieldData;
        }),
      };

      let res: Response;
      
      if (draftVersionId) {
        // ✅ Mode: UPDATE existing Draft (RFC Phase 2)
        const apiUrl = `${process.env.NEXT_PUBLIC_API_URL}/admin/template-versions/${draftVersionId}`;
        console.log('Update Draft URL:', apiUrl);
        
        res = await fetch(apiUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
          },
          body: JSON.stringify(payload),
        });
      } else {
        // ✅ Mode: CREATE new Draft
        const apiUrl = `${process.env.NEXT_PUBLIC_API_URL}/admin/templates/${encodeURIComponent(templateId)}/versions`;
        console.log('Create Draft URL:', apiUrl);
        
        res = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
          },
          body: JSON.stringify({
            templateId,
            ...payload,
          }),
        });
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Save Draft failed:', {
          status: res.status,
          statusText: res.statusText,
          error: err,
          payload: payload,
        });
        // Serialize error message (อาจเป็น object จาก Hono)
        const errMsg = typeof err.error === 'string'
          ? err.error
          : (err.details && typeof err.details === 'string')
            ? err.details
            : (err.error?.message || err.details?.message || `save failed (${res.status})`);
        throw new Error(errMsg);
      }

      const result = await res.json();
      
      // Update draftVersionId if this was a create
      if (!draftVersionId && result.versionId) {
        setDraftVersionId(result.versionId);
        setCurrentVersionId(result.versionId);
      }
      
      setHasUnsavedChanges(false);
      alert('บันทึก Draft สำเร็จ! กด "Publish" เพื่อเผยแพร่');
      await loadAll();
    } catch (err) {
      console.error('Save Draft error:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      alert('เกิดข้อผิดพลาด: ' + errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  // Clone version (Mode B): use existing version as source
  const onCloneVersion = async (sourceVersionId: string, sourceVersionNumber: number) => {
    if (!confirm(`ต้องการ Clone v${sourceVersionNumber} เป็น Draft ใหม่?\n\nSections + Fields ทั้งหมดจะถูก copy ไปยัง DRAFT ใหม่`)) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/templates/${templateId}/versions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
        },
        body: JSON.stringify({
          templateId,
          cloneFromVersionId: sourceVersionId,
          // ไม่ต้องส่ง sections/fields - backend จะ clone ให้อัตโนมัติ
          // แต่ validator ต้องการ fields min 1 → ส่ง dummy field 1 ตัว (จะถูกแทนที่)
          // ... workaround: backend Mode B ไม่ใช้ fields array
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'clone failed');
      }

      alert(`Clone v${sourceVersionNumber} สำเร็จ!`);
      await loadAll();
    } catch (err) {
      alert('Clone ล้มเหลว: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // Publish Draft → Published
  const onPublish = async () => {
    if (!draftVersionId) {
      alert('ไม่มี Draft version ที่จะ Publish');
      return;
    }

    // Publish แล้ว version ถูกล็อก — edit ที่ยังไม่ save จะหายถาวรและไม่มี
    // ทางบันทึกตามหลัง จึงต้องบังคับ save ก่อนเสมอ
    if (hasUnsavedChanges) {
      alert('มีการเปลี่ยนแปลงที่ยังไม่บันทึก\n\nกรุณากด "Save Draft" ก่อน Publish มิฉะนั้นการแก้ไขจะหายทั้งหมด');
      return;
    }

    if (!confirm('ต้องการ Publish Draft version นี้?\n\nVersion ที่ Publish แล้วจะถูกล็อก ไม่สามารถแก้ไขได้')) {
      return;
    }
    
    setSubmitting(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/template-versions/${draftVersionId}/publish`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
        },
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'publish failed');
      }
      
      alert('Publish สำเร็จ! สามารถใช้สร้าง Round ได้แล้ว');
      await loadAll();
    } catch (err) {
      alert('เกิดข้อผิดพลาด: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // Archive Published → Archived
  const onArchive = async (versionId: string, versionNumber: number) => {
    if (!confirm(`ต้องการ Archive v${versionNumber}?\n\nVersion ที่ Archived จะเก็บไว้อ้างอิงเท่านั้น ไม่สามารถใช้สร้าง Round ใหม่ได้`)) {
      return;
    }
    
    setSubmitting(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/template-versions/${versionId}/archive`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
        },
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'archive failed');
      }
      
      alert(`Archive v${versionNumber} สำเร็จ!`);
      await loadAll();
    } catch (err) {
      alert('เกิดข้อผิดพลาด: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // Delete Draft version
  const onDeleteVersion = async (versionId: string, versionNumber: number) => {
    if (!confirm(`ต้องการลบ v${versionNumber}?\n\nเฉพาะ Draft version เท่านั้นที่ลบได้`)) {
      return;
    }
    
    setSubmitting(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/template-versions/${versionId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
        },
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'delete failed');
      }
      
      alert(`ลบ v${versionNumber} สำเร็จ!`);
      await loadAll();
    } catch (err) {
      alert('เกิดข้อผิดพลาด: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredMasterFields = masterFields.filter((f) =>
    f.labelTh.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const usedFieldIds = new Set(watchedFields.map((f) => f.fieldId));

  if (loading) {
    return <div className="p-8 text-center text-slate-500">กำลังโหลด...</div>;
  }

  if (!templateId || !template) {
    return (
      <div className="p-8 text-center space-y-4">
        <p className="text-red-500">ไม่พบ Template</p>
        <Button onClick={() => router.push('/admin/templates')}>กลับไปหน้า Templates</Button>
      </div>
    );
  }

  const currentVersion = versions.find(v => v.id === currentVersionId);
  const latestPublished = versions
    .filter(v => v.status === 'PUBLISHED')
    .sort((a, b) => b.versionNumber - a.versionNumber)[0];
  const latestDraft = versions
    .filter(v => v.status === 'DRAFT')
    .sort((a, b) => b.versionNumber - a.versionNumber)[0];
  
  // RFC Phase 2: Determine mode
  // - canWrite = false (VIEWER) → force read-only view regardless of draft/published state.
  const isEditMode = canWrite && !!draftVersionId; // Has Draft + canWrite = Editable
  const isViewMode = !isEditMode && !!currentVersion && currentVersion.status === 'PUBLISHED'; // No Draft but has Published = Read Only

  // Helper to format date - handle various input formats
  const formatDate = (ts: unknown) => {
    if (!ts) return '-';
    try {
      let date: Date;
      
      // Handle number (Unix timestamp in seconds)
      if (typeof ts === 'number') {
        date = new Date(ts * 1000);
      }
      // Handle string (ISO date string)
      else if (typeof ts === 'string') {
        // Try parsing as-is first
        date = new Date(ts);
        // If invalid, try adding 'T' separator for Thai date format (dd/MM/yyyy)
        if (isNaN(date.getTime())) {
          const parts = ts.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
          if (parts) {
            const [, day, month, year, hour = '0', minute = '0'] = parts;
            date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
          }
        }
      }
      // Handle Date object
      else if (ts instanceof Date) {
        date = ts;
      }
      else {
        return '-';
      }
      
      if (isNaN(date.getTime())) return '-';
      
      return date.toLocaleDateString('th-TH', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '-';
    }
  };

  return (
    <div className="p-8 space-y-6">
      {/* RFC Phase 2: Active Context Banner - บอกชัดเจนว่ากำลังแก้ไข version ไหน */}
      <Alert className={
        isEditMode 
          ? 'bg-blue-50 border-blue-300 border-2' 
          : isViewMode 
            ? 'bg-gray-100 border-gray-300 border-2' 
            : 'bg-orange-50 border-orange-300 border-2'
      }>
        <AlertDescription className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isEditMode ? (
              <>
                <span className="text-2xl">📝</span>
                <div>
                  <span className="font-bold text-blue-900 text-lg">กำลังแก้ไข Draft v{currentVersion?.versionNumber}</span>
                  <Badge variant="outline" className="ml-2 bg-blue-100 text-blue-800 border-blue-300">
                    แก้ไขได้
                  </Badge>
                </div>
              </>
            ) : isViewMode ? (
              <>
                <span className="text-2xl">🔒</span>
                <div>
                  <span className="font-bold text-gray-800 text-lg">กำลังดู Published v{currentVersion?.versionNumber}</span>
                  <Badge variant="outline" className="ml-2 bg-gray-200 text-gray-700 border-gray-400">
                    อ่านอย่างเดียว
                  </Badge>
                </div>
              </>
            ) : (
              <>
                <span className="text-2xl">📋</span>
                <div>
                  <span className="font-bold text-orange-800 text-lg">ยังไม่มี Version</span>
                </div>
              </>
            )}
            {hasUnsavedChanges && (
              <Badge variant="outline" className="border-orange-400 text-orange-700 bg-orange-100 font-semibold animate-pulse">
                ⚠️ มีการเปลี่ยนแปลงที่ยังไม่บันทึก
              </Badge>
            )}
          </div>
          
          {/* No Version: สร้าง Draft ใหม่ */}
          {!draftVersionId && !currentVersion && (
            <Button
              variant="default"
              size="sm"
              onClick={handleSubmit(onSaveDraft)}
              disabled={submitting}
              className="bg-blue-600 hover:bg-blue-700"
            >
              📝 สร้าง Draft v1
            </Button>
          )}
          
          {/* Edit Mode: Save Draft + Publish */}
          {isEditMode && (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSubmit(onSaveDraft)}
                disabled={submitting || fields.length === 0}
              >
                💾 {submitting ? 'กำลังบันทึก...' : 'Save Draft'}
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={onPublish}
                disabled={submitting || hasUnsavedChanges}
                className="bg-green-600 hover:bg-green-700"
              >
                🔵 Publish v{latestDraft?.versionNumber}
              </Button>
            </div>
          )}
          
          {/* View Mode: สร้าง Draft ใหม่ */}
          {isViewMode && (
            <Button
              variant="default"
              size="sm"
              onClick={() => onCloneVersion(latestPublished!.id, latestPublished!.versionNumber)}
              disabled={submitting}
              className="bg-blue-600 hover:bg-blue-700"
            >
              📝 สร้าง Draft ใหม่จาก v{latestPublished?.versionNumber}
            </Button>
          )}
        </AlertDescription>
      </Alert>

      {/* ── Configurable PDF Filename (Migration 028) ───────────────────────
          รูปแบบชื่อไฟล์ PDF ระดับ Template Version — แก้ได้เฉพาะ Draft
          Published/Archived แสดงแบบอ่านอย่างเดียว (backend เป็น Source of Truth
          ของชื่อไฟล์จริงตอนดาวน์โหลด) */}
      {currentVersion && (
        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              📄 รูปแบบชื่อไฟล์ PDF
              {isEditMode ? (
                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">แก้ไขได้</Badge>
              ) : (
                <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-300">อ่านอย่างเดียว</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="pdf-filename-pattern" className="text-sm font-medium">
                รูปแบบชื่อไฟล์ PDF
              </Label>
              <p id="pdf-filename-pattern-help" className="text-xs text-slate-500">
                กำหนดชื่อไฟล์ PDF ที่ดาวน์โหลด ระบบจะเติมนามสกุล .pdf ให้อัตโนมัติ
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  id="pdf-filename-pattern"
                  aria-describedby="pdf-filename-pattern-help pdf-filename-pattern-error"
                  value={pdfFilenamePattern}
                  onChange={(e) => setPdfFilenamePattern(e.target.value)}
                  readOnly={!isEditMode}
                  disabled={!isEditMode}
                  maxLength={300}
                  className="font-mono text-sm min-w-0 flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={!isEditMode}
                  onClick={() => setPdfFilenamePattern(DEFAULT_PDF_FILENAME_PATTERN)}
                  title="คืนค่าเริ่มต้น ใบสมัคร_{applicationNo}_{fullname}"
                >
                  ↺ คืนค่าเริ่มต้น
                </Button>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">
                  {pdfFilenamePattern.length}/{200} ตัวอักษร
                </span>
                {(() => {
                  const err = validatePdfFilenamePattern(pdfFilenamePattern);
                  return err.ok ? null : (
                    <span
                      id="pdf-filename-pattern-error"
                      role="alert"
                      className="text-red-600 font-medium text-right"
                    >
                      {err.message}
                    </span>
                  );
                })()}
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2">
              <p className="text-xs font-medium text-slate-600">ตัวแปรที่ใช้ได้ (คลิกเพื่อคัดลอก)</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {PDF_FILENAME_TOKENS.map((token) => (
                  <span key={token} className="text-xs text-slate-600">
                    <code className="font-mono bg-white border border-slate-200 rounded px-1 py-0.5">{`{${token}}`}</code>{' '}
                    = {PDF_TOKEN_LABELS[token]}
                  </span>
                ))}
              </div>
              <p className="text-xs text-slate-600">
                ตัวอย่าง Preview:{' '}
                <span className="font-medium text-slate-800 break-all">
                  {buildPdfFilenamePreview(pdfFilenamePattern)}
                </span>
              </p>
              <p className="text-xs text-slate-400">
                หมายเหตุ: ชื่อไฟล์จริงตอนดาวน์โหลดมาจากระบบ (หน้า Admin และหน้าค้นหาของผู้สมัครใช้ชื่อเดียวกัน) — การเปลี่ยนรูปแบบชื่อไฟล์ไม่กระทบเนื้อหา PDF
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between items-start">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.push('/admin/templates')}>
            ← กลับ
          </Button>
          <h1 className="text-2xl font-bold mt-2">
            Template Builder: {template.name}
          </h1>
          {template.description && (
            <p className="text-slate-500 text-sm mt-1">{template.description}</p>
          )}
        </div>
        <div className="text-right space-x-2">
          {/* Document Composer button - Available for all versions (uses templateVersionId) */}
          {currentVersion && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/admin/templates/composer?versionId=${currentVersion.id}`)}
              title="แก้ไข Document Descriptor สำหรับ PDF Generation"
              className="bg-purple-50 border-purple-300 text-purple-700 hover:bg-purple-100"
            >
              🧩 Document Composer
            </Button>
          )}

          {/* Preview Button - Available for all modes */}
          {currentVersion && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPreviewModalOpen(true)}
            >
              👁 Preview
            </Button>
          )}

          {/* RFC Phase 2: View Mode = No action buttons in header */}
          {isViewMode && (
            <span className="text-sm text-gray-500 italic">ดู Version อย่างเดียว</span>
          )}
          
          {/* RFC Phase 2: Edit Mode = No action buttons in header (all in Banner) */}
          {isEditMode && (
            <span className="text-sm text-blue-600">💾 Save Draft และ 🔵 Publish อยู่ด้านบน</span>
          )}
          
          {/* RFC Phase 2: No Version = ปุ่มอยู่ใน Banner แล้ว */}
          {!draftVersionId && !currentVersion && (
            <span className="text-sm text-orange-600">📝 สร้าง Draft อยู่ด้านบน</span>
          )}
        </div>
      </div>

      {/* Phase 4: Status Info Banner — REMOVED (ซ้ำกับ Active Context Banner) */}

      {/* Phase 2: Version History — collapsed by default */}
      {versions.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div
                className="flex items-center gap-2 cursor-pointer flex-1"
                onClick={() => setVersionHistoryExpanded(!versionHistoryExpanded)}
              >
                <span className="text-base">📜</span>
                <CardTitle className="text-base">ประวัติ Version ({versions.length})</CardTitle>
                <span className="text-slate-400 text-xs ml-1 select-none">{versionHistoryExpanded ? '▲' : '▼'}</span>
              </div>
              {!versionHistoryExpanded && (
                <div className="flex items-center gap-3 text-xs text-slate-600">
                  {latestDraft && (
                    <span>Current Draft: <span className="font-medium">v{latestDraft.versionNumber}</span></span>
                  )}
                  {latestPublished && (
                    <span>Latest Published: <span className="font-medium">v{latestPublished.versionNumber}</span></span>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          {versionHistoryExpanded && (
            <CardContent>
              <div className="space-y-3">
                {versions
                  .sort((a, b) => b.versionNumber - a.versionNumber)
                  .map((v) => {
                    const isLatestPublished = latestPublished?.id === v.id;
                    const isLatestDraft = latestDraft?.id === v.id;
                    return (
                      <div key={v.id} className="border rounded-lg p-4 bg-slate-50">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-lg">v{v.versionNumber}</span>
                              <StatusBadge status={v.status} />
                              {isLatestPublished && (
                                <Badge className="bg-purple-100 text-purple-700 border-purple-300 text-xs">
                                  Latest Published
                                </Badge>
                              )}
                              {isLatestDraft && (
                                <Badge className="bg-blue-100 text-blue-700 border-blue-300 text-xs">
                                  Current Draft
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 mt-1">
                              {v.status === 'DRAFT' && `สร้างเมื่อ ${formatDate(v.createdAt)}`}
                              {v.status === 'PUBLISHED' && `เผยแพร่เมื่อ ${formatDate(v.createdAt)}`}
                              {v.status === 'ARCHIVED' && `เก็บไว้เมื่อ ${formatDate(v.createdAt)}`}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {/* View button - all versions */}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openViewModal(v)}
                            >
                              View
                            </Button>
                            {/* Compare button - all versions */}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                // Find another version to compare with
                                const otherVersions = versions.filter(vv => vv.id !== v.id);
                                if (otherVersions.length > 0) {
                                  openCompareModal(v, otherVersions[0]);
                                } else {
                                  alert('ต้องมีอย่างน้อย 2 versions จึงจะเปรียบเทียบได้');
                                }
                              }}
                            >
                              Compare
                            </Button>
                            {/* PUBLISHED: สร้าง Draft ใหม่จาก Published */}
                            {v.status === 'PUBLISHED' && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => onCloneVersion(v.id, v.versionNumber)}
                                disabled={submitting}
                              >
                                📝 สร้าง Draft ใหม่
                              </Button>
                            )}
                            {/* DRAFT: Delete เท่านั้น (Publish ทำจาก Edit Mode Banner) */}
                            {v.status === 'DRAFT' && (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => onDeleteVersion(v.id, v.versionNumber)}
                                disabled={submitting}
                              >
                                Delete
                              </Button>
                            )}
                            {/* ARCHIVED: View only - no action buttons */}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Master fields pool */}
        <Card className="col-span-1 h-[60vh] overflow-auto">
          <CardHeader>
            <CardTitle className="text-base">คลังคำถาม ({masterFields.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="ค้นหา..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <div className="space-y-2">
              {filteredMasterFields.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">
                  ไม่มี Field ที่ใช้งาน
                </p>
              ) : (
                filteredMasterFields.map((mf) => {
                  const used = usedFieldIds.has(mf.id);
                  return (
                    <div
                      key={mf.id}
                      className={`flex justify-between items-center p-3 border rounded ${
                        used ? 'bg-slate-100 opacity-60' : 'bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{mf.labelTh}</div>
                        <Badge variant="outline" className="text-xs mt-1">
                          {mf.fieldType}
                        </Badge>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => addField(mf)}
                        disabled={used}
                        title={!isEditMode ? 'สร้าง Draft ก่อนเพื่อเพิ่ม Field' : undefined}
                      >
                        {used ? 'ใช้แล้ว' : 'เพิ่ม'}
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        {/* Selected fields - Sprint 4: Sectioned layout */}
        <Card className="col-span-2 h-[60vh] overflow-auto">
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>
                ฟิลด์ใน Template ({fields.length})
                {currentVersion && (
                  <span className="text-sm font-normal text-slate-500 ml-2">
                    (v{currentVersion.versionNumber} — {currentVersion.status})
                  </span>
                )}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addSection}
              >
                + เพิ่ม Section
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {watchedSections.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">
                ยังไม่มี Section — คลิก "+ เพิ่ม Section" เพื่อเริ่มต้น
              </p>
            ) : (
              <>
                {watchedSections.map((section, sectionIdx) => {
                  const sectionFields = watchedFields
                    .map((f, idx) => ({ f, idx }))
                    .filter(({ f }) => f.sectionId === section.id);
                  return (
                    <div key={section.id} className="border-2 border-blue-200 rounded-lg bg-blue-50/30">
                      {/* Section header */}
                      <div className="flex items-center gap-2 p-3 bg-blue-100 border-b border-blue-200 rounded-t-lg">
                        <span className="font-bold text-sm w-6">{sectionIdx + 1}.</span>
                        <div className="flex-1">
                          <div className="font-semibold">{section.name}</div>
                          <div className="text-xs text-slate-500">
                            {sectionFields.length} ฟิลด์
                          </div>
                        </div>
                        <div className="flex gap-1">
                          {isEditMode && (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => moveSection(sectionIdx, -1)}
                                disabled={sectionIdx === 0}
                              >
                                ↑
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => moveSection(sectionIdx, 1)}
                                disabled={sectionIdx === watchedSections.length - 1}
                              >
                                ↓
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                onClick={() => removeSectionAction(sectionIdx)}
                              >
                                ลบ Section
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                      {/* Section body: fields in this section */}
                      <div className="p-3 space-y-2">
                        {sectionFields.length === 0 ? (
                          <p className="text-sm text-slate-400 text-center py-4">
                            ยังไม่มีฟิลด์ใน Section นี้ — คลิก "เพิ่ม" จากคลังคำถาม (จะเพิ่มเข้า Section แรกอัตโนมัติ)
                          </p>
                        ) : (
                          <SectionFieldList
                            items={sectionFields.map(({ f }) => f.fieldId)}
                            onReorder={(newOrder) => handleDragReorder(sectionIdx, newOrder)}
                          >
                            {(fieldId) => {
                              const found = sectionFields.find(({ f }) => f.fieldId === fieldId);
                              if (!found) return null;
                              const { f: field, idx: globalIdx } = found;
                              const fieldIdxInSection = sectionFields.findIndex(({ f }) => f.fieldId === fieldId);
                              const opts = field.defaultOptions;
                              const hasValidation = field.validationTypeOriginal && field.validationTypeOriginal !== 'NONE';
                              const isExpanded = expandedFields.has(field.fieldId);
                              return (
                                <FieldSortableItem
                                  key={field.fieldId}
                                  id={field.fieldId}
                                  disabled={!isEditMode}
                                  renderHandle={({ setActivatorNodeRef, attributes, listeners }) => (
                                    <span
                                      ref={setActivatorNodeRef}
                                      {...attributes}
                                      {...listeners}
                                      className={`absolute left-1 top-1/2 -translate-y-1/2 z-10 px-1 py-2 text-slate-400 select-none touch-none ${
                                        isEditMode
                                          ? 'cursor-grab active:cursor-grabbing hover:text-slate-700'
                                          : 'cursor-default opacity-50'
                                      }`}
                                      title={isEditMode ? 'ลากเพื่อเรียงลำดับ' : undefined}
                                    >
                                      ☰
                                    </span>
                                  )}
                                >
                                  <div className="border rounded bg-white pl-5">
                                {/* Phase 1: Compact Header (always visible) — ~60-80px */}
                                <div
                                  className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50 ${
                                    isExpanded ? 'border-b border-slate-200' : ''
                                  }`}
                                  onClick={() => toggleFieldExpanded(field.fieldId)}
                                >
                                  <span className="font-medium text-slate-500 w-6 text-center">{fieldIdxInSection + 1}.</span>
                                  <span className="font-medium text-sm flex-1 truncate">{field.label}</span>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <Badge variant="outline" className="text-[10px]">
                                      {field.fieldType}
                                    </Badge>
                                    {hasValidation && (
                                      <Badge variant="outline" className="text-[10px] text-orange-600 border-orange-200">
                                        {field.validationTypeOriginal}
                                      </Badge>
                                    )}
                                    {field.isRequired ? (
                                      <Badge variant="outline" className="text-[10px] text-red-600 border-red-200 bg-red-50">
                                        Required
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-[10px] text-slate-500 border-slate-200">
                                        Optional
                                      </Badge>
                                    )}
                                  </div>
                                  {isEditMode && (
                                    <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => moveField(sectionIdx, fieldIdxInSection, -1)}
                                        disabled={fieldIdxInSection === 0}
                                        className="h-7 w-7 p-0"
                                      >
                                        ↑
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => moveField(sectionIdx, fieldIdxInSection, 1)}
                                        disabled={fieldIdxInSection === sectionFields.length - 1}
                                        className="h-7 w-7 p-0"
                                      >
                                        ↓
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => {
                                          remove(globalIdx);
                                          setHasUnsavedChanges(true);
                                        }}
                                        className="h-7"
                                      >
                                        ลบ
                                      </Button>
                                    </div>
                                  )}
                                  <span className="text-slate-400 ml-1 select-none">{isExpanded ? '▲' : '▼'}</span>
                                </div>

                                {/* Phase 1: Expanded body (only when clicked) */}
                                {isExpanded && (
                                <div className="p-3 space-y-3">
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1 col-span-2">
                                    <Label className="text-xs">Section (ไม่บังคับ - เปลี่ยน Section ของ Field นี้)</Label>
                                    <select
                                      {...register(`fields.${globalIdx}.sectionId`)}
                                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    >
                                      <option value="">— ไม่มี Section —</option>
                                      {watchedSections.map((s) => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="space-y-1 col-span-2">
                                    <Label className="text-xs">คำถามใหม่ (ไม่บังคับ)</Label>
                                    <Input
                                      {...register(`fields.${globalIdx}.overrideLabelTh`)}
                                      placeholder="ปล่อยว่างเพื่อใช้คำถามเดิม"
                                    />
                                  </div>
                                  {(field.fieldType === 'DROPDOWN' || field.fieldType === 'RADIO') && (
                                    <div className="space-y-1 col-span-2">
                                      <Label className="text-xs">ตัวเลือกใหม่ (ไม่บังคับ)</Label>
                                      <Textarea
                                        {...register(`fields.${globalIdx}.overrideOptionsText`)}
                                        rows={3}
                                        placeholder={
                                          opts && opts.length > 0
                                            ? `ใช้ค่าเดิม:\n${opts.join('\n')}`
                                            : 'ตัวเลือก 1\nตัวเลือก 2'
                                        }
                                      />
                                    </div>
                                  )}

                                  {/* ✅ Other Option Support */}
                                  {(field.fieldType === 'DROPDOWN' ||
                                    field.fieldType === 'RADIO' ||
                                    field.fieldType === 'CHECKBOX') && (
                                    <Controller
                                      control={control}
                                      name={`fields.${globalIdx}.allowOther`}
                                      render={({ field: f }) => (
                                        <div className={`flex items-center space-x-2 col-span-2 p-3 rounded border ${
                                          isEditMode ? 'bg-blue-50 border-blue-100' : 'bg-gray-50 border-gray-200'
                                        }`}>
                                          <Checkbox
                                            id={`other-${globalIdx}`}
                                            checked={!!f.value}
                                            onChange={(e) => isEditMode && f.onChange(e.target.checked)}
                                            disabled={!isEditMode}
                                          />
                                          <Label htmlFor={`other-${globalIdx}`} className={`cursor-pointer font-medium ${
                                            isEditMode ? 'text-blue-800' : 'text-gray-600'
                                          }`}>
                                            เพิ่มตัวเลือก &quot;{OTHER_OPTION_LABEL}&quot;
                                          </Label>
                                        </div>
                                      )}
                                    />
                                  )}

                                  <Controller
                                    control={control}
                                    name={`fields.${globalIdx}.isRequired`}
                                    render={({ field: f }) => (
                                      <div className={`flex items-center space-x-2 col-span-2 p-3 rounded border ${
                                        isEditMode ? 'bg-blue-50 border-blue-100' : 'bg-gray-50 border-gray-200'
                                      }`}>
                                        <Checkbox
                                          id={`req-${globalIdx}`}
                                          checked={f.value}
                                          onChange={(e) => isEditMode && f.onChange(e.target.checked)}
                                          disabled={!isEditMode}
                                        />
                                        <Label htmlFor={`req-${globalIdx}`} className={`cursor-pointer font-medium ${
                                          isEditMode ? 'text-blue-800' : 'text-gray-600'
                                        }`}>
                                          ต้องตอบ (Required)
                                        </Label>
                                      </div>
                                    )}
                                  />
                                </div>

                                {/* Phase 2: Advanced Settings (collapsed by default) */}
                                <details className="border border-slate-200 rounded">
                                  <summary className="px-3 py-2 cursor-pointer text-sm font-medium text-slate-700 hover:bg-slate-50 select-none">
                                    ▼ Advanced Settings
                                  </summary>
                                  <div className="p-3 space-y-3 border-t border-slate-200">
                                    {/* Help Text */}
                                    <div className="space-y-1">
                                      <div className="flex items-center justify-between">
                                        <Label className="text-xs">Help Text ใหม่ (ไม่บังคับ)</Label>
                                        {isEditMode && (watch(`fields.${globalIdx}.helpText`) || '') !== (field.helpTextMaster || '') && (
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setValue(`fields.${globalIdx}.helpText`, field.helpTextMaster || '')}
                                            className="h-5 text-[10px] text-blue-600 px-1"
                                          >
                                            ↺ ใช้ค่าเริ่มต้น
                                          </Button>
                                        )}
                                      </div>
                                      <Input
                                        {...register(`fields.${globalIdx}.helpText`)}
                                        placeholder={field.helpTextMaster || 'ปล่อยว่างเพื่อใช้ค่าเริ่มต้น'}
                                        disabled={!isEditMode}
                                      />
                                      <OverrideStatusBadge
                                        currentValue={watch(`fields.${globalIdx}.helpText`) || ''}
                                        masterValue={field.helpTextMaster || ''}
                                      />
                                    </div>

                                    {/* Placeholder */}
                                    <div className="space-y-1">
                                      <div className="flex items-center justify-between">
                                        <Label className="text-xs">Placeholder ใหม่ (ไม่บังคับ)</Label>
                                        {isEditMode && (watch(`fields.${globalIdx}.placeholder`) || '') !== (field.placeholderMaster || '') && (
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setValue(`fields.${globalIdx}.placeholder`, field.placeholderMaster || '')}
                                            className="h-5 text-[10px] text-blue-600 px-1"
                                          >
                                            ↺ ใช้ค่าเริ่มต้น
                                          </Button>
                                        )}
                                      </div>
                                      <Input
                                        {...register(`fields.${globalIdx}.placeholder`)}
                                        placeholder={field.placeholderMaster || 'ปล่อยว่างเพื่อใช้ค่าเริ่มต้น'}
                                        disabled={!isEditMode}
                                      />
                                      <OverrideStatusBadge
                                        currentValue={watch(`fields.${globalIdx}.placeholder`) || ''}
                                        masterValue={field.placeholderMaster || ''}
                                      />
                                    </div>

                                    {/* Validation Message - แสดงเฉพาะเมื่อ Master มี validation type ที่ไม่ใช่ NONE */}
                                    {hasValidation && (
                                      <div className="space-y-1">
                                        <div className="flex items-center justify-between">
                                          <Label className="text-xs">Validation Message ใหม่ (ไม่บังคับ)</Label>
                                          {isEditMode && (watch(`fields.${globalIdx}.validationMessage`) || '') !== (field.validationMessageMaster || '') && (
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => setValue(`fields.${globalIdx}.validationMessage`, field.validationMessageMaster || '')}
                                              className="h-5 text-[10px] text-blue-600 px-1"
                                            >
                                              ↺ ใช้ค่าเริ่มต้น
                                            </Button>
                                          )}
                                        </div>
                                        <Input
                                          {...register(`fields.${globalIdx}.validationMessage`)}
                                          placeholder={field.validationMessageMaster || 'ปล่อยว่างเพื่อใช้ค่าเริ่มต้น'}
                                          disabled={!isEditMode}
                                        />
                                        <OverrideStatusBadge
                                          currentValue={watch(`fields.${globalIdx}.validationMessage`) || ''}
                                          masterValue={field.validationMessageMaster || ''}
                                        />
                                      </div>
                                    )}

                                    {hasValidation && (
                                      <div className="space-y-1">
                                        <Label className="text-xs">Validation Rules (ไม่บังคับ)</Label>
                                        <Input
                                          {...register(`fields.${globalIdx}.validationRulesText`)}
                                          placeholder='{"minLength": 5, "maxLength": 100}'
                                          disabled={!isEditMode}
                                        />
                                      </div>
                                    )}

                                    {/* Rich Field Metadata - TEXT / TEXTAREA */}
                                    {(field.fieldType === 'TEXT' || field.fieldType === 'TEXTAREA') && (
                                      <div className="space-y-1">
                                        <div className="grid grid-cols-3 gap-2">
                                          {field.fieldType === 'TEXTAREA' && (
                                            <div className="space-y-1">
                                              <Label className="text-xs">ความสูงเริ่มต้นของช่องกรอก (บรรทัด)</Label>
                                              <Input
                                                type="number"
                                                min={1}
                                                max={20}
                                                {...register(`fields.${globalIdx}.rows`)}
                                                placeholder="3"
                                              />
                                              <p className="text-[10px] text-slate-400 leading-tight">
                                                กำหนดขนาดเริ่มต้นของช่องกรอกบนหน้าจอ ไม่จำกัดจำนวนบรรทัดในเอกสาร PDF
                                              </p>
                                            </div>
                                          )}
                                          <div className="space-y-1">
                                            <Label className="text-xs">ความยาวขั้นต่ำ</Label>
                                            <Input
                                              type="number"
                                              min={0}
                                              max={5000}
                                              {...register(`fields.${globalIdx}.minLength`)}
                                              placeholder="0"
                                            />
                                          </div>
                                          <div className="space-y-1">
                                            <Label className="text-xs">ความยาวสูงสุด</Label>
                                            <Input
                                              type="number"
                                              min={1}
                                              max={5000}
                                              {...register(`fields.${globalIdx}.maxLength`)}
                                              placeholder="500"
                                            />
                                          </div>
                                        </div>
                                        {fieldSettingsErrors[field.fieldId] && (
                                          <p className="text-xs text-red-500">
                                            {fieldSettingsErrors[field.fieldId]}
                                          </p>
                                        )}
                                      </div>
                                    )}

                                    {/* FILE Config */}
                                    {field.fieldType === 'FILE' && (
                                      <div className="space-y-1 p-2 bg-slate-50 rounded border border-slate-200">
                                        <Label className="text-xs">File Config</Label>
                                        <p className="text-xs text-slate-500">
                                          ประเภทไฟล์ที่อนุญาต / จำนวนสูงสุด / ขนาดสูงสุด — ตั้งค่าใน Master Field
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                </details>
                                </div>
                                )}
                                  </div>
                                </FieldSortableItem>
                              );
                            }}
                          </SectionFieldList>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* View Version Modal */}
      <ViewVersionModal
        open={viewModalOpen}
        onOpenChange={setViewModalOpen}
        versionId={viewVersionId}
        versionNumber={viewVersionNumber}
        status={viewVersionStatus}
        templateName={template?.name || ''}
      />

      {/* Compare Version Modal */}
      <CompareVersionModal
        open={compareModalOpen}
        onOpenChange={setCompareModalOpen}
        fromVersionId={compareFromVersionId}
        toVersionId={compareToVersionId}
      />

      {/* Template Preview Modal */}
      <TemplatePreviewModal
        open={previewModalOpen}
        onOpenChange={setPreviewModalOpen}
        templateId={templateId}
        templateName={template?.name || ''}
        currentVersionId={currentVersionId}
        draftVersionId={draftVersionId}
        publishedVersionId={publishedVersionId}
        availableVersions={versions}
      />
    </div>
  );
}

export default function TemplateBuilderClient() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">กำลังโหลด...</div>}>
      <BuilderInner />
    </Suspense>
  );
}
