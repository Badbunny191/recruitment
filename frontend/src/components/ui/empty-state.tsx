'use client';

import * as React from 'react';
import { Button } from './button';
import { cn } from '@/lib/utils';

export type EmptyStateType = 'no-data' | 'no-results' | 'error';

export interface EmptyStateAction {
  /** ข้อความบนปุ่ม */
  label: string;
  /** ฟังก์ชันที่เรียกเมื่อคลิก */
  onClick: () => void;
  /** variant ของปุ่ม */
  variant?: 'primary' | 'secondary' | 'outline';
}

export interface EmptyStateProps {
  /** ประเภทของ empty state */
  type?: EmptyStateType;
  /** ไอคอน (แสดงแทนไอคอน default) */
  icon?: React.ReactNode;
  /** หัวข้อหลัก */
  title: string;
  /** คำอธิบายเพิ่มเติม */
  description?: string;
  /** กระทำที่สามารถทำได้ */
  action?: EmptyStateAction;
  /** คำแนะนำเพิ่มเติม */
  hint?: string;
  /** className เพิ่มเติม */
  className?: string;
}

const DEFAULT_ICONS: Record<EmptyStateType, { emoji: string; className: string }> = {
  'no-data': { emoji: '📭', className: 'text-5xl' },
  'no-results': { emoji: '🔍', className: 'text-5xl' },
  'error': { emoji: '⚠️', className: 'text-5xl' },
};

export function EmptyState({
  type = 'no-data',
  icon,
  title,
  description,
  action,
  hint,
  className,
}: EmptyStateProps) {
  const defaultIcon = DEFAULT_ICONS[type];

  const actionVariantMap = {
    primary: 'default' as const,
    secondary: 'secondary' as const,
    outline: 'outline' as const,
  };

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-12 px-4 text-center',
        className
      )}
    >
      {/* Icon */}
      <div className={cn('mb-4', defaultIcon.className)}>
        {icon || defaultIcon.emoji}
      </div>

      {/* Title */}
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>

      {/* Description */}
      {description && (
        <p className="text-sm text-gray-500 max-w-sm mb-4">{description}</p>
      )}

      {/* Action Button */}
      {action && (
        <Button
          onClick={action.onClick}
          variant={actionVariantMap[action.variant || 'primary']}
          className="mb-4"
        >
          {action.label}
        </Button>
      )}

      {/* Hint */}
      {hint && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>💡</span>
          <span>{hint}</span>
        </div>
      )}
    </div>
  );
}

// Convenience components for common use cases
export interface NoDataEmptyStateProps {
  title?: string;
  description?: string;
  action?: EmptyStateAction;
  className?: string;
}

export function NoDataEmptyState({
  title = 'ไม่มีข้อมูล',
  description,
  action,
  className,
}: NoDataEmptyStateProps) {
  return (
    <EmptyState
      type="no-data"
      title={title}
      description={description}
      action={action}
      className={className}
    />
  );
}

export interface NoResultsEmptyStateProps {
  keyword?: string;
  onClearFilters?: () => void;
  className?: string;
}

export function NoResultsEmptyState({
  keyword,
  onClearFilters,
  className,
}: NoResultsEmptyStateProps) {
  return (
    <EmptyState
      type="no-results"
      title={keyword ? `ไม่พบผลลัพธ์สำหรับ "${keyword}"` : 'ไม่พบผลลัพธ์'}
      description="ลองใช้คำค้นหาที่แตกต่าง หรือล้างตัวกรอง"
      action={
        onClearFilters
          ? {
              label: 'ล้างตัวกรองทั้งหมด',
              onClick: onClearFilters,
              variant: 'outline',
            }
          : undefined
      }
      className={className}
    />
  );
}
