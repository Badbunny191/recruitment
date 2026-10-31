# CPU Hotspot Analysis

> **Sprint 2 — Task 3** | วันที่: 2026-10-31 | Branch: `feature/sprint2-recoverability-and-pdf` (ฐาน cfb4ecff)
>
> **สถานะ: Analysis-only** | บริบท: Workers (paid plan — CPU limit 30s/request, memory 128 MB) เคยเกิด "Worker exceeded CPU time limit" จริงที่ preview endpoint
>
> Severity ตัดสินจาก: worst-case input size × ต้นทุนต่อ item × ความถี่การเรียก × ประวัติ incident ทุก claim มี `file:line`; ที่ไม่มีการวัดจริงจะกำกับ "ประเมิน"

**Mitigation ที่มีอยู่แล้วและห้ามทำซ้ำ** (Platform Hardening Phase 1 + รอบก่อน): `MAX_EXPORT_ROWS=1000` (422), `MAX_BULK_IDS=80`, preview LRU 6 entries/2 MB + AbortSignal + FE debounce/backoff, dashboard overview รวม fan-out เป็น 1 endpoint, migration 031 submitted_at indexes (ยืนยันบน prod แล้ว)

---

## Critical

### C1. Excel export: SELECT ทั้งรอบ (รวม formData JSON) ก่อนเช็ค cap

- **File/Function:** `backend/src/services/excel-export.service.ts` — `exportApplicationsExcel()` filtered path (`:673-677` select ไม่มี `.limit()`, เช็ค cap ที่ `:680`), selector-filter path (`:799-803`, เช็ค `:815`)
- **Reason:** `EXPORT_APP_COLUMNS` รวมคอลัมน์ `formData` (JSON TEXT ใหญ่, `:489`) — D1 ต้องย้าย+parse ทุกแถวของรอบเข้า Worker เพื่อตอบว่า "เกิน 1,000 ไหม?" cap คุมแค่การ build workbook ไม่คุมการ fetch รายงาน audit + migration 031 comment รับทราบข้อจำกัดนี้แล้ว (`:18-22`)
- **Estimated impact (ประเมิน):** รอบ 10,000 ใบ × formData 5–50 KB = 50–500 MB ย้ายผ่าน D1 RPC ใน request เดียว — ตัวเบอร์ต้น ๆ ที่ทำให้ "Worker exceeded CPU time limit" ซ้ำในอนาคต (ผู้สมัครเพิ่มตามเวลา)
- **Recommendation:** ย้าย cap เข้า SQL — นับ `SELECT COUNT(*) WHERE <filters เดียวกัน>` ก่อน (1 query เบา) เกิน cap คืน 422 ทันที แล้วจึง select จริงพร้อม `.limit(MAX_EXPORT_ROWS)`; ไม่ต้องแตะ schema/index (031 ครอบ sort แล้ว)

### C2. PDF render ต่อ cache-miss: embedFont ฟอนต์ไทย 2 ไฟล์ ทุกเอกสาร

- **File/Function:** `backend/src/lib/fonts/font-loader.ts:52-58` (embedFont subset TH Sarabun Regular 468 KB + Bold 358 KB), render core `backend/src/lib/document-composer/descriptor-renderer.ts:1063-1110`, trigger ทั้ง admin (`admin.routes.ts:2491`) และ public anonymous (`public.routes.ts:928, 957`)
- **Reason:** fontkit parse+subsetting เป็นงาน CPU หนักสุดต่อ render และ **ห้าม cache ผลลัพธ์** (PDFFont ผูก object graph ต่อเอกสาร — comment `:18-37`) ทางเดียวคือลดจำนวน render
- **Estimated impact (ประเมิน):** หลัก 100 ms ต่อ render บน paid plan; อันตรายเมื่อเป็นคลื่น (bulk ZIP concurrency 2, `frontend/src/lib/pdf-bulk-download.ts:4-5`) หรือ cold isolate (decode asset ~1 MB เพิ่ม)
- **Recommendation:** แนวรับไว้แล้ว (R2 cache on first download — ดู PDF_CACHE_STRATEGY §5): ปิดช่อง invalidation DELETE field + กันคลื่น miss ด้วย LRU ระยะสั้นฝั่ง download

## High

### H1. exceljs build workbook ทั้งก้อนใน request เดียว

- **File/Function:** `excel-export.service.ts` — `buildWorkbookBuffer()` `:508-622`, serialize `wb.xlsx.writeBuffer()` `:616`; per-row addRow + per-cell sanitize regex `/^[=+\-@\t\r]/` (`:580-599`) + wrapText pass (`:604-610`)
- **Reason:** 1,000 แถว × ~30-60 คอลัมน์ ≈ 30-60k cell (regex + alignment 2 pass) + zip deflate ทั้ง sheet (exceljs pure-JS)
- **Estimated impact (ประเมิน):** ระดับหลักร้อย ms ต่อ export ที่ cap — ยอมรับได้ในแต่ละครั้ง แต่ถูกเรียกซ้ำได้ต่อเนื่องโดย admin
- **Recommendation:** พอไหวที่ cap ปัจจุบัน — ต่อเมื่อแก้ C1 แล้วยังช้า/1102 จึงพิจารณา streaming หรือลด MAX_EXPORT_ROWS

