import * as React from 'react';

export type ApplicationStatus = 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'QUALIFIED' | 'REJECTED' | 'CANCELED' | 'ARCHIVED';

const statusConfig: Record<ApplicationStatus, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; bgClass: string }> = {
  DRAFT: { label: 'ฉบับร่าง', variant: 'secondary', bgClass: 'bg-gray-100 text-gray-800' },
  SUBMITTED: { label: 'รอตรวจ', variant: 'default', bgClass: 'bg-blue-100 text-blue-800' },
  UNDER_REVIEW: { label: 'กำลังตรวจ', variant: 'default', bgClass: 'bg-yellow-100 text-yellow-800' },
  QUALIFIED: { label: 'ผ่าน', variant: 'default', bgClass: 'bg-green-100 text-green-800' },
  REJECTED: { label: 'ไม่ผ่าน', variant: 'destructive', bgClass: 'bg-red-100 text-red-800' },
  CANCELED: { label: 'ยกเลิก', variant: 'secondary', bgClass: 'bg-gray-100 text-gray-600' },
  ARCHIVED: { label: 'เก็บเข้าคลัง', variant: 'secondary', bgClass: 'bg-purple-100 text-purple-800' },
};

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: ApplicationStatus;
}

const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ status, className = '', ...props }, ref) => {
    const config = statusConfig[status] || statusConfig.DRAFT;

    return (
      <span
        ref={ref}
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${config.bgClass} ${className}`}
        {...props}
      >
        {config.label}
      </span>
    );
  }
);
StatusBadge.displayName = 'StatusBadge';

export { StatusBadge, statusConfig };
