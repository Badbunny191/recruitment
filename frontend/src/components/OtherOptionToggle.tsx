'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { OTHER_OPTION_LABEL } from '@/lib/otherOption';

/**
 * OtherOptionToggle
 * -----------------
 * Checkbox สำหรับเปิด/ปิดตัวเลือก "อื่นๆ (โปรดระบุ)" สำหรับ Field Type:
 *   - RADIO
 *   - DROPDOWN
 *   - CHECKBOX
 *
 * เมื่อเปิด → ระบบจะเติมตัวเลือก "อื่นๆ (โปรดระบุ)" ลงในรายการ options
 * อัตโนมัติ และแสดงช่อง Text Input เพิ่มเติมในแบบฟอร์มผู้สมัคร
 */
export function OtherOptionToggle({
  checked,
  onChange,
  id = 'allowOtherOption',
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <Label htmlFor={id} className="font-normal cursor-pointer">
          เพิ่มตัวเลือก &quot;{OTHER_OPTION_LABEL}&quot;
        </Label>
      </div>
      <p className="text-xs text-gray-500">
        เมื่อผู้สมัครเลือก &quot;{OTHER_OPTION_LABEL}&quot; ระบบจะแสดงช่องกรอกข้อความเพิ่มเติม
        และบังคับให้กรอกเมื่อฟิลด์นี้เป็น Required
      </p>
    </div>
  );
}
