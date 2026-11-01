'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * RoundSelect — dropdown เลือกรอบรับสมัครของ Executive Dashboard (V4)
 * -------------------------------------------------------------------
 * interaction ลอก pattern ของ SearchableDropdown (ค้นหา + keyboard
 * ArrowUp/Down/Enter/Escape + click-outside + external-clear) แต่ไม่แตะ
 * ไฟล์เดิม (ถูกใช้ 4 หน้าอื่น) เพราะโครงต่างกัน:
 *
 *   - option 2 บรรทัด: ชื่อรอบ (truncate ได้ + title attr) เหนือ
 *     "รหัสรอบ · ปิดวันที่" + badge สถานะ — รองรับชื่อรอบที่ยาว
 *   - จัดกลุ่มตามสถานะด้วยหัวกลุ่ม: ใช้งานอยู่ / ร่าง / ปิดแล้ว
 *     (groups ว่างให้ caller ตัดออกก่อนส่ง)
 *   - แท่นล่าง "ทั้งหมด (ทุกรอบ)" pin บนสุดเสมอ — เลือก = onChange(null)
 *
 * options มาจาก overview.rounds ใน response เดิม (ไม่ยิง request เพิ่ม)
 * ข้อมูล meta ต่อ option สร้างด้วย roundOptionMeta() ที่ lib/dashboard-overview
 */

export interface RoundOption {
  id: string;
  /** ชื่อรอบเต็ม (บรรทัดแรก) */
  primary: string;
  /** "รหัสรอบ · ปิด วันที่" (บรรทัดรอง) */
  secondary: string;
  badgeLabel: string;
  badgeClassName: string;
}

export interface RoundOptionGroup {
  key: string;
  label: string;
  options: RoundOption[];
}

interface RoundSelectProps {
  /** ผูกกับ <label htmlFor> — dashboard ใช้ "dashboard-round-filter" (id เดิมของ select) */
  id?: string;
  groups: RoundOptionGroup[];
  /** id รอบที่เลือก — null = ทั้งหมด */
  value: string | null;
  onChange: (id: string | null) => void;
  /** ข้อความบนปุ่ม — caller เป็นคนคิด ("ทั้งหมด (ทุกรอบ)" / "รหัส · ชื่อรอบ" / "…" ระหว่างโหลด) */
  triggerLabel: string;
  disabled?: boolean;
  /** ข้อความเมื่อไม่มีรอบเลย */
  emptyText?: string;
  className?: string;
}

/** ค้นหาแบบ Thai-safe เดียวกับ SearchableDropdown (lowercase + includes) */
function matchesQuery(option: RoundOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    option.primary.toLowerCase().includes(q) ||
    option.secondary.toLowerCase().includes(q)
  );
}

