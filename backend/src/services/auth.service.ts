/**
 * Auth Service
 * ------------
 * Handles password hashing, verification, and authentication logic.
 * 
 * bcrypt-only: ระบบเก็บ bcrypt hash เท่านั้น (migration 020 + 025)
 * ไม่มี plaintext fallback — hash ที่ไม่ใช่ bcrypt ถือว่าไม่ถูกต้อง
 */

import { hash, compare } from 'bcryptjs';

const BCRYPT_ROUNDS = 10;

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify password against a bcrypt hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return compare(password, hash);
}

/**
 * Check if a hash looks like a bcrypt hash
 * Bcrypt hashes start with $2a$, $2b$, or $2y$ and are 60 characters long
 */
export function isBcryptHash(value: string): boolean {
  return /^\$2[aby]?\$\d{1,2}\$[./A-Za-z0-9]{53}$/.test(value);
}

/**
 * Generate a secure random password
 * Used for password reset functionality
 * 
 * Uses crypto.getRandomValues (CSPRNG) instead of Math.random()
 * for cryptographically secure random generation.
 */
export function generateSecurePassword(length: number = 16): string {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const special = '!@#$%^&*()_+-=';
  
  // Ensure at least one of each required character type
  const allChars = uppercase + lowercase + numbers + special;
  
  // Use crypto.getRandomValues for cryptographically secure random
  const getSecureRandomIndex = (max: number): number => {
    const randomBuffer = new Uint32Array(1);
    crypto.getRandomValues(randomBuffer);
    return randomBuffer[0] % max;
  };
  
  let password = '';
  password += uppercase[getSecureRandomIndex(uppercase.length)];
  password += lowercase[getSecureRandomIndex(lowercase.length)];
  password += numbers[getSecureRandomIndex(numbers.length)];
  password += special[getSecureRandomIndex(special.length)];
  
  // Fill the rest randomly using CSPRNG
  for (let i = 4; i < length; i++) {
    password += allChars[getSecureRandomIndex(allChars.length)];
  }
  
  // Fisher-Yates shuffle with CSPRNG
  const chars = password.split('');
  for (let i = chars.length - 1; i > 0; i--) {
    const j = getSecureRandomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  
  return chars.join('');
}
