'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type SortDirection = 'asc' | 'desc' | null;

export interface SortOption {
  /** ค่า unique สำหรับ identify */
  id: string;
  /** ฟิลด์ที่ใช้เรียง */
  field: string;
  /** ข้อความที่แสดง */
  label: string;
  /** ทิศทางเรียง */
  direction: 'asc' | 'desc';
}

export interface SortDropdownProps {
  /** id ที่เลือกอยู่ */
  value: string | null;
  /** ฟังก์ชันที่เรียกเมื่อเลือก */
  onChange: (id: string, field: string, direction: SortDirection) => void;
  /** ตัวเลือกที่มี */
  options: SortOption[];
  /** Label ของ dropdown */
  label?: string;
  /** ขนาด */
  size?: 'default' | 'sm' | 'lg';
  /** disabled state */
  disabled?: boolean;
  /** className เพิ่มเติม */
  className?: string;
}

export function SortDropdown({
  value,
  onChange,
  options,
  label = 'เรียงตาม',
  size = 'default',
  disabled = false,
  className,
}: SortDropdownProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  // Find selected option by id
  const selectedOption = options.find((opt) => opt.id === value);

  // Close on click outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on Escape
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen]);

  const handleSelect = (option: SortOption) => {
    onChange(option.id, option.field, option.direction);
    setIsOpen(false);
  };

  const sizeClasses = {
    default: 'h-9 px-3 text-sm',
    sm: 'h-8 px-2 text-xs',
    lg: 'h-12 px-4 text-base',
  };

  return (
    <div ref={dropdownRef} className={cn('relative', className)}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          'inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white font-medium transition-colors',
          'hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1',
          'disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
          sizeClasses[size],
          isOpen && 'ring-2 ring-blue-500 ring-offset-1 border-blue-500'
        )}
      >
        {/* Sort icon — ลูกศรเดียวชี้ตามทิศทางที่เลือก (เดิมแสดง ⇅ + ↑/↓ ตัวอักษร
            ซ้อนกับ chevron จนไอคอนตีกัน — รวมเหลือตัวเดียวสื่อทิศทางชัดเจน) */}
        <svg
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            selectedOption ? 'text-blue-600' : 'text-slate-500',
          )}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d={
              selectedOption?.direction === 'asc'
                ? 'M3 8l7-5 7 5M10 3v18' // ↑ เรียงจากน้อยไปมาก
                : 'M3 16l7 5 7-5M10 21V3' // ↓ เรียงจากมากไปน้อย
            }
          />
        </svg>

        {/* Label */}
        <span className="text-slate-700">
          {selectedOption ? selectedOption.label : label}
        </span>

        {/* Chevron */}
        <svg
          className={cn(
            'h-3.5 w-3.5 text-slate-400 transition-transform shrink-0',
            isOpen && 'rotate-180'
          )}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Dropdown Menu — เปิดขยาย "ไปทางซ้าย" จากขอบขวา trigger (right-0 เสมอ
          เดิมมี sm:left-0 ทำให้ left+right ตรึงความกว้าง = กว้าง trigger เท่านั้น
          label ยาวจึงถูกบีบ wrap) — w-max ให้กว้างตาม label ยาวสุดจริง และ
          max-w กันหลุดจอบน viewport เล็กมาก */}
      {isOpen && (
        <div className="absolute z-50 mt-1 right-0 w-max min-w-[180px] max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
          <div className="py-1">
            {/* Header */}
            <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider border-b bg-slate-50/50">
              {label}
            </div>

            {/* Options */}
            <div className="py-1 max-h-60 overflow-auto">
              {options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleSelect(option)}
                  className={cn(
                    'w-full px-3 py-1.5 text-left text-xs flex items-center justify-between transition-colors',
                    'hover:bg-slate-50',
                    value === option.id && 'bg-blue-50 text-blue-700 font-medium'
                  )}
                >
                  {/* nowrap — item ต้องบรรทัดเดียวเสมอ (เมนูกว้างพอจาก w-max แล้ว) */}
                  <span className="whitespace-nowrap">{option.label}</span>
                  {value === option.id && (
                    <span className="text-blue-600 font-bold">
                      {option.direction === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
