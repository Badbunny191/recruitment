'use client';

/**
 * TableEditor
 * ------------------------------------------------------------------
 * Editor สำหรับ Table Block — แสดงค่า field เป็นตาราง
 *
 * ⚠️ Table Block ใช้**ได้เฉพาะ** field ที่มีค่าเป็นหลายรายการจริง (repeatable)
 *   กฎการกรองอยู่ที่ `@/lib/document-composer/field-capabilities`
 *   (single source of truth — mirror ของ backend)
 *
 *   - REPEATER / TABLE → ใช้เป็น Table ได้
 *   - MASTER_DATA แบบ single-select (เช่น "สังกัดปัจจุบัน") → **ห้าม**
 *     เพราะเป็น object `{ id, name }` ค่าเดียว ไม่ใช่หลายรายการ
 *   - scalar fields (TEXT / EMAIL / PHONE / NUMBER / DATE / FILE / CHECKBOX)
 *     และ DROPDOWN / RADIO / TEXTAREA แบบค่าเดียว → **ห้าม**
 *
 * ── capability override ──────────────────────────────────────────────────
 * `tableFieldIds` เป็น **capability override** ไม่ใช่รายการที่ Admin ต้องเปิดเอง
 * ใน UI นี้จะแสดงคำอธิบายชัดเจนว่า:
 *   "ฟิลด์นี้ถูกตั้งเป็นตารางโดย override — ระบบจะไม่ตรวจซ้ำว่าเป็น
 *    หลายรายการหรือไม่ ถ้าค่าจริงมีแค่ค่าเดียว เอกสารจะแสดงแถวเดียว"
 */

import { Label } from '@/components/ui/label';
import type { TableBlock } from '@/lib/api/template-descriptor';
import { getFieldCapability } from '@/lib/document-composer/field-capabilities';
import { AlignRow, NumberRow, ToggleRow } from './HeadingEditor';
import type { TemplateFieldLibraryItem } from '../hooks/useTemplateFields';

export interface TableEditorProps {
  block: TableBlock;
  onChange: (patch: Partial<TableBlock>) => void;
  field?: TemplateFieldLibraryItem;
  disabled?: boolean;
}

