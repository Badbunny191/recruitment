'use client';

/**
 * BlockToolbar
 * --------------------------------
 * Document Composer V1 — Block Toolbar
 *
 * ปุ่มสำหรับเพิ่ม Block ใหม่:
 *   - + Heading
 *   - + Field (เปิด Field Picker)
 *   - + Table (เปิด Field Picker)
 *   - + Logo
 *
 * ส่ง callback ไป parent — parent รู้ว่าจะ insert block ที่ตำแหน่งไหน
 */

import { Button } from '@/components/ui/button';

export type AddBlockKind = 'heading' | 'field' | 'table' | 'logo' | 'signature';

export interface BlockToolbarProps {
  onAdd: (kind: AddBlockKind) => void;
  disabled?: boolean;
}

export function BlockToolbar({ onAdd, disabled }: BlockToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] uppercase font-semibold text-slate-500 mr-1">
        เพิ่ม Block:
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onAdd('heading')}
        disabled={disabled}
        className="h-7 text-xs"
        title="เพิ่ม Heading block"
      >
        <span className="mr-1">📝</span>
        Heading
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onAdd('field')}
        disabled={disabled}
        className="h-7 text-xs"
        title="เพิ่ม Field block (เลือกจาก Field Library)"
      >
        <span className="mr-1">📌</span>
        Field
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onAdd('table')}
        disabled={disabled}
        className="h-7 text-xs"
        title="เพิ่ม Table block (เลือกจาก Field Library)"
      >
        <span className="mr-1">📊</span>
        Table
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onAdd('logo')}
        disabled={disabled}
        className="h-7 text-xs"
        title="เพิ่ม Logo block"
      >
        <span className="mr-1">🖼️</span>
        Logo
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onAdd('signature')}
        disabled={disabled}
        className="h-7 text-xs"
        title="เพิ่ม Signature block (ใช้ข้อมูลจาก Application)"
      >
        <span className="mr-1">✍️</span>
        Signature
      </Button>
    </div>
  );
}