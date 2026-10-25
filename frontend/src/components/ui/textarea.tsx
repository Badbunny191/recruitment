import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = '', ...props }, ref) => {
    // cn() (tailwind-merge) ทำให้ caller override class ที่เป็น conflict group
    // เดียวกันได้ deterministic (เช่น min-h-0 ทับ min-h-[80px], resize-none ทับ
    // UA default) — caller ที่ไม่ส่ง override ได้ class เดิมทุกประการ
    // (backward compatible ไม่กระทบ Textarea หน้าอื่น)
    return (
      <textarea
        className={cn(
          'flex min-h-[80px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50 read-only:cursor-default',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