### H2. GET /admin/applications ไม่ส่ง `page` = คืนทุกแถวของ filter (สัญญา legacy)

- **File/Function:** `backend/src/routes/admin.routes.ts:2130-2138` (คอมเมนต์ "ไม่ส่ง page = contract เดิม: คืนทุกแถว") และ `/ids` `:2175-2192` (ไม่มี limit เช่นกัน)
- **Reason:** projection ตัด formData แล้ว (`applications-list-query.ts:91-99`) จึงเบากว่า Excel แต่ response + JSON.stringify โต linear ตามจำนวนใบ; FE "เลือกทั้งหมดข้ามหน้า" พึ่ง path นี้ (`ApplicationsClient.tsx:575-580`)
- **Estimated impact (ประเมิน):** วันนี้ Low (รอบจริงสิบ ๆ ใบ) แต่เป็น **regression trap สูงสุด** เมื่อรอบโต
- **Recommendation:** กำหนด hard cap (เช่น 2,000) + ตอบ 422/400 เมื่อเกิน พร้อมแนะให้ FE ใช้ paginated path; ทำครั้งเดียวพร้อมกันทั้ง `/` และ `/ids`

### H3. bcryptjs cost 10 (pure JS) ต่อ login

- **File/Function:** `backend/src/routes/admin.routes.ts:136` (verify), dummy compare กัน enumeration `:88, :111`, hash ตอน create/reset `:4299, :4456`; `backend/src/services/auth.service.ts:10-26`
- **Reason:** bcrypt บน JS runtime ≈ หลักสิบ ms CPU ต่อ compare + จงใจยิงซ้ำอีกครั้งสำหรับ email ไม่รู้จัก
- **Mitigation ที่มี:** rate limit 10/min/IP (`rate-limit.middleware.ts:111`) — เพียงพอเพราะ admin login ถี่แค่ไหน
- **Recommendation:** ไม่แก้ (auth = DO NOT TOUCH) — จดไว้ว่าถ้าย้าย password hashing ไป WebCrypto ต้องเป็น project ใหญ่ ไม่ใช่ hotfix

## Medium-High

### MH1. GET /admin/audit-logs: `LIKE '%q%'` scan เต็มตาราง ×2 (COUNT + page)

- **File/Function:** WHERE builder `backend/src/lib/audit-log-query.ts:46-61` (leading-wildcard บน adminId/entityId/ipAddress + subquery email); handler `admin.routes.ts:3375-3397` (COUNT สแกน 1 รอบ + page อีก 1 รอบ)
- **Reason:** index จาก migration 017 ใช้ไม่ได้กับ leading `%` และ `audit_logs` โตไม่จำกัด (PDF_DOWNLOAD ทุกครั้ง, login audit ทุกครั้ง — `admin.routes.ts:2512-2525`)
- **Estimated impact (ประเมิน):** 100k+ แถว → สแกนสองรอบต่อการเปิดหน้า audit
- **Recommendation:** แยก COUNT ออก/ไม่นับเมื่อมี search term (ใช้ hasMore แบบ history), จำกัด search ให้ prefix (`q%`) หรือเพิ่ม FTS ภายหลัง

### MH2. bulk-status แบบ `filter`: SELECT matched-set ไม่จำกัด + audit payload ใส่ id ครบชุด

- **File/Function:** `admin.routes.ts:2697-2700` (SELECT ไม่มี LIMIT ตาม selector), stringify รวมทุก id ลง audit payload `:2768-2778` (กรณี matched=0 ที่ `:2729-2739`); `MAX_BULK_IDS=80` คุมเฉพาะ kind `ids` (`applications-selector.ts:103`, ใช้ที่ `:2674`)
- **Reason:** filter ที่ครอบทั้งรอบ → UPDATE `IN (...)` ขนาดรอบ + audit JSON หลักสิบ-KB ขึ้นไปต่อคลิก
- **Recommendation:** cap matched-set (เช่น 500) + สรุป id ใน audit เป็น count + ชุดตัวอย่าง หรือเก็บ selector แทน id ทั้งหมด

### MH3. GET /admin/rounds/comparison: N+1 COUNT sequential ต่อเวอร์ชัน

- **File/Function:** `admin.routes.ts:2806-2812` (full-select rounds/templates/versions) + loop COUNT ต่อเวอร์ชัน `:2818-2824`
- **Reason:** V round-trip ต่อ request — dashboard V2 เลี่ยงไปแล้ว (`dashboard-overview.service.ts:216-273`) ที่นี่คือ dead/legacy endpoint (P3 เดิม)
- **Recommendation:** ยุบเป็น 1-2 query GROUP BY หรือ deprecate endpoint — ตารางเล็ก ไม่ด่วน

## Medium

### M1. Idempotency middleware: parse body ซ้ำ 2 รอบ + stableStringify+SHA-256 ทั้ง body

