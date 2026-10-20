'use client';

/**
 * SignatureEditor
 * ------------------------------------------------------------------
 * Editor สำหรับ Signature Block
 *
 * แก้ไขได้ครบ (Requirement C):
 *   - lineLabel        → ป้ายกำกับก่อนเส้นลงลายมือชื่อ (default: "ลงลายมือชื่อ")
 *   - roleLabel        → ป้ายกำกับบทบาท (default: "ผู้สมัคร")
 *   - lineStyle        → รูปแบบเส้นลงลายมือชื่อ (default: "..........")
 *   - dateLabel        → ป้ายกำกับก่อนวันที่ (default: "วันที่")
 *   - nameFieldId      → Application Field สำหรับชื่อ (เลือกจากรายการ)
 *   - dateSource       → APPLICATION_DATE | PRINT_DATE | none
 *   - showName         → แสดงชื่อในวงเล็บ
 *   - showDate         → แสดงวันที่
 *   - showParentheses  → แสดงวงเล็บรอบชื่อ
 *   - alignment        → ซ้าย | กลาง | ขวา
 *
 * ── nameFieldId ใช้ field ID เป็น stable mapping key ──────────────────────
 * เก็บเป็น `field_master.id` — **ห้าม**ผูกด้วย label ไทย
 * เพราะ label เปลี่ยนได้แต่ id ไม่เปลี่ยน (Requirement C.4)
 * ถ้าไม่กำหนด → fallback ไป `application.fullname` (พฤติกรรมเดิม)
 *
 * ── ไม่ใช่ช่องลายเซ็นดิจิทัล ───────────────────────────────────────────────
 * ห้ามสร้าง Application Field ชื่อ "ลายมือชื่อ" โดยอัตโนมัติ (Requirement C.2)
 */

import { Label } from '@/components/ui/label';
import {
  type SignatureBlock,
  type SignatureDateSource,
} from '@/lib/api/template-descriptor';
import { AlignRow, ToggleRow } from './HeadingEditor';
import type { TemplateFieldLibraryItem } from '../hooks/useTemplateFields';

export interface SignatureEditorProps {
  block: SignatureBlock;
  onChange: (patch: Partial<SignatureBlock>) => void;
  /** Application Fields ปัจจุบัน — ใช้เลือก nameFieldId */
  fields?: TemplateFieldLibraryItem[];
  fieldsLoading?: boolean;
  disabled?: boolean;
}

const DATE_SOURCES: Array<{
  value: SignatureDateSource;
  label: string;
  hint: string;
}> = [
  {
    value: 'APPLICATION_DATE',
    label: 'วันที่สมัคร',
    hint: 'จากวันที่ผู้สมัครส่งใบสมัคร (ค่าเริ่มต้น)',
  },
  {
    value: 'PRINT_DATE',
    label: 'วันที่พิมพ์',
    hint: 'จากเวลาที่ระบบสร้างเอกสาร',
  },
  {
    value: 'none',
    label: 'ไม่แสดงวันที่',
    hint: 'ไม่แสดงส่วนวันที่เลย',
  },
];

/**
 * Normalize `dateSource` — descriptor เก่าอาจเก็บค่า legacy `"application"`
 * ซึ่ง backend map เป็น APPLICATION_DATE
 */
export function normalizeDateSource(
  raw: SignatureBlock['dateSource']
): SignatureDateSource {
  return raw === 'PRINT_DATE' || raw === 'none' ? raw : 'APPLICATION_DATE';
}

