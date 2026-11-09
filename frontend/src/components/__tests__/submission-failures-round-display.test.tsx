// @ts-nocheck
/**
 * Submission Failures — Modal Human-Readable Round Information Tests
 * ============================================================================
 * Requirements verified:
 * 1. Shows human-readable round information: [Round Code] and Round Title.
 * 2. Round ID UUID is secondary info and displayed in Technical Telemetry Evidence.
 * 3. Modal shows Round Code and Round Title if present.
 * 4. If API does not send round info, fetches from backend using roundId.
 * 5. Handles null/missing round gracefully.
 * 6. Copy summary formats round information with human-readable code & title.
 *
 * Run: tsx --tsconfig tsconfig.test.json src/components/__tests__/submission-failures-round-display.test.tsx
 */

import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost:3000/admin/submission-failures' });
const globalAny = globalThis as any;
globalAny.window = win;
globalAny.document = win.document;
try { globalAny.navigator = win.navigator; } catch {}
globalAny.HTMLElement = win.HTMLElement;
globalAny.Event = win.Event;
globalAny.CustomEvent = win.CustomEvent;
globalAny.MouseEvent = win.MouseEvent;
globalAny.localStorage = win.localStorage;
globalAny.requestAnimationFrame = (cb: any) => setTimeout(() => cb(Date.now()), 0);
globalAny.cancelAnimationFrame = clearTimeout;
globalAny.IS_REACT_ACT_ENVIRONMENT = true;

// Clipboard mock
let copiedText = '';
const mockClipboard = {
  writeText: async (text: string) => {
    copiedText = text;
  },
};
try {
  Object.defineProperty(win.navigator, 'clipboard', {
    value: mockClipboard,
    writable: true,
    configurable: true,
  });
} catch {}
try {
  Object.defineProperty(globalAny.navigator, 'clipboard', {
    value: mockClipboard,
    writable: true,
    configurable: true,
  });
} catch {}

import Module from 'module';

const origLoad = (Module as any)._load;
(Module as any)._load = function (request: string, ...rest: any[]) {
  if (request === 'next/navigation') {
    return {
      useRouter: () => ({ replace: () => {}, push: () => {} }),
      usePathname: () => win.location.pathname,
      useSearchParams: () => new URLSearchParams(),
      useParams: () => ({}),
    };
  }
  return origLoad.call(this, request, ...rest);
};

let React: any;
let createRoot: any;
let act: any;
let SubmissionFailuresPage: any;

function setNativeValue(el: any, value: string) {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(el, value);
  else el.value = value;
}

async function typeInto(el: any, value: string) {
  await act(async () => {
    setNativeValue(el, value);
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
  });
}

async function bootstrap() {
  React = (await import('react')).default;
  ({ createRoot } = await import('react-dom/client'));
  act = (React as any).act;
  const mod = await import('../../app/(admin)/admin/submission-failures/page');
  SubmissionFailuresPage = mod.default;
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`✗ ${name}: ${e?.message ?? e}`);
  }
}

function assert(cond: any, msg: string) {
  if (!cond) throw new Error(msg);
}

