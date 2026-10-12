'use client';

import * as React from 'react';
import { Input } from './input';
import { Button } from './button';
import { cn } from '@/lib/utils';

export interface SearchInputProps {
  /** ค่าที่จะแสดงใน input */
  value: string;
  /** ฟังก์ชันที่เรียกเมื่อค่าเปลี่ยน */
  onChange: (value: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** จำนวนผลลัพธ์ (แสดงด้านล่าง input) */
  resultCount?: number;
  /** Label สำหรับ result count */
  resultLabel?: string;
  /** Debounce delay in ms (default: 300) */
  debounceMs?: number;
  /** ซ่อน result count */
  hideResultCount?: boolean;
  /** ขนาดของ input */
  size?: 'default' | 'sm' | 'lg';
  /** className เพิ่มเติม */
  className?: string;
  /** disabled state */
  disabled?: boolean;
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'ค้นหา...',
  resultCount,
  resultLabel = 'รายการ',
  debounceMs = 300,
  hideResultCount = false,
  size = 'default',
  className,
  disabled = false,
}: SearchInputProps) {
  const [localValue, setLocalValue] = React.useState(value);
  const debounceRef = React.useRef<NodeJS.Timeout>();

  // Sync external value
  React.useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);

    // Debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      onChange(newValue);
    }, debounceMs);
  };

  const handleClear = () => {
    setLocalValue('');
    onChange('');
  };

  const sizeClasses = {
    default: 'h-10',
    sm: 'h-8 text-sm',
    lg: 'h-12 text-base',
  };

  const showClear = localValue.length > 0;
  const showResult = !hideResultCount && resultCount !== undefined;

  return (
    <div className={cn('w-full', className)}>
      <div className="relative">
        {/* Search Icon */}
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <svg
            className="h-4 w-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        {/* Input */}
        <Input
          type="text"
          value={localValue}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            'pl-10 pr-10',
            sizeClasses[size],
            showClear && 'pr-10'
          )}
        />

        {/* Clear Button */}
        {showClear && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            disabled={disabled}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Result Count */}
      {showResult && (
        <p className="text-xs text-gray-500 mt-1.5 px-1">
          {localValue.trim()
            ? `พบ ${resultCount} ${resultLabel}`
            : `แสดง ${resultCount} ${resultLabel}`
          }
        </p>
      )}
    </div>
  );
}
