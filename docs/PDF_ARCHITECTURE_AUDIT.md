# PDF Architecture Audit

> **Sprint 2 — Task 1** | วันที่: 2026-10-31 | Branch: `feature/sprint2-recoverability-and-pdf` (ฐาน cfb4ecff)
>
> **สถานะ: Analysis-only — ห้ามแก้โค้ดตามข้อกำหนดของ sprint**
>
> ทุก claim มีหลักฐาน `file:line` จากโค้ดจริง ณ HEAD ปัจจุบัน ยกเว้นข้อความที่กำกับ "ประเมิน" (estimate) ซึ่งเป็นการวิเคราะห์ ไม่ใช่การวัดจริง

---

## 1. Executive Summary

ระบบ PDF ใช้เอนจินเดียวคือ **Document Composer** (pdf-lib + fontkit, ฟอนต์ TH Sarabun) สำหรับทั้ง preview และ download โครงสร้างเดิมตั้งใจดี: **PDF ไม่ถูกสร้างตอน submit** แต่ render แบบ lazy ครั้งแรกที่มีคนดาวน์โหลด แล้วเก็บ object cache ไว้ใน R2 (key `pdf/applications/{id}/v3.pdf`) — นี่คือ Option B ในเอกสาร PDF_CACHE_STRATEGY ที่ **implement ไปแล้วใน production จริง**

จุดเสี่ยง "Worker exceeded CPU time limit" ที่เคยเกิดจริงคือ **preview endpoint** (`POST /admin/template-versions/:id/descriptor/pdf-preview`) ซึ่ง render สดทุก request โดยไม่แตะ R2 cache และเคยมี retry storm จาก frontend มาซ้ำ ๆ — ปัจจุบันมี hardening แล้ว 3 ชั้น (LRU ใน isolate, AbortSignal, debounce+backoff ฝั่ง frontend)

ความเสี่ยงหลักที่ยังหลงเหลือ:

| # | ความเสี่ยง | ระดับ |
|---|-----------|-------|
| 1 | `embedFont` + fontkit subsetting ฟอนต์ไทย (~830 KB TTF 2 ไฟล์) ทำงาน **ทุกครั้งที่ render** ไม่มีทาง cache ผลลัพธ์ cross-document ได้ | สถาปัตยกรรมที่ยอมรับมา — ทางแก้เดียวคือลด "จำนวนครั้งที่ต้อง render" (cache) ไม่ใช่แก้ตัว embed |
| 2 | Admin bulk download (ZIP) ยิง endpoint รายใบ concurrency 2 — cache miss ต่อเนื่อง = render สดต่อเนื่อง | Medium |
| 3 | Invalidation มีช่องว่าง: ลบ field (`DELETE /admin/fields/:id`) ไม่ invalidate R2 cache, object เวอร์ชันเก่า (`v1`/`v2`) เป็น orphan ไม่มี TTL | Medium |
| 4 | `doc.save({ useObjectStreams: false })` ทำให้ไฟล์ใหญ่และ serialize ช้ากว่าจำเป็น | Low |

---

## 2. Current Flow — 7 เส้นทางตามโจทย์

### 2.1 Applicant Submit (`POST /public/applications/submit`)

- `backend/src/routes/public.routes.ts:580` — validate + insert D1 (db.batch, `:412-520` region) คืน `{applicationNo}` 201 ที่ `:838`
- **ไม่มีการสร้าง PDF ใน request นี้เลย** — PDF เกิดแบบ lazy ครั้งแรกที่มีคนขอดาวน์โหลด
- ไฟล์แนบ (upload แยกตั้งแต่ยังกรอกฟอร์ม ผ่าน `upload.routes.ts`) ถูก promote TEMP→ACTIVE ใน submit batch เดียวกัน

### 2.2 Applicant Lookup (`POST /public/applications/lookup`)

- `backend/src/routes/public.routes.ts:884` (rate limit 30/min) — คืน JSON metadata เท่านั้น (`:901-916`), **ไม่มี PDF**
- ผู้สมัครขอ PDF ตัวเองผ่าน `POST /public/applications/download-pdf` (ดู 2.5)

### 2.3 Admin PDF Preview (`POST /admin/template-versions/:id/descriptor/pdf-preview`)

