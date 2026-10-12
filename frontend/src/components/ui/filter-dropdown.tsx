'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface FilterOption {
  /** ค่าที่ส่งไปเมื่อเลือก */
  value: string;
  /** ข้อความที่แสดง */
  label: string;
  /** จำนวน (optional) */
  count?: number;
}

export interface FilterGroup {
  /** ชื่อกลุ่ม */
  label: string;
  /** ตัวเลือกในกลุ่ม */
  options: FilterOption[];
  /** ค่าที่เลือก */
  selected: string[];
  /** ฟังก์ชันที่เรียกเมื่อเปลี่ยน */
  onChange: (selected: string[]) => void;
  /** ประเภทของ filter */
  type?: 'single' | 'multi';
}

export interface FilterDropdownProps {
  /** กลุ่มของ filters */
  groups: FilterGroup[];
  /** จำนวน active filters ทั้งหมด */
  totalActiveFilters?: number;
  /** ฟังก์ชันล้าง filter ทั้งหมด */
  onClearAll?: () => void;
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

export function FilterDropdown({
  groups,
  totalActiveFilters,
  onClearAll,
  label = 'กรอง',
  placeholder = 'เลือก...',
  size = 'default',
  disabled = false,
  className,
}: FilterDropdownProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const hasActiveFilters = (totalActiveFilters ?? 0) > 0;

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

  const handleToggle = (groupIndex: number, optionValue: string, type: 'single' | 'multi') => {
    const group = groups[groupIndex];
    const isSelected = group.selected.includes(optionValue);

    if (type === 'single') {
      // Single select: only one option per group
      group.onChange(isSelected ? [] : [optionValue]);
    } else {
      // Multi select: toggle
      if (isSelected) {
        group.onChange(group.selected.filter((v) => v !== optionValue));
      } else {
        group.onChange([...group.selected, optionValue]);
      }
    }
  };

  const sizeClasses = {
    default: 'h-10 px-3 text-sm',
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
          'inline-flex items-center gap-2 rounded-md border font-medium transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          sizeClasses[size],
          hasActiveFilters
            ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
        )}
      >
        {/* Filter Icon */}
        <svg
          className={cn('h-4 w-4', size === 'sm' && 'h-3 w-3')}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
          />
        </svg>

        {/* Label */}
        <span>
          {hasActiveFilters ? `${label} (${totalActiveFilters})` : label}
        </span>

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
        <div className="absolute z-50 mt-1 min-w-[220px] rounded-md border border-gray-200 bg-white shadow-lg overflow-hidden">
          <div className="py-1 max-h-[400px] overflow-auto">
            {groups.map((group, groupIndex) => (
              <div key={group.label}>
                {/* Group Header */}
                <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b bg-gray-50">
                  {group.label}
                </div>

                {/* Options */}
                <div className="py-1">
                  {group.options.map((option) => {
                    const isSelected = group.selected.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handleToggle(groupIndex, option.value, group.type || 'multi')}
                        className={cn(
                          'w-full px-3 py-2 text-left text-sm flex items-center justify-between transition-colors',
                          'hover:bg-gray-50',
                          isSelected && 'bg-blue-50 text-blue-700'
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {/* Checkbox/Radio indicator */}
                          <span
                            className={cn(
                              'w-4 h-4 border rounded flex items-center justify-center',
                              group.type === 'single' ? 'rounded-full' : 'rounded-sm',
                              isSelected
                                ? 'border-blue-600 bg-blue-600'
                                : 'border-gray-300 bg-white'
                            )}
                          >
                            {isSelected && (
                              <svg
                                className="w-3 h-3 text-white"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={3}
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            )}
                          </span>
                          <span>{option.label}</span>
                        </div>

                        {/* Count */}
                        {option.count !== undefined && (
                          <span className="text-xs text-gray-400">
                            {option.count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          {onClearAll && (
            <div className="border-t bg-gray-50 px-3 py-2 flex justify-between">
              <button
                type="button"
                onClick={() => {
                  onClearAll();
                  setIsOpen(false);
                }}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                ล้างทั้งหมด
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                ปิด
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
