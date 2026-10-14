/**
 * Application Number Utility
 * --------------------------------------------
 * Responsible for:
 *   - Generating a unique application number in the format:
 *       APP-YYYY-NNNN
 *   - Parsing the same format back to structured fields.
 *   - Computing the current "Bangkok year" (Asia/Bangkok, UTC+7).
 *
 * The generated number is what end-users see on their application receipt
 * and on the admin review screen, so the format is a stable contract.
 *
 * Source of truth for time: `Date.now()` is a UTC millisecond epoch.
 * Bangkok is a fixed UTC+7 offset (no DST), so we can shift by +7h to
 * obtain the Bangkok wall-clock instant without depending on the runtime's
 * locale / IANA database. This keeps the helper small and portable across
 * Cloudflare Workers.
 *
 * IMPORTANT: This module does NOT guarantee uniqueness on its own. The
 * unique-constraint protection + retry loop in the submit route is the
 * source of truth. This module is the deterministic *formatter*.
 */

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

const APPLICATION_NO_REGEX = /^APP-(\d{4})-(\d{1,})$/;

/**
 * Returns the current year in Asia/Bangkok (UTC+7) as a 4-digit number.
 *
 * Example:
 *   - 2026-12-31 17:30 UTC   → 2026-12-31 24:30 Bangkok → 2027
 *   - 2026-12-31 16:59 UTC   → 2026-12-31 23:59 Bangkok → 2026
 *
 * @returns Year number (e.g. 2026, 2027)
 */
export function getCurrentBangkokYear(now: number = Date.now()): number {
  const bangkokMs = now + BANGKOK_OFFSET_MS;
  return new Date(bangkokMs).getUTCFullYear();
}

/**
 * Builds the `APP-YYYY-` prefix for the given year.
 *
 * @param year 4-digit year. Defaults to the current Bangkok year.
 */
export function getApplicationNoPrefix(year: number = getCurrentBangkokYear()): string {
  return `APP-${year}-`;
}

/**
 * Build a candidate application number for the given year + sequence.
 * The sequence is zero-padded to at least 4 digits, but will grow as
 * needed (e.g. APP-2026-12345) to keep the format readable.
 *
 * @param year      4-digit year (Bangkok time). Defaults to current.
 * @param sequence  1-based sequence number. Must be >= 1.
 */
export function buildApplicationNo(year: number, sequence: number): string {
  if (!Number.isFinite(year) || year < 1900 || year > 9999) {
    throw new Error(`Invalid year: ${year}`);
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Invalid sequence: ${sequence}`);
  }
  return `APP-${year}-${String(sequence).padStart(4, '0')}`;
}

/**
 * Parse an application number into its structured components.
 *
 * @returns `{ year, sequence, formatted }` on success, `null` on failure.
 *
 * Note: This is permissive about the sequence length so it can read both
 * legacy 4-digit numbers and any future wider sequences. It does NOT
 * validate that the year is the current year — that is by design so
 * historical records remain parseable.
 */
export function parseApplicationNo(
  applicationNo: string | null | undefined,
): { year: number; sequence: number; formatted: string } | null {
  if (!applicationNo || typeof applicationNo !== 'string') return null;
  const match = applicationNo.match(APPLICATION_NO_REGEX);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const sequence = Number.parseInt(match[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(sequence)) return null;
  return {
    year,
    sequence,
    formatted: applicationNo,
  };
}

/**
 * Extract just the year from an application number. Returns null if the
 * input is not in the expected format. Useful for filtering queries.
 */
export function getYearFromApplicationNo(
  applicationNo: string | null | undefined,
): number | null {
  const parsed = parseApplicationNo(applicationNo);
  return parsed ? parsed.year : null;
}

/**
 * Sanity-check that a string looks like a well-formed application number.
 */
export function isValidApplicationNo(
  applicationNo: string | null | undefined,
): boolean {
  return parseApplicationNo(applicationNo) !== null;
}
