/**
 * Safe Unix Timestamp Conversion Utilities
 * 
 * Problem: Drizzle ORM with Cloudflare D1 may return timestamps as:
 * - Date objects (in development)
 * - Numbers (Unix timestamps in production)
 * - Strings (ISO dates in some configurations)
 * - null/undefined
 * 
 * This causes "value.getTime is not a function" errors when code assumes
 * all timestamp values are Date objects.
 * 
 * Solution: Safe conversion that handles all types.
 */

// =============================================================================
// toUnixTimestamp - Convert any timestamp value to Unix seconds
// Returns null for invalid/null values
// =============================================================================
export function toUnixTimestamp(
  value: Date | number | string | null | undefined | unknown
): number | null {
  if (value === null || value === undefined) return null;
  
  // Already a Unix timestamp (number)
  if (typeof value === 'number') return value;
  
  // Date object
  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000);
  }
  
  // String (ISO date or other string representation)
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return isNaN(parsed) ? null : Math.floor(parsed / 1000);
  }
  
  return null;
}

// =============================================================================
// toDate - Convert any timestamp value to Date object
// Returns null for invalid/null values
// =============================================================================
export function toDate(
  value: Date | number | string | null | undefined | unknown
): Date | null {
  if (value === null || value === undefined) return null;
  
  // Already a Date object
  if (value instanceof Date) return value;
  
  // Unix timestamp (seconds or milliseconds)
  if (typeof value === 'number') {
    // Assume seconds if < 10 billion (before year 2286)
    // Otherwise assume milliseconds
    const ms = value < 10000000000 ? value * 1000 : value;
    return new Date(ms);
  }
  
  // String (ISO date)
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return isNaN(parsed) ? null : new Date(parsed);
  }
  
  return null;
}

// =============================================================================
// nowUnix - Current Unix timestamp in seconds
// =============================================================================
export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

// =============================================================================
// nowUnixMs - Current Unix timestamp in milliseconds
// =============================================================================
export function nowUnixMs(): number {
  return Date.now();
}
