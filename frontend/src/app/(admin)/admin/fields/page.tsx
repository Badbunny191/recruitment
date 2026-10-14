'use client';

import { useState, useEffect, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { SearchInput } from '@/components/ui/search-input';
import { SortDropdown } from '@/components/ui/sort-dropdown';
import { Pagination } from '@/components/ui/pagination';
import { ActionMenu } from '@/components/ui/action-menu';
import { NoDataEmptyState, NoResultsEmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

type FieldType = 'TEXT' | 'TEXTAREA' | 'DROPDOWN' | 'RADIO' | 'FILE' | 'NUMBER' | 'CHECKBOX' | 'DATE' | 'MASTER_DATA';
type ValidationType = 'NONE' | 'EMAIL' | 'PHONE' | 'NUMBER' | 'URL' | 'CITIZEN_ID' | 'REGEX';
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

// Phase 1: Auto-generate PDF Mapping Key from Thai label
// Examples: "ชื่อ-นามสกุล" → "full_name", "อีเมล" → "email", "เบอร์โทรศัพท์" → "phone"
const generatePdfMappingKey = (label: string): string => {
  if (!label) return '';
  const trimmed = label.trim().toLowerCase();

  // Common Thai → English mappings for HR fields
  const commonMappings: Record<string, string> = {
    'อีเมล': 'email',
    'อีเมล์': 'email',
    'email': 'email',
    'เบอร์โทรศัพท์': 'phone',
    'เบอร์โทร': 'phone',
    'โทรศัพท์': 'phone',
    'phone': 'phone',
    'tel': 'phone',
    'ชื่อ-นามสกุล': 'full_name',
    'ชื่อ นามสกุล': 'full_name',
    'ชื่อนามสกุล': 'full_name',
    'ชื่อ-สกุล': 'full_name',
    'full name': 'full_name',
    'fullname': 'full_name',
    'name': 'full_name',
    'ชื่อ': 'first_name',
    'first name': 'first_name',
    'firstname': 'first_name',
    'นามสกุล': 'last_name',
    'last name': 'last_name',
    'lastname': 'last_name',
    'เลขบัตรประชาชน': 'citizen_id',
    'เลขประจำตัวประชาชน': 'citizen_id',
    'citizen id': 'citizen_id',
    'national id': 'citizen_id',
    'ที่อยู่': 'address',
    'address': 'address',
    'วันเกิด': 'birthdate',
    'วันที่เกิด': 'birthdate',
    'birthdate': 'birthdate',
    'birth date': 'birthdate',
    'อายุ': 'age',
    'age': 'age',
    'เพศ': 'gender',
    'gender': 'gender',
    'ตำแหน่ง': 'position',
    'position': 'position',
    'หน่วยงาน': 'organization',
    'organization': 'organization',
    'องค์กร': 'organization',
  };

  if (commonMappings[trimmed]) {
    return commonMappings[trimmed];
  }

  // Generic: transliterate basic Thai consonants + slugify
  // For unknown Thai text, just slugify what we can
  const slug = trimmed
    .replace(/[^\w\sก-๙]/g, '') // keep word chars + Thai
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  return slug || trimmed.replace(/\s+/g, '_');
};

// ============================================
// DESIGN SYSTEM - Smart Family Style (คัดลอกจาก Recruitment Rounds)
// ============================================
const CARD_STYLE = {
  container: 'bg-white rounded-xl border border-slate-200 shadow-sm',
  header: 'px-4 py-3 border-b border-slate-100',
  body: 'px-4 py-3',
};

// ============================================
// SUB-COMPONENTS
// ============================================

/** KPI Card - Smart Family Style (คัดลอกจาก Recruitment Rounds) */
function KpiCard({
  icon,
  value,
  label,
  variant = 'default'
}: {
  icon: string;
  value: number | string;
  label: string;
  variant?: 'default' | 'success' | 'muted';
}) {
  const valueColor = {
    default: 'text-slate-900',
    success: 'text-emerald-600',
    muted: 'text-slate-500',
  }[variant];

  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm px-6 py-5 flex items-center gap-4">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl shrink-0">
        {icon}
      </div>
      <div className="flex flex-col">
        <span className={cn("text-3xl font-bold tabular-nums leading-none", valueColor)}>{value}</span>
        <span className="text-sm text-slate-500 mt-1.5">{label}</span>
      </div>
    </div>
  );
}

/** Filter Pill - Ultra Compact (คัดลอกจาก Recruitment Rounds) */
function FilterPill({
  label,
  isActive,
  onClick,
  count,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap",
        isActive
          ? "bg-slate-900 text-white"
          : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
      )}
    >
      {label}
      {count !== undefined && (
        <span className={cn(
          "text-[10px] px-1 rounded min-w-[16px] text-center leading-none",
          isActive ? "bg-white/20" : "bg-slate-100 text-slate-600"
        )}>
          {count}
        </span>
      )}
    </button>
  );
}

