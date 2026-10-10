'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useForm, Controller, SubmitHandler } from 'react-hook-form';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FileUpload } from '@/components/FileUpload';
import { SearchableDropdown } from '@/components/SearchableDropdown';

type FieldType = 'TEXT' | 'TEXTAREA' | 'DROPDOWN' | 'RADIO' | 'FILE' | 'NUMBER' | 'CHECKBOX' | 'DATE' | 'MASTER_DATA';
type ValidationType = 'NONE' | 'EMAIL' | 'PHONE' | 'NUMBER' | 'URL' | 'CITIZEN_ID' | 'REGEX';

// Phase 1 supports only 'organizations'. Keep in sync with MASTER_DATA_SOURCES in
// backend/src/schemas/validators.ts
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
}

interface TemplateSection {
  id: string;
  name: string;
  displayOrder: number;
}

interface FormValues {
  [key: string]: any;
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
  const [schema, setSchema] = useState<SchemaField[]>([]);
  const [sections, setSections] = useState<TemplateSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // MASTER_DATA options (Phase 1: organizations)
  const [organizations, setOrganizations] = useState<MasterDataOption[]>([]);
  const [masterDataError, setMasterDataError] = useState<string | null>(null);

  const { register, handleSubmit, control, formState: { errors } } = useForm<FormValues>();

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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(res => {
      console.log('Schema loaded:', res.data);
      
      // Parse and normalize schema data
      const parseSchemaField = (field: any): SchemaField => {
        // Parse options
        let options: string[] = [];
        let masterDataSource: MasterDataSource | null = null;
        if (field.options) {
          if (Array.isArray(field.options)) options = field.options;
          else if (typeof field.options === 'string') {
            try {
              const parsed = JSON.parse(field.options);
              if (Array.isArray(parsed)) options = parsed;
              else if (parsed && typeof parsed === 'object' && parsed.source) {
                masterDataSource = parsed.source;
              }
            } catch { options = []; }
          } else if (typeof field.options === 'object' && (field.options as any).source) {
            // Drizzle { mode: 'json' } may hand back a parsed object
            masterDataSource = (field.options as any).source;
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

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    setIsSubmitting(true);

    // NEW MODE: Send formData only (no root fields)
    // Core fields are already included in formData from schema
    const formData: Record<string, any> = {};
    const attachments: { fieldId: string; fileUrl: string }[] = [];

    schema.forEach(field => {
      if (field.type === 'FILE') {
        if (data[field.fieldId]) attachments.push({ fieldId: field.fieldId, fileUrl: data[field.fieldId] });
      } else if (field.type === 'CHECKBOX') {
        formData[field.fieldId] = data[field.fieldId] === true;
      } else if (field.type === 'MASTER_DATA') {
        // Persist { id, name } so the value stays human-readable for admin
        // views even if the master record is later renamed.
        const selectedId = data[field.fieldId];
        const selected = organizations.find((o) => o.id === selectedId);
        formData[field.fieldId] = selected ? { id: selected.id, name: selected.name } : null;
      } else {
        formData[field.fieldId] = data[field.fieldId];
      }
    });

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8788/api/v1';
      const res = await fetch(`${apiUrl}/public/applications/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId, formData, attachments }),
      });
      const result = await res.json();

      if (result.success) {
        router.push(`/apply/success?appNo=${result.data.applicationNo}`);
      } else {
        alert('เกิดข้อผิดพลาด: ' + (result.error || 'กรุณาตรวจสอบข้อมูล'));
      }
    } catch (error) {
      console.error('Submit error:', error);
      alert('เกิดข้อผิดพลาดในการส่งใบสมัคร: ' + (error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ'));
    } finally {
      setIsSubmitting(false);
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
    
    if (field.isRequired) {
      if (field.type === 'CHECKBOX') {
        rules.validate = (value: boolean) => value === true || 'กรุณายอมรับเงื่อนไข';
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
    
    return rules;
  };

  // Get placeholder text
  const getPlaceholder = (field: SchemaField) => {
    return field.placeholder || '';
  };

  // Get file accept types
  const getFileAccept = (field: SchemaField) => {
    const fileTypes = parseOptions(field.fileConfig?.allowedFileTypes as any);
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

  // Parse options from API - could be array, JSON string, or null
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

  // Render a single field
  const renderField = (field: SchemaField) => {
    const label = field.overrideLabel || field.label;
    const options = parseOptions(field.overrideOptions) || parseOptions(field.options);
    const validationRules = getValidationRules(field);
    const placeholder = getPlaceholder(field);
    
    return (
      <div key={field.fieldId} className="space-y-2">
        <Label htmlFor={field.fieldId}>
          {label} 
          {field.isRequired && <span className="text-red-500 ml-1">*</span>}
        </Label>
        
        {field.helpText && (
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
          <Textarea 
            id={field.fieldId}
            rows={4}
            {...register(field.fieldId, validationRules)}
            placeholder={placeholder}
            className={errors[field.fieldId] ? 'border-red-500' : ''}
          />
        )}
        
        {field.type === 'DROPDOWN' && (
          <select 
            id={field.fieldId}
            {...register(field.fieldId, validationRules)}
            className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ${errors[field.fieldId] ? 'border-red-500' : ''}`}
          >
            <option value="">{placeholder || '-- กรุณาเลือก --'}</option>
            {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
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
          </div>
        )}
        
        {field.type === 'MASTER_DATA' && (
          <Controller
            name={field.fieldId}
            control={control}
            rules={validationRules}
            render={({ field: rhfField }) => {
              // Legacy apps may hold a plain string; normalise to the id.
              const rawValue = rhfField.value;
              const legacyValue =
                rawValue && typeof rawValue === 'object'
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
                    value={legacyValue}
                    onChange={(id) => rhfField.onChange(id)}
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

        {field.type === 'CHECKBOX' && (
          <div className="flex items-start space-x-2">
            <Checkbox 
              id={field.fieldId}
              {...register(field.fieldId, validationRules)}
            />
            <Label htmlFor={field.fieldId} className="font-normal cursor-pointer">
              {field.helpText || placeholder || label}
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

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-8">
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

            {/* Consent Section */}
            <div className="space-y-4 bg-blue-50 p-4 rounded-md border border-blue-100">
              <div className="flex items-start space-x-2">
                <Checkbox id="consent1" required />
                <label htmlFor="consent1" className="text-sm font-medium leading-none">ข้าพเจ้าได้ตรวจสอบความถูกต้องครบถ้วนของข้อมูลในใบสมัครแล้ว</label>
              </div>
              <div className="flex items-start space-x-2">
                <Checkbox id="consent2" required />
                <label htmlFor="consent2" className="text-sm font-medium leading-none">ข้าพเจ้าขอรับรองว่าข้อมูลที่ได้แจ้งไว้ในใบสมัครนี้ถูกต้องครบถ้วนทุกประการ</label>
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full bg-blue-600 hover:bg-blue-700 h-12 text-lg"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  กำลังส่งข้อมูล...
                </span>
              ) : 'ยืนยันการส่งใบสมัคร'}
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
