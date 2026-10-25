'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchableDropdown } from '@/components/SearchableDropdown';
import { supportsOtherOption, effectiveOptions } from '@/lib/otherOption';

type FieldType = 'TEXT' | 'TEXTAREA' | 'DROPDOWN' | 'RADIO' | 'FILE' | 'NUMBER' | 'CHECKBOX' | 'DATE' | 'MASTER_DATA';
type ValidationType = 'NONE' | 'EMAIL' | 'PHONE' | 'NUMBER' | 'URL' | 'CITIZEN_ID' | 'REGEX';
type MasterDataSource = 'organizations';

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
  sectionId: string | null;
  type: FieldType;
  label: string;
  overrideLabel: string | null;
  options: string[] | null;
  overrideOptions: string[] | null;
  masterDataSource?: MasterDataSource | null;
  isRequired: boolean;
  helpText?: string;
  placeholder?: string;
  validationType?: ValidationType;
  validationMessage?: string;
  fileConfig?: FileConfig;
  section?: string;
  // Sprint 4
  rows?: number | null;
  minLength?: number | null;
  maxLength?: number | null;
  // ✅ Other Option Support — field รองรับตัวเลือก "อื่นๆ (โปรดระบุ)" หรือไม่
  allowOther?: boolean;
}

interface TemplateSection {
  id: string;
  name: string;
  displayOrder: number;
}

interface TemplatePreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  templateName: string;
  currentVersionId: string | null;
  draftVersionId: string | null;
  publishedVersionId: string | null;
  availableVersions: Array<{
    id: string;
    versionNumber: number;
    status: string;
  }>;
}

// Preview banner for template context (no round info)
const PreviewBanner = ({ status, versionNumber }: { status: string; versionNumber: number }) => {
  const config = {
    DRAFT: {
      icon: '📝',
      bg: 'bg-blue-50 border-blue-300',
      text: 'text-blue-900',
      label: 'Draft',
    },
    PUBLISHED: {
      icon: '✅',
      bg: 'bg-green-50 border-green-300',
      text: 'text-green-900',
      label: 'Published',
    },
    ARCHIVED: {
      icon: '📁',
      bg: 'bg-gray-50 border-gray-300',
      text: 'text-gray-900',
      label: 'Archived',
    },
  }[status] || {
    icon: '📄',
    bg: 'bg-gray-50 border-gray-300',
    text: 'text-gray-900',
    label: status,
  };

  return (
    <div className={`rounded-md border ${config.bg} ${config.text} p-3 text-sm`}>
      <div className="flex items-center gap-2">
        <span className="text-lg">{config.icon}</span>
        <span className="font-medium">
          โหมดตัวอย่าง (Preview) — v{versionNumber} ({config.label})
        </span>
      </div>
      <div className="text-xs mt-1 opacity-80">
        แสดงหน้าสมัครจริงจาก Template โดยไม่ต้องสร้าง Recruitment Round
      </div>
    </div>
  );
};

