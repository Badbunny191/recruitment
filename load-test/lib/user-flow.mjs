/**
 * User flow — เดินหน้าเว็บจริงของผู้สมัครด้วย Playwright
 * ---------------------------------------------------------------------------
 * จำลองผู้สมัครจริง: เปิดเว็บ → อ่านรายละเอียดรอบ → กรอกฟอร์ม → เปลี่ยนหน้า
 * → แนบไฟล์ → ตรวจสอบข้อมูล (review) → ยืนยันส่งใบสมัคร (Turnstile จริง)
 *
 * ข้อกำหนดด้านความปลอดภัย (สำคัญ):
 * - ใช้เบราว์เซอร์จริง (Chromium) เข้าหน้าเว็บจริง — ไม่ bypass Turnstile /
 *   Bot Protection / Managed Challenge ทุกกรณี
 * - ถ้า Turnstile challenge ค้าง/ล้มเหลวเกินเวลา → ABORT ทั้งการรัน
 *   (หยุด • บันทึกปัญหา • รายงานผล)
 * - ถ้าโดน rate limit (HTTP 429) → ถอยหลังตาม Retry-After แล้วลองใหม่
 *   (พฤติกรรมเดียวกับผู้ใช้จริง) — นับเป็นเหตุการณ์ในรายงาน
 */

import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const ts = () => new Date().toTimeString().slice(0, 8);

/**
 * กระจาย think-time รวม (5-30 วินาที) เป็นพักระหว่าง action ย่อย
 * คืน array ของ delay (ms) ที่รวมกัน ≈ totalSec
 * totalSec = 0 (โหมด stress) → delay ทุกช่องเป็น 0 จริง (ไม่มี floor)
 */
export function thinkPlan(totalSec, actions) {
  if (!totalSec || totalSec <= 0) return Array.from({ length: actions }, () => 0);
  const weights = Array.from({ length: actions }, () => Math.random() + 0.3);
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => Math.max(250, Math.round((w / sum) * totalSec * 1000)));
}

/**
 * รัน flow ทั้งหมดของผู้สมัคร 1 คน
 * @returns ผลลัพธ์ {status, applicationNo, timings, errors, screenshots, rateLimited}
 */
