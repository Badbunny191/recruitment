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
  // metadata for UI
  fieldType?: string;
  label?: string;
  defaultOptions?: string[] | null;
  helpTextOriginal?: string;
  placeholderOriginal?: string;
  validationTypeOriginal?: string;
}

interface FormValues {
  fields: BuilderField[];
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

function BuilderInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const templateId = searchParams.get('id') || '';

  const [masterFields, setMasterFields] = useState<MasterField[]>([]);
  const [template, setTemplate] = useState<{ id: string; name: string; description: string | null } | null>(null);
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  const { control, register, handleSubmit, watch, reset, setValue } = useForm<FormValues>({
    defaultValues: { fields: [] },
  });
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'fields' });
  
  const watchedFields = watch('fields');

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
      
      // Find the current/last published version
      const publishedVersions = allVersions
        .filter(v => v.status === 'PUBLISHED')
        .sort((a, b) => b.versionNumber - a.versionNumber);
      
      if (publishedVersions.length > 0) {
        const currentVer = publishedVersions[0];
        setCurrentVersionId(currentVer.id);
        
        // Load fields for this version
        const fieldsDataRes = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/admin/template-fields/${currentVer.id}`,
          { headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` } }
        ).then(r => r.json()).catch(() => ({ data: [] }));
        
        // Populate form with existing fields
        const existingFields: VersionField[] = fieldsDataRes.data || [];
        
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
            fieldType: mf?.fieldType,
            label: vf.overrideLabelTh || mf?.labelTh || '',
            defaultOptions: parseOptions(mf?.defaultOptions),
            helpTextOriginal: mf?.helpText,
            placeholderOriginal: mf?.placeholder,
            validationTypeOriginal: mf?.validationType,
          };
        });
        
        // Use replace instead of reset to directly replace the array
        replace(formFields);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [templateId]);

  const addField = (mf: MasterField) => {
    const opts = parseOptions(mf.defaultOptions);
    const currentFields = watch('fields');
    append({
      fieldId: mf.id,
      displayOrder: currentFields.length + 1,
      isRequired: true,
      overrideLabelTh: '',
      overrideOptionsText: opts.join('\n'),
      helpText: mf.helpText || '',
      placeholder: mf.placeholder || '',
      validationRulesText: '',
      fieldType: mf.fieldType,
      label: mf.labelTh,
      defaultOptions: opts,
      helpTextOriginal: mf.helpText,
      placeholderOriginal: mf.placeholder,
      validationTypeOriginal: mf.validationType,
    });
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

  const onSubmit = async (data: FormValues) => {
    if (data.fields.length === 0) {
      alert('กรุณาเพิ่มฟิลด์อย่างน้อย 1 ฟิลด์');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        templateId,
        fields: data.fields.map((f) => {
          const fieldData: any = {
            fieldId: f.fieldId,
            displayOrder: f.displayOrder,
            isRequired: f.isRequired,
            overrideLabelTh: f.overrideLabelTh || null,
            overrideOptions: f.overrideOptionsText
              ? f.overrideOptionsText.split('\n').map((s) => s.trim()).filter(Boolean)
              : null,
          };
          // Include helpText and placeholder if different from original
          if (f.helpText && f.helpText !== f.helpTextOriginal) {
            fieldData.helpText = f.helpText;
          }
          if (f.placeholder && f.placeholder !== f.placeholderOriginal) {
            fieldData.placeholder = f.placeholder;
          }
          // Parse validation rules if provided
          if (f.validationRulesText) {
            try {
              fieldData.validationRules = JSON.parse(f.validationRulesText);
            } catch {
              // Ignore invalid JSON
            }
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
      if (!res.ok) throw new Error('save failed');
      alert('บันทึก Version ใหม่สำเร็จ!');
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
        <div className="text-right">
          {currentVersion && (
            <Badge variant="default" className="mr-2">v{currentVersion.versionNumber} (ปัจจุบัน)</Badge>
          )}
          <Button onClick={handleSubmit(onSubmit)} disabled={submitting || fields.length === 0}>
            {submitting ? 'กำลังบันทึก...' : 'Publish New Version'}
          </Button>
        </div>
      </div>

      {/* Versions history */}
      {versions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ประวัติ Version ({versions.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {versions
                .sort((a, b) => b.versionNumber - a.versionNumber)
                .map((v) => (
                  <Badge key={v.id} variant={v.status === 'PUBLISHED' ? 'default' : 'secondary'}>
                    v{v.versionNumber} — {v.status}
                  </Badge>
                ))}
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

        {/* Selected fields */}
        <Card className="col-span-2 h-[60vh] overflow-auto">
          <CardHeader>
            <CardTitle className="text-base">
              ฟิลด์ใน Template ({fields.length})
              {currentVersion && (
                <span className="text-sm font-normal text-slate-500 ml-2">
                  (จาก v{currentVersion.versionNumber})
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {fields.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">
                ยังไม่มีฟิลด์ — คลิก "เพิ่ม" จากคลังคำถามทางซ้าย
              </p>
            ) : (
              <>
                {fields.map((field, index) => {
                  const opts = watchedFields[index]?.defaultOptions;
                  const hasValidation = watchedFields[index]?.validationTypeOriginal && watchedFields[index]?.validationTypeOriginal !== 'NONE';
                  return (
                  <div key={field.id} className="p-4 border rounded bg-slate-50 space-y-3">
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
                })}
              </>
            )}
          </CardContent>
        </Card>
      </div>
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
