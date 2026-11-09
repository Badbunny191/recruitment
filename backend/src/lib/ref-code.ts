/**
 * Ref Code Generator for Submission Failure Evidence
 * =================================================
 *
 * Requirements:
 * - Prefix: 'ERR-'
 * - 6 random characters from Crockford Base32 variant:
 *   Excludes 0, O, 1, I, L, U to eliminate visual and phonetic ambiguity.
 * - Alphabet: 23456789ABCDEFGHJKMNPQRSTVWXYZ (30 characters)
 * - Format: ERR-XXXXXX (e.g. ERR-7K9M2P)
 */

export const REF_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateRefCode(): string {
  const chars: string[] = [];
  const alphabetLen = REF_CODE_ALPHABET.length;

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < 6; i++) {
      chars.push(REF_CODE_ALPHABET[bytes[i] % alphabetLen]);
    }
  } else {
    for (let i = 0; i < 6; i++) {
      chars.push(REF_CODE_ALPHABET[Math.floor(Math.random() * alphabetLen)]);
    }
  }

  return `ERR-${chars.join('')}`;
}

export function isValidRefCode(code: string): boolean {
  return /^ERR-[2-9A-HJ-NP-Z]{6}$/.test(code);
}