export async function runApplicantFlow({
  browser, applicant, cfg, roundId, schema, abort, screenshotDir,
}) {
  const timings = { homeMs: 0, formMs: 0, fillMs: 0, uploadMs: 0, reviewMs: 0, submitMs: 0, totalMs: 0 };
  const errors = [];
  const screenshots = [];
  const t0 = Date.now();
  const result = {
    seq: applicant.seq,
    applicationNo: applicant.applicationNo,
    email: applicant.email,
    name: applicant.fullName,
    status: 'FAILED',
    applicationNoReceived: null,
    rateLimited: 0,
    uploads: { attempted: 0, succeeded: 0 },
    timings, errors, screenshots,
  };

  const context = await browser.newContext({
    locale: 'th-TH',
    viewport: { width: 1280, height: 900 },
    timezoneId: 'Asia/Bangkok',
  });
  const page = await context.newPage();

  const shot = async (label) => {
    try {
      const file = path.join(screenshotDir, `user-${applicant.applicationNo}-${label}-${Date.now()}.png`);
      await page.screenshot({ path: file, fullPage: false });
      screenshots.push(path.basename(file));
    } catch { /* ถ่ายไม่ได้ก็ข้าม */ }
  };
  const fail = (step, message) => {
    errors.push({ step, message: String(message).slice(0, 500), url: page.url() });
  };

  try {
    if (abort.aborted) {
      result.status = 'SKIPPED';
      result.skipReason = abort.reason;
      return result;
    }

    // ── 1. เปิดหน้าเว็บหลัก ────────────────────────────────────────────────
    let plan = thinkPlan(randInt(cfg.thinkMinSec, cfg.thinkMaxSec), 6);
    let p = 0;
    const tHome = Date.now();
    await page.goto(`${cfg.frontendBaseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // "อ่านรายละเอียด" — รอหน้าแรกแสดงรายการรอบ (client-side render จาก /rounds/active)
    //
    // ⚠️ Selector: next.config ตั้ง trailingSlash: true → Next.js normalize href
    // ทุกลิงก์เป็น "/apply/?id=<roundId>" (แม้ source เขียน /apply?id=) จึงต้องจับแบบ
    // ไม่ผูกรูปแบบ slash: href มีคำว่า "apply" + roundId (UUID) เท่านั้น —
    // ทำงานได้ทั้ง /apply?id= / /apply/?id= / route variation อนาคต
    const roundLink = page.locator(`a[href*="apply"][href*="${roundId}"]`);
    await roundLink.first().waitFor({ state: 'visible', timeout: 30_000 });
    await sleep(plan[p++]);
    timings.homeMs = Date.now() - tHome;

    // ── 2. เลือกรอบทดสอบ → หน้าสมัคร ─────────────────────────────────────
    const tForm = Date.now();
    await roundLink.first().click();
    // trailingSlash: true → URL จริงคือ /apply/?id=<roundId> — regex รองรับทั้งสองแบบ
    await page.waitForURL(new RegExp(`/apply/?\\?id=${roundId}`), { timeout: 30_000 });
    await page.locator('#field-fullname').waitFor({ state: 'visible', timeout: 30_000 });
    timings.formMs = Date.now() - tForm;
    await sleep(plan[p++]);

    // ── 3. กรอกฟอร์ม dynamic ตาม schema จริง ─────────────────────────────
    const tFill = Date.now();
    await fillFormFields(page, applicant, schema, plan, (step, msg) => fail(step, msg));
    timings.fillMs = Date.now() - tFill;

    // ── 4. แนบไฟล์ (เฉพาะฟิลด์ FILE) ─────────────────────────────────────
    const tUpload = Date.now();
    const fileFields = schema.fields.filter((f) => f.type === 'FILE');
    for (let i = 0; i < fileFields.length; i++) {
      const f = fileFields[i];
      const optional = !f.isRequired;
      // ทำให้เหมือนจริง: ฟิลด์ optional อัปโหลด ~60%
      if (optional && Math.random() > 0.6) continue;
      const assetName = f.fieldId === 'field-portfolio' ? 'TEST-portfolio.pdf' : 'TEST-resume.pdf';
      result.uploads.attempted++;
      const ok = await uploadFileWithRetry(page, f.fieldId, path.join(cfg.paths.assetsDir, assetName), result);
      if (ok) result.uploads.succeeded++;
      else fail('upload', `อัปโหลด ${assetName} (field ${f.fieldId}) ไม่สำเร็จ`);
      if (cfg.thinkMaxSec > 0) await sleep(randInt(400, 1500));
    }
    timings.uploadMs = Date.now() - tUpload;
    await sleep(plan[p++ % plan.length]);

    // ── 5. "ตรวจสอบข้อมูล" → หน้า review (trailingSlash → /apply/review/) ──
    const tReview = Date.now();
    await page.getByRole('button', { name: 'ตรวจสอบข้อมูล' }).click();
    await page.waitForURL(/\/apply\/review\/?/, { timeout: 30_000 });
    await page.locator('#confirm').waitFor({ state: 'visible', timeout: 30_000 });
    timings.reviewMs = Date.now() - tReview;
    await sleep(plan[p++ % plan.length]);

    // ── 6. ติ๊กยืนยัน + รอ Turnstile (แบบไม่ bypass) ──────────────────────
    await page.locator('#confirm').check();
    const submitBtn = page.getByRole('button', { name: 'ยืนยันส่งใบสมัคร' });
    const tsWaitStart = Date.now();
    const turnstileOk = await waitForTurnstile(submitBtn, cfg, abort);
    // Log เพิ่มเติมตามข้อกำหนด: เวลาที่รอ Turnstile + เวลาที่ผ่าน (หัวข้อ 5)
    result.turnstile = {
      manual: !!cfg.headed,
      waitMs: Date.now() - tsWaitStart,
      solvedAt: turnstileOk ? new Date().toISOString() : null,
    };
    if (!turnstileOk) {
      await shot('turnstile-timeout');
      fail('turnstile', cfg.headed
        ? `ผู้ใช้ไม่ได้ยืนยัน Turnstile ภายใน ${cfg.manualTurnstileTimeoutSec ?? 900}s — ยกเลิก user นี้ตามข้อกำหนด (ห้าม bypass)`
        : `Turnstile ไม่ปล่อย token ภายใน ${cfg.turnstileTimeoutSec}s — หยุดการทดสอบทั้งหมดตามข้อกำหนด (ห้าม bypass)`);
      abort.aborted = true;
      abort.reason = 'TURNSTILE_CHALLENGE';
      result.status = 'FAILED';
      result.turnstileBlocked = true;
      return result;
    }

    // ── 7. กดส่ง (จัดการ 429 แบบผู้ใช้จริง: รอ Retry-After แล้วกดใหม่) ────
    const tSubmit = Date.now();
    const submitResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/public/applications/submit'),
      { timeout: 120_000 },
    );
    await submitBtn.click();
    let response = await submitResponsePromise;

    for (let attempt = 1; response.status() === 429 && attempt <= 3; attempt++) {
      result.rateLimited++;
      const retryAfter = Number(response.headers()['retry-after'] || 15);
      const body = await response.json().catch(() => ({}));
      fail('rate-limit', `HTTP 429 (attempt ${attempt}) — รอ ${retryAfter}s แล้วลองใหม่: ${body?.error ?? ''}`);
      await sleep((retryAfter + 2) * 1000);
      // token อาจหมดอายุระหว่างรอ — โหมด manual จะแจ้งผู้ใช้คลิก Turnstile ใหม่เอง
      const ok2 = await waitForTurnstile(submitBtn, cfg, abort);
      if (!ok2) {
        await shot('turnstile-retry-timeout');
        abort.aborted = true;
        abort.reason = 'TURNSTILE_CHALLENGE';
        result.turnstileBlocked = true;
        return result;
      }
      const retryPromise = page.waitForResponse(
        (res) => res.url().includes('/public/applications/submit'),
        { timeout: 120_000 },
      );
      await submitBtn.click();
      response = await retryPromise;
    }
    timings.submitMs = Date.now() - tSubmit;

    const status = response.status();
    const body = await response.json().catch(() => ({}));
    // Log เพิ่มเติมตามข้อกำหนด (หัวข้อ 5): Response หลัง submit
    result.httpStatus = status;
    result.submittedAt = new Date().toISOString();

    if (status === 201 && body?.success) {
      // ── 8. หน้า success (trailingSlash → /apply/success/) ──────────────
      await page.waitForURL(/\/apply\/success\/?/, { timeout: 30_000 });
      result.applicationNoReceived = body?.data?.applicationNo ?? null;
      result.status = 'SUCCESS';
      console.log(`  [${ts()}] ✓ SUBMIT สำเร็จ: HTTP 201 → เลขที่ใบสมัคร ${result.applicationNoReceived} (${applicant.applicationNo})`);
      if (cfg.thinkMaxSec > 0) await sleep(randInt(500, 1500)); // อ่านหน้าสำเร็จเหมือนคนจริง
    } else {
      result.status = 'FAILED';
      result.httpStatus = status;
      await shot('submit-failed');
      fail('submit', `submit ตอบ ${status}: ${JSON.stringify(body).slice(0, 400)}`);
      if (status === 403 && /verification/i.test(String(body?.error ?? ''))) {
        // Turnstile siteverify ปฏิเสธ token → ถือว่าเจอระบบป้องกัน → หยุดตาม spec
        abort.aborted = true;
        abort.reason = 'TURNSTILE_VERIFICATION_FAILED';
        result.turnstileBlocked = true;
      }
    }
    timings.totalMs = Date.now() - t0;
    return result;
  } catch (err) {
    result.status = result.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED';
    await shot('exception');
    fail('exception', err?.message ?? String(err));
    timings.totalMs = Date.now() - t0;
    return result;
  } finally {
    await context.close().catch(() => {});
  }
}

/** รอ Turnstile — ไม่มีการ bypass ใด ๆ ทั้งสิ้น
 *
 * สองโหมด:
 *  - headless (ค่าเริ่มต้น): รอสั้นตาม cfg.turnstileTimeoutSec แล้วยอมแพ้ → abort ทั้งรัน
 *    (เจอ challenge = หยุด บันทึก รายงาน ตามข้อกำหนด)
 *  - headed (โหมด Manual Turnstile Assist): เบราว์เซอร์จริงเปิดค้างบนหน้าจอ
 *    → แจ้งผู้ใช้ใน console แล้ว "รอผู้ใช้คลิก Turnstile เอง" นานสูงสุดตาม
 *    cfg.manualTurnstileTimeoutSec — ห้ามคลิก checkbox แทน / ห้ามแก้ token /
 *    ห้ามหลบเลี่ยงทุกกรณี — เมื่อผู้ใช้ผ่านแล้ว (ปุ่ม submit เปิดใช้งาน)
 *    script จะกดส่งต่ออัตโนมัติ
 */
async function waitForTurnstile(submitBtn, cfg, abort, timeoutMs) {
  const manual = !!cfg.headed;
  const limit = manual
    ? (cfg.manualTurnstileTimeoutSec ?? 900) * 1000
    : (timeoutMs ?? cfg.turnstileTimeoutSec * 1000);
  const started = Date.now();
  let promptShown = false;
  while (Date.now() - started < limit) {
    if (abort.aborted) return false;
    const disabled = await submitBtn.isDisabled().catch(() => true);
    if (!disabled) {
      const waited = ((Date.now() - started) / 1000).toFixed(1);
      if (manual) {
        console.log(`  [${ts()}] ✓ ผู้ใช้ยืนยัน Turnstile สำเร็จ (รอผู้ใช้ ${waited}s) — สคริปต์กดส่งต่ออัตโนมัติ`);
      }
      return true;
    }
    if (manual && !promptShown) {
      promptShown = true;
      console.log(`  [${ts()}] ⏳ TURNSTILE: พบ Cloudflare challenge — กรุณาคลิกช่อง "ยืนยันว่าคุณเป็นมนุษย์" ในหน้าต่างเบราว์เซอร์ด้วยตนเอง`);
      console.log(`           (สคริปต์จะไม่คลิกแทนและไม่แก้ token — รอได้สูงสุด ${Math.round(limit / 1000)}s ก่อนยกเลิก user นี้)`);
    }
    await sleep(1000);
  }
  return false;
}

/** อัปโหลดไฟล์ผ่าน FileUpload จริง + retry เมื่อโดน 429 */
async function uploadFileWithRetry(page, fieldId, filePath, result) {
  const block = page.locator(`label[for="${fieldId}"]`).locator('xpath=..');
  const input = block.locator('input[type="file"]');
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await input.setInputFiles(filePath);
      // รอสัญญาณอัปโหลดสำเร็จ: ชื่อไฟล์ปรากฏในบล็อกของฟิลด์ (FileUpload แสดง meta หลัง upload)
      await block.getByText(/TEST-.*\.(pdf|jpe?g|png)/i).first().waitFor({ state: 'visible', timeout: 90_000 });
      return true;
    } catch (err) {
      const msg = String(err?.message ?? err);
      // ตรวจว่ามีข้อความ error ของ FileUpload (เช่น 429) หรือไม่
      const errText = await block.locator('text=/429|Too many|ลองใหม่|ไม่ส/i').first().textContent().catch(() => null);
      if (errText && /429|Too many/i.test(errText)) {
        result.rateLimited++;
        await sleep(20_000);
        continue;
      }
      if (attempt === 3) {
        result.uploadsErrors = result.uploadsErrors || [];
        result.uploadsErrors.push({ fieldId, message: msg.slice(0, 300) });
        return false;
      }
      await sleep(3000);
    }
  }
  return false;
}

/**
 * กรอกทุกฟิลด์ตาม schema จริงของรอบ (dynamic form)
 * - TEXT/TEXTAREA → ค่าจาก mapping ผู้สมัคร
 * - DROPDOWN → เลือก option แรก ๆ ที่มีในหน้า
 * - RADIO/CHECKBOX → เลือกตัวเลือกแรก
 * - NUMBER/DATE → ค่าทดสอบที่ผ่าน validation
 * - FILE → ข้าม (จัดการในขั้น upload)
 */
async function fillFormFields(page, applicant, schema, plan, fail) {
  const values = {
    'field-fullname': applicant.fullName,
    'field-national-id': applicant.nationalId,
    'field-email': applicant.email,
    'field-phone': applicant.phone,
    'field-address': applicant.address,
    'field-experience': applicant.experience,
  };
  let planIdx = 0;
  for (const f of schema.fields) {
    if (f.type === 'FILE') continue;
    const delay = plan[Math.min(planIdx++, plan.length - 1)];
    try {
      switch (f.type) {
        case 'TEXT': {
          const v = values[f.fieldId] ?? `TEST-${String(applicant.seq).padStart(6, '0')}`;
          await page.locator(`#${f.fieldId}`).fill(v);
          break;
        }
        case 'TEXTAREA': {
          const v = values[f.fieldId] ?? `ข้อมูลทดสอบ ${applicant.applicationNo}`;
          await page.locator(`#${f.fieldId}`).fill(v);
          break;
        }
        case 'DROPDOWN': {
          const sel = page.locator(`select#${f.fieldId}`);
          const options = await sel.locator('option').allTextContents();
          const pick = options.map((o) => o.trim()).filter((o) => o && !o.includes('กรุณาเลือก'))[0]
            ?? values[f.fieldId]
            ?? applicant.education;
          await sel.selectOption({ label: pick }).catch(async () => {
            await sel.selectOption({ index: 1 }).catch(() => {});
          });
          break;
        }
        case 'RADIO': {
          const radios = page.locator(`input[type="radio"][name="${f.fieldId}"]`);
          const count = await radios.count();
          if (count > 0) await radios.first().check();
          break;
        }
        case 'CHECKBOX': {
          const boxes = page.locator(`input[type="checkbox"][name="${f.fieldId}"]`);
          if ((await boxes.count()) > 0) await boxes.first().check();
          break;
        }
        case 'NUMBER': {
          await page.locator(`#${f.fieldId}`).fill(String(applicant.experienceYears));
          break;
        }
        case 'DATE': {
          await page.locator(`#${f.fieldId}`).fill('2026-01-15');
          break;
        }
        case 'MASTER_DATA': {
          // SearchableDropdown — พิมพ์แล้วเลือก option แรก (รอบทดสอบไม่ใช้ แต่รองรับไว้)
          const input = page.locator(`#${f.fieldId}`);
          if (await input.count()) {
            await input.fill('TEST');
            await sleep(800);
            const opt = page.locator('[role="option"], [role="listbox"] *').first();
            if (await opt.count()) await opt.click().catch(() => {});
          }
          break;
        }
        default:
          break;
      }
      await sleep(delay);
    } catch (err) {
      fail('fill', `ฟิลด์ ${f.fieldId} (${f.type}): ${err?.message ?? err}`);
    }
  }
}
