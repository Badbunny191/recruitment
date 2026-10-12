'use client';

import * as React from 'react';
import { Button } from './button';
import { cn } from '@/lib/utils';

export interface PaginationProps {
  /** หน้าปัจจุบัน (1-based) */
  currentPage: number;
  /** จำนวนรายการทั้งหมด */
  totalItems: number;
  /** จำนวนรายการต่อหน้า */
  pageSize: number;
  /** ฟังก์ชันที่เรียกเมื่อเปลี่ยนหน้า */
  onPageChange: (page: number) => void;
  /** ฟังก์ชันที่เรียกเมื่อเปลี่ยน page size */
  onPageSizeChange?: (size: number) => void;
  /** ตัวเลือก page size */
  pageSizeOptions?: number[];
  /** แสดง page size selector */
  showPageSizeSelector?: boolean;
  /** แสดง result count */
  showResultCount?: boolean;
  /** Label สำหรับ result count */
  resultLabel?: string;
  /** ซ่อน pagination (แสดงแค่ count) */
  simple?: boolean;
  /** className เพิ่มเติม */
  className?: string;
}

export function Pagination({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  showPageSizeSelector = true,
  showResultCount = true,
  resultLabel = 'รายการ',
  simple = false,
  className,
}: PaginationProps) {
  const totalPages = Math.ceil(totalItems / pageSize);
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  // Generate page numbers to show
  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];
    const maxVisible = 7;

    if (totalPages <= maxVisible) {
      // Show all pages
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (currentPage <= 4) {
        // Near the start
        for (let i = 2; i <= 5; i++) {
          pages.push(i);
        }
        pages.push('ellipsis');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 3) {
        // Near the end
        pages.push('ellipsis');
        for (let i = totalPages - 4; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // In the middle
        pages.push('ellipsis');
        for (let i = currentPage - 1; i <= currentPage + 1; i++) {
          pages.push(i);
        }
        pages.push('ellipsis');
        pages.push(totalPages);
      }
    }

    return pages;
  };

  const pageNumbers = getPageNumbers();

  if (totalItems === 0) {
    return null;
  }

  if (simple) {
    // Simple mode: just show count
    return (
      <div className={cn('flex items-center justify-between px-2 py-3', className)}>
        {showResultCount && (
          <p className="text-sm text-gray-500">
            {showResultCount && `แสดง ${totalItems} ${resultLabel}`}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 px-2 py-3', className)}>
      {/* Result Count & Page Size */}
      <div className="flex items-center gap-4">
        {showResultCount && (
          <p className="text-sm text-gray-500">
            แสดง {startItem}-{endItem} จาก {totalItems} {resultLabel}
          </p>
        )}

        {showPageSizeSelector && onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">แสดง</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <span className="text-sm text-gray-500">{resultLabel}/หน้า</span>
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      <div className="flex items-center gap-1">
        {/* Previous Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="hidden sm:flex"
        >
          <svg
            className="h-4 w-4 mr-1"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          ก่อนหน้า
        </Button>

        {/* Mobile: just prev/next */}
        <Button
          variant="outline"
          size="icon"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="sm:hidden h-8 w-8"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </Button>

        {/* Page Numbers */}
        <div className="hidden sm:flex items-center gap-1">
          {pageNumbers.map((page, index) =>
            page === 'ellipsis' ? (
              <span
                key={`ellipsis-${index}`}
                className="px-2 py-1 text-gray-400"
              >
                ...
              </span>
            ) : (
              <Button
                key={page}
                variant={currentPage === page ? 'default' : 'outline'}
                size="sm"
                onClick={() => onPageChange(page)}
                className="w-9 h-8"
              >
                {page}
              </Button>
            )
          )}
        </div>

        {/* Next Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="hidden sm:flex"
        >
          ถัดไป
          <svg
            className="h-4 w-4 ml-1"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </Button>

        <Button
          variant="outline"
          size="icon"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="sm:hidden h-8 w-8"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </Button>
      </div>
    </div>
  );
}