- `backend/src/routes/template-descriptor.routes.ts:475-476` (router mount ที่ `admin.routes.ts:4588`)
- **Render สดทุก request** ยกเว้นโดน LRU ใน isolate (ไม่แตะ R2 เลย)
- ข้อมูลจริงผ่าน `loadApplicationContext` (`:505`, service: `backend/src/services/application-context.service.ts:64-182`) หรือ sample data ผ่าน `buildPreviewContext` (`:519`)
- ส่ง `c.req.raw.signal` เข้า renderer เพื่อ abort กลางทางได้ (`:575`)
- มี HTML preview คู่กัน (`POST .../descriptor/preview`, `:362-364`) ซึ่ง render ผ่าน `preview-renderer.ts` (2,383 บรรทัด) — **ไม่มี cache ทั้งสองฝั่ง** และไม่ใช่ PDF

### 2.4 Admin PDF Download (`GET /admin/applications/:id/pdf`)

- `backend/src/routes/admin.routes.ts:2491` → `getApplicationPdf` (`:2504`) → เขียน audit `PDF_DOWNLOAD` ทุกครั้ง (`:2510-2528`)
- Header `X-Cache: HIT|MISS` + `Cache-Control: private, max-age=300` (`:2546-2547`)
- ชื่อไฟล์จาก `pdf_filename_pattern` (migration 028) ผ่าน `application-pdf-context.ts:26-47`

### 2.5 Public PDF Download (`POST /public/applications/download-pdf`)

- `backend/src/routes/public.routes.ts:927-928` — ยืนยันตัวตนด้วย roundId+email+phone (ไม่ใช่ signed URL), rate limit `lookup-pdf` 20/min (`:929`)
- เรียก `getApplicationPdf` เดียวกับฝั่ง admin (`:957`) → **anonymous caller คือตัว trigger render สดได้** (แต่ผูกกับข้อมูลตัวเองเท่านั้น)
- `Content-Disposition: attachment` (`:973-981`), `Cache-Control: private, no-cache, no-store` (`:979`)

### 2.6 Template Versioning → อินพุตของ render

- `template_versions` เก็บ `descriptorJson` + `descriptorSchemaVersion` (`backend/src/db/schema.ts:72-73`) และ `pdf_filename_pattern` (`:81`, เพิ่มโดย migration 028)
- **Version pinning**: render ใช้ `round.templateVersionId` เสมอ ไม่ใช่เวอร์ชันล่าสุด (`pdf.service.ts:155-176`) — ใบสมัครที่ยื่นไปแล้วเห็นแบบฟอร์มเดิมตลอด
- Context build = 7 sequential D1 queries (app → round → template version → sections → fields → attachments → formData JSON.parse) ที่ `pdf.service.ts:158-320`
- descriptor ถ้าไม่มีใน DB (เทมเพลตเก่าก่อน migration 022) จะ generate ขึ้นจาก sections/fields (`pdf.service.ts:96-113`)

### 2.7 Cache Invalidation

- ไฟล์: `backend/src/lib/pdf-cache-invalidation.ts` — กลไกคือ **R2 `bucket.delete` ของ key เวอร์ชันปัจจุบัน** (batch 1000/key, `:34`, `:80-82`) ไม่ใช่ Cache API purge ทุก function fail-open (log `[PDF-CACHE]` แล้วผ่าน)
- จุดเรียก 3 จุด:
  | Trigger | Function | ผู้เรียก |
  |---|---|---|
  | บันทึก descriptor | `invalidatePdfCacheForTemplateVersion` | `template-descriptor.routes.ts:341` |
  | เปลี่ยนชื่อรอบ | `invalidatePdfCacheForRound` | `admin.routes.ts:1987-1989` (`{ROUND_NAME}` อ่านสดตอน render) |
  | แก้ field master (PUT) | `invalidatePdfCacheForFieldMaster` | `admin.routes.ts:400` |
