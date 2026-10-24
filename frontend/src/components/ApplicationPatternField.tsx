'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface ApplicationPatternFieldProps {
  value: string | null;
  onChange: (pattern: string | null) => void;
  /** Context for preview */
  context: {
    year: number;
    roundCode: string;
  };
  /** Lock the field (no editing) — เมื่อมี application แล้ว */
  locked?: boolean;
  /** Message แสดงเมื่อ lock */
  lockedReason?: string;
}

// =============================================================================
// Constants matching backend (019_application_number_pattern)
// =============================================================================

type PresetId = 'standard' | 'short' | 'long' | 'custom';

interface Preset {
  id: PresetId;
  label: string;
  description: string;
  pattern: string; // null for custom
  getSample: (year: number, code: string) => string;
}

const PRESETS: Preset[] = [
  {
    id: 'standard',
    label: 'มาตรฐาน',
    description: 'ปี + รหัสรอบ + Running 4 หลัก',
    pattern: '{YEAR}-{ROUND_CODE}-{RUNNING:4}',
    getSample: (y, c) => `${y}-${c}-0001`,
  },
  {
    id: 'short',
    label: 'แบบสั้น',
    description: 'ปี + Running 3 หลัก (ไม่มีรหัสรอบ)',
    pattern: '{YEAR}-{RUNNING:3}',
    getSample: (y) => `${y}-001`,
  },
  {
    id: 'long',
    label: 'แบบยาว',
    description: 'ปี + รหัสรอบ + Running 6 หลัก',
    pattern: '{YEAR}-{ROUND_CODE}-{RUNNING:6}',
    getSample: (y, c) => `${y}-${c}-000001`,
  },
  {
    id: 'custom',
    label: 'กำหนดเอง',
    description: 'ระบุ token เอง',
    pattern: '', // empty = user will type
    getSample: () => '—',
  },
];

const ALLOWED_DIGIT_COUNTS = [3, 4, 5, 6] as const;
const ALLOWED_SEPARATORS = ['-', '/', '.', '_'] as const;
const MAX_PATTERN_LENGTH = 100;

interface ParseResult {
  ok: boolean;
  error?: string;
  tokens?: Array<
    | { kind: 'TOKEN'; name: string; raw: string }
    | { kind: 'RUNNING'; digitCount: number; raw: string }
    | { kind: 'SEPARATOR'; value: string }
  >;
  digitCount?: number;
  maxCapacity?: number;
}

function parsePattern(pattern: string): ParseResult {
  if (!pattern || !pattern.trim()) {
    return { ok: false, error: 'กรุณากรอกรูปแบบเลขที่ใบสมัคร' };
  }
  const trimmed = pattern.trim();

  if (trimmed.length > MAX_PATTERN_LENGTH) {
    return { ok: false, error: `รูปแบบยาวเกินไป (สูงสุด ${MAX_PATTERN_LENGTH} ตัวอักษร)` };
  }

  if (ALLOWED_SEPARATORS.includes(trimmed[0] as any)) {
    return { ok: false, error: 'รูปแบบต้องไม่ขึ้นต้นด้วยตัวคั่น' };
  }
  if (ALLOWED_SEPARATORS.includes(trimmed[trimmed.length - 1] as any)) {
    return { ok: false, error: 'รูปแบบต้องไม่ลงท้ายด้วยตัวคั่น' };
  }

  const tokens: NonNullable<ParseResult['tokens']> = [];
  const seen = new Set<string>();
  let i = 0;
  let runningCount = 0;

  while (i < trimmed.length) {
    const ch = trimmed[i];

    if (ch === '{') {
      const closeIdx = trimmed.indexOf('}', i);
      if (closeIdx === -1) {
        return { ok: false, error: "Token ไม่สมบูรณ์: '{' ไม่มี '}' ปิด" };
      }
      const raw = trimmed.slice(i, closeIdx + 1);
      const inner = trimmed.slice(i + 1, closeIdx);

      if (inner === 'YEAR' || inner === 'ROUND_CODE') {
        if (seen.has(inner)) return { ok: false, error: `Token ${inner} ซ้ำกัน` };
        seen.add(inner);
        tokens.push({ kind: 'TOKEN', name: inner, raw });
      } else if (inner.startsWith('RUNNING:')) {
        const digitStr = inner.slice('RUNNING:'.length);
        if (!/^\d+$/.test(digitStr)) {
          return { ok: false, error: `{RUNNING:...} ต้องระบุจำนวนหลักเป็นตัวเลข: ${raw}` };
        }
        const digitCount = parseInt(digitStr, 10);
        const key = `RUNNING:${digitCount}`;
        if (seen.has(key)) return { ok: false, error: `Token ${raw} ซ้ำกัน` };
        seen.add(key);
        tokens.push({ kind: 'RUNNING', digitCount, raw });
        runningCount++;
      } else if (inner === 'RUNNING') {
        return { ok: false, error: '{RUNNING} ต้องระบุจำนวนหลัก เช่น {RUNNING:4}' };
      } else {
        return { ok: false, error: `Token ที่ไม่รู้จัก: ${raw}` };
      }
      i = closeIdx + 1;
      continue;
    }

    if (ALLOWED_SEPARATORS.includes(ch as any)) {
      tokens.push({ kind: 'SEPARATOR', value: ch });
      i++;
      continue;
    }

    return { ok: false, error: `ตัวอักษรที่ไม่อนุญาต: '${ch}'` };
  }

  if (runningCount === 0) {
    return { ok: false, error: 'ต้องมี {RUNNING:n} อย่างน้อย 1 token' };
  }

  const runningToken = tokens.find((t) => t.kind === 'RUNNING') as
    | { kind: 'RUNNING'; digitCount: number }
    | undefined;
  if (runningToken && !ALLOWED_DIGIT_COUNTS.includes(runningToken.digitCount as any)) {
    return { ok: false, error: `จำนวนหลัก RUNNING ต้องเป็น ${ALLOWED_DIGIT_COUNTS.join(', ')} เท่านั้น` };
  }

  for (let j = 0; j < tokens.length - 1; j++) {
    if (tokens[j].kind === 'SEPARATOR' && tokens[j + 1].kind === 'SEPARATOR') {
      return { ok: false, error: 'ตัวคั่นซ้ำติดกันไม่ได้' };
    }
  }

  return {
    ok: true,
    tokens,
    digitCount: runningToken?.digitCount,
    maxCapacity: runningToken ? Math.pow(10, runningToken.digitCount) - 1 : 0,
  };
}

