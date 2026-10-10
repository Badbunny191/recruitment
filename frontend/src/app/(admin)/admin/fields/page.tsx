'use client';

import { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';

type FieldType = 'TEXT' | 'TEXTAREA' | 'DROPDOWN' | 'RADIO' | 'FILE' | 'NUMBER' | 'CHECKBOX' | 'DATE' | 'MASTER_DATA';
type ValidationType = 'NONE' | 'EMAIL' | 'PHONE' | 'NUMBER' | 'URL' | 'CITIZEN_ID' | 'REGEX';

// Phase 1 supports only 'organizations'. Keep in sync with MASTER_DATA_SOURCES in
// backend/src/schemas/validators.ts
type MasterDataSource = 'organizations';

interface FileConfig {
  allowedFileTypes?: string[];
  maxFiles?: number;
  maxSizeMB?: number;
}

interface FieldMaster {
  id: string;
  fieldType: FieldType;
  labelTh: string;
  // string[] for DROPDOWN/RADIO, { source } for MASTER_DATA
  defaultOptions: string[] | { source: MasterDataSource } | null;
  pdfMappingKey: string | null;
  isActive: boolean;
  helpText?: string;
  placeholder?: string;
  section?: string;
  fileConfig?: FileConfig;
  validationType?: ValidationType;
  validationMessage?: string;
}

interface FormState {
  fieldType: FieldType;
  labelTh: string;
  defaultOptionsText: string;
  masterDataSource: MasterDataSource;
  pdfMappingKey: string;
  isActive: boolean;
  helpText: string;
  placeholder: string;
  section: string;
  fileConfig: FileConfig;
  validationType: ValidationType;
  validationMessage: string;
}

const EMPTY_FORM: FormState = {
  fieldType: 'TEXT',
  labelTh: '',
  defaultOptionsText: '',
  masterDataSource: 'organizations',
  pdfMappingKey: '',
  isActive: true,
  helpText: '',
  placeholder: '',
  section: '',
  fileConfig: { maxFiles: 1, maxSizeMB: 10 },
  validationType: 'NONE',
  validationMessage: '',
};

const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'TEXT', label: 'TEXT — ช่องกรอกข้อความ' },
  { value: 'TEXTAREA', label: 'TEXTAREA — กล่องข้อความยาว' },
  { value: 'NUMBER', label: 'NUMBER — ช่องกรอกตัวเลข' },
  { value: 'DATE', label: 'DATE — วันที่' },
  { value: 'DROPDOWN', label: 'DROPDOWN — เลือกจากรายการ' },
  { value: 'RADIO', label: 'RADIO — เลือก 1 ตัวเลือก' },
  { value: 'CHECKBOX', label: 'CHECKBOX — ช่องติ๊กถูก' },
  { value: 'FILE', label: 'FILE — อัปโหลดไฟล์' },
  { value: 'MASTER_DATA', label: 'MASTER_DATA — เลือกจากข้อมูลหลัก (คลังหน่วยงาน)' },
];

const MASTER_DATA_SOURCE_OPTIONS: { value: MasterDataSource; label: string }[] = [
  { value: 'organizations', label: 'หน่วยงาน (Organizations)' },
];

const VALIDATION_TYPE_OPTIONS: { value: ValidationType; label: string; example: string }[] = [
  { value: 'NONE', label: 'ไม่มี', example: '' },
  { value: 'EMAIL', label: 'อีเมล (Email)', example: 'example@email.com' },
  { value: 'PHONE', label: 'เบอร์โทรศัพท์', example: '0812345678 หรือ 081-234-5678' },
  { value: 'NUMBER', label: 'ตัวเลข (Number)', example: '12345' },
  { value: 'URL', label: 'URL', example: 'https://www.example.com' },
  { value: 'CITIZEN_ID', label: 'เลขบัตรประชาชน', example: '1234567890123' },
  { value: 'REGEX', label: 'RegEx กำหนดเอง', example: 'รูปแบบอื่นๆ' },
];

const SECTION_OPTIONS = [
  'ข้อมูลส่วนบุคคล',
  'ข้อมูลตำแหน่ง',
  'การศึกษา',
  'ประสบการณ์ทำงาน',
  'คุณสมบัติ',
  'เอกสารแนบ',
  'การรับรอง',
  'อื่นๆ',
];

