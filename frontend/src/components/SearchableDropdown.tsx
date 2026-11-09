'use client';

import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface SearchableOption {
  id: string;
  label: string;
  code?: string;
  subLabel?: string;
}

export interface SearchableDropdownProps {
  options: SearchableOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  /**
   * searchFirst: Search-input pattern (search-first UX)
   * Instead of a button that looks like a select, renders a direct search input [🔍 ค้นหารอบ...]
   * Typing filters options directly below the input.
   */
  searchFirst?: boolean;
}

/**
 * SearchableDropdown - Reusable component
 * - Supports standard dropdown mode or search-first input mode (searchFirst={true})
 * - Search/filter options by label, code, and keywords (case-insensitive, Thai-safe)
 * - Keyboard navigation: ArrowUp, ArrowDown, Enter, Escape
 * - Click outside to close
 * - Returns id (string) via onChange
 */
export function SearchableDropdown({
  options,
  value,
  onChange,
  placeholder = 'ค้นหา...',
  emptyText = 'ไม่พบรายการ',
  disabled = false,
  readOnly = false,
  className = '',
  searchFirst = false,
}: SearchableDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = searchFirst
    ? (options.find((o) => o.id === value && o.id !== '') || null)
    : (options.find((o) => o.id === value) || null);

  // Filter options
  const filtered = query.trim()
    ? options.filter((o) => {
        const q = query.trim().toLowerCase();
        // In search-first mode, hide "all" (empty id) option when actively filtering by query
        if (searchFirst && o.id === '') return false;
        return (
          o.label.toLowerCase().includes(q) ||
          (o.code && o.code.toLowerCase().includes(q)) ||
          (o.subLabel && o.subLabel.toLowerCase().includes(q))
        );
      })
    : options;

  // Click outside to close
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

  // Reset highlight when filter changes
  useEffect(() => {
    setHighlight(0);
  }, [query]);

  // External clear — parent resets value (null or empty string)
  useEffect(() => {
    if (value !== null && value !== '') return;
    setOpen(false);
    setQuery('');
    setHighlight(0);
  }, [value]);

  const handleSelect = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery('');
  };

  const handleClear = () => {
    onChange(null);
    setQuery('');
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && filtered[highlight]) {
        e.preventDefault();
        handleSelect(filtered[highlight].id);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {searchFirst ? (
        /* Search-first Input Pattern [🔍 placeholder...] */
        <div className="relative">
          {/* Search Icon */}
          <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          <input
            ref={inputRef}
            type="text"
            disabled={disabled}
            readOnly={readOnly}
            value={open ? query : (selectedOption ? selectedOption.label : '')}
            placeholder={open && selectedOption ? selectedOption.label : placeholder}
            onFocus={() => {
              if (!disabled && !readOnly) {
                setOpen(true);
                setQuery('');
              }
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!open) setOpen(true);
            }}
            onKeyDown={handleKeyDown}
            className={cn(
              'h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-9 text-sm text-slate-900 placeholder:text-slate-400',
              'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors',
              open && 'ring-2 ring-blue-500 border-transparent',
              disabled && 'cursor-not-allowed opacity-50',
              readOnly && 'cursor-default'
            )}
          />

          {/* Clear button or dropdown chevron */}
          {selectedOption || (open && query) ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
              disabled={disabled}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1 rounded"
              title="ล้างค่าที่เลือก"
              aria-label="ล้างค่าที่เลือก"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
              <svg
                className={cn('h-4 w-4 transition-transform', open && 'rotate-180')}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          )}
        </div>
      ) : (
        /* Standard Display button */
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (!disabled) {
              setOpen((o) => !o);
              setTimeout(() => inputRef.current?.focus(), 0);
            }
          }}
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
            open && 'ring-2 ring-blue-500 border-transparent',
            disabled && 'cursor-not-allowed opacity-50',
            readOnly && 'cursor-default'
          )}
        >
          <span className={selectedOption ? 'text-gray-900' : 'text-gray-400'}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <svg
            className={cn('h-4 w-4 text-gray-400 transition-transform', open && 'rotate-180')}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}

      {/* Dropdown panel */}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg overflow-hidden">
          {/* In standard mode, render search input inside dropdown */}
          {!searchFirst && (
            <div className="border-b p-2">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="พิมพ์เพื่อค้นหา..."
                className="h-8 w-full rounded border border-gray-300 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {value && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="mt-1 text-xs text-red-600 hover:text-red-700"
                >
                  ล้างค่าที่เลือก
                </button>
              )}
            </div>
          )}

          {/* Options list */}
          <ul className="max-h-60 overflow-y-auto py-1" role="listbox">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-sm text-slate-500 text-center">{emptyText}</li>
            ) : (
              filtered.map((opt, idx) => {
                const isSelected = opt.id === (value || '');
                const isHighlight = idx === highlight;
                return (
                  <li
                    key={opt.id || '__all'}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(opt.id)}
                    onMouseEnter={() => setHighlight(idx)}
                    className={cn(
                      'cursor-pointer px-3 py-2 text-sm flex items-center justify-between gap-2 transition-colors',
                      isHighlight ? 'bg-slate-100' : '',
                      isSelected ? 'font-semibold text-blue-600 bg-blue-50/60' : 'text-slate-700',
                      'hover:bg-slate-50'
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {opt.code && (
                        <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono font-medium bg-slate-100 text-slate-700 border border-slate-200">
                          {opt.code}
                        </span>
                      )}
                      <span className="truncate" title={opt.label}>
                        {opt.subLabel || opt.label}
                      </span>
                    </div>
                    {isSelected && (
                      <svg className="h-4 w-4 text-blue-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </li>
                );
              })
            )}
          </ul>

          {/* Footer count */}
          <div className="border-t border-slate-100 px-3 py-1.5 text-xs text-slate-400">
            {filtered.length} / {options.length} รายการ
          </div>
        </div>
      )}
    </div>
  );
}
