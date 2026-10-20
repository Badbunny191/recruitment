'use client';

/**
 * SystemDataEditor
 * ------------------------------------------------------------------
 * Editor สำหรับ System Data Block — ข้อมูลระบบ 1 รายการต่อ 1 block
 *
 * ตั้งค่าได้ (Requirement B):
 *   - key          → APPLICATION_NO | ROUND_NAME | APPLICATION_DATE
 *                    | PRINT_DATE | POSITION_NAME
 *   - label        → override ของข้อความป้ายกำกับ (ว่าง = ค่ามาตรฐาน)
 *   - showLabel    → ซ่อน/แสดงป้ายกำกับ
 *   - layout       → stacked (label บน / value ล่าง) | inline (บรรทัดเดียว)
 *   - labelStyle   → small | medium | large
 *   - valueStyle   → small | medium | large
 *   - dateFormat   → thai_long | thai_short | iso | numeric (เฉพาะ 2 key วันที่)
 *   - align        → ซ้าย | กลาง | ขวา
 *
 * ── หมายเหตุเรื่อง key ──────────────────────────────────────────────────
 * เปลี่ยน `key` = เปลี่ยนความหมายข้อมูลทั้ง block → ถ้า Admin เปลี่ยนจาก
 * APPLICATION_NO ไปเป็น ROUND_NAME ค่าที่ resolve ได้จะเปลี่ยนตามทันที
 *
 * หมายเหตุเรื่อง POSITION_NAME (Requirement K.10):
 * ระบบยังไม่มี source จริง (ไม่มี FK จาก round → positions)
 * → จะแสดง placeholder `{POSITION_NAME}` เสมอ จนกว่าจะมีข้อมูลจริง
 */

import { Label } from '@/components/ui/label';
import {
  SYSTEM_DATA_LABELS,
  SYSTEM_DATE_KEYS,
  type DateFormat,
  type Size,
  type SystemDataBlock,
  type SystemDataKey,
} from '@/lib/api/template-descriptor';
import { AlignRow } from './HeadingEditor';

export interface SystemDataEditorProps {
  block: SystemDataBlock;
  onChange: (patch: Partial<SystemDataBlock>) => void;
  disabled?: boolean;
}

const KEYS: readonly SystemDataKey[] = [
  'APPLICATION_NO',
  'ROUND_NAME',
  'APPLICATION_DATE',
  'PRINT_DATE',
  'POSITION_NAME',
];

const SIZE_OPTIONS: Array<{ value: Size; label: string }> = [
  { value: 'small', label: 'เล็ก' },
  { value: 'medium', label: 'กลาง' },
  { value: 'large', label: 'ใหญ่' },
];

const DATE_FORMAT_OPTIONS: Array<{
  value: DateFormat;
  label: string;
  example: string;
}> = [
  { value: 'thai_long', label: 'ไทย (ยาว)', example: '7 มกราคม 2569' },
  { value: 'thai_short', label: 'ไทย (สั้น)', example: '7/1/2569' },
  { value: 'iso', label: 'ISO พ.ศ.', example: '2569-01-07' },
  { value: 'numeric', label: 'ตัวเลข', example: '07-01-2569' },
];

/** key ที่ยังไม่มี source จริงในระบบ (Requirement K.10) */
const KEYS_WITHOUT_SOURCE: readonly SystemDataKey[] = ['POSITION_NAME'];