export function RoundSelect({
  id,
  groups,
  value,
  onChange,
  triggerLabel,
  disabled = false,
  emptyText = 'ยังไม่มีรอบรับสมัคร',
  className = '',
}: RoundSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // highlight เป็น index ของรายการแบน: 0 = "ทั้งหมด", i+1 = flatOptions[i]
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const totalOptions = useMemo(
    () => groups.reduce((sum, g) => sum + g.options.length, 0),
    [groups],
  );

  // กรองตามค้นหาภายในกลุ่ม — กลุ่มที่เหลือ 0 รายการซ่อน (หัวกลุ่มหายไปพร้อมกัน)
  const visibleGroups = useMemo(
    () =>
      groups
        .map((g) => ({ ...g, options: g.options.filter((o) => matchesQuery(o, query)) }))
        .filter((g) => g.options.length > 0),
    [groups, query],
  );

  const flatOptions = useMemo(
    () => visibleGroups.flatMap((g) => g.options),
    [visibleGroups],
  );

  // Click outside to close (pattern เดิมของ SearchableDropdown)
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Reset highlight เมื่อผลค้นหาเปลี่ยน (pattern เดิม)
  useEffect(() => {
    setHighlight(0);
  }, [query]);

  // ✅ External clear — parent ล้างค่า (self-heal/ปุ่ม ✕ ของ Scope Banner) แล้ว
  // panel/ช่องค้นหาต้องไม่ค้าง — pattern เดิมของ SearchableDropdown
  useEffect(() => {
    if (value !== null) return;
    setOpen(false);
    setQuery('');
    setHighlight(0);
  }, [value]);

  const closePanel = () => {
    setOpen(false);
    setQuery('');
    setHighlight(0);
  };

  const handleSelect = (id: string | null) => {
    onChange(id);
    closePanel();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      // +1 เพราะ index 0 คือ "ทั้งหมด"
      setHighlight((h) => Math.min(h + 1, flatOptions.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlight === 0) {
        handleSelect(null);
      } else {
        const opt = flatOptions[highlight - 1];
        if (opt) handleSelect(opt.id);
      }
    } else if (e.key === 'Escape') {
      closePanel();
    }
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Trigger — id/aria-label เดิมของ select เพื่อให้ label/a11y/test ผูกได้เหมือนเดิม */}
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setOpen((o) => !o);
            setTimeout(() => inputRef.current?.focus(), 0);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="กรองตามรอบรับสมัคร"
        data-testid="dashboard-round-trigger"
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
          open && 'ring-2 ring-blue-500 border-transparent',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        {/* ชื่อรอบยาว → truncate + title attr; ชื่อเต็มพักที่ Scope Banner เสมอ */}
        <span className="truncate text-slate-900" title={triggerLabel}>
          {triggerLabel}
        </span>
        <svg
          className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg"
          data-testid="dashboard-round-panel"
        >
          {/* ช่องค้นหา — ค้นจากชื่อรอบ/รหัสรอบ (บรรทัดรองรวมรหัสไว้แล้ว) */}
          <div className="border-b p-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              // onInput (ไม่ใช่ onChange): สำหรับ text input พฤติกรรมกับผู้ใช้เหมือนกัน
              // ทุกกรณี และเป็น pattern เดียวที่ test harness ของระบบ dispatch ได้
              // (เช่นเดียวกับ trick ของ checkbox ใน signature-editor.test)
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              placeholder="พิมพ์เพื่อค้นหารอบ…"
              aria-label="ค้นหารอบรับสมัคร"
              data-testid="dashboard-round-search"
              className="h-8 w-full rounded border border-slate-300 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {value && (
              <button
                type="button"
                onClick={() => handleSelect(null)}
                className="mt-1 text-xs text-red-600 hover:text-red-700"
              >
                ล้างค่าที่เลือก
              </button>
            )}
          </div>

          <ul className="max-h-72 overflow-y-auto py-1" role="listbox" aria-label="รายการรอบรับสมัคร">
            {/* "ทั้งหมด" pin บนสุด — ตัวเลือก default ที่เข้าถึงได้เสมอแม้รายการยาว */}
            <li
              role="option"
              aria-selected={!value}
              data-testid="dashboard-round-option-all"
              onClick={() => handleSelect(null)}
              onMouseEnter={() => setHighlight(0)}
              className={cn(
                'cursor-pointer px-3 py-2 text-sm hover:bg-blue-50',
                highlight === 0 && 'bg-blue-50',
                !value ? 'font-semibold text-blue-700' : 'font-medium text-slate-700',
              )}
            >
              ทั้งหมด (ทุกรอบ)
            </li>

            {flatOptions.length === 0 && (
              <li className="px-3 py-2 text-center text-sm text-slate-500">
                {query.trim() ? 'ไม่พบรอบที่ค้นหา' : emptyText}
              </li>
            )}

            {visibleGroups.map((g) => (
              <Fragment key={g.key}>
                <li
                  role="presentation"
                  data-testid={`dashboard-round-group-${g.key}`}
                  className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  {g.label} ({g.options.length})
                </li>
                {g.options.map((opt, i) => {
                  const index = i + 1; // เลื่อน 1 ช่องสำหรับ "ทั้งหมด"
                  const isSelected = opt.id === value;
                  return (
                    <li
                      key={opt.id}
                      role="option"
                      aria-selected={isSelected}
                      data-testid="dashboard-round-option"
                      data-value={opt.id}
                      onClick={() => handleSelect(opt.id)}
                      onMouseEnter={() => setHighlight(index)}
                      className={cn(
                        'cursor-pointer px-3 py-2 hover:bg-blue-50',
                        highlight === index && 'bg-blue-50',
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            'truncate text-sm',
                            isSelected ? 'font-semibold text-blue-700' : 'font-medium text-slate-900',
                          )}
                          title={opt.primary}
                        >
                          {opt.primary}
                        </span>
                        {isSelected && (
                          <span aria-hidden="true" className="shrink-0 text-sm text-blue-600">
                            ✓
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-slate-500">
                          {opt.secondary || '\u00A0'}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none',
                            opt.badgeClassName,
                          )}
                        >
                          {opt.badgeLabel}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </Fragment>
            ))}
          </ul>

          {/* Footer count — pattern เดิมของ SearchableDropdown */}
          <div className="border-t px-3 py-1.5 text-xs text-slate-500">
            {flatOptions.length} / {totalOptions} รายการ
          </div>
        </div>
      )}
    </div>
  );
}
