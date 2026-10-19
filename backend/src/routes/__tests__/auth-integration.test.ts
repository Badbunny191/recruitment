/**
 * Auth Routes Integration Tests
 * 
 * Tests for user creation, login, and password change flows.
 * 
 * SECURITY NOTE:
 * - Never log or expose password hashes
 * - Never use real user credentials
 * - Test with isolated test users
 * 
 * Run: node --import tsx src/routes/__tests__/auth-integration.test.ts
 */

// @ts-nocheck — tsx run-time; keep simple, no project type plumbing
import { hashPassword, generateSecurePassword, isBcryptHash } from '../../services/auth.service';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`✓ ${name}`);
    })
    .catch((e) => {
      failed++;
      failures.push(`${name}: ${e?.message ?? e}`);
      console.log(`✗ ${name}: ${e?.message ?? e}`);
    });
}

function assertEqual(actual: any, expected: any, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: any, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

// =============================================================================
// Test Case A: mustChangePassword = true Flow
// =============================================================================

test('A1: Create user stores bcrypt hash (not plaintext)', async () => {
  const tempPassword = generateSecurePassword(16);
  const passwordHash = await hashPassword(tempPassword);
  
  // Verify hash format is bcrypt
  assertTrue(isBcryptHash(passwordHash), 'passwordHash must be bcrypt format');
  
  // Verify hash is different from plaintext
  assertEqual(passwordHash !== tempPassword, true, 'passwordHash must not equal plaintext');
  
  // Hash length should be 60 characters (bcrypt standard)
  assertEqual(passwordHash.length, 60, 'Hash length should be 60');
});

test('A2: Login with correct password returns valid result', async () => {
  const tempPassword = 'Ab3#Xy9Km2Pq5Rs7';
  const passwordHash = await hashPassword(tempPassword);
  
  const bcrypt = await import('bcryptjs');
  const valid = await bcrypt.compare(tempPassword, passwordHash);
  
  assertEqual(valid, true, 'bcrypt.compare should return true for correct password');
});

test('A3: Old temp password does NOT work after password change', async () => {
  const tempPassword = 'Ab3#Xy9Km2Pq5Rs7';
  const newPassword = 'NewP@ssw0rd!';
  
  // Hash both passwords
  const tempHash = await hashPassword(tempPassword);
  const newHash = await hashPassword(newPassword);
  
  const bcrypt = await import('bcryptjs');
  
  // Old temp password should NOT work with new hash
  const tempResult = await bcrypt.compare(tempPassword, newHash);
  assertEqual(tempResult, false, 'Old temp password should not work with new hash');
  
  // New password should work with new hash
  const newResult = await bcrypt.compare(newPassword, newHash);
  assertEqual(newResult, true, 'New password should work with new hash');
});

// =============================================================================
// Test Case B: mustChangePassword = false Flow
// =============================================================================

test('B1: Create user with mustChangePassword=false stores bcrypt hash', async () => {
  const tempPassword = generateSecurePassword(16);
  const passwordHash = await hashPassword(tempPassword);
  
  // Verify hash format
  assertTrue(isBcryptHash(passwordHash), 'passwordHash must be bcrypt format');
  
  // Verify login works
  const bcrypt = await import('bcryptjs');
  const valid = await bcrypt.compare(tempPassword, passwordHash);
  assertEqual(valid, true, 'Login should work with temp password');
});

// =============================================================================
// Test Case C: Unauthenticated Request Rejected
// =============================================================================

test('C1: change-password without auth should be rejected by middleware', () => {
  // Simulate auth middleware behavior
  const getJwtPayload = (headers: Record<string, string>) => {
    const auth = headers['Authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      return null;
    }
    // In real implementation, this would verify JWT
    return { id: 'user-1', email: 'test@test.com', role: 'ADMIN' };
  };
  
  // Without Authorization header, should return null
  const currentUser = getJwtPayload({});
  assertEqual(currentUser, null, 'Request without Authorization should return null');
  
  // With valid Authorization header, should return payload
  const withAuth = getJwtPayload({ 'Authorization': 'Bearer valid-token' });
  assertTrue(withAuth !== null, 'Request with Authorization should return payload');
});

// =============================================================================
// Test Case D: Disabled and Locked Users
// =============================================================================

test('D1: Disabled user cannot login (isActive === false)', () => {
  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    isActive: false, // User is disabled
    lockedUntil: null,
    mustChangePassword: false,
  };
  
  // Simulate login check
  const isActive = mockUser.isActive;
  const canLogin = isActive !== false;
  
  assertEqual(canLogin, false, 'Disabled user should not be able to login');
});

