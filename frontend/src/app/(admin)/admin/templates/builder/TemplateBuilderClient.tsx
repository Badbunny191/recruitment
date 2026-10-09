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
import { ViewVersionModal } from '@/components/ViewVersionModal';
import { CompareVersionModal } from '@/components/CompareVersionModal';

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
}

interface TemplateVersion {
  id: string;
  versionNumber: number;
  status: string;
  createdAt: number;
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
  validationRules: Record<string, any> | null;
  // Rich Field Metadata
  rows: number | null;
  minLength: number | null;
  maxLength: number | null;
}

interface BuilderField {
  fieldId: string;
  displayOrder: number;
  isRequired: boolean;
  overrideLabelTh: string;
  overrideOptionsText: string;
  helpText: string;
  placeholder: string;
  validationRulesText: string;
  // Rich Field Metadata
  rows: string;
  minLength: string;
  maxLength: string;
  // metadata for UI
  fieldType?: string;
  label?: string;
  defaultOptions?: string[] | null;
  helpTextOriginal?: string;
  placeholderOriginal?: string;
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

function BuilderInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const templateId = searchParams.get('id') || '';

  const [masterFields, setMasterFields] = useState<MasterField[]>([]);
  const [template, setTemplate] = useState<{ id: string; name: string; description: string | null } | null>(null);
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [draftVersionId, setDraftVersionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

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
      
      // Priority: Draft > Published
      const targetVersion = draftVersions[0] || publishedVersions[0];
      
      if (targetVersion) {
        setCurrentVersionId(targetVersion.id);
        if (targetVersion.status === 'DRAFT') {
          setDraftVersionId(targetVersion.id);
        }

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
            overrideOptionsText: opts.join('\n'),
            helpText: vf.helpText || '',
            placeholder: vf.placeholder || '',
            validationRulesText: vf.validationRules ? JSON.stringify(vf.validationRules) : '',
            rows: vf.rows?.toString() || '',
            minLength: vf.minLength?.toString() || '',
            maxLength: vf.maxLength?.toString() || '',
            fieldType: mf?.fieldType,
            label: vf.overrideLabelTh || mf?.labelTh || '',
            defaultOptions: parseOptions(mf?.defaultOptions),
            helpTextOriginal: mf?.helpText,
            placeholderOriginal: mf?.placeholder,
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
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [templateId]);

  const addField = (mf: MasterField, targetSectionId: string | null = null) => {
    const opts = parseOptions(mf.defaultOptions);
    const currentFields = watch('fields');
    const currentSections = watch('sections');
    // Default to first section if exists
    const sectionId = targetSectionId ?? (currentSections.length > 0 ? currentSections[0].id : null);
    append({
      fieldId: mf.id,
      displayOrder: currentFields.length + 1,
      isRequired: true,
      overrideLabelTh: '',
      overrideOptionsText: opts.join('\n'),
      helpText: mf.helpText || '',
      placeholder: mf.placeholder || '',
      validationRulesText: '',
      rows: '',
      minLength: '',
      maxLength: '',
      fieldType: mf.fieldType,
      label: mf.labelTh,
      defaultOptions: opts,
      helpTextOriginal: mf.helpText,
      placeholderOriginal: mf.placeholder,
      validationTypeOriginal: mf.validationType,
      sectionId,
    });
  };

  const addSection = () => {
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
  };

  const moveField = (index: number, direction: -1 | 1) => {
    const currentFields = watch('fields');
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= currentFields.length) return;
    const current = [...currentFields];
    [current[index], current[newIndex]] = [current[newIndex], current[index]];
    const formValues = current.map((f, i) => ({ ...f, displayOrder: i + 1 }));
    replace(formValues);
  };

