# PDF V1 — Source Assets

**ทำไมต้องมี folder นี้:**

Cloudflare Workers ใช้ esbuild (ผ่าน Wrangler 3) ในการ bundle
esbuild **ไม่รองรับ** import ไฟล์ binary (.ttf, .png) โดยตรง
และ Wrangler.toml ไม่มี `build.rules` เหมือน Vite/Webpack

**วิธีแก้:**

ใช้ Node.js build script (`scripts/build-assets.ts`) แปลง binary → base64 string
แล้วเขียนเป็นไฟล์ `.data.ts` (export constant) ใน `src/lib/`
esbuild bundle string เป็น JS literal ได้โดยตรง (ไม่ต้อง loader)

## ไฟล์ใน folder นี้

| File | Purpose | Output |
|---|---|---|
| `THSarabunNew.ttf` | TH Sarabun Regular (ภาษาไทย) | `src/lib/fonts/sarabun-regular.data.ts` |
| `THSarabunNew Bold.ttf` | TH Sarabun Bold | `src/lib/fonts/sarabun-bold.data.ts` |
| `sao-logo.png` | โลโก้ สตง. | `src/lib/assets/sao-logo.data.ts` |

## วิธีอัปเดต asset

1. วางไฟล์ใหม่ใน folder นี้ (overwrite)
2. รัน:
   ```bash
   npm run build:assets
   ```
3. Generated `.data.ts` จะถูกอัปเดตอัตโนมัติ
4. Commit ทั้ง 2 ไฟล์:
   - `assets-source/<file>` (binary ต้นฉบับ)
   - `src/lib/**/*.data.ts` (generated base64)

## Auto-generation

`package.json` มี hooks:
- `predev` → run `build:assets` ก่อน `wrangler dev`
- `prebuild` → run `build:assets` ก่อน typecheck
- `predeploy` → run `build:assets` ก่อน `wrangler deploy`

## Download

### TH Sarabun
- f0nt.com: https://www.f0nt.com/release/th-sarabun-new/
- GitHub: https://github.com/SarunSumlet/th-fonts-collection

### SAO Logo
- https://www.sao.go.th/

## Bundle Size

| Asset | Binary | Base64 | Gzipped |
|---|---|---|---|
| THSarabunNew.ttf | 468 KB | 624 KB | ~280 KB |
| THSarabunNew Bold.ttf | 358 KB | 477 KB | ~210 KB |
| sao-logo.png | 179 KB | 239 KB | ~180 KB (PNG ไม่ compress ได้อีก) |
| **Total** | **1.0 MB** | **1.3 MB** | **~670 KB** |

Cloudflare Workers paid plan: 10 MB compressed → ✅
Cloudflare Workers free plan: 1 MB compressed → ❌ (ต้อง upgrade)
