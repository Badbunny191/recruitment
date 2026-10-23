// @ts-nocheck
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import * as schema from '../../db/schema';
import {
  normalizePhone,
  extractPhoneCandidates,
  isPhoneMatch,
  lookupApplication,
  getLookupRoundOptions,
} from '../applicant-lookup.service';
import { ApplicationLookupSchema } from '../../schemas/validators';
import {
  rateLimitMiddleware,
  __resetRateLimitStoreForTests,
} from '../../middlewares/rate-limit.middleware';

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });

  sqlite.exec(`
    CREATE TABLE recruitment_rounds (
      id TEXT PRIMARY KEY,
      template_version_id TEXT NOT NULL,
      title TEXT NOT NULL,
      position_level TEXT NOT NULL,
      open_date INTEGER NOT NULL,
      close_date INTEGER NOT NULL,
      status TEXT DEFAULT 'ACTIVE',
      created_at INTEGER DEFAULT (unixepoch()),
      deleted_at INTEGER,
      announcement_title TEXT,
      announcement_description TEXT,
      contact_information TEXT,
      remark TEXT,
      application_pattern TEXT,
      round_code TEXT
    );

    CREATE TABLE applications (
      id TEXT PRIMARY KEY,
      application_no TEXT UNIQUE,
      round_id TEXT NOT NULL REFERENCES recruitment_rounds(id),
      email TEXT NOT NULL,
      fullname TEXT NOT NULL,
      national_id TEXT,
      status TEXT DEFAULT 'SUBMITTED',
      status_reason TEXT,
      verified_by TEXT,
      verified_at INTEGER,
      form_data TEXT NOT NULL,
      submitted_at INTEGER DEFAULT (unixepoch()),
      deleted_at INTEGER,
      year INTEGER,
      round_code TEXT,
      seq_in_round INTEGER
    );
  `);

  return { sqlite, db };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('\n========================================');
  console.log('Applicant Lookup Service Tests');
  console.log('========================================\n');

  let passed = 0;

  // 1. Phone Normalization tests
  console.log('[1] normalizePhone tests');
  assert(normalizePhone('087-543-3363') === '0875433363', 'strips hyphens');
  assert(normalizePhone('+66 87 543 3363') === '0875433363', 'converts +66 to 0');
  assert(normalizePhone('66875433363') === '0875433363', 'converts 66 prefix to 0');
  assert(normalizePhone('02-123-4567') === '021234567', 'supports landline');
  assert(normalizePhone('(02) 123-4567') === '021234567', 'supports parentheses');
  assert(normalizePhone('0987766777dd') === '', 'rejects phone with trailing letters (0987766777dd)');
  assert(normalizePhone('abc0987766777') === '', 'rejects phone with leading letters');
  assert(normalizePhone('0987766777@#') === '', 'rejects phone with special characters');
  assert(normalizePhone('123') === '', 'rejects too short phone');
  assert(isPhoneMatch('0987766777', '0987766777dd') === false, 'isPhoneMatch rejects 0987766777dd');
  assert(isPhoneMatch('098-776-6777', '0987766777dd') === false, 'isPhoneMatch rejects 0987766777dd against formatted stored phone');
  console.log('✓ normalizePhone works for various formats and strictly rejects invalid inputs like 0987766777dd');
  passed++;

  // 2. Phone Extraction tests
  console.log('[2] extractPhoneCandidates tests');
  const fd1 = { 'field-phone': '0812345678', 'field-email': 'test@test.com' };
  assert(extractPhoneCandidates(fd1).includes('0812345678'), 'extracts field-phone');

  const fd2 = { phone: '0899999999' };
  assert(extractPhoneCandidates(fd2).includes('0899999999'), 'extracts phone');

  const fd3 = { custom_telephone_no: '023334444' };
  assert(extractPhoneCandidates(fd3).includes('023334444'), 'extracts key containing telephone');
  console.log('✓ extractPhoneCandidates works across keys');
  passed++;

  // 3. Database lookup tests
  console.log('[3] lookupApplication integration tests');
  const { sqlite, db } = createTestDb();

  // Seed rounds
  sqlite.exec(`
    INSERT INTO recruitment_rounds (id, template_version_id, title, position_level, open_date, close_date, status, created_at)
    VALUES 
      ('round-001', 'tplver-1', 'รับสมัครพนักงานใหม่ ประจำปี 2569', 'ชำนาญการ', 1700000000, 1800000000, 'ACTIVE', 1700000000),
      ('round-002', 'tplver-1', 'รอบที่ปิดแล้ว', 'ปฏิบัติการ', 1600000000, 1650000000, 'CLOSED', 1600000000),
      ('round-draft', 'tplver-1', 'รอบร่าง', 'ชำนาญการพิเศษ', 1700000000, 1800000000, 'DRAFT', 1700000000);
  `);

  // Seed applications
  sqlite.exec(`
    INSERT INTO applications (id, application_no, round_id, email, fullname, status, form_data, submitted_at)
    VALUES
      ('app-1', 'APP-2026-0001', 'round-001', 'somchai@example.com', 'สมชาย สายลม', 'SUBMITTED', '{"field-phone":"0812345678","field-fullname":"สมชาย สายลม"}', 1705000000),
      ('app-2', 'APP-2026-0002', 'round-001', 'somying@example.com', 'สมหญิง จริงใจ', 'QUALIFIED', '{"field-phone":"089-876-5432"}', 1705100000),
      ('app-3', 'APP-2026-0003', 'round-002', 'closed_user@example.com', 'ผู้สมัคร รอบปิด', 'SUBMITTED', '{"phone":"029998888"}', 1620000000),
      ('app-4', 'APP-2026-0004', 'round-001', 'phone_test@example.com', 'ทดสอบ เบอร์โทร', 'SUBMITTED', '{"field-phone":"0987766777"}', 1705200000),
      ('app-cancel-only', 'APP-2026-0010', 'round-001', 'canceled_only@example.com', 'ผู้สมัคร ยกเลิกเดี่ยว', 'CANCELED', '{"field-phone":"0811111111"}', 1705300000),
      ('app-multi-old', 'APP-2026-0020', 'round-001', 'multi_apps@example.com', 'ผู้สมัคร ยื่นซ้ำ', 'CANCELED', '{"field-phone":"0822222222"}', 1705400000),
      ('app-multi-new', 'APP-2026-0021', 'round-001', 'multi_apps@example.com', 'ผู้สมัคร ยื่นซ้ำ', 'SUBMITTED', '{"field-phone":"0833333333"}', 1705500000),
      ('app-archived-only', 'APP-2026-0030', 'round-001', 'archived_only@example.com', 'ผู้สมัคร เก็บเข้าคลัง', 'ARCHIVED', '{"field-phone":"0844444444"}', 1705600000),
      ('app-cancel-then-archived-old', 'APP-2026-0040', 'round-001', 'cancel_then_archive@example.com', 'ผู้สมัคร ยกเลิกแล้วคลัง', 'CANCELED', '{"field-phone":"0855555555"}', 1705700000),
      ('app-cancel-then-archived-new', 'APP-2026-0041', 'round-001', 'cancel_then_archive@example.com', 'ผู้สมัคร ยกเลิกแล้วคลัง', 'ARCHIVED', '{"field-phone":"0866666666"}', 1705800000);
  `);

  // Test 3.1: Successful lookup with exact match
  const res1 = await lookupApplication(db, {
    roundId: 'round-001',
    email: 'somchai@example.com',
    phone: '0812345678',
  });
  assert(res1.ok === true, 'res1 should be ok');
  assert(res1.data.applicationNo === 'APP-2026-0001', 'correct applicationNo');
  assert(res1.data.positionTitle === 'ชำนาญการ', 'correct positionTitle');
  assert(res1.data.status === 'SUBMITTED', 'correct status');
  console.log('✓ exact match succeeds');
  passed++;

  // Test 3.2: Successful lookup with phone format variation and email case difference
  const res2 = await lookupApplication(db, {
    roundId: 'round-001',
    email: 'SOMYING@EXAMPLE.COM',
    phone: '+66 89 876 5432',
  });
  assert(res2.ok === true, 'res2 should be ok');
  assert(res2.data.applicationNo === 'APP-2026-0002', 'correct applicationNo');
  assert(res2.data.status === 'QUALIFIED', 'correct status QUALIFIED');
  console.log('✓ case-insensitive email and formatted phone lookup succeeds');
  passed++;

  // Test 3.3: Lookup for closed round works
  const res3 = await lookupApplication(db, {
    roundId: 'round-002',
    email: 'closed_user@example.com',
    phone: '02-999-8888',
  });
  assert(res3.ok === true, 'res3 should be ok');
  assert(res3.data.applicationNo === 'APP-2026-0003', 'correct applicationNo for closed round');
  console.log('✓ closed round lookup succeeds');
  passed++;

  // Test 3.4: Rejects when phone does not match
  const resWrongPhone = await lookupApplication(db, {
    roundId: 'round-001',
    email: 'somchai@example.com',
    phone: '0899999999',
  });
  assert(resWrongPhone.ok === false, 'wrong phone should fail');
  assert(resWrongPhone.error === 'NOT_FOUND', 'returns NOT_FOUND');
  console.log('✓ wrong phone fails cleanly with NOT_FOUND');
  passed++;

  // Test 3.5: Rejects when round does not match
  const resWrongRound = await lookupApplication(db, {
    roundId: 'round-002',
    email: 'somchai@example.com',
    phone: '0812345678',
  });
  assert(resWrongRound.ok === false, 'wrong round should fail');
  console.log('✓ wrong round fails cleanly');
  passed++;

  // Test 3.6: Rejects invalid inputs
  const resInvalid = await lookupApplication(db, {
    roundId: '',
    email: '',
    phone: '123',
  });
  assert(resInvalid.ok === false, 'invalid input rejected');
  assert(resInvalid.error === 'INVALID_INPUT', 'returns INVALID_INPUT');
  console.log('✓ invalid input rejected');
  passed++;

  // Test 3.7: Rejects phone with letters like 0987766777dd
  const resLettersPhone = await lookupApplication(db, {
    roundId: 'round-001',
    email: 'phone_test@example.com',
    phone: '0987766777dd',
  });
  assert(resLettersPhone.ok === false, 'phone with dd should not match');
  console.log('✓ phone with 0987766777dd does not find application');
  passed++;

  // Test 3.8: Succeeds with correct phone 0987766777
  const resValidPhoneTest = await lookupApplication(db, {
    roundId: 'round-001',
    email: 'phone_test@example.com',
    phone: '0987766777',
  });
  assert(resValidPhoneTest.ok === true, 'correct phone matches');
  assert(resValidPhoneTest.data.applicationNo === 'APP-2026-0004', 'returns correct application');
  console.log('✓ exact valid phone 0987766777 finds application');
  passed++;

  // Test 3.9: CANCELED application with no newer application can be found
  const resCanceledOnly = await lookupApplication(db, {
    roundId: 'round-001',
    email: 'canceled_only@example.com',
    phone: '0811111111',
  });
  assert(resCanceledOnly.ok === true, 'CANCELED application with no newer application is findable');
  assert(resCanceledOnly.data.applicationNo === 'APP-2026-0010', 'returns CANCELED applicationNo');
  assert(resCanceledOnly.data.status === 'CANCELED', 'returns CANCELED status');
  console.log('✓ CANCELED application with no newer application can be looked up and downloaded');
  passed++;

  // Test 3.10: When a newer application exists in the same round, only the new application is shown
  // 10a. Lookup with new application phone succeeds and returns the new application
  const resMultiNew = await lookupApplication(db, {
    roundId: 'round-001',
    email: 'multi_apps@example.com',
    phone: '0833333333',
  });
  assert(resMultiNew.ok === true, 'returns new application');
  assert(resMultiNew.data.applicationNo === 'APP-2026-0021', 'returns only APP-002, not APP-001');
  assert(resMultiNew.data.status === 'SUBMITTED', 'status is SUBMITTED');

  // 10b. Searching with old CANCELED application phone strictly returns NOT_FOUND
  const resMultiOld = await lookupApplication(db, {
    roundId: 'round-001',
    email: 'multi_apps@example.com',
    phone: '0822222222',
  });
  assert(resMultiOld.ok === false, 'cannot find old CANCELED application when a newer one exists');
  assert(resMultiOld.error === 'NOT_FOUND', 'returns NOT_FOUND');
  console.log('✓ when newer application exists in same round, only the new application is shown; old CANCELED app cannot be found or downloaded');
  passed++;

  // Test 3.11: ARCHIVED application cannot be found
  const resArchivedOnly = await lookupApplication(db, {
    roundId: 'round-001',
    email: 'archived_only@example.com',
    phone: '0844444444',
  });
  assert(resArchivedOnly.ok === false, 'ARCHIVED application is not findable');
  assert(resArchivedOnly.error === 'NOT_FOUND', 'ARCHIVED returns NOT_FOUND');
  console.log('✓ ARCHIVED application cannot be found or downloaded');
  passed++;

  // Test 3.12: When latest application is ARCHIVED, older CANCELED application is NOT resurrected
  const resCancelThenArchived = await lookupApplication(db, {
    roundId: 'round-001',
    email: 'cancel_then_archive@example.com',
    phone: '0855555555',
  });
  assert(resCancelThenArchived.ok === false, 'does not fall back to old CANCELED app when current app is ARCHIVED');
  assert(resCancelThenArchived.error === 'NOT_FOUND', 'returns NOT_FOUND');
  console.log('✓ older CANCELED app is not exposed when current application is ARCHIVED');
  passed++;

  // Test 4: getLookupRoundOptions
  const roundOptions = await getLookupRoundOptions(db);
  assert(roundOptions.length === 2, 'returns ACTIVE and CLOSED rounds (excludes DRAFT)');
  assert(roundOptions.some(r => r.id === 'round-001'), 'includes active round');
  assert(roundOptions.some(r => r.id === 'round-002'), 'includes closed round');
  assert(!roundOptions.some(r => r.id === 'round-draft'), 'excludes draft round');
  console.log('✓ getLookupRoundOptions returns active + closed rounds');
  passed++;

  // Test 5: ApplicationLookupSchema validation
  console.log('[4] ApplicationLookupSchema validation tests');
  const validSchema1 = ApplicationLookupSchema.safeParse({
    roundId: 'round-001',
    email: 'test@example.com',
    phone: '0987766777',
  });
  assert(validSchema1.success === true, 'valid standard phone passes schema');

  const validSchema2 = ApplicationLookupSchema.safeParse({
    roundId: 'round-001',
    email: 'test@example.com',
    phone: '081-234-5678',
  });
  assert(validSchema2.success === true, 'formatted phone with hyphens passes schema');

  const invalidSchemaLetters = ApplicationLookupSchema.safeParse({
    roundId: 'round-001',
    email: 'test@example.com',
    phone: '0987766777dd',
  });
  assert(invalidSchemaLetters.success === false, 'phone with letters (0987766777dd) rejected by schema');

  const invalidSchemaSpecial = ApplicationLookupSchema.safeParse({
    roundId: 'round-001',
    email: 'test@example.com',
    phone: '0987766777@#$',
  });
  assert(invalidSchemaSpecial.success === false, 'phone with special chars rejected by schema');

  const invalidSchemaShort = ApplicationLookupSchema.safeParse({
    roundId: 'round-001',
    email: 'test@example.com',
    phone: '123',
  });
  assert(invalidSchemaShort.success === false, 'too short phone rejected by schema');
  console.log('✓ ApplicationLookupSchema validates phone properly and rejects 0987766777dd');
  passed++;

  // Test 6: Rate limit middleware with lookup isolation
  console.log('[5] Rate limit middleware lookup tests');
  __resetRateLimitStoreForTests();

  const middleware = rateLimitMiddleware({ keyPrefix: 'lookup', perMinute: 30 });
  let nextCalled = 0;
  const dummyNext = async () => { nextCalled++; };
  const mockContext = (ip = '1.2.3.4') => ({
    req: { header: (name: string) => (name === 'cf-connecting-ip' ? ip : undefined) },
    env: { RATE_LIMIT_ENABLED: 'true' },
    header: () => {},
    json: (body: any, status: number) => ({ body, status }),
  });

  // 30 requests should all pass
  for (let i = 0; i < 30; i++) {
    const res = await middleware(mockContext() as any, dummyNext);
    assert(res === undefined, `request ${i + 1} should pass`);
  }
  assert(nextCalled === 30, 'all 30 requests called next');

  // 31st request should be rate limited (429)
  const blockedRes = await middleware(mockContext() as any, dummyNext);
  assert(blockedRes && (blockedRes as any).status === 429, '31st request is rate limited with 429');
  console.log('✓ rateLimitMiddleware with keyPrefix lookup allows 30 req/min and blocks on 31st');
  passed++;

  console.log(`\n=== Summary ===\nPassed: ${passed}\nFailed: 0\n`);
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
