/**
 * Date Formatting Utilities
 * -------------------------
 * Utilities สำหรับจัดการ date formatting ที่รองรับหลายรูปแบบ
 * 
 * Supports:
 * - Date object
 * - ISO string
 * - Unix timestamp (seconds)
 * - Unix timestamp (milliseconds)
 * - numeric string
 * - null / undefined / empty string
 * - invalid values
 */

/**
 * Normalize various date inputs to a valid Date object or null
 * 
 * @param value - Input value of any type
 * @returns Valid Date object or null if invalid
 */
export function normalizeDate(value: unknown): Date | null {
  // Handle null, undefined, empty string
  if (value == null || value === '') {
    return null;
  }

  // Handle Date object
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  // Handle number (Unix timestamp - could be seconds or milliseconds)
  if (typeof value === 'number') {
    // Distinguish between seconds and milliseconds
    // Values < 10,000,000,000 are likely seconds
    // Values >= 10,000,000,000 are likely milliseconds
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Handle string (could be ISO string or numeric string)
  if (typeof value === 'string') {
    const trimmed = value.trim();
    
    // Empty after trim
    if (trimmed === '') {
      return null;
    }

    // Try parsing as numeric string first
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      // Distinguish between seconds and milliseconds
      const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
      const date = new Date(milliseconds);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    // Try parsing as ISO string or other date format
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Other types - return null
  return null;
}

/**
 * Format a date for display in Thai locale
 * 
 * @param value - Input value of any type (Date, string, number, null)
 * @param options - Intl.DateTimeFormat options (default: date only, Thai locale)
 * @returns Formatted date string or fallback text
 */
export function formatDateThai(
  value: unknown,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
): string {
  const date = normalizeDate(value);
  
  if (date === null) {
    return '-';
  }

  try {
    return date.toLocaleDateString('th-TH', options);
  } catch {
    return '-';
  }
}

/**
 * Format last login timestamp for User Management display
 * 
 * @param lastLoginAt - Last login timestamp (any supported format)
 * @returns Thai formatted date string
 */
export function formatLastLogin(lastLoginAt: unknown): string {
  // null/undefined/empty → "ยังไม่เคยเข้าสู่ระบบ"
  if (lastLoginAt == null || lastLoginAt === '') {
    return 'ยังไม่เคยเข้าสู่ระบบ';
  }

  // Try to normalize the value
  const date = normalizeDate(lastLoginAt);
  
  if (date !== null) {
    try {
      return date.toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      // Fall through to return dash
    }
  }

  // Invalid value (not null) → "-"
  return '-';
}

/**
 * Format password change timestamp for User Management display
 * 
 * @param passwordChangedAt - Password change timestamp (any supported format)
 * @returns Thai formatted date string or fallback text
 */
export function formatPasswordChanged(passwordChangedAt: unknown): string {
  const date = normalizeDate(passwordChangedAt);
  
  if (date === null) {
    return 'ยังไม่เคยเปลี่ยน';
  }

  try {
    return date.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '-';
  }
}
