'use client';

/**
 * WorkspaceDivider
 * -----------------------------------------------------------------
 * Document Composer — เส้นแบ่งที่ลากปรับขนาดระหว่าง Visual Composer
 * กับ Live Preview (ก้อนที่ 2)
 *
 * Accessibility:
 *   - role="separator"
 *   - aria-orientation="vertical"
 *   - focusable (tabIndex=0)
 *   - aria-valuemin / aria-valuemax / aria-valuenow
 *   - ArrowLeft / ArrowRight ปรับทีละขั้น, Home / End ไปขอบเขต
 *   - Double click → คืนค่า Default
 *
 * ⚠️ การลาก Divider **ห้าม** ยิง Preview API เพิ่ม (ไม่แตะ descriptor)
 */

import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '@/lib/utils';
import {
  KEYBOARD_RESIZE_STEP,
  MIN_SPLIT_RATIO,
  MAX_SPLIT_RATIO,
} from '../lib/workspace-layout';

export interface WorkspaceDividerProps {
  /** สัดส่วนปัจจุบันของ Visual Composer (0..1) */
  ratio: number;
  /** กำลังลากอยู่หรือไม่ */
  isDragging?: boolean;
  /** จุดเริ่มลาก */
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  /** คีย์บอร์ด */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  /** ดับเบิลคลิก → รีเซ็ตค่าเริ่มต้น */
  onDoubleClick: () => void;
  /** ช่วงขั้นตอนที่ใช้แสดงใน aria-valuetext */
  step?: number;
}

export function WorkspaceDivider({
  ratio,
  isDragging = false,
  onPointerDown,
  onKeyDown,
  onDoubleClick,
  step = KEYBOARD_RESIZE_STEP,
}: WorkspaceDividerProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      onKeyDown(event);
    },
    [onKeyDown]
  );

  const percent = Math.round(ratio * 100);

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label="ปรับขนาด Visual Composer และ Live Preview"
      aria-valuemin={Math.round(MIN_SPLIT_RATIO * 100)}
      aria-valuemax={Math.round(MAX_SPLIT_RATIO * 100)}
      aria-valuenow={percent}
      aria-valuetext={`Visual Composer ${percent}% / Live Preview ${
        100 - percent
      }%`}
      tabIndex={0}
      data-testid="workspace-divider"
      data-dragging={isDragging ? 'true' : 'false'}
      onPointerDown={onPointerDown}
      onKeyDown={handleKeyDown}
      onDoubleClick={onDoubleClick}
      title="ลากเพื่อปรับขนาด · คลิกสองครั้งเพื่อรีเซ็ต · ใช้ปุ่มลูกศรเพื่อปรับทีละขั้น"
      className={cn(
        'group relative shrink-0 w-2 cursor-col-resize touch-none select-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1',
        'rounded-full'
      )}
    >
      {/* แถบจับตรงกลาง */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-1/2 top-0 bottom-0 w-0.5 -translate-x-1/2 rounded-full transition-colors',
          isDragging
            ? 'bg-blue-600'
            : 'bg-slate-300 group-hover:bg-blue-400 group-focus-visible:bg-blue-500'
        )}
      />
      {/* จุดจับตรงกลางแนวตั้ง */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
          'h-8 w-1 rounded-full transition-colors',
          isDragging
            ? 'bg-blue-600'
            : 'bg-slate-400 group-hover:bg-blue-500 group-focus-visible:bg-blue-600'
        )}
      />
    </div>
  );
}
