/**
 * R9 + R9.1 — Account state security responses (frontend)
 * =========================================================
 *
 * Backend (middlewares/account-state.middleware.ts) ตรวจสถานะบัญชีจาก DB
 * ทุก request และตอบ 403 พร้อม code:
 *   - MUST_CHANGE_PASSWORD  → ยังใช้งานได้เฉพาะเปลี่ยนรหัสผ่าน/ดูโปรไฟล์
 *     → พาไปหน้า /admin/change-password (set flag ให้ AdminGuard redirect)
 *   - ACCOUNT_DISABLED      → บัญชีถูกปิด (มีผลทันทีแม้ JWT ยังไม่หมดอายุ)
 *     → ล้าง session ทั้งหมดแล้วพาไป /admin/login (แนวทางเดียวกับ 401)
 *
 * หน้าที่ของฝั่งนี้: ดัก response เหล่านี้ก่อนที่หน้าจะแสดง
 * "โหลดข้อมูลไม่สำเร็จ / ไม่พบข้อมูล" แทน security error
 *
 * กัน loop:
 *   - change-password redirect เฉพาะเมื่อ "ไม่ได้อยู่หน้า change-password อยู่แล้ว"
 *   - login redirect เฉพาะเมื่อ "ไม่ได้อยู่หน้า login อยู่แล้ว"
 *   - /auth/change-password + /auth/me เป็น allowlist ฝั่ง backend
 *     (หน้า change-password เองไม่โดน 403 MUST_CHANGE_PASSWORD)
 */

export const MUST_CHANGE_PASSWORD_CODE = 'MUST_CHANGE_PASSWORD';
export const ACCOUNT_DISABLED_CODE = 'ACCOUNT_DISABLED';
export const STORAGE_KEY_MUST_CHANGE_PASSWORD = 'mustChangePassword';
export const ADMIN_TOKEN_STORAGE_KEY = 'adminToken';
export const ADMIN_USER_STORAGE_KEY = 'adminUser';
export const CHANGE_PASSWORD_PATH = '/admin/change-password';
export const LOGIN_PATH = '/admin/login';

function win(): any {
  return typeof window !== 'undefined' ? (window as any) : undefined;
}

export function readMustChangePasswordFlag(): boolean {
  try {
    return win()?.localStorage?.getItem(STORAGE_KEY_MUST_CHANGE_PASSWORD) === 'true';
  } catch {
    return false;
  }
}

export function setMustChangePasswordFlag(value: boolean): void {
  try {
    const storage = win()?.localStorage;
    if (!storage) return;
    if (value) storage.setItem(STORAGE_KEY_MUST_CHANGE_PASSWORD, 'true');
    else storage.removeItem(STORAGE_KEY_MUST_CHANGE_PASSWORD);
  } catch {
    // storage เช่น quota/disabled — ไม่มีผลต่อ security (backend enforce อยู่)
  }
}

/**
 * R9.1 — ล้าง session แบบเดียวกับ 401 ใน useAdminAuth (adminToken/adminUser)
 * รวมถึง flag ของ R9 ด้วย
 */
export function clearAdminSession(): void {
  try {
    const storage = win()?.localStorage;
    if (!storage) return;
    storage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    storage.removeItem(ADMIN_USER_STORAGE_KEY);
    storage.removeItem(STORAGE_KEY_MUST_CHANGE_PASSWORD);
  } catch {
    // storage ใช้ไม่ได้ — backend ยังบล็อกอยู่ (source of truth อยู่ฝั่ง server)
  }
}

function isOnPage(path: string): boolean {
  try {
    return win()?.location?.pathname === path;
  } catch {
    return false;
  }
}

export function isOnChangePasswordPage(): boolean {
  return isOnPage(CHANGE_PASSWORD_PATH);
}

export function isOnLoginPage(): boolean {
  return isOnPage(LOGIN_PATH);
}

export function isMustChangePasswordBody(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const body = data as Record<string, unknown>;
  return (
    body.code === MUST_CHANGE_PASSWORD_CODE ||
    body.error === MUST_CHANGE_PASSWORD_CODE
  );
}

