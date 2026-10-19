'use client';

/**
 * FieldPicker
 * --------------------------------
 * Document Composer V1 — Field Picker Modal
 *
 * Modal เลือก field จาก Template Version's Field Library
 * ใช้เมื่อผู้ใช้กด +Field หรือ +Table
 *
 * ใช้ข้อมูลจาก useTemplateFields() — endpoint เดิม
 */

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { TemplateFieldLibraryItem } from '../hooks/useTemplateFields';

export interface FieldPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (field: TemplateFieldLibraryItem) => void;
  fields: TemplateFieldLibraryItem[];
  loading?: boolean;
  /** "field" → เลือกได้ทุก type / "table" → แนะนำ MASTER_DATA */
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter(
      (f) =>
        f.labelTh.toLowerCase().includes(q) ||
        f.fieldId.toLowerCase().includes(q) ||
        (f.fieldType || '').toLowerCase().includes(q)
    );
  }, [fields, search]);

  if (!open) return null;

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
              {mode === 'table' ? 'เลือก Field สำหรับ Table' : 'เลือก Field'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {mode === 'table'
                ? 'แนะนำ field type MASTER_DATA (table-like)'
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
          ) : filtered.length === 0 ? (
            <div className="text-center text-slate-400 text-sm py-8">
              {fields.length === 0
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
                    className="w-full text-left px-3 py-2 rounded border border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-900 truncate">
                        {f.labelTh}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                        {f.fieldType && (
                          <span className="text-slate-600">{f.fieldType}</span>
                        )}
                        {f.isRequired && (
                          <span className="text-red-600 font-medium">required</span>
                        )}
                      </div>
                    </div>
                    <span className="text-blue-600 text-xs shrink-0">เลือก →</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t flex items-center justify-between text-[11px] text-slate-500">
          <span>
            แสดง {filtered.length} จาก {fields.length} field(s)
          </span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ยกเลิก
          </Button>
        </div>
      </div>
    </div>
  );
}