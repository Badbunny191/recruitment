'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ActionMenuItem {
  /** ข้อความที่แสดง */
  label: string;
  /** ไอคอน (optional) */
  icon?: React.ReactNode;
  /** ฟังก์ชันที่เรียกเมื่อคลิก */
  onClick: () => void;
  /** ประเภทของ item */
  type?: 'default' | 'danger' | 'separator';
  /** disabled state */
  disabled?: boolean;
  /** tooltip */
  title?: string;
}

export interface ActionMenuProps {
  /** รายการ actions */
  items: ActionMenuItem[];
  /** ตำแหน่งที่แสดง dropdown */
  align?: 'left' | 'right';
  /** ขนาดของ trigger button */
  size?: 'default' | 'sm' | 'icon';
  /** className สำหรับ trigger */
  triggerClassName?: string;
  /** className สำหรับ menu */
  menuClassName?: string;
  /** ไอคอนสำหรับ trigger */
  triggerIcon?: React.ReactNode;
  /** trigger label */
  triggerLabel?: string;
  /** disabled state */
  disabled?: boolean;
  /** className เพิ่มเติม */
  className?: string;
}

export function ActionMenu({
  items,
  align = 'right',
  size = 'default',
  triggerClassName,
  menuClassName,
  triggerIcon,
  triggerLabel,
  disabled = false,
  className,
}: ActionMenuProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Close on click outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
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

  const handleItemClick = (item: ActionMenuItem) => {
    if (item.type === 'separator' || item.disabled) return;
    item.onClick();
    setIsOpen(false);
  };

  const sizeClasses = {
    default: 'h-8 px-2 text-sm',
    sm: 'h-7 px-1.5 text-xs',
    icon: 'h-8 w-8 p-0',
  };

  const getItemClasses = (item: ActionMenuItem) => {
    const baseClasses =
      'w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors';
    const disabledClasses = item.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50';
    const typeClasses = {
      default: 'text-gray-700',
      danger: 'text-red-600 hover:bg-red-50',
      separator: '',
    };
    return cn(baseClasses, disabledClasses, typeClasses[item.type || 'default']);
  };

  return (
    <div ref={menuRef} className={cn('relative', className)}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          'inline-flex items-center justify-center rounded-md border border-gray-300 bg-white font-medium transition-colors',
          'hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          sizeClasses[size],
          triggerClassName
        )}
        title={triggerLabel}
      >
        {triggerIcon || (
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
              d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
            />
          </svg>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className={cn(
            'absolute z-50 mt-1 min-w-[160px] rounded-md border border-gray-200 bg-white shadow-lg overflow-hidden',
            align === 'right' ? 'right-0' : 'left-0',
            menuClassName
          )}
        >
          <div className="py-1">
            {items.map((item, index) =>
              item.type === 'separator' ? (
                <div
                  key={`sep-${index}`}
                  className="border-t border-gray-100 my-1"
                />
              ) : (
                <button
                  key={index}
                  type="button"
                  onClick={() => handleItemClick(item)}
                  disabled={item.disabled}
                  className={getItemClasses(item)}
                  title={item.title}
                >
                  {item.icon && <span className="w-4 h-4">{item.icon}</span>}
                  <span>{item.label}</span>
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Convenience component for table row actions
export interface RowActionsProps {
  /** รายการ actions */
  items: Omit<ActionMenuItem, 'type'>[];
  /** เพิ่ม separator ก่อน danger items */
  dangerAtEnd?: boolean;
  /** className เพิ่มเติม */
  className?: string;
}

export function RowActions({
  items,
  dangerAtEnd = true,
  className,
}: RowActionsProps) {
  const menuItems: ActionMenuItem[] = [];

  items.forEach((item, index) => {
    if (dangerAtEnd && item.label.includes('ลบ') && index > 0) {
      menuItems.push({ type: 'separator', label: '', onClick: () => {} });
    }
    menuItems.push({ type: item.label.includes('ลบ') ? 'danger' : 'default', ...item });
  });

  return <ActionMenu items={menuItems} size="sm" className={className} />;
}
