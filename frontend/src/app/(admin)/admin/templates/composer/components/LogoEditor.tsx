'use client';

/**
 * LogoEditor
 * ------------------------------------------------------------------
 * Editor สำหรับ Logo Block
 *
 * รองรับ 3 แหล่ง (Requirement D):
 *   - `organization` → โลโก้หน่วยงาน
 *   - `upload`       → **disabled** พร้อมคำอธิบายว่ายังไม่รองรับ
 *   - `none`         → ไม่แสดงโลโก้
 *
 * ── ข้อจำกัดที่พบจริง ──────────────────────────────────────────────────────
 * ระบบ **ไม่มี** column โลโก้ในตาราง `organizations`
 * และ **ไม่มี** asset storage สำหรับ Admin
 * (มีแต่ R2 route สาธารณะที่รับเฉพาะ PDF เอกสารสมัคร — ใช้ไม่ได้)
 *
 * ดังนั้น:
 *   - โครงสร้างข้อมูลรองรับ `imageUrl` ไว้ล่วงหน้า (forward-compatible)
 *     แต่ UI **disable** upload ไว้ เพราะไม่มีช่องทางอัปโหลด
 *   - **ไม่สร้าง** Upload API / **ไม่ใช้** public R2 route
 *     **ไม่ใช้** Base64 / **ไม่เพิ่ม** migration
 *   - ถ้าไม่มีภาพจริง → renderer แสดง "ยังไม่มีโลโก้"
 *     (ไม่แสดงกรอบรูปว่าง และไม่ทำให้ PDF generation ล้ม)
 *
 * ตั้งค่าได้: source · width · height · alignment · alt text
 */

import { Label } from '@/components/ui/label';
import { NO_LOGO_TEXT, type LogoBlock, type LogoSource } from '@/lib/api/template-descriptor';
import { AlignRow, NumberRow } from './HeadingEditor';

export interface LogoEditorProps {
  block: LogoBlock;
  onChange: (patch: Partial<LogoBlock>) => void;
  disabled?: boolean;
}

const SOURCES: Array<{
  value: LogoSource;
  label: string;
  hint: string;
  available: boolean;
}> = [
  {
    value: 'organization',
    label: 'โลโก้หน่วยงาน',
    hint: 'แหล่งโลโก้หลักของเอกสาร (ค่าเริ่มต้น)',
    available: true,
  },
  {
    value: 'upload',
    label: 'อัปโหลดรูปเอง',
    hint: 'ยังไม่รองรับ — ระบบยังไม่มีที่เก็บไฟล์รูปภาพสำหรับผู้ดูแลระบบ',
    available: false,
  },
  {
    value: 'none',
    label: 'ไม่แสดงโลโก้',
    hint: 'ข้ามการแสดงโลโก้ในเอกสารทั้งหมด',
    available: true,
  },
];

const MIN_SIZE = 8;
const MAX_SIZE = 1000;

export function LogoEditor({ block, onChange, disabled }: LogoEditorProps) {
  const source = block.source ?? 'organization';
  const uploadSelected = source === 'upload';

  return (
    <div className="space-y-2.5 p-3 bg-amber-50/50 rounded border border-amber-200">
      <p className="text-[10px] text-slate-600 leading-relaxed">
        Logo Block เป็น Document Block ไม่ใช่ช่องที่ผู้สมัครกรอก
        ถ้าไม่มีภาพจริง ระบบจะแสดง “{NO_LOGO_TEXT}” แทน (ไม่แสดงกรอบรูปว่าง)
      </p>

      {/* ── แหล่งที่มา ──────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <Label className="text-[10px] text-slate-600">แหล่งที่มาของโลโก้</Label>
        <div className="space-y-1">
          {SOURCES.map((opt) => {
            const active = source === opt.value;
            const isDisabled = disabled || !opt.available;
            return (
              <label
                key={opt.value}
                title={opt.hint}
                className={`flex items-start gap-2 px-2 py-1.5 rounded border text-[11px] ${
                  isDisabled
                    ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-70'
                    : 'cursor-pointer transition-colors'
                } ${
                  active && !isDisabled
                    ? 'border-amber-400 bg-amber-50'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name={`logoSource-${block.id}`}
                  checked={active}
                  disabled={isDisabled}
                  onChange={() => onChange({ source: opt.value })}
                  className="mt-0.5 h-3.5 w-3.5"
                />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="text-slate-800 font-medium">
                      {opt.label}
                    </span>
                    {!opt.available && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-[9px] font-semibold uppercase">
                        ยังไม่รองรับ
                      </span>
                    )}
                    {source === opt.value && opt.value === 'upload' && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 text-[9px] font-semibold">
                        เลือกไว้ (ยังไม่มีภาพ)
                      </span>
                    )}
                  </span>
                  <span className="block text-[10px] text-slate-500 leading-tight mt-0.5">
                    {opt.hint}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        {uploadSelected && (
          <div className="mt-1.5 px-2 py-2 rounded bg-slate-100 border border-slate-200">
            <p className="text-[10px] text-slate-600 leading-relaxed">
              ⚠️ <strong>ยังไม่รองรับการอัปโหลดรูป</strong> — ระบบยังไม่มีช่องทาง
              เก็บไฟล์รูปภาพสำหรับผู้ดูแลระบบ
              (ไม่มี Upload API, ไม่ใช้ public R2 route, ไม่ใช้ Base64
              และไม่เพิ่ม migration)
              <br />
              ตัวเลือกนี้ถูก**เก็บไว้เพื่ออนาคต** โดยไม่ต้องเปลี่ยน schema
              หากเลือกไว้ตอนนี้ เอกสารจะแสดง “{NO_LOGO_TEXT}”
            </p>
          </div>
        )}
      </div>

      {/* ── ขนาดรูป ─────────────────────────────────────────────── */}
      {source !== 'none' && (
        <div className="grid grid-cols-2 gap-2">
          <NumberRow
            label="ความกว้าง (pt)"
            value={block.width}
            min={MIN_SIZE}
            max={MAX_SIZE}
            onChange={(width) => onChange({ width })}
            disabled={disabled}
          />
          <div className="space-y-1">
            <Label className="text-[10px] text-slate-600">ความสูง (pt)</Label>
            <input
              type="number"
              value={block.height ?? ''}
              min={MIN_SIZE}
              max={MAX_SIZE}
              disabled={disabled}
              placeholder="อัตโนมัติ"
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') {
                  onChange({ height: undefined });
                  return;
                }
                const n = Number(raw);
                if (!Number.isFinite(n)) return;
                onChange({
                  height: Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(n))),
                });
              }}
              className="flex h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
            />
            <p className="text-[10px] text-slate-500 leading-tight">
              ปล่อยว่าง = คงอัตราส่วนตามรูปต้นฉบับ
            </p>
          </div>
        </div>
      )}

      {/* ── alt text ────────────────────────────────────────────── */}
      {source !== 'none' && (
        <div className="space-y-1">
          <Label className="text-[10px] text-slate-600">
            alt (คำอธิบายรูป)
          </Label>
          <input
            type="text"
            value={block.alt ?? ''}
            disabled={disabled}
            onChange={(e) =>
              onChange({ alt: e.target.value || undefined })
            }
            placeholder="โลโก้หน่วยงาน"
            className="flex h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
          />
          <p className="text-[10px] text-slate-500 leading-tight">
            ใช้เมื่อโลโก้โหลดไม่ได้ (เช่น ตัวอ่านหน้าจอ) — ไม่ถูกพิมพ์ลง PDF
          </p>
        </div>
      )}

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

export default LogoEditor;