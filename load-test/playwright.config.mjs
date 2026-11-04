import { defineConfig } from 'playwright/test';

/**
 * Playwright config สำหรับ smoke spec (tests/apply-flow.spec.mjs)
 * - workers: 1 (smoke test 1 ผู้ใช้ — load test เต็มใช้ run-load-test.mjs)
 * - timeout สูงเพราะ flow เดินเว็บจริง + Turnstile
 * รัน: cd load-test && npx playwright test
 */
export default defineConfig({
  testDir: './tests',
  timeout: 10 * 60 * 1000,
  expectTimeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    headless: true,
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    viewport: { width: 1280, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  outputDir: './results/playwright-artifacts',
});
