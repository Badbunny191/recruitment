'use client';

import { useState, useEffect, useRef } from 'react';

export interface SearchableOption {
  id: string;
  label: string;
}

export interface SearchableDropdownProps {
  options: SearchableOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * SearchableDropdown - Reusable component
 * - Search/filter options by label (case-insensitive, Thai-safe)
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
  className = '',
}: SearchableDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((o) => o.id === value) || null;

  // Filter options
  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
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
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlight]) {
        handleSelect(filtered[highlight].id);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Display button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setOpen((o) => !o);
            setTimeout(() => inputRef.current?.focus(), 0);
          }
        }}
        className={`flex h-10 w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? 'ring-2 ring-blue-500 border-transparent' : ''
        }`}
      >
        <span className={selectedOption ? 'text-gray-900' : 'text-gray-400'}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg">
          {/* Search input */}
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

          {/* Options list */}
          <ul className="max-h-60 overflow-y-auto py-1" role="listbox">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-500 text-center">{emptyText}</li>
            ) : (
              filtered.map((opt, idx) => {
                const isSelected = opt.id === value;
                const isHighlight = idx === highlight;
                return (
                  <li
                    key={opt.id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(opt.id)}
                    onMouseEnter={() => setHighlight(idx)}
                    className={`cursor-pointer px-3 py-2 text-sm ${
                      isHighlight ? 'bg-blue-50' : ''
                    } ${isSelected ? 'font-medium text-blue-700' : 'text-gray-700'} hover:bg-blue-50`}
                  >
                    {opt.label}
                  </li>
                );
              })
            )}
          </ul>

          {/* Footer count */}
          <div className="border-t px-3 py-1.5 text-xs text-gray-500">
            {filtered.length} / {options.length} รายการ
          </div>
        </div>
      )}
    </div>
  );
}
