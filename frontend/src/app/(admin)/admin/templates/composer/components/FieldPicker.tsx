'use client';

/**
 * FieldPicker
 * --------------------------------
 * Document Composer — Field Picker Modal
 *
 * ใช้เมื่อผู้ใช้กด +Field หรือ +Table
 * ใช้ข้อมูลจาก useTemplateFields() — endpoint เดิม
 *
 * ── Table mode (Requirement G) ────────────────────────────────────────────
 * กรองด้วย `field-capabilities` ซึ่งเป็น **single source of truth**
 * (mirror ของ backend `field-capabilities.ts`) เพื่อให้ Table Picker
 * เสนอเฉพาะ field ที่ renderer วาดเป็นตารางได้จริง
 *
 *   แสดง  : REPEATER / TABLE (isRepeatable === true, valueShape === "array")
 *   ไม่แสดง:
 *     - scalar fields (TEXT / EMAIL / PHONE / NUMBER / DATE / FILE / CHECKBOX)
 *     - TEXTAREA / DROPDOWN / RADIO แบบค่าเดียว
 *     - MASTER_DATA แบบ single-select เช่น "สังกัดปัจจุบัน" (object `{id,name}`)
 *
 *   → ถ้าไม่มี field ที่เข้าเกณฑ์เลย แสดง:
 *     "Template Version นี้ยังไม่มีฟิลด์แบบหลายรายการ"
 *
 *   → ห้ามทำให้ MASTER_DATA ค่าเดียวกลายเป็น Table (Requirement F)
 */

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  getFieldCapability,
} from '@/lib/document-composer/field-capabilities';
import type { TemplateFieldLibraryItem } from '../hooks/useTemplateFields';

/** ข้อความ empty state ของ Table Picker (Requirement G) */
export const NO_REPEATABLE_FIELDS_MESSAGE =
  'Template Version นี้ยังไม่มีฟิลด์แบบหลายรายการ';

export interface FieldPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (field: TemplateFieldLibraryItem) => void;
  fields: TemplateFieldLibraryItem[];
  loading?: boolean;
  /** "field" → เลือกได้ทุก type / "table" → เฉพาะ repeatable จริง */
  mode?: 'field' | 'table';
}

export function FieldPicker({
  open,
  onClose,
  onSelect,
  fields,
  loading,
  mode = 'field',
}: FieldPickerProps) {
  const [search, setSearch] = useState('');

  /**
   * Table mode: กรองด้วย field-capabilities ก่อนเสมอ
   * (single source of truth — ห้าม hardcode รายชื่อ type ซ้ำที่นี่)
   */
  const eligible = useMemo(() => {
    if (mode !== 'table') return fields;
    return fields.filter((f) => getFieldCapability(f.fieldType).isRepeatable);
  }, [fields, mode]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return eligible;
    return eligible.filter(
      (f) =>
        f.labelTh.toLowerCase().includes(q) ||
        f.fieldId.toLowerCase().includes(q) ||
        (f.fieldType || '').toLowerCase().includes(q)
    );
  }, [eligible, search]);

  if (!open) return null;

  const isTableMode = mode === 'table';
  const noRepeatableAtAll = isTableMode && !loading && eligible.length === 0;

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {isTableMode ? 'เลือก Field สำหรับ Table' : 'เลือก Field'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isTableMode
                ? 'แสดงเฉพาะฟิลด์ที่เก็บค่าเป็นหลายรายการจริง (REPEATER / TABLE)'
                : 'Field ทั้งหมดจาก Template Version นี้'}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0"
            aria-label="Close"
          >
            ✕
          </Button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b">
          <Label className="text-xs text-slate-600 mb-1 block">ค้นหา</Label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="พิมพ์ชื่อ field เพื่อค้นหา..."
            className="h-9"
            autoFocus
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-auto px-5 py-3">
          {loading ? (
            <div className="text-center text-slate-500 text-sm py-8">
              กำลังโหลด Field Library...
            </div>
          ) : noRepeatableAtAll ? (
            /* ── Empty state ตาม Requirement G ────────────────── */
            <div className="text-center py-10 px-4">
              <div className="text-3xl mb-2">📊</div>
              <p className="text-sm font-medium text-slate-700">
                {NO_REPEATABLE_FIELDS_MESSAGE}
              </p>
              <p className="text-xs text-slate-500 mt-2 max-w-sm mx-auto leading-relaxed">
                Table Block ใช้ได้เฉพาะฟิลด์ที่ผู้สมัครกรอกได้หลายแถว
                เช่น ประวัติการทำงาน หรือ ประวัติการศึกษา
                <br />
                ฟิลด์แบบค่าเดียว (เช่น &quot;สังกัดปัจจุบัน&quot;) ให้ใช้ปุ่ม{' '}
                <strong>+Field</strong> แทน
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-slate-400 text-sm py-8">
              {eligible.length === 0
                ? 'Template Version นี้ยังไม่มี Field — กลับไปเพิ่ม Field ใน Template Builder'
                : 'ไม่พบ Field ที่ตรงกับคำค้น'}
            </div>
          ) : (
            <ul className="space-y-1">
              {filtered.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(f);
                      onClose();
                    }}
                    className={`w-full text-left px-3 py-2 rounded border transition-colors flex items-center justify-between gap-3 ${
                      isTableMode
                        ? 'border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50'
                        : 'border-slate-200 hover:border-blue-400 hover:bg-blue-50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-900 truncate">
                        {f.labelTh}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                        <span className="text-slate-600">
                          {f.fieldType || 'ไม่ระบุประเภท'}
                        </span>
                        {f.isRequired && (
                          <span className="text-red-600 font-medium">required</span>
                        )}
                        {isTableMode && (
                          <span className="text-emerald-700 font-medium">
                            · หลายรายการ
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={`text-xs shrink-0 ${
                        isTableMode ? 'text-emerald-600' : 'text-blue-600'
                      }`}
                    >
                      เลือก →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t flex items-center justify-between text-[11px] text-slate-500">
          <span>
            แสดง {filtered.length} จาก{' '}
            {isTableMode ? eligible.length : fields.length} field(s)
            {isTableMode && fields.length > eligible.length && (
              <span className="text-slate-400">
                {' '}
                (กรองออก {fields.length - eligible.length} ฟิลด์แบบค่าเดียว)
              </span>
            )}
          </span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ยกเลิก
          </Button>
        </div>
      </div>
    </div>
  );
}