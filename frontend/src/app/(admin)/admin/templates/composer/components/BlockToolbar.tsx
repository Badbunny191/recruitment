'use client';

/**
 * BlockToolbar
 * --------------------------------
 * Document Composer — Block Toolbar
 *
 * ปุ่มสำหรับเพิ่ม Block ใหม่:
 *   - + Heading / Text
 *   - + System Data  (ข้อมูลระบบ: เลขที่ใบสมัคร / ชื่อรอบ / วันที่)
 *   - + Field        (เปิด Field Picker — ทุกชนิด)
 *   - + Table        (เปิด Field Picker — เฉพาะฟิลด์แบบหลายรายการ)
 *   - + Logo
 *   - + Signature
 *
 * ส่ง callback ไป parent — parent รู้ว่าจะ insert block ที่ตำแหน่งไหน
 */

import { Button } from '@/components/ui/button';

export type AddBlockKind =
  | 'heading'
  | 'systemData'
  | 'field'
  | 'table'
  | 'logo'
  | 'signature';

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
        title="เพิ่ม Heading / Text block (รองรับข้อความหลายบรรทัดและผสม token)"
      >
        <span className="mr-1">📝</span>
        Heading / Text
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onAdd('systemData')}
        disabled={disabled}
        className="h-7 text-xs"
        title="เพิ่ม System Data block — ข้อมูลระบบ 1 รายการ (เลขที่ใบสมัคร / ชื่อรอบ / วันที่)"
      >
        <span className="mr-1">🗂️</span>
        System Data
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
        title="เพิ่ม Table block (เฉพาะฟิลด์แบบหลายรายการ)"
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