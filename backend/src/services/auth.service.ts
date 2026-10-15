/**
 * Auth Service
 * ------------
 * Handles password hashing, verification, and authentication logic.
 * 
 * Supports dual-mode migration:
 * - Legacy mode: plaintext password comparison (for existing users)
 * - Migrated mode: bcrypt comparison (for migrated users)
 */

import { hash, compare, genSalt } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { adminUsers } from '../db/schema';
import type { Bindings } from '../types';

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
 * Verify password for login
 * Supports dual-mode:
 * - If passwordHash looks like bcrypt: use bcrypt.compare()
 * - If passwordHash is plaintext: return true only if exact match
 *   (will trigger migration on successful login)
 */
export async function verifyPasswordForLogin(
  password: string,
  passwordHash: string,
  isMigrated: boolean
): Promise<{ valid: boolean; needsMigration: boolean }> {
  // If user is marked as migrated, always use bcrypt
  if (isMigrated || isBcryptHash(passwordHash)) {
    const valid = await verifyPassword(password, passwordHash);
    return { valid, needsMigration: false };
  }

  // Legacy mode: plaintext comparison (for migration period)
  // This is only used when isMigrated = false AND passwordHash doesn't look like bcrypt
  const valid = password === passwordHash;
  // If plaintext match, flag for migration
  return { valid, needsMigration: valid };
}

/**
 * Migrate a user's password from plaintext to bcrypt
 * Returns the new bcrypt hash
 */
export async function migratePassword(
  env: Bindings,
  userId: string,
  password: string
): Promise<string> {
  const db = drizzle(env.DB);
  
  // Hash the plaintext password
  const newHash = await hashPassword(password);
  
  // Update in database
  await db.update(adminUsers)
    .set({ 
      passwordHash: newHash,
      passwordMigrated: true 
    })
    .where(eq(adminUsers.id, userId));
  
  return newHash;
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
