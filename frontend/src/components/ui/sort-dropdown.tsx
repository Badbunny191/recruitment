'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type SortDirection = 'asc' | 'desc' | null;

export interface SortOption {
  /** ค่าที่ส่งไปเมื่อเลือก */
  value: string;
  /** ข้อความที่แสดง */
  label: string;
  /** ทิศทางเริ่มต้น (asc = ▲, desc = ▼) */
  defaultDirection?: SortDirection;
}

export interface SortDropdownProps {
  /** ค่าที่เลือกอยู่ */
  value: string | null;
  /** ฟังก์ชันที่เรียกเมื่อเลือก */
  onChange: (value: string, direction: SortDirection) => void;
  /** ตัวเลือกที่มี */
  options: SortOption[];
  /** Label ของ dropdown */
  label?: string;
  /** placeholder */
  placeholder?: string;
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
  placeholder = 'เลือก...',
  size = 'default',
  disabled = false,
  className,
}: SortDropdownProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  // Find selected option
  const selectedOption = options.find((opt) => opt.value === value);

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
    // Toggle direction if same option
    const newDirection =
      value === option.value
        ? option.defaultDirection === 'asc'
          ? 'desc'
          : option.defaultDirection === 'desc'
          ? 'asc'
          : 'asc'
        : option.defaultDirection || 'asc';

    onChange(option.value, newDirection);
    setIsOpen(false);
  };

  const sizeClasses = {
    default: 'h-10 px-3 text-sm',
    sm: 'h-8 px-2 text-xs',
    lg: 'h-12 px-4 text-base',
  };

  const getDirectionIcon = (option: SortOption) => {
    if (value !== option.value) return null;
    const currentOption = options.find((opt) => opt.value === value);
    const direction = currentOption?.defaultDirection || 'asc';
    return direction === 'asc' ? '▲' : '▼';
  };

  return (
    <div ref={dropdownRef} className={cn('relative', className)}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          'inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white font-medium transition-colors',
          'hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          sizeClasses[size],
          isOpen && 'ring-2 ring-blue-500 ring-offset-2'
        )}
      >
        {/* Sort Icon */}
        <svg
          className={cn('h-4 w-4 text-gray-500', size === 'sm' && 'h-3 w-3')}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
          />
        </svg>

        {/* Label */}
        <span className="text-gray-700">
          {selectedOption ? selectedOption.label : label}
        </span>

        {/* Direction Indicator */}
        {selectedOption && (
          <span className="text-blue-600 text-xs font-bold">
            {getDirectionIcon(selectedOption)}
          </span>
        )}

        {/* Chevron */}
        <svg
          className={cn(
            'h-4 w-4 text-gray-400 transition-transform',
            isOpen && 'rotate-180'
          )}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full min-w-[180px] rounded-md border border-gray-200 bg-white shadow-lg overflow-hidden">
          <div className="py-1">
            {/* Header */}
            <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b">
              {label}
            </div>

            {/* Options */}
            <div className="py-1 max-h-60 overflow-auto">
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option)}
                  className={cn(
                    'w-full px-3 py-2 text-left text-sm flex items-center justify-between transition-colors',
                    'hover:bg-gray-50',
                    value === option.value && 'bg-blue-50 text-blue-700'
                  )}
                >
                  <span>{option.label}</span>
                  {value === option.value && (
                    <span className="text-blue-600 text-xs font-bold">
                      {getDirectionIcon(option)}
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