export function TemplatePreviewModal({
  open,
  onOpenChange,
  templateId,
  templateName,
  currentVersionId,
  draftVersionId,
  publishedVersionId,
  availableVersions,
}: TemplatePreviewModalProps) {
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [schema, setSchema] = useState<SchemaField[]>([]);
  const [sections, setSections] = useState<TemplateSection[]>([]);
  const [previewVersion, setPreviewVersion] = useState<{ versionNumber: number; status: string } | null>(null);
  const [organizations, setOrganizations] = useState<MasterDataOption[]>([]);
  const [masterDataError, setMasterDataError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787/api/v1';

  // Determine default version to preview
  useEffect(() => {
    if (!open) return;

    // Priority: currentVersionId > draftVersionId > publishedVersionId
    const defaultVersion = currentVersionId || draftVersionId || publishedVersionId;
    if (defaultVersion) {
      setPreviewVersionId(defaultVersion);
    }
  }, [open, currentVersionId, draftVersionId, publishedVersionId]);

  // Load master data
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/public/master-data/organizations`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((res) => setOrganizations(res.data || []))
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        console.error('Failed to load master data:', err);
        setMasterDataError('ไม่สามารถโหลดข้อมูลหน่วยงานได้');
      });
    return () => controller.abort();
  }, [apiUrl]);

  // Load preview schema when version changes
  useEffect(() => {
    if (!open || !previewVersionId) return;

    const controller = new AbortController();
    const token = typeof window !== 'undefined' ? localStorage.getItem('adminToken') : null;

    setLoading(true);
    setError(null);

    fetch(`${apiUrl}/admin/templates/${templateId}/preview-schema?versionId=${previewVersionId}`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token ?? ''}` },
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((res) => {
        if (!res?.success || !res?.data) {
          throw new Error(res?.error || 'ไม่สามารถโหลดข้อมูลฟอร์มได้');
        }

        const parseSchemaField = (field: any): SchemaField => {
          let options: string[] = [];
          let masterDataSource: MasterDataSource | null = null;

          if (field.masterDataSource === 'organizations') {
            masterDataSource = 'organizations';
          } else if (field.options) {
            if (Array.isArray(field.options)) options = field.options;
            else if (typeof field.options === 'string') {
              try {
                const parsed = JSON.parse(field.options);
                if (Array.isArray(parsed)) options = parsed;
                else if (parsed && typeof parsed === 'object' && parsed.source === 'organizations') {
                  masterDataSource = 'organizations';
                }
              } catch {
                options = [];
              }
            } else if (typeof field.options === 'object' && field.options?.source) {
              if (field.options.source === 'organizations') {
                masterDataSource = 'organizations';
              }
            }
          }

          let overrideOptions: string[] = [];
          if (field.overrideOptions) {
            if (Array.isArray(field.overrideOptions)) overrideOptions = field.overrideOptions;
            else if (typeof field.overrideOptions === 'string') {
              try {
                overrideOptions = JSON.parse(field.overrideOptions);
              } catch {
                overrideOptions = [];
              }
            }
          }

          let fileConfig: FileConfig | undefined;
          if (field.fileConfig) {
            if (typeof field.fileConfig === 'string') {
              try {
                fileConfig = JSON.parse(field.fileConfig);
              } catch {
                fileConfig = undefined;
              }
            } else {
              fileConfig = field.fileConfig;
            }
          }

          return {
            fieldId: field.fieldId,
            sectionId: field.sectionId ?? null,
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
            section: field.section,
            rows: field.rows ?? null,
            minLength: field.minLength ?? null,
            maxLength: field.maxLength ?? null,
            // ✅ Other Option Support
            allowOther: !!field.allowOther,
          };
        };

        setSchema((res.data.fields || []).map(parseSchemaField));
        setSections(res.data.sections || []);
        setPreviewVersion({
          versionNumber: res.data.version.versionNumber,
          status: res.data.version.status,
        });
        setLoading(false);
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        console.error('Failed to load preview schema:', err);
        setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดข้อมูลฟอร์มได้');
        setLoading(false);
      });

    return () => controller.abort();
  }, [open, previewVersionId, templateId, apiUrl]);

  // Group fields by section
  const { grouped, ungrouped, hasTemplateSections } = useMemo(() => {
    const g: Record<string, SchemaField[]> = {};
    const u: SchemaField[] = [];
    const hasSections = sections.length > 0;
    schema.forEach((field) => {
      if (hasSections && field.sectionId) {
        if (!g[field.sectionId]) g[field.sectionId] = [];
        g[field.sectionId].push(field);
      } else if (hasSections && !field.sectionId) {
        u.push(field);
      } else if (!hasSections && field.section) {
        if (!g[field.section]) g[field.section] = [];
        g[field.section].push(field);
      } else {
        u.push(field);
      }
    });
    return { grouped: g, ungrouped: u, hasTemplateSections: hasSections };
  }, [schema, sections]);

  const parseOptions = (input: string[] | string | null | undefined): string[] => {
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

  const getFileAccept = (field: SchemaField) => {
    const fileTypes = parseOptions(field.fileConfig?.allowedFileTypes as any);
    if (!fileTypes || fileTypes.length === 0) return 'application/pdf';
    return fileTypes
      .map((t) => {
        const lower = t.toLowerCase();
        switch (lower) {
          case 'pdf': return 'application/pdf';
          case 'jpg':
          case 'jpeg': return 'image/jpeg';
          case 'png': return 'image/png';
          case 'doc':
          case 'docx': return 'application/msword';
          default: return t;
        }
      })
      .join(',');
  };

  // Render a single field (disabled for preview)
  const renderField = (field: SchemaField) => {
    const label = field.overrideLabel || field.label;
    const options = effectiveOptions(
      parseOptions(field.options),
      parseOptions(field.overrideOptions),
      field.allowOther
    );
    const placeholder = field.placeholder || '';
    // ✅ Rich Field Metadata — fallback ตรงกับ Applicant Form (rows null → 4,
    // maxLength null → hard cap 5000; preview เป็น read-only จึงไม่มี counter)
    const rows = field.rows ?? 4;
    const isCheckbox = field.type === 'CHECKBOX';
    // ✅ Other Option Support — ถ้ามีตัวเลือก "อื่นๆ (โปรดระบุ)" ให้แสดงช่อง
    // Text Input `[________________]` เพิ่มเติม (disabled ในโหมดตัวอย่าง)
    const hasOther = supportsOtherOption(options);
    const isCheckboxGroup =
      field.type === 'CHECKBOX' && !!field.allowOther && options.length > 0;

    const otherPreview = hasOther ? (
      <div className="space-y-1 pl-6">
        <Input
          id={`${field.fieldId}__other`}
          placeholder="กรุณาระบุรายละเอียดเพิ่มเติม"
          disabled
          className="bg-slate-50"
        />
      </div>
    ) : null;

    return (
      <div key={field.fieldId} className="space-y-2">
        {/* ✅ Other Option Support — CHECKBOX แบบกลุ่มต้องแสดง label ของ field */}
        {(!isCheckbox || isCheckboxGroup) && (
          <Label htmlFor={field.fieldId}>
            {label}
            {field.isRequired && <span className="text-red-500 ml-1">*</span>}
          </Label>
        )}

        {field.helpText && !isCheckbox && <p className="text-xs text-gray-500 -mt-1">{field.helpText}</p>}

        {field.type === 'TEXT' && (
          <Input
            id={field.fieldId}
            placeholder={placeholder}
            readOnly
            className="bg-slate-50 placeholder:text-slate-400 cursor-default"
            maxLength={field.maxLength || undefined}
          />
        )}

        {field.type === 'NUMBER' && (
          <Input
            id={field.fieldId}
            type="number"
            placeholder={placeholder}
            disabled
            className="bg-slate-50"
            min={field.minLength || undefined}
            max={field.maxLength || undefined}
          />
        )}

        {field.type === 'DATE' && (
          <Input id={field.fieldId} type="date" disabled className="bg-slate-50" />
        )}

        {field.type === 'TEXTAREA' && (
          <Textarea
            id={field.fieldId}
            rows={rows}
            placeholder={placeholder}
            disabled
            className="bg-slate-50 resize-none"
            maxLength={field.maxLength ?? 5000}
          />
        )}

        {field.type === 'DROPDOWN' && (
          <>
            <select
              id={field.fieldId}
              disabled
              className="flex h-10 w-full rounded-md border border-input bg-slate-50 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-70"
            >
              <option value="">{placeholder || '-- กรุณาเลือก --'}</option>
              {options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            {otherPreview}
          </>
        )}

        {field.type === 'RADIO' && (
          <div className="space-y-2">
            {options.map((opt) => (
              <div key={opt} className="flex items-center space-x-2">
                <input
                  type="radio"
                  id={`${field.fieldId}-${opt}`}
                  value={opt}
                  disabled
                  className="w-4 h-4"
                />
                <Label htmlFor={`${field.fieldId}-${opt}`} className="font-normal cursor-not-allowed text-slate-500">
                  {opt}
                </Label>
              </div>
            ))}
            {otherPreview}
          </div>
        )}

        {field.type === 'MASTER_DATA' && (
          <>
            {field.masterDataSource !== 'organizations' ? (
              <p className="text-xs text-red-500">
                ไม่รองรับแหล่งข้อมูล: {field.masterDataSource || 'ไม่ระบุ'}
              </p>
            ) : (
              <SearchableDropdown
                options={organizations.map((o) => ({ id: o.id, label: o.name }))}
                value={null}
                onChange={() => {}}
                placeholder={placeholder || 'พิมพ์เพื่อค้นหาหน่วยงาน...'}
                emptyText="ไม่พบหน่วยงานที่ค้นหา"
                disabled
              />
            )}
            {masterDataError && <p className="text-xs text-red-500 mt-1">{masterDataError}</p>}
          </>
        )}

        {field.type === 'CHECKBOX' && isCheckboxGroup && (
          // ✅ Other Option Support — CHECKBOX แบบกลุ่ม (เลือกได้หลายค่า)
          <div className="space-y-2">
            {options.map((opt) => (
              <div key={opt} className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id={`${field.fieldId}-${opt}`}
                  value={opt}
                  disabled
                  className="w-4 h-4"
                />
                <Label htmlFor={`${field.fieldId}-${opt}`} className="font-normal cursor-not-allowed text-slate-500">
                  {opt}
                </Label>
              </div>
            ))}
            {otherPreview}
          </div>
        )}

        {field.type === 'CHECKBOX' && !isCheckboxGroup && (
          <div className="flex items-start space-x-2">
            <Checkbox id={field.fieldId} disabled />
            <Label htmlFor={field.fieldId} className="font-normal cursor-not-allowed text-slate-500">
              {field.helpText || placeholder || label}
              {field.isRequired && <span className="text-red-500 ml-1">*</span>}
            </Label>
          </div>
        )}

        {field.type === 'FILE' && (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500">
            <div className="font-medium text-slate-600 mb-1">📎 ช่องอัปโหลดไฟล์</div>
            <div>
              ประเภทที่รองรับ: <span className="text-slate-700">{field.fileConfig?.allowedFileTypes?.join(', ') || 'PDF'}</span>
              {field.fileConfig?.maxSizeMB && (
                <> • ขนาดสูงสุด: <span className="text-slate-700">{field.fileConfig.maxSizeMB}MB</span></>
              )}
              {field.fileConfig?.maxFiles && field.fileConfig.maxFiles > 1 && (
                <> • สูงสุด <span className="text-slate-700">{field.fileConfig.maxFiles}</span> ไฟล์</>
              )}
            </div>
            <div className="mt-2 text-xs text-amber-700">⛔ ปิดการอัปโหลดในโหมดตัวอย่าง</div>
          </div>
        )}
      </div>
    );
  };

  const hasSchemaFields = schema.length > 0;

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PUBLISHED':
        return <Badge className="bg-green-600">Published</Badge>;
      case 'DRAFT':
        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">Draft</Badge>;
      case 'ARCHIVED':
        return <Badge className="bg-gray-100 text-gray-600 border-gray-300">Archived</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${viewMode === 'mobile' ? 'max-w-sm' : 'max-w-3xl'} max-h-[90vh] overflow-auto`}>
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>Preview: {templateName}</DialogTitle>
              <DialogDescription>
                ดูหน้าสมัครจริงจาก Template โดยไม่ต้องสร้าง Round
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              {/* View Mode Toggle */}
              <div className="flex rounded-md border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setViewMode('desktop')}
                  className={`px-3 py-1.5 text-sm transition-colors ${
                    viewMode === 'desktop'
                      ? 'bg-slate-800 text-white'
                      : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  🖥️ Desktop
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('mobile')}
                  className={`px-3 py-1.5 text-sm transition-colors ${
                    viewMode === 'mobile'
                      ? 'bg-slate-800 text-white'
                      : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  📱 Mobile
                </button>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Version Selector Tabs */}
        {availableVersions.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b pb-3">
            {availableVersions
              .sort((a, b) => b.versionNumber - a.versionNumber)
              .map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setPreviewVersionId(v.id)}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    previewVersionId === v.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  v{v.versionNumber} {getStatusBadge(v.status)}
                </button>
              ))}
          </div>
        )}

        {/* Preview Banner */}
        {previewVersion && (
          <PreviewBanner status={previewVersion.status} versionNumber={previewVersion.versionNumber} />
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-4 text-red-800">
            {error}
          </div>
        )}

        {/* Form Preview */}
        {!loading && !error && (
          <div className={`rounded-md border bg-white ${viewMode === 'mobile' ? 'max-w-sm mx-auto' : ''}`}>
            <div className="p-6 space-y-8">
              {hasSchemaFields ? (
                <div className="space-y-8">
                  {/* Ungrouped fields */}
                  {ungrouped.length > 0 && (
                    <div className="space-y-6">
                      {hasTemplateSections && (
                        <h3 className="font-semibold text-lg border-b pb-2">
                          ข้อมูลอื่น ๆ
                        </h3>
                      )}
                      <div className="grid grid-cols-1 gap-6">
                        {ungrouped.map(renderField)}
                      </div>
                    </div>
                  )}

                  {/* Sectioned fields */}
                  {hasTemplateSections
                    ? sections.map((section) => {
                        const sectionFields = grouped[section.id] || [];
                        if (sectionFields.length === 0) return null;
                        return (
                          <div key={section.id} className="space-y-6">
                            <h3 className="font-semibold text-lg border-b pb-2 flex items-center gap-2">
                              <svg
                                className="w-5 h-5 text-gray-500"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                                />
                              </svg>
                              {section.name}
                            </h3>
                            <div className="grid grid-cols-1 gap-6">
                              {sectionFields.map(renderField)}
                            </div>
                          </div>
                        );
                      })
                    : Object.entries(grouped).map(([sectionName, sectionFields]) => (
                        <div key={sectionName} className="space-y-6">
                          <h3 className="font-semibold text-lg border-b pb-2">
                            {sectionName}
                          </h3>
                          <div className="grid grid-cols-1 gap-6">
                            {sectionFields.map(renderField)}
                          </div>
                        </div>
                      ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <p>ไม่พบฟิลด์ใน Template นี้</p>
                  <p className="text-sm mt-1">กรุณาเพิ่มฟิลด์ใน Template Builder ก่อน</p>
                </div>
              )}

              {/* NOTE: Consent fields should be added as CHECKBOX type in Template Builder.
                  If template has CHECKBOX fields, they will render in the schema fields loop above. */}

              {/* Submit button placeholder */}
              {hasSchemaFields && (
                <Button
                  type="submit"
                  className="w-full bg-slate-400 hover:bg-slate-400 cursor-not-allowed h-12 text-lg"
                  disabled
                >
                  ⛔ โหมดตัวอย่าง (Preview) ไม่สามารถส่งใบสมัครได้
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ปิด
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
