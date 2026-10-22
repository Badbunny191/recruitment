/**
 * PDF V1 — Logo Loader
 *
 * Load SAO (สำนักงานการตรวจเงินแผ่นดิน) logo PNG.
 *
 * Logo is base64-inlined in src/lib/assets/sao-logo.data.ts (auto-generated
 * by scripts/build-assets.ts from assets-source/).
 */

import { PDFImage, PDFDocument } from 'pdf-lib';
import { SAO_LOGO_BASE64 } from './sao-logo.data';

let cachedLogoBytes: Uint8Array | null = null;

/**
 * ⚠️ ทำไม cache แค่ "ไบต์" ไม่ cache PDFImage
 * =============================================================================
 *
 * เหตุผลเดียวกับ `font-loader.ts`:
 *   `doc.embedPng()` ผูก image เข้ากับ PDFDocument ตัวนั้นด้วย object reference
 *
 * ถ้าเก็บ `PDFImage` ไว้ที่ module scope แล้วนำไป `page.drawImage()` บน doc อื่น
 *   → resource dict จะชี้ไปยัง object ของ document เดิม
 *   → รูปโลโก้หายเงียบ ๆ (content stream ยังมีคำสั่งวาดรูป แต่ XObject หาย)
 *
 * ✅ cache เฉพาะไบต์ดิบ แล้ว embed ใหม่ทุก document
 */
export async function loadSaoLogo(doc: PDFDocument): Promise<PDFImage> {
  if (!cachedLogoBytes) {
    cachedLogoBytes = base64ToBytes(SAO_LOGO_BASE64);
  }

  try {
    return await doc.embedPng(cachedLogoBytes);
  } catch (err) {
    throw new Error(
      `Failed to load SAO logo: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Reset cache (สำหรับ testing หรือ hot reload)
 */
export function resetLogoCache(): void {
  cachedLogoBytes = null;
}

/**
 * Convert base64 string → Uint8Array
 */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
