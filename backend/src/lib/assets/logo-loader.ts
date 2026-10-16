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

let cachedLogo: PDFImage | null = null;

/**
 * โหลด SAO logo เป็น PDFImage
 *
 * - ใช้ png-lib embedPng ในการ parse
 * - Cache ใน Worker memory หลัง load ครั้งแรก
 * - throw error ถ้า load ล้มเหลว
 */
export async function loadSaoLogo(doc: PDFDocument): Promise<PDFImage> {
  if (cachedLogo) {
    return cachedLogo;
  }

  try {
    const bytes = base64ToBytes(SAO_LOGO_BASE64);
    cachedLogo = await doc.embedPng(bytes);
    return cachedLogo;
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
  cachedLogo = null;
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