  // Save as Draft (new or update)
  const onSaveDraft = async (data: FormValues) => {
    if (data.fields.length === 0) {
      alert('กรุณาเพิ่มฟิลด์อย่างน้อย 1 ฟิลด์');
      return;
    }
    if (data.sections.length === 0) {
      alert('กรุณาเพิ่ม Section อย่างน้อย 1 Section');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        templateId,
        sections: data.sections.map((s) => ({
          tempId: s.id, // tempId for client-side mapping
          name: s.name,
          displayOrder: s.displayOrder,
        })),
        fields: data.fields.map((f) => {
          const fieldData: any = {
            fieldId: f.fieldId,
            displayOrder: f.displayOrder,
            isRequired: f.isRequired,
            overrideLabelTh: f.overrideLabelTh || null,
            overrideOptions: f.overrideOptionsText
              ? f.overrideOptionsText.split('\n').map((s) => s.trim()).filter(Boolean)
              : null,
            sectionId: f.sectionId || null,
          };
          if (f.helpText && f.helpText !== f.helpTextOriginal) {
            fieldData.helpText = f.helpText;
          }
          if (f.placeholder && f.placeholder !== f.placeholderOriginal) {
            fieldData.placeholder = f.placeholder;
          }
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

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/templates/${templateId}/versions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'save failed');
      }

      alert('บันทึก Draft สำเร็จ! กด "Publish" เพื่อเผยแพร่');
      await loadAll();
    } catch (err) {
      alert('เกิดข้อผิดพลาด: ' + (err as Error).message);
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
          {/* Draft Actions */}
          {latestDraft && (
            <>
              <Button
                variant="outline"
                onClick={() => onArchive(latestDraft.id, latestDraft.versionNumber)}
                disabled={submitting}
              >
                Archive
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => onDeleteVersion(latestDraft.id, latestDraft.versionNumber)}
                disabled={submitting}
              >
                ลบ Draft
              </Button>
            </>
          )}
          {/* Publish Button */}
          {latestDraft && (
            <Button
              onClick={onPublish}
              disabled={submitting}
              className="bg-green-600 hover:bg-green-700"
            >
              Publish v{latestDraft.versionNumber}
            </Button>
          )}
          {/* Save as Draft Button */}
          <Button
            variant="secondary"
            onClick={handleSubmit(onSaveDraft)}
            disabled={submitting || fields.length === 0}
          >
            {submitting ? 'กำลังบันทึก...' : 'Save as Draft'}
          </Button>
        </div>
      </div>

      {/* Status Info with Badges */}
      <div className="bg-blue-50 border border-blue-200 rounded p-4">
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-slate-600">Latest Published:</span>
            {latestPublished ? (
              <>
                <span className="font-medium">v{latestPublished.versionNumber}</span>
                <StatusBadge status="PUBLISHED" />
              </>
            ) : (
              <span className="text-slate-400">ยังไม่มี Published</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-600">Current Draft:</span>
            {latestDraft ? (
              <>
                <span className="font-medium">v{latestDraft.versionNumber}</span>
                <StatusBadge status="DRAFT" />
              </>
            ) : (
              <span className="text-slate-400">ไม่มี Draft</span>
            )}
          </div>
        </div>
      </div>

      {/* Version History */}
      {versions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ประวัติ Version ({versions.length})</CardTitle>
          </CardHeader>
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
                          {/* Clone as new Draft - Sprint 4 */}
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onCloneVersion(v.id, v.versionNumber)}
                            disabled={submitting}
                          >
                            Clone
                          </Button>
                          {/* Delete Draft - only if DRAFT and no round uses it */}
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
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
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
                disabled={!currentVersion || currentVersion.status !== 'DRAFT'}
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
                        </div>
                      </div>
                      {/* Section body: fields in this section */}
                      <div className="p-3 space-y-2">
                        {sectionFields.length === 0 ? (
                          <p className="text-sm text-slate-400 text-center py-4">
                            ยังไม่มีฟิลด์ใน Section นี้ — คลิก "เพิ่ม" จากคลังคำถาม (จะเพิ่มเข้า Section แรกอัตโนมัติ)
                          </p>
                        ) : (
                          sectionFields.map(({ f: field, idx: index }) => {
                            const opts = watchedFields[index]?.defaultOptions;
                            const hasValidation = watchedFields[index]?.validationTypeOriginal && watchedFields[index]?.validationTypeOriginal !== 'NONE';
                            return (
                              <div key={field.fieldId} className="p-4 border rounded bg-white space-y-3">
                                <div className="flex items-center gap-3">
                                  <span className="font-bold text-lg w-8">{index + 1}</span>
                                  <div className="flex-1">
                                    <div className="font-medium">{field.label}</div>
                                    <div className="flex items-center gap-2 mt-1">
                                      <Badge variant="outline" className="text-xs">
                                        {field.fieldType}
                                      </Badge>
                                      {hasValidation && (
                                        <Badge variant="outline" className="text-xs text-orange-600 border-orange-200">
                                          {watchedFields[index].validationTypeOriginal}
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex gap-1">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => moveField(index, -1)}
                                      disabled={index === 0}
                                    >
                                      ↑
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => moveField(index, 1)}
                                      disabled={index === fields.length - 1}
                                    >
                                      ↓
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="destructive"
                                      size="sm"
                                      onClick={() => remove(index)}
                                    >
                                      ลบ
                                    </Button>
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3 pl-11">
                                  <div className="space-y-1 col-span-2">
                                    <Label className="text-xs">Section (ไม่บังคับ - เปลี่ยน Section ของ Field นี้)</Label>
                                    <select
                                      {...register(`fields.${index}.sectionId`)}
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
                                      {...register(`fields.${index}.overrideLabelTh`)}
                                      placeholder="ปล่อยว่างเพื่อใช้คำถามเดิม"
                                    />
                                  </div>
                                  {(field.fieldType === 'DROPDOWN' || field.fieldType === 'RADIO') && (
                                    <div className="space-y-1 col-span-2">
                                      <Label className="text-xs">ตัวเลือกใหม่ (ไม่บังคับ)</Label>
                                      <Textarea
                                        {...register(`fields.${index}.overrideOptionsText`)}
                                        rows={3}
                                        placeholder={
                                          opts && opts.length > 0
                                            ? `ใช้ค่าเดิม:\n${opts.join('\n')}`
                                            : 'ตัวเลือก 1\nตัวเลือก 2'
                                        }
                                      />
                                    </div>
                                  )}
                                  <div className="space-y-1 col-span-2">
                                    <Label className="text-xs">Help Text ใหม่ (ไม่บังคับ)</Label>
                                    <Input
                                      {...register(`fields.${index}.helpText`)}
                                      placeholder={field.helpTextOriginal || 'ปล่อยว่างเพื่อใช้ค่าเดิม'}
                                    />
                                  </div>
                                  <div className="space-y-1 col-span-2">
                                    <Label className="text-xs">Placeholder ใหม่ (ไม่บังคับ)</Label>
                                    <Input
                                      {...register(`fields.${index}.placeholder`)}
                                      placeholder={field.placeholderOriginal || 'ปล่อยว่างเพื่อใช้ค่าเดิม'}
                                    />
                                  </div>
                                  {hasValidation && (
                                    <div className="space-y-1 col-span-2">
                                      <Label className="text-xs">Validation Rules JSON (ไม่บังคับ)</Label>
                                      <Input
                                        {...register(`fields.${index}.validationRulesText`)}
                                        placeholder='{"minLength": 5, "maxLength": 100}'
                                      />
                                    </div>
                                  )}

                                  {/* Rich Field Metadata - แสดงสำหรับ TEXT และ TEXTAREA */}
                                  {(field.fieldType === 'TEXT' || field.fieldType === 'TEXTAREA') && (
                                    <>
                                      <div className="space-y-1">
                                        <Label className="text-xs">จำนวนบรรทัด (TEXTAREA)</Label>
                                        <Input
                                          type="number"
                                          min={1}
                                          {...register(`fields.${index}.rows`)}
                                          placeholder="เช่น 3"
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-xs">ความยาวขั้นต่ำ</Label>
                                        <Input
                                          type="number"
                                          min={0}
                                          {...register(`fields.${index}.minLength`)}
                                          placeholder="เช่น 0"
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-xs">ความยาวสูงสุด</Label>
                                        <Input
                                          type="number"
                                          min={1}
                                          {...register(`fields.${index}.maxLength`)}
                                          placeholder="เช่น 500"
                                        />
                                      </div>
                                    </>
                                  )}

                                  <Controller
                                    control={control}
                                    name={`fields.${index}.isRequired`}
                                    render={({ field: f }) => (
                                      <div className="flex items-center space-x-2 col-span-2 bg-blue-50 p-3 rounded border border-blue-100">
                                        <Checkbox
                                          id={`req-${index}`}
                                          checked={f.value}
                                          onChange={(e) => f.onChange(e.target.checked)}
                                        />
                                        <Label htmlFor={`req-${index}`} className="cursor-pointer font-medium text-blue-800">
                                          ต้องตอบ (Required)
                                        </Label>
                                      </div>
                                    )}
                                  />
                                </div>
                              </div>
                            );
                          })
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