const FILE_TYPE_OPTIONS = [
  { value: 'pdf', label: 'PDF' },
  { value: 'jpg', label: 'JPG (รูปภาพ)' },
  { value: 'jpeg', label: 'JPEG (รูปภาพ)' },
  { value: 'png', label: 'PNG (รูปภาพ)' },
  { value: 'doc', label: 'DOC (เอกสาร Word)' },
  { value: 'docx', label: 'DOCX (เอกสาร Word)' },
];

export default function FieldMasterPage() {
  const [fields, setFields] = useState<FieldMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FieldMaster | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FieldMaster | null>(null);

  // Field Delete Impact Modal
  const [impactModalOpen, setImpactModalOpen] = useState(false);
  const [impactData, setImpactData] = useState<any>(null);
  const [impactLoading, setImpactLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await fetch(process.env.NEXT_PUBLIC_API_URL + '/admin/fields', {
      headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
    }).then((r) => r.json());
    setFields(res.data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  // เรียก Impact API ก่อนลบ
  const checkFieldImpact = async (fieldId: string) => {
    setImpactLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/fields/${fieldId}/usage`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
      });
      const data = await res.json();
      setImpactData(data.data);
      setImpactModalOpen(true);
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการตรวจสอบผลกระทบ');
    } finally {
      setImpactLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (f: FieldMaster) => {
    setEditing(f);
    
    // Parse file config
    let fileConfig: FileConfig = { maxFiles: 1, maxSizeMB: 10 };
    if (f.fileConfig) {
      if (typeof f.fileConfig === 'string') {
        try {
          fileConfig = JSON.parse(f.fileConfig);
        } catch {
          fileConfig = { maxFiles: 1, maxSizeMB: 10 };
        }
      } else {
        fileConfig = f.fileConfig;
      }
    }
    
    // Parse defaultOptions - could be array, { source }, or JSON string from DB
    let parsedOptions: string[] = [];
    let masterDataSource: MasterDataSource = 'organizations';
    if (f.defaultOptions) {
      let rawOptions: any = f.defaultOptions;
      if (typeof rawOptions === 'string') {
        try {
          rawOptions = JSON.parse(rawOptions);
        } catch {
          rawOptions = null;
        }
      }
      if (Array.isArray(rawOptions)) {
        parsedOptions = rawOptions;
      } else if (rawOptions && typeof rawOptions === 'object' && rawOptions.source) {
        masterDataSource = rawOptions.source;
      }
    }

    setForm({
      fieldType: f.fieldType,
      labelTh: f.labelTh,
      defaultOptionsText: parsedOptions.join('\n'),
      masterDataSource,
      pdfMappingKey: f.pdfMappingKey || '',
      isActive: f.isActive,
      helpText: f.helpText || '',
      placeholder: f.placeholder || '',
      section: f.section || '',
      fileConfig,
      validationType: (f.validationType as any) || 'NONE',
      validationMessage: f.validationMessage || '',
    });
    setDialogOpen(true);
  };

  const parseOptions = (text: string): string[] | null => {
    const opts = text.split('\n').map((s) => s.trim()).filter(Boolean);
    return opts.length > 0 ? opts : null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload: any = {
        fieldType: form.fieldType,
        labelTh: form.labelTh,
        // MASTER_DATA stores a source ref, DROPDOWN/RADIO store a string[]
        defaultOptions:
          form.fieldType === 'MASTER_DATA'
            ? { source: form.masterDataSource }
            : parseOptions(form.defaultOptionsText),
        pdfMappingKey: form.pdfMappingKey || null,
        isActive: form.isActive,
      };

      // UI fields
      if (form.helpText.trim()) payload.helpText = form.helpText.trim();
      if (form.placeholder.trim()) payload.placeholder = form.placeholder.trim();
      if (form.section) payload.section = form.section;
      
      // Validation fields
      if (form.validationType !== 'NONE') {
        payload.validationType = form.validationType;
        if (form.validationMessage.trim()) {
          payload.validationMessage = form.validationMessage.trim();
        }
      }
      
      // File config - ALWAYS send if FILE type
      if (form.fieldType === 'FILE') {
        payload.fileConfig = {
          allowedFileTypes: form.fileConfig.allowedFileTypes || ['pdf'],
          maxFiles: form.fileConfig.maxFiles || 1,
          maxSizeMB: form.fileConfig.maxSizeMB || 10,
        };
      }

      const url = editing
        ? `${process.env.NEXT_PUBLIC_API_URL}/admin/fields/${editing.id}`
        : `${process.env.NEXT_PUBLIC_API_URL}/admin/fields`;
      const method = editing ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('save failed');
      setDialogOpen(false);
      await load();
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการบันทึก');
    } finally {
      setSubmitting(false);
    }
  };

  // เปลี่ยนปุ่มลบให้เรียก impact check ก่อน
  const handleDeleteClick = async (f: FieldMaster) => {
    setConfirmDelete(f);
    await checkFieldImpact(f.id);
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/fields/${confirmDelete.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}` },
      });
      if (!res.ok) throw new Error('delete failed');
      setConfirmDelete(null);
      setImpactModalOpen(false);
      setImpactData(null);
      await load();
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการลบ');
    }
  };

  const updateFileConfig = (updates: Partial<FileConfig>) => {
    setForm({
      ...form,
      fileConfig: { ...form.fileConfig, ...updates },
    });
  };

  const getTypeBadgeColor = (type: FieldType) => {
    const colors: Record<FieldType, string> = {
      TEXT: 'bg-blue-100 text-blue-800',
      TEXTAREA: 'bg-blue-100 text-blue-800',
      NUMBER: 'bg-green-100 text-green-800',
      DATE: 'bg-purple-100 text-purple-800',
      DROPDOWN: 'bg-yellow-100 text-yellow-800',
      RADIO: 'bg-orange-100 text-orange-800',
      CHECKBOX: 'bg-teal-100 text-teal-800',
      FILE: 'bg-pink-100 text-pink-800',
      MASTER_DATA: 'bg-indigo-100 text-indigo-800',
    };
    return colors[type] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <h1 className="text-2xl font-bold">Field Master (คลังฟิลด์)</h1>
        <Button onClick={openCreate}>
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          เพิ่ม Field ใหม่
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {FIELD_TYPE_OPTIONS.slice(0, 5).map((opt) => {
          const count = fields.filter(f => f.fieldType === opt.value).length;
          return (
            <Card key={opt.value} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => {}}>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">{count}</p>
                <p className="text-xs text-gray-500 truncate">{opt.value}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="border rounded-lg bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead>Label (TH)</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Validation</TableHead>
                <TableHead>Section</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12">
                    <div className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span className="text-gray-500">กำลังโหลด...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : fields.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-gray-500">
                    ยังไม่มี Field
                  </TableCell>
                </TableRow>
              ) : (
                fields.map((field) => (
                  <TableRow key={field.id} className="hover:bg-gray-50 transition-colors">
                    <TableCell>
                      <div>
                        <p className="font-medium">{field.labelTh}</p>
                        {field.helpText && (
                          <p className="text-xs text-gray-500 mt-1 truncate max-w-xs">{field.helpText}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getTypeBadgeColor(field.fieldType)}`}>
                        {field.fieldType}
                      </span>
                      {field.fieldType === 'FILE' && field.fileConfig && (
                        <p className="text-xs text-gray-500 mt-1">
                          {typeof field.fileConfig === 'object' 
                            ? `${field.fileConfig.maxFiles || 1} ไฟล์ • ${field.fileConfig.maxSizeMB || 10}MB`
                            : 'ตั้งค่าแล้ว'}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {field.validationType && field.validationType !== 'NONE' ? (
                        <Badge variant="outline" className="text-orange-600 border-orange-200">
                          {VALIDATION_TYPE_OPTIONS.find(v => v.value === field.validationType)?.label}
                        </Badge>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {field.section ? (
                        <Badge variant="outline">{field.section}</Badge>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={field.isActive ? 'default' : 'secondary'}>
                        {field.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" size="sm" onClick={() => openEdit(field)}>
                          แก้ไข
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteClick(field)}
                          disabled={!field.isActive}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          ลบ
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'แก้ไข Field' : 'เพิ่ม Field ใหม่'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <h3 className="font-medium text-gray-800 border-b pb-2">ข้อมูลพื้นฐาน</h3>
              
              <div className="space-y-2">
                <Label htmlFor="fieldType">ประเภทฟิลด์ *</Label>
                <Select
                  id="fieldType"
                  value={form.fieldType}
                  onChange={(e) => setForm({ ...form, fieldType: e.target.value as FieldType })}
                  required
                >
                  {FIELD_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="labelTh">คำถาม/ชื่อฟิลด์ (ภาษาไทย) *</Label>
                <Input
                  id="labelTh"
                  value={form.labelTh}
                  onChange={(e) => setForm({ ...form, labelTh: e.target.value })}
                  required
                  placeholder="เช่น อีเมล, เบอร์โทรศัพท์"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="section">หมวดหมู่ (Section)</Label>
                  <Select
                    id="section"
                    value={form.section}
                    onChange={(e) => setForm({ ...form, section: e.target.value })}
                  >
                    <option value="">-- ไม่ระบุ --</option>
                    {SECTION_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pdfMappingKey">PDF Mapping Key</Label>
                  <Input
                    id="pdfMappingKey"
                    value={form.pdfMappingKey}
                    onChange={(e) => setForm({ ...form, pdfMappingKey: e.target.value })}
                    placeholder="เช่น email, phone"
                  />
                </div>
              </div>
            </div>

            {/* Options for DROPDOWN/RADIO */}
            {(form.fieldType === 'DROPDOWN' || form.fieldType === 'RADIO') && (
              <div className="space-y-4">
                <h3 className="font-medium text-gray-800 border-b pb-2">ตัวเลือก</h3>
                <div className="space-y-2">
                  <Label htmlFor="defaultOptions">รายการตัวเลือก (หนึ่งบรรทัดต่อหนึ่งตัวเลือก)</Label>
                  <Textarea
                    id="defaultOptions"
                    rows={4}
                    value={form.defaultOptionsText}
                    onChange={(e) => setForm({ ...form, defaultOptionsText: e.target.value })}
                    placeholder={'ตัวเลือก 1\nตัวเลือก 2\nตัวเลือก 3'}
                  />
                </div>
              </div>
            )}

            {/* Source selection for MASTER_DATA type */}
            {form.fieldType === 'MASTER_DATA' && (
              <div className="space-y-4">
                <h3 className="font-medium text-gray-800 border-b pb-2">แหล่งข้อมูลหลัก</h3>
                <div className="space-y-2">
                  <Label htmlFor="masterDataSource">แหล่งข้อมูล *</Label>
                  <Select
                    id="masterDataSource"
                    value={form.masterDataSource}
                    onChange={(e) =>
                      setForm({ ...form, masterDataSource: e.target.value as MasterDataSource })
                    }
                    required
                  >
                    {MASTER_DATA_SOURCE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </Select>
                  <p className="text-xs text-gray-500">
                    ผู้สมัครจะเห็นเป็นช่องค้นหา (Searchable Dropdown) ในแบบฟอร์มสาธารณะ
                    และค่าที่เลือกจะถูกบันทึกเป็น &#123; id, name &#125; โดยอัตโนมัติ
                  </p>
                </div>
              </div>
            )}

            {/* File Config for FILE type */}
            {form.fieldType === 'FILE' && (
              <div className="space-y-4">
                <h3 className="font-medium text-gray-800 border-b pb-2">การตั้งค่าไฟล์</h3>
                
                <div className="space-y-2">
                  <Label>ประเภทไฟล์ที่อนุญาต</Label>
                  <div className="flex flex-wrap gap-3">
                    {FILE_TYPE_OPTIONS.map((opt) => (
                      <label key={opt.value} className="flex items-center gap-2 cursor-pointer bg-gray-50 px-3 py-2 rounded border hover:bg-gray-100">
                        <Checkbox
                          checked={form.fileConfig.allowedFileTypes?.includes(opt.value)}
                          onChange={(e) => {
                            const current = form.fileConfig.allowedFileTypes || [];
                            const newTypes = e.target.checked
                              ? [...current, opt.value]
                              : current.filter(t => t !== opt.value);
                            updateFileConfig({ allowedFileTypes: newTypes.length > 0 ? newTypes : ['pdf'] });
                          }}
                        />
                        <span className="text-sm">{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="maxFiles">จำนวนไฟล์สูงสุด</Label>
                    <Input
                      id="maxFiles"
                      type="number"
                      min={1}
                      max={10}
                      value={form.fileConfig.maxFiles || 1}
                      onChange={(e) => updateFileConfig({ maxFiles: parseInt(e.target.value) || 1 })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maxSizeMB">ขนาดไฟล์สูงสุด (MB)</Label>
                    <Input
                      id="maxSizeMB"
                      type="number"
                      min={1}
                      max={50}
                      value={form.fileConfig.maxSizeMB || 10}
                      onChange={(e) => updateFileConfig({ maxSizeMB: parseInt(e.target.value) || 10 })}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Help & Placeholder */}
            <div className="space-y-4">
              <h3 className="font-medium text-gray-800 border-b pb-2">ข้อความช่วยเหลือ</h3>
              
              <div className="space-y-2">
                <Label htmlFor="helpText">ข้อความอธิบาย (Help Text)</Label>
                <Input
                  id="helpText"
                  value={form.helpText}
                  onChange={(e) => setForm({ ...form, helpText: e.target.value })}
                  placeholder="เช่น ตัวอย่าง 7 ปี 7 เดือน"
                />
                <p className="text-xs text-gray-500">แสดงใต้ชื่อฟิลด์เพื่ออธิบายเพิ่มเติม</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="placeholder">ข้อความ Placeholder</Label>
                <Input
                  id="placeholder"
                  value={form.placeholder}
                  onChange={(e) => setForm({ ...form, placeholder: e.target.value })}
                  placeholder="เช่น 080-1234567"
                />
                <p className="text-xs text-gray-500">แสดงในช่องกรอกข้อมูลก่อนกรอก</p>
              </div>
            </div>

            {/* Validation Section */}
            <div className="space-y-4">
              <h3 className="font-medium text-gray-800 border-b pb-2">การตรวจสอบข้อมูล</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="validationType">ประเภทการตรวจสอบ</Label>
                  <Select
                    id="validationType"
                    value={form.validationType}
                    onChange={(e) => setForm({ ...form, validationType: e.target.value as ValidationType })}
                  >
                    {VALIDATION_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                        {opt.example ? ` (${opt.example})` : ''}
                      </option>
                    ))}
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="validationMessage">ข้อความแจ้งเตือน</Label>
                  <Input
                    id="validationMessage"
                    value={form.validationMessage}
                    onChange={(e) => setForm({ ...form, validationMessage: e.target.value })}
                    placeholder={form.validationType === 'NONE' ? '' : 'รูปแบบไม่ถูกต้อง'}
                    disabled={form.validationType === 'NONE'}
                  />
                  {form.validationType !== 'NONE' && !form.validationMessage && (
                    <p className="text-xs text-gray-500">
                      ค่าเริ่มต้น: {VALIDATION_TYPE_OPTIONS.find(v => v.value === form.validationType)?.example}
                    </p>
                  )}
                </div>
              </div>

              {form.validationType === 'REGEX' && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-sm text-yellow-800">
                    <strong>หมายเหตุ:</strong> สำหรับ RegEx กำหนดเอง กรุณาระบุ Pattern ในช่องข้อความแจ้งเตือน
                    (เช่น ต้องขึ้นต้นด้วยตัวอักษรไทยหรืออังกฤษ)
                  </p>
                </div>
              )}
            </div>

            {/* Status */}
            <div className="space-y-4">
              <h3 className="font-medium text-gray-800 border-b pb-2">สถานะ</h3>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="isActive"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                <Label htmlFor="isActive" className="cursor-pointer">ใช้งาน (Active)</Label>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                ยกเลิก
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    กำลังบันทึก...
                  </span>
                ) : 'บันทึก'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Field Delete Impact Modal */}
      <Dialog open={impactModalOpen} onOpenChange={setImpactModalOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>ผลกระทบจากการลบ Field</DialogTitle>
          </DialogHeader>
          
          {impactLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-2 text-gray-500">
                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>กำลังตรวจสอบ...</span>
              </div>
            </div>
          ) : impactData ? (
            <div className="space-y-4">
              {/* Field Info */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="font-medium text-blue-800">Field: {impactData.fieldName}</p>
                <p className="text-sm text-blue-600 mt-1">
                  {impactData.isActive ? 'สถานะ: ใช้งาน' : 'สถานะ: ปิดใช้งาน'}
                </p>
              </div>

              {impactData.canDelete ? (
                /* สามารถลบได้ */
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-green-800">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="font-medium">สามารถลบได้ทันที</span>
                  </div>
                  <p className="text-sm text-green-700 mt-2">{impactData.message}</p>
                  <p className="text-xs text-green-600 mt-1">
                    Field นี้ไม่ถูกใช้งานใน template ใดๆ ระบบจะตั้งค่าเป็น "ปิดใช้งาน" (Soft Delete)
                  </p>
                </div>
              ) : (
                /* ไม่สามารถลบได้ */
                <div className="space-y-4">
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-amber-800">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span className="font-medium">ไม่สามารถลบได้โดยตรง</span>
                    </div>
                    <p className="text-sm text-amber-700 mt-2">{impactData.message}</p>
                  </div>

                  {/* Usage Summary */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-slate-50 border rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-slate-800">{impactData.usage.templateCount}</p>
                      <p className="text-xs text-slate-500">Templates</p>
                    </div>
                    <div className="bg-slate-50 border rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-slate-800">{impactData.usage.versionCount}</p>
                      <p className="text-xs text-slate-500">Versions</p>
                    </div>
                    <div className="bg-slate-50 border rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-slate-800">{impactData.usage.roundCount}</p>
                      <p className="text-xs text-slate-500">Rounds</p>
                    </div>
                  </div>

                  {/* Templates List */}
                  {impactData.usage.templates.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm text-gray-700">Templates ที่ใช้ Field นี้:</h4>
                      <div className="space-y-1">
                        {impactData.usage.templates.map((t: any) => (
                          <div key={t.id} className="flex items-center gap-2 text-sm bg-gray-50 p-2 rounded">
                            <span className="text-gray-600">📄</span>
                            <span>{t.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Versions List */}
                  {impactData.usage.versions.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm text-gray-700">Versions ที่ใช้ Field นี้:</h4>
                      <div className="space-y-1">
                        {impactData.usage.versions.map((v: any) => (
                          <div key={v.id} className="flex items-center justify-between text-sm bg-gray-50 p-2 rounded">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-600">📋</span>
                              <span>{v.templateName}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={v.status === 'PUBLISHED' ? 'default' : 'secondary'} className="text-xs">
                                v{v.versionNumber} ({v.status})
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Rounds List */}
                  {impactData.usage.rounds.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm text-gray-700">Rounds ที่ใช้ Field นี้:</h4>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {impactData.usage.rounds.map((r: any) => (
                          <div key={r.id} className="flex items-center justify-between text-sm bg-gray-50 p-2 rounded">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-600">📌</span>
                              <span>{r.title}</span>
                            </div>
                            <Badge variant={r.status === 'ACTIVE' ? 'default' : 'secondary'} className="text-xs">
                              {r.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Alternative: Deactivate */}
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <p className="text-sm text-gray-700">
                      <strong>ทางเลือก:</strong> หากต้องการให้ Field นี้ไม่ปรากฏใน Form Builder ใหม่ 
                      สามารถตั้งค่าเป็น "ปิดใช้งาน" แทนการลบ
                    </p>
                    <p className="text-xs text-gray-500 mt-2">
                      Field ที่ถูกปิดใช้งานจะถูกซ่อนจาก Form Builder แต่ข้อมูลใน Rounds และ Applications ที่มีอยู่จะไม่ได้รับผลกระทบ
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : null}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setImpactModalOpen(false);
              setConfirmDelete(null);
            }}>
              ปิด
            </Button>
            {impactData?.canDelete && (
              <Button 
                variant="destructive" 
                onClick={handleDelete}
                disabled={submitting}
              >
                {submitting ? 'กำลังลบ...' : 'ตกลง ลบ (Soft Delete)'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