- **File/Function:** `backend/src/middlewares/idempotency.middleware.ts:157-165, :193, :209`; `backend/src/lib/request-hash.ts:38-78`
- **Reason:** hot path ของ public submit — formData ไม่มี cap รวม (zod `z.record(z.any())`, `validators.ts:530-546` เฉพาะ textarea จำกัด 5,000 ตัวอักษร/field) parse สองรอบ (middleware + validator)
- **Mitigation ที่มี:** tokenStore TTL 900s
- **Recommendation:** แชร์ parsed body ครั้งเดียว (ตั้ง `c.set('parsedBody')` แล้ว validator อ่าน) — เล็กแต่ตรง hot path

### M2. Unbounded in-memory Maps (memory, ไม่ใช่ CPU): idempotency tokenStore + rate-limit buckets

- **File/Function:** `idempotency.middleware.ts:74-78 (TODO ของตัวเอง), :108, :125-133 (sweep O(n))`; `rate-limit.middleware.ts:56`
- **Reason:** flood จาก IP จำนวนมาก → Map โต → memory pressure ต่อ isolate
- **Recommendation:** จำกัดขนาด (LRU/trim) ตอนที่แตะ TODO นั้น — ไม่ด่วน

### M3. Excel: JSON.parse formData ต่อแถว (รวม double-parse legacy)

- **File/Function:** `excel-export.service.ts:978-999` (`parseFormDataRecord`), เรียกต่อแถว `:575`
- **Reason:** 1,000 ครั้งของ JSON หลัก-KB — รองจาก C1 ที่ย้ายค่าขนส่งมาก่อน
- **Recommendation:** หายไปเองเมื่อ C1 คุม fetch; ไม่ต้องแก้แยก

## Low

| # | จุด | File:line | เหตุผลที่ Low |
|---|---|---|---|
| L1 | clone-options: 2 query ต่อเวอร์ชันที่ publish | `admin.routes.ts:3291-3320` | parallel, V น้อย |
| L2 | suggestUniqueRoundCode: ≤26 sequential query | `admin.routes.ts:3073-3083` | admin-only, เกิดไม่บ่อย |
| L3 | compare endpoint O(F²) `.find` | `admin.routes.ts:2958-3021` | F = หลักสิบ |
| L4 | GET /rounds, /fields, /fields/:id/usage: full-select ไม่มี limit | `admin.routes.ts:1678-1723, :335, :417-515` | master tables เล็ก |
| L5 | accountStateGate +1 D1 `.get()` ทุก request admin | `backend/src/middlewares/account-state.middleware.ts:79-86` | ต้นทุนคงที่ ~1 query (ราคาที่ยอมรับเพื่อ R9.1) |
| L6 | cron GC: batch 200 + claim-then-delete | `index.ts:120-134`; `attachment-cleanup.ts:23-24, 52-83` | bounded, idempotent (nit: R2 delete fail จะ abort loop รอบนั้น `:77`) |
| L7 | template create/clone: sequential INSERT ต่อ section/field | `admin.routes.ts:1030-1176` | admin-only, หลักสิบแถว |

## Frontend (สั้น)

| จุด | File:line | ประเมิน |
|---|---|---|
| sessionStorage draft JSON round-trip | `frontend/src/lib/applyDraft.ts:117-161, 281-290` | bounded ด้วยขนาดฟอร์ม — Low |
| ApplicationDetailClient double `JSON.parse(formData)` | `ApplicationDetailClient.tsx:557-562` | Low |
| Audit-logs page parse payload ต่อแถว | `audit-logs/page.tsx:224` | ≤pageSize — Low |
| Bulk ZIP loop concurrency 2 | `pdf-bulk-download.ts:4-5, 213, 296` | ปัญหาจริงอยู่ฝั่ง server (C2) — FE สมควรคง concurrency เดิม |

## Top 10 โดยรวม (จัดอันดับสุดท้าย)

1. **C1** Excel fetch ทั้งรอบก่อน cap — Critical
2. **C2** PDF render ต่อ miss (embedFont) — High (มีแนวรับแล้ว)
3. **H2** `/applications` + `/ids` ไม่มี limit — High (regression trap)
4. **H1** exceljs build+zip in-request — High
5. **H3** bcrypt cost 10 — High ต่อ request (bounded)
6. **MH1** audit-logs LIKE scan ×2 — Medium-High
7. **MH2** bulk-status filter ไม่จำกัด — Medium-High
8. **MH3** rounds/comparison N+1 — Medium-High (dead endpoint)
9. **M1** idempotency double-parse — Medium
10. **M2** unbounded Maps — Medium (memory)

**ข้อสรุป:** ทุก incident-เก่า (preview) มีแนวรับครบแล้ว ความเสี่ยงที่ยังโครงสร้างอยู่คือ "cap ทำหลัง fetch" (C1, H2, MH2) — เป็นรูปแบบเดียวกัน แก้ด้วยวิธีเดียวกัน (นับก่อนดึง) จึงเหมาะเป็นงานลำดับถัดไปของ sprint ถัดไป