function assertEqual(actual: any, expected: any, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function flushPromises() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

async function main() {
  await bootstrap();
  console.log('\n=================================================');
  console.log('Submission Failures: Human-Readable Round Display');
  console.log('=================================================\n');

  // Test 1: When API sends roundCode and roundTitle, modal displays them
  await test('Test 1: Modal displays [roundCode] and roundTitle when API provides them', async () => {
    const roundId = '1ee6aa88-3d28-4bf0-be63-4b34354974f1';
    const mockFailure = {
      id: 'fail-1',
      refCode: 'ERR-ABC123',
      roundId,
      roundCode: 'R67-001',
      roundTitle: 'รับสมัครพนักงานตำแหน่งนักทรัพยากรบุคคล',
      email: 'applicant@test.com',
      fullname: 'สมชาย ใจดี',
      submissionToken: 'tok-1',
      category: 'ROUND_CLOSED',
      reasonCode: 'TIME_EXPIRED',
      errorMessage: 'เลยกำหนดเวลารับสมัครแล้ว',
      httpStatus: 403,
      ipAddress: '1.2.3.4',
      cfRay: 'ray-123',
      userAgent: 'Mozilla/5.0',
      createdAt: 1735689600000,
    };

    globalAny.fetch = async (url: string) => {
      if (url.includes('/admin/submission-failures')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: [mockFailure],
            pagination: { page: 1, pageSize: 20, total: 1 },
          }),
        };
      }
      if (url.includes('/admin/rounds')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: [],
          }),
        };
      }
      return { ok: false, status: 404 };
    };

    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(SubmissionFailuresPage));
    });
    await flushPromises();

    // Click "ดูหลักฐาน" button
    const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
    const evidenceBtn = buttons.find((b) => b.textContent?.includes('ดูหลักฐาน'));
    assert(evidenceBtn, 'ดูหลักฐาน button must exist in table');

    await act(async () => {
      evidenceBtn.click();
    });
    await flushPromises();

    // Check modal round code and round title
    const roundCodeEl = container.querySelector('[data-testid="modal-round-code"]');
    assert(roundCodeEl, 'modal-round-code element must exist');
    assert(roundCodeEl.textContent?.includes('[R67-001]'), `Expected [R67-001], got ${roundCodeEl.textContent}`);

    const roundTitleEl = container.querySelector('[data-testid="modal-round-title"]');
    assert(roundTitleEl, 'modal-round-title element must exist');
    assert(roundTitleEl.textContent?.includes('รับสมัครพนักงานตำแหน่งนักทรัพยากรบุคคล'), `Title mismatch: ${roundTitleEl.textContent}`);

    // Check Round ID UUID is displayed as secondary info
    const secondaryIdEl = container.querySelector('[data-testid="modal-round-id-secondary"]');
    assert(secondaryIdEl, 'modal-round-id-secondary must exist');
    assert(secondaryIdEl.textContent?.includes(roundId), 'UUID must be shown as secondary info');

    // Check Technical Telemetry Evidence section contains Round ID UUID
    const techIdEl = container.querySelector('[data-testid="technical-round-id"]');
    assert(techIdEl, 'technical-round-id must exist');
    assert(techIdEl.textContent?.includes(roundId), 'UUID must be in technical telemetry section');

    root.unmount();
    container.remove();
  });

  // Test 2: If API does not send round info, frontend fetches from backend by roundId
  await test('Test 2: If API does not send round info, fetches from backend using roundId', async () => {
    const roundId = '2bb6aa88-3d28-4bf0-be63-4b34354974f2';
    // API item without roundCode / roundTitle
    const mockFailureNoRoundInfo = {
      id: 'fail-2',
      refCode: 'ERR-XYZ789',
      roundId,
      roundCode: null,
      roundTitle: null,
      email: 'applicant2@test.com',
      fullname: 'สมหญิง ศรีสมร',
      submissionToken: 'tok-2',
      category: 'VALIDATION_ERROR',
      reasonCode: 'MISSING_FIELD',
      errorMessage: 'กรุณากรอกข้อมูลให้ครบถ้วน',
      httpStatus: 400,
      ipAddress: '5.6.7.8',
      cfRay: 'ray-456',
      userAgent: 'Mozilla/5.0 Chrome',
      createdAt: 1735689600000,
    };

    let backendRoundFetchCalled = false;
    let fetchedId = '';

    globalAny.fetch = async (url: string) => {
      if (url.includes('/admin/submission-failures')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: [mockFailureNoRoundInfo],
            pagination: { page: 1, pageSize: 20, total: 1 },
          }),
        };
      }
      if (url.includes(`/admin/rounds/${roundId}`)) {
        backendRoundFetchCalled = true;
        fetchedId = roundId;
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              id: roundId,
              title: 'รับสมัครเจ้าพนักงานธุรการ',
              roundCode: 'R67-002',
            },
          }),
        };
      }
      if (url.includes('/admin/rounds')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: [],
          }),
        };
      }
      return { ok: false, status: 404 };
    };

    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(SubmissionFailuresPage));
    });
    await flushPromises();

    // Click "ดูหลักฐาน"
    const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
    const evidenceBtn = buttons.find((b) => b.textContent?.includes('ดูหลักฐาน'));
    assert(evidenceBtn, 'ดูหลักฐาน button must exist');

    await act(async () => {
      evidenceBtn.click();
    });
    await flushPromises();

    assert(backendRoundFetchCalled, 'Backend must be called to fetch round info using roundId');
    assertEqual(fetchedId, roundId, 'Fetched roundId matches');

    // Verify modal rendered the fetched round info
    const roundCodeEl = container.querySelector('[data-testid="modal-round-code"]');
    assert(roundCodeEl, 'modal-round-code element must exist after fetch');
    assert(roundCodeEl.textContent?.includes('[R67-002]'), `Expected [R67-002], got ${roundCodeEl.textContent}`);

    const roundTitleEl = container.querySelector('[data-testid="modal-round-title"]');
    assert(roundTitleEl, 'modal-round-title element must exist after fetch');
    assert(roundTitleEl.textContent?.includes('รับสมัครเจ้าพนักงานธุรการ'), `Title mismatch: ${roundTitleEl.textContent}`);

    root.unmount();
    container.remove();
  });

  // Test 3: Null roundId is handled gracefully without errors
  await test('Test 3: Null roundId renders (ไม่ได้ระบุรอบรับสมัคร) without crash or backend call', async () => {
    const mockFailureNullRound = {
      id: 'fail-3',
      refCode: 'ERR-BOT999',
      roundId: null,
      email: null,
      fullname: null,
      submissionToken: null,
      category: 'TURNSTILE_FAIL',
      reasonCode: 'BOT_BLOCKED',
      errorMessage: 'การตรวจสอบความปลอดภัยล้มเหลว',
      httpStatus: 403,
      ipAddress: '9.9.9.9',
      cfRay: 'ray-bot',
      userAgent: 'curl/7.68.0',
      createdAt: 1735689600000,
    };

    let fetchCalledForNull = false;

    globalAny.fetch = async (url: string) => {
      if (url.includes('/admin/submission-failures')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: [mockFailureNullRound],
            pagination: { page: 1, pageSize: 20, total: 1 },
          }),
        };
      }
      if (url.includes('/admin/rounds/null') || url.includes('/admin/rounds/undefined')) {
        fetchCalledForNull = true;
      }
      if (url.includes('/admin/rounds')) {
        return {
          ok: true,
          json: async () => ({ success: true, data: [] }),
        };
      }
      return { ok: false, status: 404 };
    };

    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(SubmissionFailuresPage));
    });
    await flushPromises();

    const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
    const evidenceBtn = buttons.find((b) => b.textContent?.includes('ดูหลักฐาน'));
    assert(evidenceBtn, 'ดูหลักฐาน button must exist');

    await act(async () => {
      evidenceBtn.click();
    });
    await flushPromises();

    assert(!fetchCalledForNull, 'Should not fetch round for null roundId');
    assert(container.textContent?.includes('(ไม่ได้ระบุรอบรับสมัคร)'), 'Must indicate no round was specified');

    root.unmount();
    container.remove();
  });

  // Test 4: Copy Evidence Summary formats round info with human-readable code & title
  await test('Test 4: "คัดลอกสรุปข้อเท็จจริง" copies human-readable round information', async () => {
    const roundId = '1ee6aa88-3d28-4bf0-be63-4b34354974f1';
    const mockFailure = {
      id: 'fail-4',
      refCode: 'ERR-COPY01',
      roundId,
      roundCode: 'R67-001',
      roundTitle: 'รับสมัครพนักงานตำแหน่งนักทรัพยากรบุคคล',
      email: 'hr.applicant@test.com',
      fullname: 'นายพยาน ชัดเจน',
      submissionToken: 'tok-copy',
      category: 'DUPLICATE_EMAIL',
      reasonCode: 'DUPLICATE_EMAIL',
      errorMessage: 'อีเมลนี้ถูกใช้สมัครในรอบนี้แล้ว',
      httpStatus: 400,
      ipAddress: '10.0.0.1',
      cfRay: 'ray-copy',
      userAgent: 'Mozilla/5.0',
      createdAt: 1735689600000,
    };

    globalAny.fetch = async (url: string) => {
      if (url.includes('/admin/submission-failures')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: [mockFailure],
            pagination: { page: 1, pageSize: 20, total: 1 },
          }),
        };
      }
      if (url.includes('/admin/rounds')) {
        return { ok: true, json: async () => ({ success: true, data: [] }) };
      }
      return { ok: false, status: 404 };
    };

    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(SubmissionFailuresPage));
    });
    await flushPromises();

    const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
    const evidenceBtn = buttons.find((b) => b.textContent?.includes('ดูหลักฐาน'));
    assert(evidenceBtn, 'ดูหลักฐาน button must exist');

    await act(async () => {
      evidenceBtn.click();
    });
    await flushPromises();

    // Click "คัดลอกสรุปข้อเท็จจริง"
    const copyBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('คัดลอกสรุปข้อเท็จจริง')
    ) as HTMLButtonElement;
    assert(copyBtn, 'Copy button must exist in modal');

    await act(async () => {
      copyBtn.click();
    });
    await flushPromises();

    assert(copiedText.includes('รอบรับสมัคร: [R67-001] รับสมัครพนักงานตำแหน่งนักทรัพยากรบุคคล'), `Copied text should include human readable round info: ${copiedText}`);
    assert(copiedText.includes(roundId), 'Copied text should include round ID');

    root.unmount();
    container.remove();
  });

  // Test 5: Round options load from { data: [...] } without success: true, logs rounds.length > 0, and filters by title & code
  await test('Test 5: Load round options from backend { data: [...] }, verify console log & search by code/title', async () => {
    const mockRoundsData = [
      { id: 'r-1', title: 'รับสมัครนักทรัพยากรบุคคล', roundCode: 'R67-001' },
      { id: 'r-2', title: 'รับสมัครนิติกรปฏิบัติการ', roundCode: 'LAW-002' },
    ];

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(' '));
      origLog(...args);
    };

    globalAny.fetch = async (url: string) => {
      if (url.includes('/admin/submission-failures')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: [],
            pagination: { page: 1, pageSize: 20, total: 0 },
          }),
        };
      }
      if (url.includes('/admin/rounds')) {
        // Backend contract: returns { data: [...] } without success: true
        return {
          ok: true,
          json: async () => ({
            data: mockRoundsData,
          }),
        };
      }
      return { ok: false, status: 404 };
    };

    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(React.createElement(SubmissionFailuresPage));
      });
      await flushPromises();

      // 1. Verify console log confirms rounds.length > 0
      const roundLog = logs.find((l) => l.includes('[submission-failures] rounds.length: 2'));
      assert(roundLog, `Console log must report rounds loaded. Logs: ${JSON.stringify(logs)}`);
      assert(roundLog.includes('rounds.length > 0: true'), `Console log must confirm rounds.length > 0: ${roundLog}`);

      // 2. Focus on SearchableDropdown input to open options list
      const searchInput = container.querySelector('input[placeholder="ค้นหารอบรับสมัคร..."]') as HTMLInputElement;
      assert(searchInput, 'SearchableDropdown input must exist');

      await act(async () => {
        searchInput.focus();
        searchInput.dispatchEvent(new win.Event('focus', { bubbles: true }));
      });
      await flushPromises();

      // 3. Verify total loaded options count (1 default + 2 rounds = 3)
      const footer = container.querySelector('.border-t.border-slate-100');
      assert(footer, 'Dropdown footer must exist');
      assert(footer.textContent?.includes('/ 3 รายการ'), `Expected 3 total options in footer, got: ${footer.textContent}`);

      // 4. Test searching by round code: "LAW"
      await typeInto(searchInput, 'LAW');
      await flushPromises();

      const items = Array.from(container.querySelectorAll('li[role="option"]'));
      assertEqual(items.length, 1, 'Should find exactly 1 matching round for code LAW');
      assert(items[0].textContent?.includes('LAW-002'), 'Must show round with code LAW-002');
      assert(items[0].textContent?.includes('รับสมัครนิติกรปฏิบัติการ'), 'Must show title of LAW round');

      // 5. Test searching by round title: "ทรัพยากรบุคคล"
      await typeInto(searchInput, 'ทรัพยากรบุคคล');
      await flushPromises();

      const items2 = Array.from(container.querySelectorAll('li[role="option"]'));
      assertEqual(items2.length, 1, 'Should find exactly 1 matching round for title keyword');
      assert(items2[0].textContent?.includes('R67-001'), 'Must show round with code R67-001');
      assert(items2[0].textContent?.includes('รับสมัครนักทรัพยากรบุคคล'), 'Must show title');
    } finally {
      console.log = origLog;
      root.unmount();
      container.remove();
    }
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    console.error('Failed tests:\n' + failures.map((f) => ` - ${f}`).join('\n'));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test harness error:', err);
  process.exit(1);
});
