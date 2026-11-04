/**
 * SMOKE TEST (@playwright/test) — เดิน flow ผู้สมัคร 1 คนแบบเต็ม
 * ---------------------------------------------------------------------------
 * ใช้ตรวจว่าชุดทดสอบตรงกับระบบจริงก่อนรัน load test เต็ม
 * รัน: cd load-test && npx playwright test
 *
 * ข้อกำหนด: ต้องมี round ทดสอบแล้ว (node setup-round.mjs) — spec จะหยุด
 * พร้อมข้อความชัดเจนถ้ายังไม่ setup
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConfig, parseArgs } from '../config.mjs';
import { makeApplicant } from '../lib/applicants.mjs';
import { fillFormFields } from '../lib/user-flow.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cfg = buildConfig(parseArgs());

const stateFile = path.join(HERE, '..', 'results', 'state.json');
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : null;
const roundId = process.env.LOAD_TEST_ROUND_ID || state?.roundId;
const resumePath = path.join(HERE, '..', 'test-assets', 'TEST-resume.pdf');

test.describe('SAO Recruitment — apply flow smoke', () => {
  test.skip(!roundId, 'ยังไม่มี round ทดสอบ — รัน `node setup-round.mjs` ก่อน (หรือตั้ง LOAD_TEST_ROUND_ID)');

  let schema;

  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${cfg.apiBaseUrl}/public/rounds/${roundId}/schema`);
    expect(res.status(), 'ต้องดึง schema ของรอบทดสอบได้ (รอบต้อง ACTIVE)').toBe(200);
    schema = (await res.json()).data;
  });

  test('ผู้สมัคร 1 คน กรอก → แนบไฟล์ → ตรวจสอบ → ส่งสำเร็จ', async ({ page }) => {
    const applicant = makeApplicant(Math.floor(Date.now() / 1000) % 100000 || 900001);

    // 1) หน้าแรก → เลือกรอบทดสอบ
    // next.config trailingSlash:true → href จริงคือ /apply/?id=<roundId> — จับแบบยืดหยุ่น
    await page.goto(`${cfg.frontendBaseUrl}/`);
    const roundLink = page.locator(`a[href*="apply"][href*="${roundId}"]`);
    await expect(roundLink.first()).toBeVisible();
    await roundLink.first().click();
    await expect(page).toHaveURL(new RegExp(`/apply/?\\?id=${roundId}`));

    // 2) กรอกฟอร์ม dynamic ตาม schema
    await page.locator('#field-fullname').waitFor({ state: 'visible' });
    const plan = [400, 400, 400, 400, 400, 400];
    await fillFormFields(page, applicant, schema, plan, (step, msg) => {
      throw new Error(`กรอกฟอร์มล้มเหลว [${step}]: ${msg}`);
    });

    // 3) แนบไฟล์ PDF (ทุกฟิลด์ FILE ที่ required)
    for (const f of schema.fields.filter((x) => x.type === 'FILE')) {
      if (!f.isRequired) continue;
      const block = page.locator(`label[for="${f.fieldId}"]`).locator('xpath=..');
      await block.locator('input[type="file"]').setInputFiles(resumePath);
      await expect(block.getByText(/TEST-.*\.pdf/i).first()).toBeVisible({ timeout: 90_000 });
    }

    // 4) ตรวจสอบข้อมูล → review (trailingSlash → /apply/review/)
    await page.getByRole('button', { name: 'ตรวจสอบข้อมูล' }).click();
    await expect(page).toHaveURL(/\/apply\/review\//);
    await page.locator('#confirm').check();

    // 5) รอ Turnstile จริง (ไม่ bypass) แล้วกดส่ง
    const submitBtn = page.getByRole('button', { name: 'ยืนยันส่งใบสมัคร' });
    await expect(submitBtn).toBeEnabled({ timeout: 150_000 });
    const submitRes = page.waitForResponse((r) => r.url().includes('/public/applications/submit'));
    await submitBtn.click();
    const res = await submitRes;
    expect(res.status(), `submit ต้อง 201 (ได้ ${res.status()})`).toBe(201);

    // 6) หน้าสำเร็จ (trailingSlash → /apply/success/)
    await expect(page).toHaveURL(/\/apply\/success\//, { timeout: 30_000 });
  });
});