export function SignatureEditor({
  block,
  onChange,
  fields = [],
  fieldsLoading,
  disabled,
}: SignatureEditorProps) {
  const dateSource = normalizeDateSource(block.dateSource);
  const showName = block.showName ?? true;
  const showDate = block.showDate ?? true;

  // field ที่เลือกไว้ (อาจถูกลบออกจาก version ไปแล้ว)
  const selectedField = fields.find((f) => f.fieldId === block.nameFieldId);
  const nameFieldMissing =
    !!block.nameFieldId && !selectedField && !fieldsLoading && fields.length > 0;

  return (
    <div className="space-y-2.5 p-3 bg-rose-50/50 rounded border border-rose-200">
      <p className="text-[10px] text-slate-600 leading-relaxed">
        Signature Block เป็นส่วนจัดหน้าสำหรับชื่อ / วันที่ / เส้นลงลายมือชื่อ
        <br />
        ไม่ใช่ช่องลายเซ็นดิจิทัล และไม่ใช่ช่องที่ผู้สมัครต้องกรอก
        ค่าทั้งหมดมาจาก Application อัตโนมัติ
      </p>

      {/* ── lineLabel + lineStyle ────────────────────────────────── */}
      <div className="space-y-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-slate-600">
            ป้ายกำกับเส้นลงลายมือชื่อ (lineLabel)
          </Label>
          <input
            type="text"
            value={block.lineLabel ?? ''}
            disabled={disabled}
            onChange={(e) =>
              onChange({ lineLabel: e.target.value || undefined })
            }
            placeholder="ลงลายมือชื่อ"
            className="flex h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 disabled:opacity-50"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] text-slate-600">
            รูปแบบเส้นลงลายมือชื่อ (lineStyle)
          </Label>
          <div className="flex gap-1">
            <input
              type="text"
              value={block.lineStyle ?? ''}
              disabled={disabled}
              onChange={(e) =>
                onChange({ lineStyle: e.target.value || undefined })
              }
              placeholder="........................................"
              className="flex h-8 flex-1 rounded-md border border-slate-300 bg-white px-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-rose-500 disabled:opacity-50"
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange({ lineStyle: '........................................' })}
              className="h-8 px-2 text-[11px] rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              title="รีเซ็ตเป็นเส้นประมาณ 40 จุด"
            >
              รีเซ็ต
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange({ lineStyle: '________________________' })}
              className="h-8 px-2 text-[11px] rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              title="ใช้ขีดล่างแทนจุด"
            >
              ขีด
            </button>
          </div>
        </div>
      </div>

      {/* ── roleLabel ───────────────────────────────────────────── */}
      <div className="space-y-1">
        <Label className="text-[10px] text-slate-600">
          ป้ายกำกับบทบาท (roleLabel)
        </Label>
        <input
          type="text"
          value={block.roleLabel ?? ''}
          disabled={disabled}
          onChange={(e) =>
            onChange({ roleLabel: e.target.value || undefined })
          }
          placeholder="ผู้สมัคร"
          className="flex h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 disabled:opacity-50"
        />
      </div>

      {/* ── nameFieldId ─────────────────────────────────────────── */}
      <div className="space-y-1">
        <Label className="text-[10px] text-slate-600">
          ฟิลด์ชื่อผู้สมัคร (nameFieldId)
        </Label>
        <select
          value={block.nameFieldId ?? ''}
          disabled={disabled || fieldsLoading}
          onChange={(e) =>
            onChange({ nameFieldId: e.target.value || undefined })
          }
          className="flex h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 disabled:opacity-50"
        >
          {/* ค่าเริ่มต้น: ไม่กำหนด → fallback ไปชื่อผู้สมัครจากใบสมัคร */}
          <option value="">
            ไม่กำหนด — ใช้ชื่อ-นามสกุลจากใบสมัคร (fallback เดิม)
          </option>
          {fields.map((f) => (
            <option key={f.id} value={f.fieldId}>
              {f.labelTh}
              {f.fieldType ? ` (${f.fieldType})` : ''}
            </option>
          ))}
        </select>

        <p className="text-[10px] text-slate-500 leading-relaxed">
          เก็บเป็น <strong>field ID</strong> (stable mapping key) ไม่ผูกกับชื่อฟิลด์
          → เปลี่ยนชื่อฟิลด์ทีหลังได้โดยไม่ทำให้เอกสารพัง
        </p>

        {nameFieldMissing && (
          <p className="text-[10px] text-amber-700 leading-relaxed">
            ⚠️ ฟิลด์ที่เลือกไม่อยู่ใน Template Version นี้แล้ว
            ระบบจะ fallback ไปใช้ชื่อผู้สมัครจากใบสมัครแทน
          </p>
        )}
      </div>

      {/* ── Visibility toggles ──────────────────────────────────── */}
      <div className="space-y-1">
        <Label className="text-[10px] text-slate-600">การแสดงผล</Label>
        <div className="space-y-1.5 mt-1">
          <ToggleRow
            label="แสดงชื่อผู้สมัคร (showName)"
            hint={`แสดง "${block.roleLabel || 'ผู้สมัคร'} (ชื่อผู้สมัคร)"`}
            checked={showName}
            disabled={disabled}
            tone="rose"
            onChange={(showName) => onChange({ showName })}
          />
          <ToggleRow
            label="แสดงวงเล็บรอบชื่อ (showParentheses)"
            hint='รูปแบบ: ผู้สมัคร (ชื่อผู้สมัคร)'
            checked={block.showParentheses ?? true}
            disabled={disabled || !showName}
            tone="rose"
            onChange={(showParentheses) => onChange({ showParentheses })}
          />
          <ToggleRow
            label="แสดงวันที่ (showDate)"
            hint={`รูปแบบ: ${block.dateLabel || 'วันที่'} …`}
            checked={showDate}
            disabled={disabled}
            tone="rose"
            onChange={(showDate) => onChange({ showDate })}
          />
        </div>
      </div>

      {/* ── dateSource + dateLabel ──────────────────────────────── */}
      {showDate && (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-slate-600">
              แหล่งข้อมูลวันที่ (dateSource)
            </Label>
            <div className="space-y-1">
              {DATE_SOURCES.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-2 px-2 py-1.5 rounded border text-[11px] cursor-pointer transition-colors ${
                    dateSource === opt.value
                      ? 'border-rose-300 bg-rose-50'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name={`sigDateSource-${block.id}`}
                    checked={dateSource === opt.value}
                    disabled={disabled}
                    onChange={() => onChange({ dateSource: opt.value })}
                    className="mt-0.5 h-3.5 w-3.5"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-slate-800 font-medium">
                      {opt.label}
                    </span>
                    <span className="block text-[10px] text-slate-500 leading-tight mt-0.5">
                      {opt.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {dateSource !== 'none' && (
            <div className="space-y-1">
              <Label className="text-[10px] text-slate-600">
                ป้ายกำกับวันที่ (dateLabel)
              </Label>
              <input
                type="text"
                value={block.dateLabel ?? ''}
                disabled={disabled}
                onChange={(e) =>
                  onChange({ dateLabel: e.target.value || undefined })
                }
                placeholder="วันที่"
                className="flex h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 disabled:opacity-50"
              />
            </div>
          )}
        </div>
      )}

      {/* ── alignment ───────────────────────────────────────────── */}
      <div className="space-y-1">
        <Label className="text-[10px] text-slate-600">Alignment</Label>
        <AlignRow
          align={block.align ?? 'center'}
          onChange={(align) => onChange({ align })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

export default SignatureEditor;