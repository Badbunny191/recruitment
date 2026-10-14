'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchableDropdown } from '@/components/SearchableDropdown';

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
}

interface TemplateSection {
  id: string;
  name: string;
  displayOrder: number;
}

interface RoundInfo {
  id: string;
  title: string;
  positionLevel: string;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED' | string;
  openDate: string | number | null;
  closeDate: string | number | null;
  announcementTitle: string | null;
  announcementDescription: string | null;
  contactInformation: string | null;
  remark: string | null;
}

// Bangkok offset (+7h) so that getUTC*() returns the Thai wall clock the
// admin entered (mirrors the logic in /apply/page.tsx).
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

const formatThaiDateTime = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined || value === '') return '-';
  let d: Date;
  if (typeof value === 'number') {
    d = new Date(value < 1e12 ? value * 1000 : value);
  } else {
    d = new Date(value);
  }
  if (isNaN(d.getTime())) return String(value);
  const dThai = new Date(d.getTime() + BANGKOK_OFFSET_MS);
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const day = dThai.getUTCDate();
  const month = months[dThai.getUTCMonth()];
  const year = dThai.getUTCFullYear() + 543;
  const hh = String(dThai.getUTCHours()).padStart(2, '0');
  const mm = String(dThai.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} ${hh}:${mm}`;
};

// Banner config keyed by round status (DRAFT / ACTIVE / CLOSED)
type BannerKind = 'DRAFT' | 'ACTIVE' | 'CLOSED';
const bannerConfig: Record<BannerKind, { icon: string; tone: string; ring: string; title: string; subtitle: string }> = {
  DRAFT: {
    icon: '🟡',
    tone: 'bg-amber-50 text-amber-900',
    ring: 'border-amber-300',
    title: 'โหมดตัวอย่าง (Preview) — สถานะปัจจุบัน: DRAFT',
    subtitle: 'รอบนี้ยังไม่เปิดรับสมัครสำหรับผู้สมัครทั่วไป',
  },
  ACTIVE: {
    icon: '🟢',
    tone: 'bg-emerald-50 text-emerald-900',
    ring: 'border-emerald-300',
    title: 'โหมดตัวอย่าง (Preview) — สถานะปัจจุบัน: ACTIVE',
    subtitle: 'รอบนี้เปิดรับสมัครอยู่ ผู้สมัครทั่วไปสามารถส่งใบสมัครได้',
  },
  CLOSED: {
    icon: '🔴',
    tone: 'bg-rose-50 text-rose-900',
    ring: 'border-rose-300',
    title: 'โหมดตัวอย่าง (Preview) — สถานะปัจจุบัน: CLOSED',
    subtitle: 'รอบนี้ปิดรับสมัครแล้วสำหรับผู้สมัครทั่วไป',
  },
};

function AdminPreviewInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const roundId = searchParams?.get('id') ?? undefined;

  const [schema, setSchema] = useState<SchemaField[]>([]);
  const [sections, setSections] = useState<TemplateSection[]>([]);
  const [roundInfo, setRoundInfo] = useState<RoundInfo | null>(null);
  const [organizations, setOrganizations] = useState<MasterDataOption[]>([]);
  const [masterDataError, setMasterDataError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787/api/v1';

  // Load MASTER_DATA organizations (organizations only — Phase 1).
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

  // Load preview schema (bypasses lifecycle gate).
  useEffect(() => {
    if (!roundId) {
      setError('ไม่พบรหัสรอบรับสมัคร');
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const token = typeof window !== 'undefined' ? localStorage.getItem('adminToken') : null;
    fetch(`${apiUrl}/admin/rounds/${roundId}/preview-schema`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token ?? ''}` },
    })
      .then(async (res) => {
        if (res.status === 401) {
          // Token invalid → bounce to login
          if (typeof window !== 'undefined') {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin/login';
          }
          throw new Error('Unauthorized');
        }
        if (res.status === 404) {
          throw new Error('ไม่พบรอบรับสมัครนี้');
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((res) => {
        if (!res?.success || !res?.data) {
          throw new Error(res?.error || 'ไม่สามารถโหลดข้อมูลฟอร์มได้');
        }

        // Normalize fields (mirror /apply/page.tsx)
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
            } else if (typeof field.options === 'object' && (field.options as any).source) {
              if ((field.options as any).source === 'organizations') {
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
          };
        };

        const fields = (res.data.fields || []).map(parseSchemaField);
        const sectionList = res.data.sections || [];
        setSchema(fields);
        setSections(sectionList);
        setRoundInfo(res.data.round || null);
        setLoading(false);
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        console.error('Failed to load preview schema:', err);
        setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดข้อมูลฟอร์มได้');
        setLoading(false);
      });
    return () => controller.abort();
  }, [apiUrl, roundId]);

  // Group fields by section (Sprint 4 hybrid mode).
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
          case 'pdf':
            return 'application/pdf';
          case 'jpg':
          case 'jpeg':
            return 'image/jpeg';
          case 'png':
            return 'image/png';
          case 'doc':
          case 'docx':
            return 'application/msword';
          default:
            return t;
        }
      })
      .join(',');
  };

  // Render a single field — DISABLED across the board (preview mode).
  // We render inputs as disabled so the user can read the structure without
  // being able to interact (especially for FILE uploads, which would otherwise
  // upload to R2 in Apply Form).
  const renderField = (field: SchemaField) => {
    const label = field.overrideLabel || field.label;
    const options = parseOptions(field.overrideOptions) || parseOptions(field.options);
    const placeholder = field.placeholder || '';
    const isCheckbox = field.type === 'CHECKBOX';

    return (
      <div key={field.fieldId} className="space-y-2">
        {!isCheckbox && (
          <Label htmlFor={field.fieldId}>
            {label}
            {field.isRequired && <span className="text-red-500 ml-1">*</span>}
          </Label>
        )}

        {field.helpText && !isCheckbox && <p className="text-xs text-gray-500 -mt-1">{field.helpText}</p>}

        {field.type === 'TEXT' && (
          <Input id={field.fieldId} placeholder={placeholder} readOnly className="bg-slate-50 placeholder:text-slate-500 cursor-default" />
        )}

        {field.type === 'NUMBER' && (
          <Input id={field.fieldId} type="number" placeholder={placeholder} disabled className="bg-slate-50" />
        )}

        {field.type === 'DATE' && (
          <Input id={field.fieldId} type="date" disabled className="bg-slate-50" />
        )}

        {field.type === 'TEXTAREA' && (
          <Textarea id={field.fieldId} rows={4} placeholder={placeholder} disabled className="bg-slate-50" />
        )}

        {field.type === 'DROPDOWN' && (
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
        )}

        {field.type === 'RADIO' && (
          <div className="space-y-2">
            {options.map((opt) => (
              <div key={opt} className="flex items-center space-x-2">
                <input type="radio" id={`${field.fieldId}-${opt}`} value={opt} disabled className="w-4 h-4" />
                <Label htmlFor={`${field.fieldId}-${opt}`} className="font-normal cursor-not-allowed text-slate-500">
                  {opt}
                </Label>
              </div>
            ))}
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
                onChange={() => {
                  /* preview: no-op */
                }}
                placeholder={placeholder || 'พิมพ์เพื่อค้นหาหน่วยงาน...'}
                emptyText="ไม่พบหน่วยงานที่ค้นหา"
                disabled
              />
            )}
            {masterDataError && <p className="text-xs text-red-500 mt-1">{masterDataError}</p>}
          </>
        )}

        {field.type === 'CHECKBOX' && (
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

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-blue-500 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          <p className="text-gray-500">กำลังโหลดแบบฟอร์มตัวอย่าง...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto p-4 md:p-8">
        <Card>
          <CardHeader className="bg-rose-50 border-b border-rose-200">
            <CardTitle className="text-xl text-rose-800">ไม่สามารถโหลด Preview ได้</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            <div className="rounded-md bg-rose-100 border border-rose-300 px-4 py-3 text-base text-rose-900">
              {error}
            </div>
            <Button variant="outline" onClick={() => router.push('/admin/rounds')}>
              ← กลับไปหน้ารอบรับสมัคร
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!roundId) {
    return <div className="p-8 text-center text-red-500">ไม่พบรหัสรอบรับสมัคร</div>;
  }

  const status = (roundInfo?.status || 'DRAFT').toUpperCase() as BannerKind;
  const banner = bannerConfig[status] || bannerConfig.DRAFT;
  const hasSchemaFields = schema.length > 0;

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-4">
      {/* Top toolbar */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => router.push('/admin/rounds')}>
          ← กลับไปหน้ารอบรับสมัคร
        </Button>
        <span className="text-xs text-slate-500">โหมดผู้ดูแลระบบ</span>
      </div>

      {/* Preview Banner — changes by round status */}
      <div className={`rounded-md border ${banner.ring} ${banner.tone} p-4`}>
        <div className="flex items-start gap-3">
          <span className="text-2xl leading-none" aria-hidden>
            {banner.icon}
          </span>
          <div className="flex-1">
            <div className="font-semibold text-base">{banner.title}</div>
            <div className="text-sm mt-1 opacity-90">{banner.subtitle}</div>
            {roundInfo && (
              <div className="text-xs mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 opacity-80">
                <div>
                  <span className="font-medium">ชื่อรอบ:</span> {roundInfo.title}
                </div>
                <div>
                  <span className="font-medium">ตำแหน่ง:</span> {roundInfo.positionLevel}
                </div>
                <div>
                  <span className="font-medium">เปิดรับสมัคร:</span> {formatThaiDateTime(roundInfo.openDate)}
                </div>
                <div>
                  <span className="font-medium">ปิดรับสมัคร:</span> {formatThaiDateTime(roundInfo.closeDate)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Round announcement / contact / remark block (mirrors Apply Form) */}
      {roundInfo &&
        (roundInfo.announcementTitle ||
          roundInfo.announcementDescription ||
          roundInfo.contactInformation ||
          roundInfo.remark) && (
          <div className="rounded-md border border-blue-200 bg-blue-50/60 p-4 md:p-5 space-y-3">
            {roundInfo.announcementTitle && (
              <h2 className="text-base md:text-lg font-semibold text-slate-900">
                {roundInfo.announcementTitle}
              </h2>
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
          <CardTitle className="text-xl flex items-center gap-2">
            <span aria-hidden>👁</span>
            <span>Preview Form: {roundInfo?.title || '-'}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={(e) => e.preventDefault()} className="space-y-8">
            {hasSchemaFields ? (
              <div className="space-y-8">
                {ungrouped.length > 0 && (
                  <div className="space-y-6">
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
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                      {hasTemplateSections ? 'ข้อมูลอื่น ๆ' : 'ข้อมูลประกอบการพิจารณา'}
                    </h3>
                    <div className="grid grid-cols-1 gap-6">{ungrouped.map(renderField)}</div>
                  </div>
                )}

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
                          <div className="grid grid-cols-1 gap-6">{sectionFields.map(renderField)}</div>
                        </div>
                      );
                    })
                  : Object.entries(grouped).map(([sectionName, sectionFields]) => (
                      <div key={sectionName} className="space-y-6">
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
                          {sectionName}
                        </h3>
                        <div className="grid grid-cols-1 gap-6">{sectionFields.map(renderField)}</div>
                      </div>
                    ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <p>ไม่พบฟิลด์ในแบบฟอร์ม กรุณาติดต่อผู้ดูแลระบบ</p>
              </div>
            )}

            {/* Consent fields removed - Dynamic Template is the source of truth.
                If the template needs a consent checkbox, add a CHECKBOX field via Template Builder. */}

            <Button
              type="submit"
              className="w-full bg-slate-400 hover:bg-slate-400 cursor-not-allowed h-12 text-lg"
              disabled
              aria-disabled="true"
            >
              ⛔ โหมดตัวอย่าง (Preview) ไม่สามารถส่งใบสมัครได้
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminPreviewPage() {
  return (
    <div>
      {/* Wrap in Suspense to satisfy Next.js 14 requirement for
          useSearchParams() in statically-exported routes. */}
      <Suspense fallback={
        <div className="p-8 flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <svg className="animate-spin h-8 w-8 text-blue-500 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            <p className="text-gray-500">กำลังโหลดแบบฟอร์มตัวอย่าง...</p>
          </div>
        </div>
      }>
        <AdminPreviewInner />
      </Suspense>
    </div>
  );
}