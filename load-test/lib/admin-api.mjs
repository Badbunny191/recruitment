/**
 * Admin API client — login + request helper
 * ---------------------------------------------------------------------------
 * - POST /api/v1/admin/auth/login {email,password} → {token, user{role,...}}
 *   (มี rate limit 10 req/min/IP บน login — เรียกครั้งเดียวต่อ process แล้ว cache token)
 * - JWT อายุ 8 ชั่วโมง (exp 28800)
 * - ถ้าบัญชี mustChangePassword จะยัง login ผ่าน แต่ endpoint อื่นตอบ 403
 *   MUST_CHANGE_PASSWORD → ต้องเปลี่ยนรหัสผ่านก่อน (ดู SETUP-GUIDE.md)
 */

import { cfg } from '../config.mjs';

let cachedToken = null;
let cachedUser = null;

export async function adminLogin({ email, password, apiBaseUrl } = {}) {
  const base = apiBaseUrl || cfg.apiBaseUrl;
  const mail = email || cfg.adminEmail;
  const pass = password || cfg.adminPassword;
  if (!mail || !pass) {
    throw new Error(
      'กรุณาตั้ง LOAD_TEST_ADMIN_EMAIL / LOAD_TEST_ADMIN_PASSWORD ใน load-test/.env (ดู .env.example)',
    );
  }
  const res = await fetch(`${base}/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: mail, password: pass }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 423) throw new Error('บัญชี admin ถูกล็อกชั่วคราว (423) — รอสักครู่แล้วลองใหม่');
  if (res.status === 403 && body?.error === 'MUST_CHANGE_PASSWORD') {
    throw new Error('บัญชี admin ต้องเปลี่ยนรหัสผ่านก่อน (MUST_CHANGE_PASSWORD) — login ที่หน้าเว็บก่อน แล้วใช้รหัสใหม่ใน .env');
  }
  if (!res.ok) {
    throw new Error(`Admin login ล้มเหลว (${res.status}): ${body?.error ?? ''} ${body?.message ?? ''}`);
  }
  cachedToken = body.token;
  cachedUser = body.user;
  return body;
}

/** คืน token ปัจจุบัน (login อัตโนมัติถ้ายังไม่มี) */
export async function getToken() {
  if (!cachedToken) await adminLogin();
  return cachedToken;
}

export async function getAdminUser() {
  if (!cachedToken) await adminLogin();
  return cachedUser;
}

/**
 * เรียก admin API — คืน {status, ok, body, headers, ms}
 *
 * ⚠️ path ต้องเป็นแบบ relative ของ admin เช่น '/fields', '/rounds', '/applications'
 *    ฟังก์ชันนี้เติม prefix '/admin' ให้เอง:
 *      adminFetch('/fields') → {apiBaseUrl}/admin/fields  (= /api/v1/admin/fields)
 *    บั๊กเดิม 2026-11-04: ต่อ URL ตรง ๆ ทำให้ยิง /api/v1/fields → 404
 *    (route จริงคือ /api/v1/admin/fields ตาม admin.routes.ts:342 + index.ts:92)
 */
export async function adminFetch(path, { method = 'GET', json, ...rest } = {}) {
  const fullPath = path.startsWith('/admin') ? path : `/admin${path}`;
  const token = await getToken();
  const started = Date.now();
  const res = await fetch(`${cfg.apiBaseUrl}${fullPath}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
    ...rest,
  });
  const ms = Date.now() - started;
  let body = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) body = await res.json().catch(() => null);
  else body = await res.arrayBuffer().catch(() => null);

  if (res.status === 401) {
    // token หมดอายุระหว่างทาง → login ใหม่แล้วยิงซ้ำ 1 ครั้ง
    cachedToken = null;
    const token2 = await getToken();
    const res2 = await fetch(`${cfg.apiBaseUrl}${fullPath}`, {
      method,
      headers: {
        authorization: `Bearer ${token2}`,
        ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: json !== undefined ? JSON.stringify(json) : undefined,
      ...rest,
    });
    let body2 = null;
    const ct2 = res2.headers.get('content-type') || '';
    if (ct2.includes('application/json')) body2 = await res2.json().catch(() => null);
    else body2 = await res2.arrayBuffer().catch(() => null);
    return { status: res2.status, ok: res2.ok, body: body2, headers: res2.headers, ms: Date.now() - started };
  }

  return { status: res.status, ok: res.ok, body, headers: res.headers, ms };
}

/** หา TEST round ที่สร้างไว้จาก API (fallback เมื่อไม่มี results/state.json) */
export async function findTestRound(cfgLocal = cfg) {
  const res = await adminFetch('/rounds');
  if (!res.ok) throw new Error(`GET /admin/rounds ล้มเหลว (${res.status})`);
  const rounds = res.body?.data ?? [];
  return rounds.find((r) => r.title === cfgLocal.roundTitle && !r.deletedAt) || null;
}