// ============================================
// MAIN PAGE
// ============================================

export default function FieldMasterPage() {
  const [fields, setFields] = useState<FieldMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FieldMaster | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FieldMaster | null>(null);
  // Phase 1: Track if user has manually edited pdfMappingKey (to enable auto-generate)
  const [pdfMappingKeyTouched, setPdfMappingKeyTouched] = useState(false);

  // View filter: all | active | inactive
  const [view, setView] = useState<'all' | 'active' | 'inactive'>('all');

  // Search & Sort state
  const [search, setSearch] = useState('');
  const [sortId, setSortId] = useState<string>('labelTh-asc');
  const [sortField, setSortField] = useState<string>('labelTh');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);

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

  useEffect(() => {
    setCurrentPage(1);
  }, [view, search, sortId]);

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
    setPdfMappingKeyTouched(false);
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
    setPdfMappingKeyTouched(!!f.pdfMappingKey);
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
        defaultOptions:
          form.fieldType === 'MASTER_DATA'
            ? { source: form.masterDataSource }
            : parseOptions(form.defaultOptionsText),
        pdfMappingKey: form.pdfMappingKey || null,
        isActive: form.isActive,
      };

      // UI fields - always send (null if empty to clear DB)
      payload.section = form.section || null;
      payload.helpText = form.helpText.trim() || null;
      payload.placeholder = form.placeholder.trim() || null;

      // Validation fields - always send
      payload.validationType = form.validationType === 'NONE' ? null : form.validationType;
      payload.validationMessage = form.validationMessage.trim() || null;

      // File config - send if FILE type, else null
      if (form.fieldType === 'FILE') {
        payload.fileConfig = {
          allowedFileTypes: form.fileConfig.allowedFileTypes || ['pdf'],
          maxFiles: form.fileConfig.maxFiles || 1,
          maxSizeMB: form.fileConfig.maxSizeMB || 10,
        };
      } else {
        payload.fileConfig = null;
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
      TEXT: 'bg-blue-100 text-blue-700 border-blue-200',
      TEXTAREA: 'bg-blue-100 text-blue-700 border-blue-200',
      NUMBER: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      DATE: 'bg-purple-100 text-purple-700 border-purple-200',
      DROPDOWN: 'bg-amber-100 text-amber-700 border-amber-200',
      RADIO: 'bg-orange-100 text-orange-700 border-orange-200',
      CHECKBOX: 'bg-teal-100 text-teal-700 border-teal-200',
      FILE: 'bg-pink-100 text-pink-700 border-pink-200',
      MASTER_DATA: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    };
    return colors[type] || 'bg-slate-100 text-slate-600 border-slate-200';
  };

  // Sort options
  const sortOptions = [
    { id: 'labelTh-asc', field: 'labelTh', label: 'ชื่อ A-Z', direction: 'asc' as const },
    { id: 'labelTh-desc', field: 'labelTh', label: 'ชื่อ Z-A', direction: 'desc' as const },
    { id: 'fieldType-asc', field: 'fieldType', label: 'ประเภท A-Z', direction: 'asc' as const },
    { id: 'fieldType-desc', field: 'fieldType', label: 'ประเภท Z-A', direction: 'desc' as const },
  ];

  // Filter & Sort & Paginate
  // หมายเหตุ: KPI คำนวณจาก `fields` (System State - ข้อมูลทั้งหมด) — ไม่ถูกกระทบโดย filter
  // แต่ Table คำนวณจาก `filteredAndSortedFields` (ผ่าน filter/sort แล้ว)
  const filteredAndSortedFields = useMemo(() => {
    let result = [...fields];

    // View filter (ทำฝั่ง client — ไม่กระทบ KPI เพราะ KPI ใช้ `fields` ทั้งหมด)
    if (view === 'active') {
      result = result.filter(f => f.isActive);
    } else if (view === 'inactive') {
      result = result.filter(f => !f.isActive);
    }

    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter(f =>
        f.labelTh.toLowerCase().includes(s) ||
        f.fieldType.toLowerCase().includes(s) ||
        (f.section?.toLowerCase().includes(s))
      );
    }

    result.sort((a, b) => {
      let aVal: any, bVal: any;
      if (sortField === 'labelTh') {
        aVal = a.labelTh.toLowerCase();
        bVal = b.labelTh.toLowerCase();
      } else if (sortField === 'fieldType') {
        aVal = a.fieldType.toLowerCase();
        bVal = b.fieldType.toLowerCase();
      } else {
        return 0;
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [fields, view, search, sortField, sortDirection]);

  const totalItems = filteredAndSortedFields.length;
  const paginatedFields = filteredAndSortedFields.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const totalFields = fields.length;
  const activeFields = fields.filter(f => f.isActive).length;
  const inactiveFields = fields.filter(f => !f.isActive).length;

  const viewCounts = {
    all: totalFields,
    active: activeFields,
    inactive: inactiveFields,
  };

  return (
    <div className="p-4 md:p-6 space-y-3">
      {/* ============================================ */}
      {/* 1. PAGE HEADER */}
      {/* ============================================ */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🧩</span>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">คลังฟิลด์ (Field Library)</h1>
            <p className="text-[11px] text-slate-500">จัดการฟิลด์ที่ใช้ซ้ำได้ในแบบฟอร์มทั้งหมดในระบบ</p>
          </div>
        </div>
        <Button onClick={openCreate} size="sm" className="h-8">
          + เพิ่ม Field ใหม่
        </Button>
      </div>

      {/* ============================================ */}
      {/* 2. KPI CARDS - Ultra Compact */}
      {/* ============================================ */}
      <div className="grid grid-cols-3 gap-2">
        <KpiCard icon="📊" value={totalFields} label="ทั้งหมด" />
        <KpiCard icon="✅" value={activeFields} label="ใช้งานอยู่" variant="success" />
        <KpiCard icon="⏸" value={inactiveFields} label="ปิดใช้งาน" variant="muted" />
      </div>

      {/* ============================================ */}
      {/* 3. CONTENT CARD - Smart Family Style */}
      {/* ============================================ */}
      <div className={cn(CARD_STYLE.container, "overflow-hidden")}>
        {/* 3.1 UNIFIED TOOLBAR */}
        <div className={cn(CARD_STYLE.header, "flex flex-col gap-2")}>
          {/* Row 1: Search + Sort */}
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="ค้นหาชื่อฟิลด์, ประเภท, section..."
                resultCount={totalItems}
                resultLabel="รายการ"
                size="sm"
                hideResultCount
              />
            </div>
            <SortDropdown
              value={sortId}
              onChange={(id, field, direction) => {
                setSortId(id);
                setSortField(field);
                if (direction) setSortDirection(direction);
              }}
              options={sortOptions}
              size="sm"
            />
          </div>

          {/* Row 2: Filter Pills + Result Count */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <FilterPill label="ทั้งหมด" isActive={view === 'all'} onClick={() => setView('all')} count={viewCounts.all} />
              <FilterPill label="ใช้งานอยู่" isActive={view === 'active'} onClick={() => setView('active')} count={viewCounts.active} />
              <FilterPill label="ปิดใช้งาน" isActive={view === 'inactive'} onClick={() => setView('inactive')} count={viewCounts.inactive} />
            </div>
            <span className="text-[11px] text-slate-500 whitespace-nowrap">
              {search.trim() ? `พบทั้งหมด ${totalItems} รายการ` : `ทั้งหมด ${totalItems} รายการ`}
            </span>
          </div>
        </div>

        {/* 3.2 TABLE */}
        <div className="overflow-x-auto">
          <Table className="w-full table-fixed">
            <TableHeader>
              <TableRow className="bg-slate-50/50 hover:bg-slate-50/50">
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 w-[30%]">ชื่อฟิลด์</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 hidden sm:table-cell w-[12%]">ประเภท</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 hidden md:table-cell w-[15%]">Validation</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 hidden lg:table-cell w-[18%]">Section</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 w-[10%]">สถานะ</TableHead>
                <TableHead className="h-10 text-[11px] font-medium text-slate-600 text-right w-[5%]">จัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <div className="flex items-center justify-center gap-2 text-slate-500">
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span className="text-xs">กำลังโหลด...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filteredAndSortedFields.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-0">
                    {/* ถ้ามี search หรือ filter (ที่ไม่ใช่ all) → ไม่พบผลลัพธ์ */}
                    {search || view !== 'all' ? (
                      <NoResultsEmptyState
                        keyword={search}
                        onClearFilters={() => {
                          setSearch('');
                          setView('all');
                        }}
                      />
                    ) : (
                      <NoDataEmptyState
                        title="ยังไม่มี Field"
                        description="เริ่มต้นโดยการเพิ่ม Field ใหม่"
                        action={{ label: '+ เพิ่ม Field ใหม่', onClick: openCreate, variant: 'primary' }}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                paginatedFields.map((field) => (
                  <TableRow key={field.id} className="group">
                    {/* Label (TH) */}
                    <TableCell className="py-3 align-top">
                      <div className="flex flex-col gap-1 min-w-0">
                        <div
                          className="font-medium text-sm text-slate-900 leading-snug line-clamp-2"
                          title={field.labelTh}
                        >
                          {field.labelTh}
                        </div>
                        {field.helpText && (
                          <div className="text-[11px] text-slate-500 line-clamp-1" title={field.helpText}>
                            {field.helpText}
                          </div>
                        )}
                      </div>
                    </TableCell>

                    {/* Type */}
                    <TableCell className="py-3 hidden sm:table-cell align-top">
                      <div className="flex flex-col gap-1">
                        <span className={cn(
                          "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border w-fit",
                          getTypeBadgeColor(field.fieldType)
                        )}>
                          {field.fieldType}
                        </span>
                        {field.fieldType === 'FILE' && field.fileConfig && (
                          <span className="text-[10px] text-slate-500">
                            {typeof field.fileConfig === 'object'
                              ? `${field.fileConfig.maxFiles || 1} ไฟล์ • ${field.fileConfig.maxSizeMB || 10}MB`
                              : 'ตั้งค่าแล้ว'}
                          </span>
                        )}
                      </div>
                    </TableCell>

                    {/* Validation */}
                    <TableCell className="py-3 text-xs text-slate-500 hidden md:table-cell align-top">
                      {field.validationType && field.validationType !== 'NONE' ? (
                        <span className="text-orange-600 text-[11px] font-medium">
                          {VALIDATION_TYPE_OPTIONS.find(v => v.value === field.validationType)?.label}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </TableCell>

                    {/* Section */}
                    <TableCell className="py-3 text-xs text-slate-500 hidden lg:table-cell align-top">
                      {field.section ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border bg-slate-50 text-slate-700 border-slate-200">
                          {field.section}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </TableCell>

                    {/* Status */}
                    <TableCell className="py-3 align-top">
                      <span className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap",
                        field.isActive
                          ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                          : "bg-slate-100 text-slate-600 border-slate-200"
                      )}>
                        {field.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}
                      </span>
                    </TableCell>

                    {/* Actions - ⋮ only */}
                    <TableCell className="py-3 text-right align-top">
                      <ActionMenu
                        size="sm"
                        items={[
                          { label: '✏️ แก้ไข', onClick: () => openEdit(field) },
                          ...(field.isActive
                            ? [{ label: '🗑 ลบ (Soft Delete)', type: 'danger' as const, onClick: () => handleDeleteClick(field) }]
                            : []
                          ),
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* 3.3 PAGINATION */}
        <div className={cn(CARD_STYLE.header, "flex items-center justify-between")}>
          <span className="text-[11px] text-slate-500">
            {search.trim() ? `พบ ${totalItems} รายการ` : `แสดง ${paginatedFields.length} จาก ${totalItems}`}
          </span>
          <Pagination
            currentPage={currentPage}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            showPageSizeSelector={false}
            showResultCount={false}
          />
        </div>
      </div>

      {/* ============================================ */}
      {/* 4. FORM DIALOG */}
      {/* ============================================ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? '✏️ แก้ไข Field' : '➕ เพิ่ม Field ใหม่'}</DialogTitle>
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
                  onChange={(e) => {
                    const newLabel = e.target.value;
                    // Phase 1: Auto-generate PDF Mapping Key if user hasn't manually edited it
                    const updates: Partial<FormState> = { labelTh: newLabel };
                    if (!pdfMappingKeyTouched) {
                      updates.pdfMappingKey = generatePdfMappingKey(newLabel);
                    }
                    setForm({ ...form, ...updates });
                  }}
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

            {/* Phase 1: Advanced Settings (collapsed by default) — Phase 2 moved PDF Mapping Key here */}
            <details className="border border-slate-200 rounded-lg">
              <summary className="px-4 py-2 cursor-pointer text-sm font-medium text-slate-700 hover:bg-slate-50 select-none">
                ▼ Advanced Settings
              </summary>
              <div className="p-4 space-y-4 border-t border-slate-200">
                <div className="space-y-2">
                  <Label htmlFor="pdfMappingKey">PDF Mapping Key</Label>
                  <Input
                    id="pdfMappingKey"
                    value={form.pdfMappingKey}
                    onChange={(e) => {
                      setPdfMappingKeyTouched(true);
                      setForm({ ...form, pdfMappingKey: e.target.value });
                    }}
                    placeholder="auto-generated from label"
                  />
                  <p className="text-xs text-gray-500">
                    ใช้สำหรับระบบ PDF Export — ระบบจะสร้างค่าเริ่มต้นจากชื่อฟิลด์ให้อัตโนมัติ (เช่น &quot;อีเมล&quot; → email, &quot;ชื่อ-นามสกุล&quot; → full_name)
                  </p>
                  {form.labelTh && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setForm({ ...form, pdfMappingKey: generatePdfMappingKey(form.labelTh) });
                        setPdfMappingKeyTouched(true);
                      }}
                    >
                      ✨ ใช้ค่าเริ่มต้นจากชื่อฟิลด์
                    </Button>
                  )}
                </div>
              </div>
            </details>

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
                              <span className={cn(
                                "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border",
                                v.status === 'PUBLISHED'
                                  ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                                  : "bg-amber-100 text-amber-700 border-amber-200"
                              )}>
                                v{v.versionNumber} ({v.status})
                              </span>
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
                            <span className={cn(
                              "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border",
                              r.status === 'ACTIVE'
                                ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                                : "bg-slate-100 text-slate-600 border-slate-200"
                            )}>
                              {r.status}
                            </span>
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
