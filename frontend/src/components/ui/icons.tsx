/**
 * Icons — ชุดไอคอนเส้น (stroke) ที่ใช้ร่วมกันในหน้า public
 * =========================================================
 * เดิมหน้าแรกใช้ emoji (🔍 📅 ⏳) ซึ่ง
 *   - เรนเดอร์ต่างกันทุก OS/เบราว์เซอร์ (บางเครื่องเป็นสี่เหลี่ยม)
 *   - ขนาด/น้ำหนักเส้นคุมไม่ได้ ทำให้ visual hierarchy เพี้ยน
 *   - screen reader อ่านเป็นคำแปลก ๆ
 *
 * ชุดนี้เป็น inline SVG แบบ stroke เดียวกันทั้งหมด (viewBox 24, stroke-width 2)
 * ตรงกับสไตล์ที่ components/ui/search-input.tsx ใช้อยู่แล้ว
 * → ทั้งระบบใช้ icon system เดียว ไม่ผสม emoji กับ SVG
 *
 * ทุกตัวเป็น aria-hidden โดยปริยาย เพราะข้อความข้าง ๆ สื่อความหมายอยู่แล้ว
 * (ถ้าต้องการให้อ่าน ให้ส่ง aria-label เอง)
 */

import * as React from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

const base = (className?: string) => ({
  className: className ?? 'h-5 w-5',
  fill: 'none' as const,
  stroke: 'currentColor',
  viewBox: '0 0 24 24',
  'aria-hidden': true,
  focusable: false,
});

/** แว่นขยาย — ใช้กับ "ค้นหาใบสมัคร" */
export function SearchIcon({ className, ...props }: IconProps) {
  return (
    <svg {...base(className)} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  );
}

/** ปฏิทิน — ใช้กับวันที่เปิด/ปิดรับสมัคร */
export function CalendarIcon({ className, ...props }: IconProps) {
  return (
    <svg {...base(className)} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
}

/** นาฬิกา — ใช้กับ countdown / deadline */
export function ClockIcon({ className, ...props }: IconProps) {
  return (
    <svg {...base(className)} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

/** ลูกศรขวา — ใช้ในปุ่ม CTA */
export function ArrowRightIcon({ className, ...props }: IconProps) {
  return (
    <svg {...base(className)} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 7l5 5-5 5M6 12h12"
      />
    </svg>
  );
}

/** เครื่องหมายถูกในวงกลม — ใช้กับสถานะ "เปิดรับสมัคร" */
export function CheckCircleIcon({ className, ...props }: IconProps) {
  return (
    <svg {...base(className)} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

/** ระฆัง — ใช้กับสถานะ "กำหนดเปิดรับสมัคร" */
export function BellIcon({ className, ...props }: IconProps) {
  return (
    <svg {...base(className)} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0a3 3 0 11-6 0"
      />
    </svg>
  );
}

/** แม่กุญแจปิด — ใช้กับสถานะ "ปิดรับสมัครแล้ว" */
export function LockIcon({ className, ...props }: IconProps) {
  return (
    <svg {...base(className)} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zM16 11V7a4 4 0 00-8 0v4"
      />
    </svg>
  );
}

/** ระดับตำแหน่ง — ใช้แทน bullet ข้อความ */
export function BadgeIcon({ className, ...props }: IconProps) {
  return (
    <svg {...base(className)} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12h6m-6 4h6M7 3h7l4 4v14a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z"
      />
    </svg>
  );
}
