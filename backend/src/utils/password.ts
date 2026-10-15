/**
 * Password Validation Utility
 * ---------------------------
 * Validates password strength according to policy:
 * - Minimum 8 characters
 * - At least 1 uppercase letter
 * - At least 1 lowercase letter
 * - At least 1 number
 * - At least 1 special character (!@#$%^&*()_+-=[]{}|;':\",./<>?)
 */

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('รหัสผ่านต้องมีตัวพิมพ์ใหญ่อย่างน้อย 1 ตัว');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('รหัสผ่านต้องมีตัวพิมพ์เล็กอย่างน้อย 1 ตัว');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว');
  }

  if (!/[!@#$%^&*()_+\-=\[\]{}|;':",./<>?\\]/.test(password)) {
    errors.push('รหัสผ่านต้องมีอักขระพิเศษอย่างน้อย 1 ตัว (!@#$%^&*()_+-=[]{}|;\':\",./<>?)');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check if a password is in a list of common weak passwords
 * In production, use a more comprehensive list or a dedicated library
 */
export function isCommonPassword(password: string): boolean {
  const commonPasswords = [
    'password', 'password123', 'password1234', '12345678', '123456789',
    'admin123', 'admin1234', 'welcome', 'welcome123', 'changeme',
    '123456', '1234567890', 'qwerty', 'abc123', 'letmein',
    'monkey', 'dragon', 'master', 'login', 'passw0rd',
  ];
  return commonPasswords.includes(password.toLowerCase());
}
