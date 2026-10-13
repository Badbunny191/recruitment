'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
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

/** ระยะห่างจาก trigger (px) */
const MENU_OFFSET = 4;
/** ความสูงโดยประมาณของแต่ละ item (px) */
const ESTIMATED_ITEM_HEIGHT = 36;
/** ความกว้างขั้นต่ำของเมนู (px) */
const MENU_MIN_WIDTH = 160;
/** ความสูงขั้นต่ำของเมนู (px) — กัน false positive flip เมื่อเมนูสั้น */
const MIN_MENU_HEIGHT = 80;

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  direction: 'down' | 'up';
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
  const [mounted, setMounted] = React.useState(false);

  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // ใช้ state ที่มี initial value เพื่อ break deadlock
  // คำนวณครั้งแรกตอนเปิด (sync) เพื่อให้ render แรกมี position พร้อมเลย
  const [menuPosition, setMenuPosition] = React.useState<MenuPosition | null>(null);

  // ติดตามการ mount
  React.useEffect(() => {
    setMounted(true);
  }, []);

  /**
   * คำนวณตำแหน่งจาก trigger + estimated menu size (ไม่ต้องการ menu DOM)
   * ใช้สำหรับ initial render เพื่อ break deadlock
   */
  const computeInitialPosition = React.useCallback((): MenuPosition | null => {
    const trigger = triggerRef.current;
    if (!trigger) return null;

    const triggerRect = trigger.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // ใช้ estimated size (ไม่ต้องวัด DOM)
    const nonSeparatorCount = items.filter(i => i.type !== 'separator').length;
    const estimatedMenuHeight = Math.max(
      nonSeparatorCount * ESTIMATED_ITEM_HEIGHT + 8, // +8 for padding
      MIN_MENU_HEIGHT
    );
    const menuWidth = MENU_MIN_WIDTH;

    // พื้นที่ที่มีให้เปิดลง/ขึ้น
    const spaceBelow = viewportHeight - triggerRect.bottom - MENU_OFFSET;
    const spaceAbove = triggerRect.top - MENU_OFFSET;

    // ตัดสินใจ flip
    const direction: 'down' | 'up' =
      spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow ? 'up' : 'down';

    let top: number;
    if (direction === 'down') {
      top = triggerRect.bottom + MENU_OFFSET;
    } else {
      top = triggerRect.top - estimatedMenuHeight - MENU_OFFSET;
    }

    let left: number;
    if (align === 'right') {
      left = triggerRect.right - menuWidth;
    } else {
      left = triggerRect.left;
    }

    // กันเมนูล้น viewport
    const overflowRight = (left + menuWidth) - viewportWidth;
    if (overflowRight > 0) left = left - overflowRight - 8;
    if (left < 8) left = 8;

    return { top, left, width: menuWidth, direction };
  }, [align, items]);

  /**
   * คำนวณตำแหน่งแบบ real (ใช้ measured menu size)
   * รันหลังจาก render เพื่อ refine ตำแหน่ง
   */
  const refinePosition = React.useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    const menuHeight = menuRect.height;
    const menuWidth = menuRect.width;

    const spaceBelow = viewportHeight - triggerRect.bottom - MENU_OFFSET;
    const spaceAbove = triggerRect.top - MENU_OFFSET;

    const direction: 'down' | 'up' =
      spaceBelow < Math.max(menuHeight, MIN_MENU_HEIGHT) && spaceAbove > spaceBelow
        ? 'up'
        : 'down';

    let top: number;
    if (direction === 'down') {
      top = triggerRect.bottom + MENU_OFFSET;
    } else {
      top = triggerRect.top - menuHeight - MENU_OFFSET;
    }

    let left: number;
    if (align === 'right') {
      left = triggerRect.right - menuWidth;
    } else {
      left = triggerRect.left;
    }

    const overflowRight = (left + menuWidth) - viewportWidth;
    if (overflowRight > 0) left = left - overflowRight - 8;
    if (left < 8) left = 8;

    setMenuPosition({ top, left, width: menuWidth, direction });
  }, [align]);

  /**
   * เมื่อเปิดเมนู:
   * 1. คำนวณ initial position sync (ก่อน paint) เพื่อให้ render แรกมี position
   * 2. หลัง render แล้ว refine ด้วย measured size
   *
   * ใช้ useLayoutEffect เพื่อให้ position ถูก set ก่อน browser paint
   * →ไม่มี flicker (menu ปรากฏในตำแหน่งที่ถูกตั้งแต่ render แรก)
   */
  const useIsomorphicLayoutEffect =
    typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

  useIsomorphicLayoutEffect(() => {
    if (!isOpen) {
      setMenuPosition(null);
      return;
    }

    // Step 1: คำนวณ initial position ก่อน paint (sync)
    const initial = computeInitialPosition();
    if (initial) {
      setMenuPosition(initial);
    }

    // Step 2: refine ด้วย measured size หลัง render (rAF)
    const rafId = requestAnimationFrame(() => {
      refinePosition();
    });

    const handleScroll = () => refinePosition();
    const handleResize = () => refinePosition();

    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen, computeInitialPosition, refinePosition]);

  // ปิดเมื่อคลิกนอก
  React.useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // ปิดเมื่อกด Escape
  React.useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleItemClick = (item: ActionMenuItem) => {
    if (item.type === 'separator' || item.disabled) return;
    const callback = item.onClick;
    setIsOpen(false);
    // ปิดก่อนแล้วค่อยรัน callback (เพื่อให้ UI responsive)
    callback();
  };

  const sizeClasses = {
    default: 'h-8 px-2 text-sm',
    sm: 'h-7 px-1.5 text-xs',
    icon: 'h-8 w-8 p-0',
  };

  const getItemClasses = (item: ActionMenuItem) => {
    const baseClasses =
      'w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors';
    const disabledClasses = item.disabled
      ? 'opacity-50 cursor-not-allowed'
      : 'hover:bg-gray-50';
    const typeClasses = {
      default: 'text-gray-700',
      danger: 'text-red-600 hover:bg-red-50',
      separator: '',
    };
    return cn(baseClasses, disabledClasses, typeClasses[item.type || 'default']);
  };

  // Render dropdown ผ่าน portal
  const renderDropdown = () => {
    if (!isOpen || !menuPosition || !mounted) return null;
    return createPortal(
      <div
        ref={menuRef}
        role="menu"
        aria-orientation="vertical"
        style={{
          position: 'fixed',
          top: menuPosition.top,
          left: menuPosition.left,
          width: menuPosition.width,
          // z-index สูงกว่า Dialog (z-50), Navbar (z-30), Drawer backdrop (z-40), Drawer (z-50)
          zIndex: 9999,
        }}
        className={cn(
          'rounded-md border border-gray-200 bg-white shadow-lg overflow-hidden',
          'transition-opacity duration-100',
          menuClassName
        )}
      >
        <div className="py-1 max-h-[60vh] overflow-y-auto">
          {items.map((item, index) =>
            item.type === 'separator' ? (
              <div
                key={`sep-${index}`}
                role="separator"
                className="border-t border-gray-100 my-1"
              />
            ) : (
              <button
                key={`item-${index}`}
                type="button"
                role="menuitem"
                onClick={() => handleItemClick(item)}
                disabled={item.disabled}
                className={getItemClasses(item)}
                title={item.title}
              >
                {item.icon && <span className="w-4 h-4 shrink-0">{item.icon}</span>}
                <span className="truncate">{item.label}</span>
              </button>
            )
          )}
        </div>
      </div>,
      document.body
    );
  };

  return (
    <span className={cn('inline-block', className)}>
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (disabled) return;
          setIsOpen((prev) => !prev);
        }}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={isOpen}
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

      {/* Dropdown Menu — render via portal */}
      {renderDropdown()}
    </span>
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