function padNumber(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function buildPreview(
  tokens: NonNullable<ParseResult['tokens']>,
  ctx: { year: number; roundCode: string; running?: number },
): string {
  const parts: string[] = [];
  for (const t of tokens) {
    if (t.kind === 'SEPARATOR') {
      parts.push(t.value);
    } else if (t.kind === 'TOKEN' && t.name === 'YEAR') {
      parts.push(String(ctx.year));
    } else if (t.kind === 'TOKEN' && t.name === 'ROUND_CODE') {
      parts.push(ctx.roundCode || '?');
    } else if (t.kind === 'RUNNING') {
      parts.push(padNumber(ctx.running ?? 1, t.digitCount));
    }
  }
  return parts.join('');
}

// =============================================================================
// Main Component
// =============================================================================

export function ApplicationPatternField({
  value,
  onChange,
  context,
  locked = false,
  lockedReason,
}: ApplicationPatternFieldProps) {
  // ===== Legacy round: ไม่มี application_pattern (null) =====
  if (value === null) {
    return <LegacyBanner reason={lockedReason} />;
  }

  // ===========================================================================
  // STATE ARCHITECTURE (กัน reset bug)
  // ===========================================================================
  // กฎสำคัญ:
  //  1. selectedPreset เป็น useState จริง ไม่ derive จาก value
  //  2. customPattern เป็น local state เพื่อให้แก้ได้ลื่นไหล
  //  3. Sync จาก external value เข้ามา "เฉพาะเมื่อ value เปลี่ยนจากภายนอก"
  //     ไม่ใช่เปลี่ยนจาก user action ใน component นี้เอง
  // ===========================================================================

  // Helper: detect preset จาก pattern
  const detectPreset = useCallback((pattern: string): PresetId => {
    const match = PRESETS.find((p) => p.id !== 'custom' && p.pattern === pattern);
    return match?.id ?? 'custom';
  }, []);

  // Initial state (lazy - ทำครั้งเดียวตอน mount)
  const [selectedPreset, setSelectedPreset] = useState<PresetId>(() => detectPreset(value));
  const [customPattern, setCustomPattern] = useState<string>(() => value || '');

  // Track previous value เพื่อแยก "value เปลี่ยนจากภายนอก" vs "value เปลี่ยนจาก user"
  const prevValueRef = useRef<string>(value);

  // ===========================================================================
  // SYNC จาก external value
  // ===========================================================================
  // เงื่อนไขที่ sync:
  //   - prevValueRef.current !== value (มีการเปลี่ยน value จริง)
  //   - value เป็น undefined (parent reset form)
  //
  // เงื่อนไขที่ไม่ sync:
  //   - prevValueRef.current === value (re-render ปกติ, value ไม่เปลี่ยน)
  //   - value เป็น custom pattern (อาจเป็น user กำลังแก้)
  //
  // เมื่อ sync: detect preset ใหม่ แล้ว setSelectedPreset + setCustomPattern
  // ===========================================================================
  useEffect(() => {
    // ไม่ sync ถ้า value เหมือนเดิม (re-render ปกติ)
    if (prevValueRef.current === value) {
      return;
    }

    // Update ref ก่อน
    prevValueRef.current = value;

    // Sync state ตาม value ใหม่
    const detected = detectPreset(value);
    setSelectedPreset(detected);

    // ถ้า value ตรง preset → set customPattern = preset pattern (เป็น starting point)
    // ถ้า value เป็น custom → set customPattern = value (เก็บสิ่งที่ user พิมพ์ไว้)
    if (detected === 'custom') {
      setCustomPattern(value);
    } else {
      setCustomPattern(PRESETS.find((p) => p.id === detected)!.pattern);
    }
  }, [value, detectPreset]);

  const parsed = useMemo(
    () => (selectedPreset === 'custom' ? parsePattern(customPattern) : parsePattern(value)),
    [selectedPreset, customPattern, value],
  );

  const preview1 = useMemo(() => {
    if (!parsed.ok || !parsed.tokens) return null;
    return buildPreview(parsed.tokens, {
      year: context.year,
      roundCode: context.roundCode,
      running: 1,
    });
  }, [parsed, context]);

  const preview123 = useMemo(() => {
    if (!parsed.ok || !parsed.tokens) return null;
    return buildPreview(parsed.tokens, {
      year: context.year,
      roundCode: context.roundCode,
      running: 123,
    });
  }, [parsed, context]);

  // ===========================================================================
  // HANDLERS
  // ===========================================================================

  const handleSelectPreset = (id: PresetId) => {
    // ✅ setSelectedPreset ก่อน (state เปลี่ยนแน่นอน)
    setSelectedPreset(id);

    if (id === 'custom') {
      // เลือก "กำหนดเอง" → seed local pattern + sync กับ parent
      const seed = customPattern || '{YEAR}-{ROUND_CODE}-{RUNNING:4}';
      setCustomPattern(seed);
      // อัปเดต prevValueRef ก่อน onChange เพื่อกัน useEffect sync กลับมา
      prevValueRef.current = seed;
      onChange(seed);
    } else {
      const preset = PRESETS.find((p) => p.id === id);
      if (preset) {
        prevValueRef.current = preset.pattern;
        onChange(preset.pattern);
      }
    }
  };

  const handleCustomChange = (next: string) => {
    setCustomPattern(next);
    // อัปเดต prevValueRef เพื่อกัน useEffect sync กลับมา (เราคือคนเปลี่ยน value เอง)
    prevValueRef.current = next;
    onChange(next);
  };

  // ===== Locked state (round has applications) =====
  // แสดงเป็นข้อมูล Read Only ไม่ใช่ฟอร์ม (ไม่มี input / helper text /
  // เครื่องหมาย *) เพื่อให้สื่อว่าไม่ต้องแก้ไขอีก
  if (locked) {
    return (
      <div className="space-y-1.5">
        <Label>รูปแบบเลขที่ใบสมัคร</Label>
        <div className="p-3 bg-slate-100 rounded-lg space-y-1">
          <div className="text-sm font-mono text-slate-900 break-all">
            {value ?? 'APP-YYYY-NNNN (format เดิม)'}
          </div>
          {lockedReason && (
            <p className="text-xs text-amber-700 flex items-center gap-1">
              <span>🔒</span>
              <span>{lockedReason}</span>
            </p>
          )}
        </div>
      </div>
    );
  }

  // ===== Active editing state =====
  return (
    <div className="space-y-4">
      {/* Preset cards (Card Selection) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {PRESETS.map((preset) => {
          const isSelected = selectedPreset === preset.id;
          const sample = preset.id === 'custom'
            ? 'Custom Pattern'
            : preset.getSample(context.year, context.roundCode || 'CODE');
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleSelectPreset(preset.id)}
              className={cn(
                "text-left p-3 rounded-lg border-2 transition-all min-h-[88px]",
                isSelected
                  ? "border-slate-900 bg-slate-50 shadow-sm"
                  : "border-slate-200 hover:border-slate-400 hover:bg-slate-50",
              )}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span
                  className={cn(
                    "w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0",
                    isSelected ? "border-slate-900" : "border-slate-300",
                  )}
                >
                  {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-slate-900" />}
                </span>
                <span className="font-medium text-sm text-slate-900">{preset.label}</span>
              </div>
              <div className="font-mono text-xs text-slate-700 mb-0.5 break-all ml-5">
                {sample}
              </div>
              <div className="text-[10px] text-slate-500 ml-5 leading-tight">
                {preset.description}
              </div>
            </button>
          );
        })}
      </div>

      {/* Pattern field (readonly for preset, editable for custom) */}
      {selectedPreset !== 'custom' ? (
        <div className="space-y-1.5">
          <Label htmlFor="applicationPattern">Pattern</Label>
          <div className="relative">
            <Input
              id="applicationPattern"
              value={value || ''}
              readOnly
              disabled
              className="font-mono pr-10 bg-slate-50 cursor-not-allowed"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-600 text-xs flex items-center gap-1">
              🔒
            </span>
          </div>
          <p className="text-xs text-slate-500 flex items-center gap-1">
            <span>🔒</span>
            <span>Managed by preset — ห้ามแก้ไข</span>
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="applicationPattern">Pattern (กำหนดเอง)</Label>
          <Input
            id="applicationPattern"
            value={customPattern}
            onChange={(e) => handleCustomChange(e.target.value)}
            placeholder="{YEAR}-{ROUND_CODE}-{RUNNING:4}"
            className="font-mono"
            maxLength={MAX_PATTERN_LENGTH}
          />
          {!parsed.ok && customPattern && (
            <p className="text-xs text-red-600 flex items-center gap-1">
              <span>⚠️</span>
              <span>{parsed.error}</span>
            </p>
          )}
          {parsed.ok && (
            <p className="text-xs text-emerald-600 flex items-center gap-1">
              <span>✓</span>
              <span>รูปแบบถูกต้อง</span>
            </p>
          )}
          <details className="bg-slate-50 border border-slate-200 rounded-md p-2 text-xs">
            <summary className="cursor-pointer text-slate-700 font-medium">
              💡 Token ที่รองรับ
            </summary>
            <div className="mt-2 space-y-1 font-mono">
              <div><span className="text-blue-600">&#123;YEAR&#125;</span> → ปี ค.ศ. 4 หลัก ({context.year})</div>
              <div><span className="text-blue-600">&#123;ROUND_CODE&#125;</span> → รหัสรอบ ({context.roundCode || '?'})</div>
              <div><span className="text-blue-600">&#123;RUNNING:3-6&#125;</span> → Running 3-6 หลัก</div>
              <div className="pt-1 text-slate-500">ตัวคั่น: <span className="font-mono">- / . _</span></div>
            </div>
          </details>
        </div>
      )}

      {/* Preview Card (เด่น) */}
      {parsed.ok && preview1 && (
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-1.5">
            <span className="text-base">👁</span>
            <span className="text-sm font-semibold text-blue-900">เลขที่ใบสมัครตัวอย่าง</span>
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-blue-700">ใบสมัครคนแรก</span>
              <span className="font-mono text-lg font-bold text-blue-900">{preview1}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-blue-700">ใบสมัครลำดับ 123</span>
              <span className="font-mono text-lg font-bold text-blue-900">{preview123}</span>
            </div>
            <div className="flex items-baseline justify-between border-t border-blue-200 pt-2">
              <span className="text-xs text-blue-700">รองรับสูงสุด</span>
              <span className="font-mono text-sm font-semibold text-blue-900">
                {parsed.maxCapacity?.toLocaleString()} คน/รอบ
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Legacy Banner (สำหรับ round เก่าที่ application_pattern = null)
// =============================================================================

function LegacyBanner({ reason }: { reason?: string }) {
  return (
    <div className="space-y-2">
      <Label>รูปแบบเลขที่ใบสมัคร</Label>
      <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">🔒</span>
          <div>
            <div className="text-sm font-semibold text-amber-900">
              รอบนี้ใช้ Legacy Format
            </div>
            <div className="font-mono text-base font-bold text-amber-900 mt-0.5">
              APP-YYYY-NNNN
            </div>
          </div>
        </div>
        <p className="text-xs text-amber-800 leading-relaxed">
          {reason ||
            'ไม่สามารถเปลี่ยนเป็น Pattern ใหม่ได้ เนื่องจากมีผู้สมัครอยู่แล้ว'}
        </p>
      </div>
    </div>
  );
}