- **ช่องว่างที่พบ:**
  1. สถานะใบสมัครเปลี่ยน **ไม่ invalidate โดยเจตนา** (PDF ไม่มี STATUS token) — documented ที่ header `:7-14`
  2. `DELETE /admin/fields/:id` (soft-deactivate) **ไม่ invalidate** ขณะที่ PUT invalidate — ไม่สมมาตร (`admin.routes.ts:406-409`)
  3. R2 object ไม่มี TTL — ความถูกต้องพึ่ง bump `PDF_CACHE_VERSION` (`pdf-types.ts:190-203`, ปัจจุบัน `'v3'`); object v1/v2 เก่าเป็น orphan ไม่มีตัวเก็บ
  4. แก้ `pdf_filename_pattern` ไม่ invalidate (ชื่อไฟล์ไม่ผูกกับ bytes) — ถูกต้องตาม design

---

## 3. PDF Lifecycle

```
Submit ──(ไม่สร้าง PDF)──► D1 row
                                   │
Admin download ──┐                 │
Public download ─┼─► R2 get(pdf/applications/{id}/v3.pdf) ──HIT──► bytes กลับ client
Bulk ZIP (FE) ───┘                 │
                                   MISS
                                   ▼
                    buildApplicationContext (7 D1 queries)
                                   ▼
                    loadTemplateDescriptor ──(ไม่มี)──► generateDescriptorFromTemplate
                                   ▼
                    buildRenderPlan (descriptor + ctx → commands)
                                   ▼
                    renderPlanToPdf: PDFDocument.create()
                      → embedFont(TH Sarabun Regular+Bold, subset)  ◄── ทุกครั้ง
                      → embedPng(logo เฉพาะเมื่อมี logo block)
                      → command loop (per-command abort check)
                      → doc.save({useObjectStreams:false})
                                   ▼
                    r2.put (best-effort, metadata x-generated-at/x-page-count)
                                   ▼
แก้ descriptor/ชื่อรอบ/field master ──► R2 delete key v3 ──► render ใหม่ครั้งถัดไป
```

Preview path (แยกจาก diagram บน): `descriptor edit → debounce 1.2s → POST pdf-preview → LRU(isolate, key=applicationId|descriptorJson) → miss ⇒ render สด → ไม่เคยเขียน R2`

---

## 4. Rendering Paths — เอนจิน

- Entry: `buildRenderPlan()` `backend/src/lib/document-composer/descriptor-renderer.ts:588` (tokens resolve ครั้งเดียวที่ `:603`) → `renderPlanToPdf()` `:1048`
- Render core `:1063-1110`: `PDFDocument.create()` → `loadSarabunFonts` → logo เมื่อมีคำสั่ง logo → loop คำสั่งแบบ synchronous พร้อม per-block try/catch (Requirement K.6, `:1091-1102`) → `doc.save` (`:1105`)
- เอนจินเก่า `renderApplicationPdf()` (`backend/src/lib/pdf-renderer.service.ts:93`) **ตายแล้วใน production** — เหลือแค่ test import และมี test คอยห้าม pdf.service.ts กลับไปเรียก (`__tests__/pdf-cache-invalidation.test.ts:440`)
- ฟอนต์: bytes decode cache ที่ module scope (`backend/src/lib/fonts/font-loader.ts:45-48`) แต่ `doc.registerFontkit + doc.embedFont(bytes, {subset:true})` Regular+Bold รัน **ทุกเอกสาร** (`:52-58`) — ห้าม cache ผล embed เพราะ PDFFont ผูก object graph ของเอกสารนั้น (comment `:18-37`, ที่เคยทำพลาดแล้วเกิดหน้าว่าง)
- โลโก้: pattern เดียวกัน (`backend/src/lib/assets/logo-loader.ts:28-40`)
- เวลาไทย: token วัน/เวลา + signature ใช้ fixed offset Asia/Bangkok `BANGKOK_OFFSET_MS = 7h` (`document-tokens.ts:731, 752-769`) — แก้แล้วจาก commit 78ad3839 และบังคับ bump cache v3

### Hardening ที่มีอยู่จริงบน preview (ต่อยอดจาก incident 503/1102, commit 106e6673)

