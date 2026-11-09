/**
 * Submission Failure Evidence Middleware
 * ======================================
 *
 * Sits in the public submit pipeline after Rate-limit and Honeypot:
 *   honeypot -> rateLimit -> submitFailureLogger -> idempotency -> turnstile -> zValidator -> handler
 *
 * Responsibilities:
 * 1. Safe Request Body Cloning: Extracts metadata without disturbing downstream body streams.
 * 2. Fail-Soft Background Logging: Uses `c.executionCtx.waitUntil(...)` to insert into D1
 *    without adding latency to the client response.
 * 3. Non-Breaking Ref Code Injection: Injects `refCode` (ERR-XXXXXX) into error JSON responses.
 * 4. Instant Rollback Toggle: Bypassed when `SUBMISSION_FAILURE_LOGGING_ENABLED=false`.
 */

import { createMiddleware } from 'hono/factory';
import { drizzle } from 'drizzle-orm/d1';
import { Bindings, AppVariables, envFlag } from '../types';
import { generateRefCode } from '../lib/ref-code';
import { logSubmitFailureSafely, SubmitFailureCategory } from '../services/submit-failure.service';

const DEFAULT_ENABLED = true;

async function tryReadJson(c: { req: { raw: Request; header: (name: string) => string | undefined } }): Promise<any> {
  const contentType = c.req.header('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) return null;
  try {
    const cloned = c.req.raw.clone();
    return await cloned.json();
  } catch {
    return null;
  }
}

function resolveCategory(status: number, resJson: any): SubmitFailureCategory {
  if (status === 403) {
    const reason = String(resJson?.reason || '');
    if (
      reason === 'ROUND_CLOSED' ||
      reason === 'ROUND_NOT_OPEN' ||
      reason === 'ARCHIVED' ||
      reason === 'ROUND_DRAFT' ||
      reason.includes('ROUND')
    ) {
      return 'ROUND_CLOSED';
    }
    const err = String(resJson?.error || '');
    if (err.includes('Human verification failed') || err.includes('ยืนยันตัวตนไม่สำเร็จ')) {
      return 'TURNSTILE_FAIL';
    }
    return 'ROUND_CLOSED';
  }

  if (status === 400) {
    const err = String(resJson?.error || '');
    const reason = String(resJson?.reason || '');
    if (err.includes('ท่านได้สมัครรอบนี้แล้ว') || reason === 'DUPLICATE_EMAIL') {
      return 'DUPLICATE_EMAIL';
    }
    return 'VALIDATION_ERROR';
  }

  if (status >= 500) {
    return 'INTERNAL_ERROR';
  }

  return 'UNKNOWN';
}

export const submitFailureLoggerMiddleware = () =>
  createMiddleware<{ Bindings: Bindings; Variables: AppVariables }>(async (c, next) => {
    const enabled = envFlag(c.env.SUBMISSION_FAILURE_LOGGING_ENABLED, DEFAULT_ENABLED);
    if (!enabled) {
      await next();
      return;
    }

    // 1. Safely clone request body before downstream work
    const reqBody = await tryReadJson(c);

    // 2. Run downstream middlewares & route handler
    await next();

    // 3. Only act on rejection responses (HTTP 4xx, 5xx)
    const status = c.res.status;
    if (status >= 400) {
      const refCode = generateRefCode();

      // Extract client payload fields
      const roundId = typeof reqBody?.roundId === 'string' ? reqBody.roundId : null;
      const formData = (reqBody?.formData && typeof reqBody.formData === 'object') ? reqBody.formData : {};
      
      const email = typeof formData['field-email'] === 'string' && formData['field-email'].trim()
        ? formData['field-email'].trim()
        : (typeof reqBody?.email === 'string' && reqBody.email.trim() ? reqBody.email.trim() : null);

      const fullname = typeof formData['field-fullname'] === 'string' && formData['field-fullname'].trim()
        ? formData['field-fullname'].trim()
        : (typeof reqBody?.fullname === 'string' && reqBody.fullname.trim() ? reqBody.fullname.trim() : null);

      const submissionToken = typeof reqBody?.submissionToken === 'string' && reqBody.submissionToken.trim()
        ? reqBody.submissionToken.trim()
        : (typeof reqBody?.submission_token === 'string' && reqBody.submission_token.trim() ? reqBody.submission_token.trim() : null);

      // Inspect downstream response body
      let resJson: any = null;
      try {
        resJson = await c.res.clone().json();
      } catch {
        resJson = null;
      }

      const category = resolveCategory(status, resJson);
      const reasonCode = resJson?.reason ? String(resJson.reason) : (resJson?.code ? String(resJson.code) : null);
      const errorMessage = resJson?.error ? String(resJson.error) : (resJson?.message ? String(resJson.message) : `HTTP ${status}`);

      const ipAddress = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || null;
      const cfRay = c.req.header('cf-ray') || null;
      const userAgent = c.req.header('user-agent') || null;

      // 4. Fail-soft background write
      const db = drizzle(c.env.DB as any);
      const logPromise = logSubmitFailureSafely({
        db,
        refCode,
        roundId,
        email,
        fullname,
        submissionToken,
        category,
        reasonCode,
        errorMessage,
        httpStatus: status,
        ipAddress,
        cfRay,
        userAgent,
        createdAt: Date.now(),
      });

      let hasWaitUntil = false;
      try {
        if (c.executionCtx && typeof (c.executionCtx as any).waitUntil === 'function') {
          (c.executionCtx as any).waitUntil(logPromise);
          hasWaitUntil = true;
        }
      } catch {
        hasWaitUntil = false;
      }

      if (!hasWaitUntil) {
        // Fallback for test runner (Node.js test harness without Cloudflare ExecutionContext)
        await logPromise;
      }

      // 5. Inject refCode non-breakingly into response
      if (resJson && typeof resJson === 'object') {
        resJson.refCode = refCode;
        c.res = c.json(resJson, status as any);
      }
    }
  });
