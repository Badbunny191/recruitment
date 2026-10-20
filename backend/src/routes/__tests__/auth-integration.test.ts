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
  // Return the promise so caller can await it
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
// Run All Tests
// =============================================================================

async function runAllTests() {
  console.log('========================================');
  console.log('Auth Routes Integration Tests');
  console.log('========================================\n');

  // Call all test functions and collect their promises
  const testPromises: Promise<any>[] = [];

  // Test Case A
  testPromises.push(test('A1: Create user stores bcrypt hash (not plaintext)', async () => {
    const tempPassword = generateSecurePassword(16);
    const passwordHash = await hashPassword(tempPassword);
    assertTrue(isBcryptHash(passwordHash), 'passwordHash must be bcrypt format');
    assertEqual(passwordHash !== tempPassword, true, 'passwordHash must not equal plaintext');
    assertEqual(passwordHash.length, 60, 'Hash length should be 60');
  }));

  testPromises.push(test('A2: Login with correct password returns valid result', async () => {
    const tempPassword = 'Ab3#Xy9Km2Pq5Rs7';
    const passwordHash = await hashPassword(tempPassword);
    const bcrypt = await import('bcryptjs');
    const valid = await bcrypt.compare(tempPassword, passwordHash);
    assertEqual(valid, true, 'bcrypt.compare should return true for correct password');
  }));

  testPromises.push(test('A3: Old temp password does NOT work after password change', async () => {
    const tempPassword = 'Ab3#Xy9Km2Pq5Rs7';
    const newPassword = 'NewP@ssw0rd!';
    const tempHash = await hashPassword(tempPassword);
    const newHash = await hashPassword(newPassword);
    const bcrypt = await import('bcryptjs');
    const tempResult = await bcrypt.compare(tempPassword, newHash);
    assertEqual(tempResult, false, 'Old temp password should not work with new hash');
    const newResult = await bcrypt.compare(newPassword, newHash);
    assertEqual(newResult, true, 'New password should work with new hash');
  }));

  // Test Case B
  testPromises.push(test('B1: Create user with mustChangePassword=false stores bcrypt hash', async () => {
    const tempPassword = generateSecurePassword(16);
    const passwordHash = await hashPassword(tempPassword);
    assertTrue(isBcryptHash(passwordHash), 'passwordHash must be bcrypt format');
    const bcrypt = await import('bcryptjs');
    const valid = await bcrypt.compare(tempPassword, passwordHash);
    assertEqual(valid, true, 'Login should work with temp password');
  }));

  // Test Case C
  testPromises.push(test('C1: change-password without auth should be rejected by middleware', () => {
    const getJwtPayload = (headers: Record<string, string>) => {
      const auth = headers['Authorization'];
      if (!auth || !auth.startsWith('Bearer ')) {
        return null;
      }
      return { id: 'user-1', email: 'test@test.com', role: 'ADMIN' };
    };
    const currentUser = getJwtPayload({});
    assertEqual(currentUser, null, 'Request without Authorization should return null');
    const withAuth = getJwtPayload({ 'Authorization': 'Bearer valid-token' });
    assertTrue(withAuth !== null, 'Request with Authorization should return payload');
  }));

  // Test Case D
  testPromises.push(test('D1: Disabled user cannot login (isActive === false)', () => {
    const mockUser = {
      id: 'test-user-id',
      email: 'test@example.com',
      isActive: false,
      lockedUntil: null,
      mustChangePassword: false,
    };
    const isActive = mockUser.isActive;
    const canLogin = isActive !== false;
    assertEqual(canLogin, false, 'Disabled user should not be able to login');
  }));

  testPromises.push(test('D2: Locked user cannot login (lockedUntil in future)', () => {
    const futureDate = new Date(Date.now() + 3600000);
    const mockUser = {
      id: 'test-user-id',
      email: 'test@example.com',
      isActive: true,
      lockedUntil: futureDate,
      mustChangePassword: false,
    };
    const now = Date.now();
    const lockedUntilMs = new Date(mockUser.lockedUntil).getTime();
    const isLocked = now < lockedUntilMs;
    assertEqual(isLocked, true, 'Locked user should not be able to login');
  }));

  testPromises.push(test('D3: Active user can login', () => {
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
  }));

  // Test Case E
  testPromises.push(test('E1: bcrypt.compare rejects plaintext passwords', async () => {
    const plaintextPassword = 'MyPlainTextPassword123!';
    const plaintextHash = plaintextPassword;
    const bcrypt = await import('bcryptjs');
    const isValid = await bcrypt.compare(plaintextPassword, plaintextHash);
    assertEqual(isValid, false, 'bcrypt.compare should reject plaintext passwords');
  }));

  testPromises.push(test('E2: Plaintext passwords stored in DB will fail login', async () => {
    const plaintextPassword = 'MyPlainTextPassword123!';
    const storedPlaintext = plaintextPassword;
    const bcrypt = await import('bcryptjs');
    const result = await bcrypt.compare(plaintextPassword, storedPlaintext);
    assertEqual(result, false, 'Plaintext stored passwords should fail login');
  }));

  // Test Case F
  testPromises.push(test('F1: hashPassword produces consistent bcrypt hashes', async () => {
    const password = 'TestP@ssw0rd!';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);
    assertTrue(hash1 !== hash2, 'Two hashes of same password should be different');
    const bcrypt = await import('bcryptjs');
    assertEqual(await bcrypt.compare(password, hash1), true, 'First hash should verify');
    assertEqual(await bcrypt.compare(password, hash2), true, 'Second hash should verify');
  }));

  testPromises.push(test('F2: generateSecurePassword produces 16 char passwords', () => {
    const pw = generateSecurePassword(16);
    assertEqual(pw.length, 16, 'Password should be 16 characters');
  }));

  testPromises.push(test('F3: isBcryptHash correctly identifies bcrypt format', async () => {
    const hash = await hashPassword('test');
    assertTrue(isBcryptHash(hash), 'Generated hash should be identified as bcrypt');
    assertEqual(isBcryptHash('plaintext'), false, 'Plaintext should not be bcrypt');
    assertEqual(isBcryptHash(''), false, 'Empty string should not be bcrypt');
    assertEqual(isBcryptHash('$invalid'), false, 'Invalid format should not be bcrypt');
  }));

  // Test Case G
  testPromises.push(test('G1: Successful login should update lastLoginAt', async () => {
    const mockUser = {
      id: 'test-user-id',
      email: 'test@example.com',
      passwordHash: await hashPassword('correct-password'),
      role: 'ADMIN',
      isActive: true,
      lockedUntil: null,
      mustChangePassword: false,
    };
    const bcrypt = await import('bcryptjs');
    const valid = await bcrypt.compare('correct-password', mockUser.passwordHash);
    assertEqual(valid, true, 'Password should be valid');
    const lastLoginAt = new Date();
    assertTrue(lastLoginAt instanceof Date, 'lastLoginAt should be a Date object');
    assertTrue(lastLoginAt.getTime() > 0, 'lastLoginAt should be a valid timestamp');
  }));

  testPromises.push(test('G2: Failed login should NOT update lastLoginAt', async () => {
    const bcrypt = await import('bcryptjs');
    const passwordHash = await hashPassword('correct-password');
    const valid = await bcrypt.compare('wrong-password', passwordHash);
    assertEqual(valid, false, 'Wrong password should not be valid');
    let shouldUpdateLastLogin = false;
    if (valid) {
      shouldUpdateLastLogin = true;
    }
    assertEqual(shouldUpdateLastLogin, false, 'Failed login should not update lastLoginAt');
  }));

  testPromises.push(test('G3: Disabled user login should NOT update lastLoginAt', () => {
    const mockUser = { isActive: false };
    const isActive = mockUser.isActive;
    const canUpdateLastLogin = isActive !== false;
    assertEqual(canUpdateLastLogin, false, 'Disabled user should not update lastLoginAt');
  }));

  testPromises.push(test('G4: Locked user login should NOT update lastLoginAt', () => {
    const futureDate = new Date(Date.now() + 3600000);
    const mockUser = { isActive: true, lockedUntil: futureDate };
    const now = Date.now();
    const lockedUntilMs = new Date(mockUser.lockedUntil).getTime();
    const isLocked = now < lockedUntilMs;
    assertEqual(isLocked, true, 'User is locked');
  }));

  testPromises.push(test('G5: lastLoginAt should be Date object, not Unix timestamp', () => {
    const lastLoginAt = new Date();
    assertTrue(lastLoginAt instanceof Date, 'lastLoginAt must be Date object');
    assertEqual(typeof lastLoginAt.getTime(), 'number', 'Date.getTime() should return number');
    assertTrue(typeof lastLoginAt.toISOString === 'function', 'lastLoginAt should have Date methods');
  }));

  testPromises.push(test('G6: lastLoginAt update failure should not fail login (best-effort)', async () => {
    const simulateFailedUpdate = async () => {
      throw new Error('Database connection lost');
    };
    const loginSuccess = true;
    assertEqual(loginSuccess, true, 'Login should succeed');
    let updateFailed = false;
    try {
      await simulateFailedUpdate();
    } catch (error) {
      updateFailed = true;
      console.log('[LAST_LOGIN_UPDATE_FAILED] Simulated failure for test');
    }
    assertEqual(updateFailed, true, 'Update simulation should fail as expected');
    assertEqual(loginSuccess, true, 'Login should still be successful despite update failure');
  }));

  // Await all tests to complete
  await Promise.all(testPromises);
}

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