| ชั้น | ค่าที่ตั้ง | ที่อยู่ |
|---|---|---|
| Backend LRU | 6 entries / 2 MB total / TTL 60s, key = `applicationId\|JSON(descriptor)` | `document-composer/pdf-preview-cache.ts:29-31, 41-46` |
| AbortSignal | pre-render check → 499, เช็คทุก command, map AbortError → 499 | `template-descriptor.routes.ts:565-576, 619-621`; `descriptor-renderer.ts:1085-1090` |
| FE debounce | 1,200 ms | `PdfPreviewFrame.tsx:85` |
| FE retry | สูงสุด 3 ครั้ง, backoff 1s/2s/4s, abort in-flight ทุกครั้งที่แก้ descriptor | `PdfPreviewFrame.tsx:104-105, 121-124, 208-211` |
| Instrumentation | log `buildRenderPlanMs/renderPlanToPdfMs/totalMs` + header `X-Pdf-Page-Count`, `X-Pdf-Preview-Cache` | `template-descriptor.routes.ts:585-616` |

---

## 5. CPU Hotspots (เฉพาะเส้นทาง PDF)

จัดอันดับจากน้ำหนักต่อ 1 request (ประเมินจากโครงสร้างโค้ด + ขนาด asset; ไม่มี profile จริงต่อ operation ใน doc นี้):

1. **`doc.embedFont(bytes, {subset:true})` × 2** — fontkit parse+subset TTF 468 KB (Regular) + 358 KB (Bold) ทุกเอกสาร (`font-loader.ts:57-58`) — นี่คือต้นทุนคงที่ที่แพงที่สุดต่อ render
2. **`doc.save({ useObjectStreams: false })`** — serialize object graph ทั้งเอกสารแบบ synchronous (`descriptor-renderer.ts:1105`); `useObjectStreams:false` ทำให้ output ใหญ่และแพงกว่าจำเป็น (ถูกเลือกไว้เพื่อความเข้ากันได้ — ประเมินว่าลองเปิดเป็น option ได้แต่ต้องยืนยัน parity)
3. **Per-character width measurement ใน `wrapParagraph`** — `widthOfTextAtSize` ต่อ token และต่ออักขระสำหรับคำยาว/ไร้ช่องว่าง (`:2462-2527`, char loop `:2511-2522`) — ภาษาไทยเว้นวรรคน้อยจึงเดิน path per-character บ่อย
4. **ตาราง** — `computeTableLayout` wrap ทุก cell ทุกแถว (`:1810-1878`, `:1853-1857`) + re-draw header ทุกหน้า (`:1884-1906`) = O(rows × cols × wrap-cost)
5. **Cold-isolate asset decode** — `atob` base64 ≈1.0 MB (ฟอนต์ 2 ไฟล์ + โลโก้ 238.7 KB base64) หนึ่งครั้งต่อ isolate (`font-loader.ts:84-91`, `logo-loader.ts:52-59`) — จำนวน isolate บน Workers = จำนวนครั้งที่โดน evict

**Amplifier ที่สำคัญที่สุด:** `frontend/src/lib/pdf-bulk-download.ts:4-5, 213, 296` — admin กด ZIP ทั้งรอบ → ยิง `GET /admin/applications/:id/pdf` รายใบ concurrency 2 → cache miss ต่อเนื่องจ่ายข้อ 1-4 ซ้ำต่อใบ ภายใน isolate ชุดเดียว

---

## 6. Memory Hotspots

| จุด | เหตุผล | หลักฐาน |
|---|---|---|
| Base64 assets ใน bundle | ฟอนต์+โลโก้ ≈ 1.35 MB source, decode เป็น ≈1.0 MB bytes ต่อ isolate, cache ค้างใน module scope ตลอดชีวิต isolate | `sarabun-regular.data.ts` (639,730 B), `sarabun-bold.data.ts` (488,848 B), `sao-logo.data.ts` (244,639 B) |
| เอกสาร PDF ค้างใน memory | PDFDocument + plan + bytes อยู่ระหว่าง render; LRU preview กักไว้สูงสุด 2 MB | `pdf-preview-cache.ts:29-30` |
| จำนวนหน้าไม่มีเพดาน | มีแค่ pagination guard ต่อ block (0.5pt SAFETY) ไม่มี max-page cap ระดับเอกสาร | `descriptor-renderer.ts:2023-2050, 1177` |
| ข้อมูลผู้สมัคร | formData JSON.parse ต่อ render (ครั้งเดียวต่อ context) — bounded ด้วย textarea 5,000 ตัวอักษร/field | `pdf.service.ts:277-285`; `validators.ts:179,186` |

