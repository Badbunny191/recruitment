/**
 * R9 — mustChangePassword frontend handling
 * ==========================================
 *
 * Backend (middlewares/must-change-password.middleware.ts) ตอบ 403 + code
 * MUST_CHANGE_PASSWORD สำหรับทุก endpoint ที่ถูกบล็อกขณะ flag เปิดอยู่
 * หน้าที่ของฝั่งนี้: ดัก response เหล่านั้นแล้วพาไปหน้าเปลี่ยนรหัสผ่าน
 * ก่อนที่หน้านั้นจะแสดง "โหลดข้อมูลไม่สำเร็จ / ไม่พบข้อมูล" แทน security error
 *
 * กัน loop:
 *   - redirect เฉพาะเมื่อ "ไม่ได้อยู่หน้า change-password อยู่แล้ว"
 *   - /auth/change-password + /auth/me เป็น allowlist ฝั่ง backend
 *     (หน้า change-password เองไม่โดน 403 MUST_CHANGE_PASSWORD)
 */

export const MUST_CHANGE_PASSWORD_CODE = 'MUST_CHANGE_PASSWORD';
export const STORAGE_KEY_MUST_CHANGE_PASSWORD = 'mustChangePassword';
export const CHANGE_PASSWORD_PATH = '/admin/change-password';

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

export function isOnChangePasswordPage(): boolean {
  try {
    return win()?.location?.pathname === CHANGE_PASSWORD_PATH;
  } catch {
    return false;
  }
}

export function isMustChangePasswordBody(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const body = data as Record<string, unknown>;
  return (
    body.code === MUST_CHANGE_PASSWORD_CODE ||
    body.error === MUST_CHANGE_PASSWORD_CODE
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
 * ครอบ window.fetch ครั้งเดียว (idempotent, uninstall ได้) — ครอบคลุม
 * หน้า admin ที่เรียก raw fetch เอง ไม่ต้องผ่าน adminFetch ทุกจุด
 * response ที่ caller ได้ยังอ่าน body ได้ครบ (clone ก่อน parse)
 */
export function installMustChangePasswordFetchInterceptor(): () => void {
  const w = win() as any;
  if (!w || typeof w.fetch !== 'function') return () => {};
  if (w.fetch.__mustChangePasswordInterceptor) return () => {};

  const original = w.fetch;
  const wrapped = async (input: any, init?: any) => {
    const res = await original(input, init);
    if (res && res.status === 403) {
      try {
        await handleMustChangePasswordResponse(res);
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