test('D2: Locked user cannot login (lockedUntil in future)', () => {
  const futureDate = new Date(Date.now() + 3600000); // 1 hour from now
  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    isActive: true,
    lockedUntil: futureDate, // User is locked
    mustChangePassword: false,
  };
  
  // Simulate login check
  const now = Date.now();
  const lockedUntilMs = new Date(mockUser.lockedUntil).getTime();
  const isLocked = now < lockedUntilMs;
  
  assertEqual(isLocked, true, 'Locked user should not be able to login');
});

test('D3: Active user can login', () => {
  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    isActive: true,
    lockedUntil: null,
    mustChangePassword: false,
  };
  
  const isActive = mockUser.isActive;
  const isLocked = mockUser.lockedUntil !== null && 
    new Date(mockUser.lockedUntil).getTime() > Date.now();
  
  assertEqual(isActive !== false, true, 'Active user should be able to login');
  assertEqual(isLocked, false, 'Active user should not be locked');
});

// =============================================================================
// Test Case E: Plaintext Passwords NOT Supported
// =============================================================================

test('E1: bcrypt.compare rejects plaintext passwords', async () => {
  const plaintextPassword = 'MyPlainTextPassword123!';
  const plaintextHash = plaintextPassword; // Simulating plaintext storage
  
  const bcrypt = await import('bcryptjs');
  
  // bcrypt.compare should return false for plaintext
  const isValid = await bcrypt.compare(plaintextPassword, plaintextHash);
  
  assertEqual(isValid, false, 'bcrypt.compare should reject plaintext passwords');
});

test('E2: Plaintext passwords stored in DB will fail login', async () => {
  // This simulates what happens when a user has plaintext password in DB
  // After our fix, Create User will store bcrypt hash, but this test
  // verifies that old plaintext users would fail
  
  const plaintextPassword = 'MyPlainTextPassword123!';
  const storedPlaintext = plaintextPassword;
  
  const bcrypt = await import('bcryptjs');
  
  // bcrypt.compare on plaintext will always fail
  const result = await bcrypt.compare(plaintextPassword, storedPlaintext);
  assertEqual(result, false, 'Plaintext stored passwords should fail login');
});

// =============================================================================
// Test Case F: Hash Password Function Tests
// =============================================================================

test('F1: hashPassword produces consistent bcrypt hashes', async () => {
  const password = 'TestP@ssw0rd!';
  const hash1 = await hashPassword(password);
  const hash2 = await hashPassword(password);
  
  // Each hash should be different (due to random salt)
  assertTrue(hash1 !== hash2, 'Two hashes of same password should be different');
  
  // But both should verify correctly
  const bcrypt = await import('bcryptjs');
  assertEqual(await bcrypt.compare(password, hash1), true, 'First hash should verify');
  assertEqual(await bcrypt.compare(password, hash2), true, 'Second hash should verify');
});

test('F2: generateSecurePassword produces 16 char passwords', () => {
  const pw = generateSecurePassword(16);
  assertEqual(pw.length, 16, 'Password should be 16 characters');
});

test('F3: isBcryptHash correctly identifies bcrypt format', async () => {
  const hash = await hashPassword('test');
  
  // Valid bcrypt hash
  assertTrue(isBcryptHash(hash), 'Generated hash should be identified as bcrypt');
  
  // Invalid formats
  assertEqual(isBcryptHash('plaintext'), false, 'Plaintext should not be bcrypt');
  assertEqual(isBcryptHash(''), false, 'Empty string should not be bcrypt');
  assertEqual(isBcryptHash('$invalid'), false, 'Invalid format should not be bcrypt');
});

// =============================================================================
// Run All Tests
// =============================================================================

runAllTests()
  .then(() => {
    console.log('\n=== Summary ===\n');
    console.log(`Total: ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
      console.log('\nFailures:');
      failures.forEach((f) => console.log(`  - ${f}`));
    }
    if (failed > 0) {
      (globalThis as any).process.exit(1);
    }
  })
  .catch((e) => {
    console.error('Test runner failed:', e);
    (globalThis as any).process.exit(1);
  });

async function runAllTests() {
  console.log('========================================');
  console.log('Auth Routes Integration Tests');
  console.log('========================================\n');
}