รูปภาพผู้สมัคร/ลายเซ็นเป็นภาพ: **ไม่มี** — ลายเซ็นเป็นข้อความ+เส้นประ (`drawSignature` `:2232-2284`), FILE field พิมพ์ชื่อไฟล์เท่านั้น (`document-tokens.ts:268-282`) — นี่คือเหตุผลที่ memory ต่อ render จึงไม่ระเบิดเหมือนระบบที่ฝังรูป

---

## 7. โอกาสชน Worker Limit (สรุปจุดเสี่ยง)

| เส้นทาง | เงื่อนไขที่เสี่ยง | เคยเกิดจริง? | กลไกกันอยู่ |
|---|---|---|---|
| Preview | descriptor ใหญ่/ตารางยาว + ยิงถี่ (editing session) | **ใช่** (503/1102, มี comment อ้างที่ `template-descriptor.routes.ts:452`) | LRU + Abort + debounce/backoff (ครบ) |
| Public download | ผู้สมัครกดโหลดใหม่หลายใบต่อเนื่องหลัง invalidation พร้อมกัน (เช่น หลังแก้ descriptor ทั้งรอบ) | ไม่พบหลักฐาน | rate limit 20/min/IP เท่านั้น — **ไม่มี cache ระดับ isolate** |
| Admin download + Bulk ZIP | รอบใหญ่ ยังไม่เคยถูก render ก่อน | ไม่พบหลักฐาน | ไม่มี — concurrency 2 ทำให้พอไหว (ประเมิน 70% มั่นใจว่ารอบ <500 ใบปลอดภัย) |
| Cold start แรกของ isolate | decode asset 1 MB + render แรก | ไม่พบหลักฐาน | — |

ข้อสรุปเชิงสถาปัตยกรรม: เส้นทางที่ "ยอม render สดต่อ miss" (download) ปลอดภัยเพราะ R2 cache ทำให้ render จ่ายครั้งเดียวต่อใบต่อเวอร์ชัน — ความเสี่ยงจึงกระจุกอยู่ที่ (ก) คลื่น miss พร้อมกันหลัง invalidation และ (ข) preview ซึ่งไม่เคยมี persistent cache เลย

---

## 8. Risks (สรุป)

1. **[Medium] Invalidation ไม่สมมาตร** — DELETE field ไม่ล้าง cache ผู้ใช้จะเห็น PDF เก่าจนกว่าจะมี trigger อื่น (หรือ bump version)
2. **[Medium] Orphan R2 objects** — v1/v2 ค้างถาวร (พื้นที่ต่ำ แต่เป็น PII-bearing PDF ที่หลุดจากการควบคุม invalidation — ควรมี lifecycle/cleanup)
3. **[Medium] Bulk ZIP เป็น render storm ที่ซ่อนใน frontend** — ไม่มี backpressure ฝั่ง server เมื่อ invalidation เพิ่งเกิด
4. **[Low] `useObjectStreams:false`** — ไฟล์ใหญ่/ช้ากว่าจำเป็น
5. **[Low] Public download ใช้ PII (email+phone) เป็น credential** — อยู่นอกขอบเขต PDF perf แต่ควรจดไว้ (P2 เดิมจาก go-live audit)

## 9. Recommendations (ส่งต่อ Task 2)

1. **ยึด Option B (cache-on-first-download) ที่ implement แล้วเป็นแกนหลัก** — ไม่ต้องเปลี่ยนสถาปัตยกรรม
2. เติม **preview persistence** แบบ bounded (เฉพาะ preview ของ descriptor ที่ save แล้ว) — รายละเอียดใน `PDF_CACHE_STRATEGY.md`
3. เติม invalidation สำหรับ `DELETE /admin/fields/:id` + cleanup orphan (cron เดิมที่ `index.ts:120-134` ต่อยอดได้)
4. เก็บ `useObjectStreams:false` ไว้ก่อน แล้ววัด A/B ทีหลัง (ห้ามแก้พร้อมกับอย่างอื่น)
5. Bulk ZIP: คง concurrency 2 ฝั่ง FE และพิจารณา pre-warm ทีละใบผ่าน cron ภายหลัง — **ไม่แนะนำ Queue** (ตามข้อ DO NOT TOUCH + ต้นทุน ops)