export function TableEditor({
  block,
  onChange,
  field,
  disabled,
}: TableEditorProps) {
  const capability = getFieldCapability(field?.fieldType);
  const effectiveLabel = block.label || field?.labelTh || block.fieldId;
  const showLabel = block.showLabel ?? true;

  // field ที่ถูกตั้งเป็นตารางโดยไม่ใช่ repeatable จริง → เตือน (แต่ไม่ลบ block)
  const isOverride = !capability.isRepeatable;

  return (
    <div className="space-y-2.5 p-3 bg-emerald-50/50 rounded border border-emerald-200">
      {/* ── field reference (read-only) ─────────────────────────── */}
      <div className="space-y-1">
        <Label className="text-[10px] text-slate-600">ฟิลด์ที่อ้างอิง</Label>
        <div className="flex items-center gap-2">
          <code className="block flex-1 text-[11px] bg-white border border-slate-200 rounded px-2 py-1.5 break-all font-mono">
            {block.fieldId}
          </code>
          {field?.fieldType && (
            <span className="text-[10px] text-emerald-700 font-medium shrink-0">
              {field.fieldType}
            </span>
          )}
        </div>
        {field ? (
          <p className="text-[10px] text-slate-500 mt-1">{field.labelTh}</p>
        ) : (
          <p className="text-[10px] text-amber-700 mt-1">
            ⚠️ ไม่พบฟิลด์นี้ใน Template Version — Preview/PDF จะข้าม block นี้
          </p>
        )}
        <p className="text-[10px] text-slate-500 mt-1">
          การเปลี่ยน fieldId ต้องลบ block นี้แล้วเพิ่มใหม่ผ่าน +Table
        </p>
      </div>

      {/* ── capability warning ──────────────────────────────────── */}
      <div
        className={`px-2 py-2 rounded border text-[10px] leading-relaxed ${
          isOverride
            ? 'bg-amber-50 border-amber-300 text-amber-800'
            : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        }`}
      >
        {isOverride ? (
          <>
            <strong>⚠️ capability override</strong> — ฟิลด์ชนิด{' '}
            <code className="font-mono">{field?.fieldType ?? 'ไม่ทราบ'}</code>{' '}
            ไม่ใช่ฟิลด์แบบหลายรายการโดยชัดเจน
            <br />
            ระบบจะ**ไม่**ตรวจซ้ำว่าค่าจริงเป็นหลายรายการหรือไม่
            หากค่าจริงมีเพียงค่าเดียว เอกสารจะแสดงตาราง 1 แถว
            ต้องการความหมายแบบ "ค่าเดียว" ให้ใช้{' '}
            <strong>+Field</strong> แทน (เช่น MASTER_DATA single-select)
          </>
        ) : (
          <>
            <strong>✓ ฟิลด์แบบหลายรายการ</strong> — renderer จะวาดเป็นตาราง
            โดยอัตโนมัติ (หนึ่งแถวต่อหนึ่งรายการ)
          </>
        )}
      </div>

      {/* ── label + showLabel ───────────────────────────────────── */}
      <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
        <div className="space-y-1">
          <Label className="text-[10px] text-slate-600">
            ป้ายกำกับเหนือตาราง
          </Label>
          <input
            type="text"
            value={block.label ?? ''}
            disabled={disabled}
            onChange={(e) =>
              onChange({ label: e.target.value || undefined })
            }
            placeholder={field?.labelTh ?? 'ปล่อยว่างเพื่อซ่อนป้ายกำกับ'}
            className="flex h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
          />
        </div>

        <label className="flex items-center gap-1.5 text-[11px] text-slate-700 cursor-pointer pb-1.5 whitespace-nowrap">
          <input
            type="checkbox"
            checked={showLabel}
            disabled={disabled}
            onChange={(e) => onChange({ showLabel: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 disabled:opacity-50"
          />
          <span>แสดงป้ายกำกับ</span>
        </label>
      </div>

      {/* ── emptyText ───────────────────────────────────────────── */}
      <div className="space-y-1">
        <Label className="text-[10px] text-slate-600">
          ข้อความเมื่อยังไม่มีข้อมูล (emptyText)
        </Label>
        <input
          type="text"
          value={block.emptyText ?? ''}
          disabled={disabled}
          onChange={(e) =>
            onChange({ emptyText: e.target.value || undefined })
          }
          placeholder="(ไม่มีข้อมูล)"
          className="flex h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
        />
        <p className="text-[10px] text-slate-500 leading-tight">
          แสดงแทนตารางเมื่อผู้สมัครยังไม่กรอกข้อมูล (default: "(ไม่มีข้อมูล)")
        </p>
      </div>

      {/* ── alignment ───────────────────────────────────────────── */}
      <div className="space-y-1">
        <Label className="text-[10px] text-slate-600">Alignment</Label>
        <AlignRow
          align={block.align ?? 'left'}
          onChange={(align) => onChange({ align })}
          disabled={disabled}
        />
      </div>

      {/* ── spacing ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <NumberRow
          label="ระยะห่างบน (pt)"
          value={block.marginTop}
          onChange={(marginTop) => onChange({ marginTop })}
          disabled={disabled}
        />
        <NumberRow
          label="ระยะห่างล่าง (pt)"
          value={block.marginBottom}
          onChange={(marginBottom) => onChange({ marginBottom })}
          disabled={disabled}
        />
      </div>

      {/* ── live hint ───────────────────────────────────────────── */}
      <ToggleRow
        label="ดูตัวอย่างป้ายกำกับ"
        hint={`จะแสดง: "${effectiveLabel}" เหนือตาราง`}
        checked={showLabel}
        disabled
        onChange={() => undefined}
      />
    </div>
  );
}

export default TableEditor;