import { eq, and, isNull, sql, desc, inArray } from 'drizzle-orm';
import { applications, recruitmentRounds } from '../db/schema';

export interface ApplicantLookupInput {
  roundId: string;
  email: string;
  phone: string;
}

export interface ApplicantLookupResult {
  applicationNo: string;
  positionTitle: string;
  roundTitle: string;
  submittedAt: Date | number | null;
  status: string;
}

export type LookupServiceResponse =
  | { ok: true; data: ApplicantLookupResult }
  | { ok: false; error: 'NOT_FOUND' | 'INVALID_INPUT'; message: string };

/**
 * Normalize phone number by validating format and extracting only digits.
 * Converts Thai country code +66... to 0...
 * Rejects input containing letters, special characters, or invalid length.
 */
export function normalizePhone(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();

  // Rejects invalid characters (letters like 'dd', special characters like '@#$')
  // Allowed: digits, whitespace, hyphens, plus, parentheses, dots
  if (/[^0-9+\s\-().]/.test(trimmed)) {
    return '';
  }

  let digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('66') && digits.length >= 10) {
    digits = '0' + digits.slice(2);
  }

  // Must be a plausible phone number length (8-12 digits)
  if (digits.length < 8 || digits.length > 12) {
    return '';
  }

  return digits;
}

/**
 * Extract potential phone values from formData.
 * Checks known keys first (field-phone, phone, tel, mobile) and falls back
 * to scanning keys that contain 'phone' or 'tel'.
 */
export function extractPhoneCandidates(formData: Record<string, unknown> | null | undefined): string[] {
  if (!formData || typeof formData !== 'object') return [];
  const candidates: string[] = [];

  const directKeys = ['field-phone', 'phone', 'tel', 'mobile'];
  for (const k of directKeys) {
    const val = formData[k];
    if (typeof val === 'string' && val.trim()) {
      candidates.push(val.trim());
    }
  }

  for (const [key, val] of Object.entries(formData)) {
    if (typeof val === 'string' && val.trim()) {
      const lowerKey = key.toLowerCase();
      if ((lowerKey.includes('phone') || lowerKey.includes('tel') || lowerKey.includes('โทร')) && !candidates.includes(val.trim())) {
        candidates.push(val.trim());
      }
    }
  }

  return candidates;
}

/**
 * Check if a stored phone number matches the user's input.
 */
export function isPhoneMatch(rawStoredPhone: string, rawInputPhone: string): boolean {
  const normStored = normalizePhone(rawStoredPhone);
  const normInput = normalizePhone(rawInputPhone);
  return normStored.length >= 8 && normInput.length >= 8 && normStored === normInput;
}

/**
 * Core business logic for Phase 1 Applicant Lookup.
 * Enforces lookup by Round + Email + Phone only.
 * Returns only safe fields: applicationNo, positionTitle, submittedAt, status.
 */
export async function lookupApplication(
  db: any,
  input: ApplicantLookupInput
): Promise<LookupServiceResponse> {
  const cleanEmail = (input.email || '').trim().toLowerCase();
  const cleanPhone = normalizePhone(input.phone || '');

  if (!input.roundId || !cleanEmail || cleanPhone.length < 8) {
    return {
      ok: false,
      error: 'INVALID_INPUT',
      message: 'กรุณาระบุรอบรับสมัคร อีเมล และเบอร์โทรศัพท์ให้ถูกต้อง',
    };
  }

  // 1. Verify round exists and fetch position information
  const round = await db
    .select({
      id: recruitmentRounds.id,
      title: recruitmentRounds.title,
      positionLevel: recruitmentRounds.positionLevel,
    })
    .from(recruitmentRounds)
    .where(
      and(
        eq(recruitmentRounds.id, input.roundId),
        isNull(recruitmentRounds.deletedAt)
      )
    )
    .get();

  if (!round) {
    return {
      ok: false,
      error: 'NOT_FOUND',
      message: 'ไม่พบข้อมูลรอบรับสมัครที่ระบุ',
    };
  }

  // 2. Fetch applications for this round and email
  const apps = await db
    .select({
      id: applications.id,
      applicationNo: applications.applicationNo,
      status: applications.status,
      submittedAt: applications.submittedAt,
      formData: applications.formData,
    })
    .from(applications)
    .where(
      and(
        eq(applications.roundId, input.roundId),
        eq(sql`lower(${applications.email})`, cleanEmail),
        isNull(applications.deletedAt)
      )
    )
    .orderBy(desc(applications.submittedAt))
    .all();

  if (!apps || apps.length === 0) {
    return {
      ok: false,
      error: 'NOT_FOUND',
      message: 'ไม่พบข้อมูลใบสมัครที่ตรงกับข้อมูลที่ระบุ',
    };
  }

  // 3. Find application where phone number matches
  const matchedApp = apps.find((app: any) => {
    let parsedFormData = app.formData;
    if (typeof parsedFormData === 'string') {
      try {
        parsedFormData = JSON.parse(parsedFormData);
      } catch {
        // invalid JSON
      }
    }
    const candidates = extractPhoneCandidates(parsedFormData);
    return candidates.some((cand) => isPhoneMatch(cand, input.phone));
  });

  if (!matchedApp) {
    return {
      ok: false,
      error: 'NOT_FOUND',
      message: 'ไม่พบข้อมูลใบสมัครที่ตรงกับข้อมูลที่ระบุ',
    };
  }

  return {
    ok: true,
    data: {
      applicationNo: matchedApp.applicationNo || '-',
      positionTitle: round.positionLevel || round.title,
      roundTitle: round.title,
      submittedAt: matchedApp.submittedAt,
      status: matchedApp.status || 'SUBMITTED',
    },
  };
}

/**
 * Fetch available recruitment rounds for applicant lookup.
 * Includes both ACTIVE and CLOSED rounds so applicants can check past applications.
 */
export async function getLookupRoundOptions(db: any) {
  return await db
    .select({
      id: recruitmentRounds.id,
      title: recruitmentRounds.title,
      positionLevel: recruitmentRounds.positionLevel,
      status: recruitmentRounds.status,
    })
    .from(recruitmentRounds)
    .where(
      and(
        inArray(recruitmentRounds.status, ['ACTIVE', 'CLOSED']),
        isNull(recruitmentRounds.deletedAt)
      )
    )
    .orderBy(desc(recruitmentRounds.createdAt))
    .all();
}