export function isAccountDisabledBody(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const body = data as Record<string, unknown>;
  return (
    body.code === ACCOUNT_DISABLED_CODE ||
    body.error === ACCOUNT_DISABLED_CODE
  );
}

/**
 * พาไปหน้าเปลี่ยนรหัสผ่าน — คืน false เมื่ออยู่หน้านั้นแล้ว (loop guard)
 * ใช้ hard navigation เพื่อเคลียร์ state ของหน้าที่โหลดค้างทั้งหมด
 */
export function redirectToChangePassword(): boolean {
  if (isOnChangePasswordPage()) return false;
  setMustChangePasswordFlag(true);
  try {
    win()?.location?.assign?.(CHANGE_PASSWORD_PATH);
  } catch {
    // SSR/test env ไม่มี location — flag ถูก set ไว้แล้ว AdminGuard จะ redirect ตอน mount
  }
  return true;
}

/**
 * R9.1 — ล้าง session + พาไปหน้า login — คืน false เมื่ออยู่หน้า login แล้ว
 * (loop guard) บัญชีถูกปิด = session นี้ใช้ต่อไม่ได้ทุกกรณี — ล้าง session
 * "ก่อนเสมอ" แล้วค่อย guard การ navigate (การอยู่หน้า login อยู่แล้ว
 * ห้ามทำให้ token เก่าหลุดอยู่ใน storage)
 */
export function redirectToLogin(): boolean {
  clearAdminSession();
  if (isOnLoginPage()) return false;
  try {
    win()?.location?.assign?.(LOGIN_PATH);
  } catch {
    // SSR/test env ไม่มี location — session ถูกล้างแล้ว AdminGuard จะ redirect เอง
  }
  return true;
}

/**
 * ตรวจ response 403 จาก backend — ถ้าเป็น MUST_CHANGE_PASSWORD ให้ redirect
 * คืน true เมื่อจัดการแล้ว (caller มักไม่ต้องแสดง error ต่อ)
 */
export async function handleMustChangePasswordResponse(res: Response): Promise<boolean> {
  if (!res || res.status !== 403) return false;
  try {
    const data = await res.clone().json();
    if (isMustChangePasswordBody(data)) {
      return redirectToChangePassword();
    }
  } catch {
    // body ไม่ใช่ JSON — ไม่ใช่ MUST_CHANGE_PASSWORD
  }
  return false;
}

/**
 * R9.1 — ตรวจ response 403 จาก backend — ถ้าเป็น ACCOUNT_DISABLED ให้ล้าง
 * session แล้วพาไป login คืน true เมื่อจัดการแล้ว
 */
export async function handleAccountDisabledResponse(res: Response): Promise<boolean> {
  if (!res || res.status !== 403) return false;
  try {
    const data = await res.clone().json();
    if (isAccountDisabledBody(data)) {
      return redirectToLogin();
    }
  } catch {
    // body ไม่ใช่ JSON — ไม่ใช่ ACCOUNT_DISABLED
  }
  return false;
}

/**
 * ครอบ window.fetch ครั้งเดียว (idempotent, uninstall ได้) — ดัก 403
 * ของทั้งสอง code (ACCOUNT_DISABLED ตรวจก่อนเพราะ policy แรงกว่า) ครอบคลุม
 * หน้า admin ที่เรียก raw fetch เอง ไม่ต้องผ่าน adminFetch ทุกจุด
 * response ที่ caller ได้ยังอ่าน body ได้ครบ (clone ก่อน parse)
 */
export function installAccountStateFetchInterceptor(): () => void {
  const w = win() as any;
  if (!w || typeof w.fetch !== 'function') return () => {};
  if (w.fetch.__mustChangePasswordInterceptor) return () => {};

  const original = w.fetch;
  const wrapped = async (input: any, init?: any) => {
    const res = await original(input, init);
    if (res && res.status === 403) {
      try {
        const handled = await handleAccountDisabledResponse(res);
        if (!handled) await handleMustChangePasswordResponse(res);
      } catch {
        // ไม่มีผลต่อ response ที่ caller ได้
      }
    }
    return res;
  };
  wrapped.__mustChangePasswordInterceptor = true;
  w.fetch = wrapped;

  return () => {
    if (w.fetch === wrapped) w.fetch = original;
  };
}