export function SystemDataEditor({
  block,
  onChange,
  disabled,
}: SystemDataEditorProps) {
  const isDateKey = SYSTEM_DATE_KEYS.includes(block.key);
  const defaultLabel = SYSTEM_DATA_LABELS[block.key];

  return (
    <div className="space-y-2.5 p-3 bg-sky-50/60 rounded border border-sky-200">
      <p className="text-[10px] text-slate-600 leading-relaxed">
        System Data Block แสดง <strong>ข้อมูลระบบ</strong> 1 รายการ
        ค่ามาจากระบบจริงตอน render (Preview + PDF ใช้ตัว resolver เดียวกัน)
      </p>

      {/* ── key ─────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <Label className="text-[10px] text-slate-600">ประเภทข้อมูลระบบ</Label>
        <select
          value={block.key}
          disabled={disabled}
          onChange={(e) => {
            const key = e.target.value as SystemDataKey;
            // เปลี่ยน key → ล้างค่าที่ผูกกับ key เดิม (label override / dateFormat)
            const patch: Partial<SystemDataBlock> = { key };
            if (!SYSTEM_DATE_KEYS.includes(key)) delete patch.dateFormat;
            onChange(patch);
          }}
          className="flex h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
        >
          {KEYS.map((key) => (
            <option key={key} value={key}>
              {SYSTEM_DATA_LABELS[key]} ({`{${key}}`})
            </option>
          ))}
        </select>

        {KEYS_WITHOUT_SOURCE.includes(block.key) && (
          <p className="text-[10px] text-amber-700 leading-relaxed mt-1">
            ⚠️ ระบบยังไม่มีแหล่งข้อมูลจริงสำหรับ token นี้
            (ไม่มีความสัมพันธ์จากรอบ → ตำแหน่ง) จึงจะแสดง{' '}
            <code>{`{${block.key}}`}</code> เป็น placeholder จนกว่าจะมีข้อมูล
          </p>
        )}
      </div>

      {/* ── label override + showLabel ───────────────────────────── */}
      <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
        <div className="space-y-1">
          <Label className="text-[10px] text-slate-600">
            ป้ายกำกับ (ปล่อยว่าง = ใช้ค่ามาตรฐาน)
          </Label>
          <input
            type="text"
            value={block.label ?? ''}
            disabled={disabled}
            onChange={(e) =>
              onChange({ label: e.target.value || undefined })
            }
            placeholder={defaultLabel}
            className="flex h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
          />
        </div>

        <label className="flex items-center gap-1.5 text-[11px] text-slate-700 cursor-pointer pb-1.5 whitespace-nowrap">
          <input
            type="checkbox"
            checked={block.showLabel ?? true}
            disabled={disabled}
            onChange={(e) => onChange({ showLabel: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 disabled:opacity-50"
          />
          <span>แสดงป้ายกำกับ</span>
        </label>
      </div>

      {/* ── layout ──────────────────────────────────────────────── */}
      <div className="space-y-1">
        <Label className="text-[10px] text-slate-600">การจัดวาง</Label>
        <div className="flex gap-1">
          <LayoutButton
            active={(block.layout ?? 'stacked') === 'stacked'}
            onClick={() => onChange({ layout: 'stacked' })}
            disabled={disabled}
            label="stacked"
            hint="ป้ายกำกับบนบรรทัด ค่าอยู่บรรทัดถัดไป"
          />
          <LayoutButton
            active={(block.layout ?? 'stacked') === 'inline'}
            onClick={() => onChange({ layout: 'inline' })}
            disabled={disabled}
            label="inline"
            hint="ป้ายกำกับและค่าอยู่บรรทัดเดียวกัน"
          />
        </div>
      </div>

      {/* ── labelStyle / valueStyle ─────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <SelectRow
          label="ขนาดป้ายกำกับ"
          value={block.labelStyle ?? 'small'}
          options={SIZE_OPTIONS}
          onChange={(labelStyle) => onChange({ labelStyle })}
          disabled={disabled}
        />
        <SelectRow
          label="ขนาดค่า"
          value={block.valueStyle ?? 'medium'}
          options={SIZE_OPTIONS}
          onChange={(valueStyle) => onChange({ valueStyle })}
          disabled={disabled}
        />
      </div>

      {/* ── dateFormat (เฉพาะ 2 key วันที่) ──────────────────────── */}
      {isDateKey ? (
        <div className="space-y-1">
          <Label className="text-[10px] text-slate-600">รูปแบบวันที่</Label>
          <div className="space-y-1">
            {DATE_FORMAT_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-center gap-2 px-2 py-1.5 rounded border text-[11px] cursor-pointer transition-colors ${
                  (block.dateFormat ?? 'thai_long') === opt.value
                    ? 'border-sky-400 bg-sky-50 text-slate-900'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name={`dateFormat-${block.id}`}
                  checked={(block.dateFormat ?? 'thai_long') === opt.value}
                  disabled={disabled}
                  onChange={() => onChange({ dateFormat: opt.value })}
                  className="h-3.5 w-3.5"
                />
                <span className="flex-1">{opt.label}</span>
                <code className="text-[10px] text-slate-400">
                  {opt.example}
                </code>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── align ───────────────────────────────────────────────── */}
      <div className="space-y-1">
        <Label className="text-[10px] text-slate-600">Alignment</Label>
        <AlignRow
          align={block.align ?? 'left'}
          onChange={(align) => onChange({ align })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

function LayoutButton({
  active,
  onClick,
  disabled,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={hint}
      className={`flex-1 h-8 text-xs rounded border transition-colors disabled:opacity-50 ${
        active
          ? 'bg-sky-600 text-white border-sky-600'
          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
      }`}
    >
      {label}
    </button>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: Size;
  options: Array<{ value: Size; label: string }>;
  onChange: (v: Size) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-slate-600">{label}</Label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as Size)}
        className="flex h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default SystemDataEditor;