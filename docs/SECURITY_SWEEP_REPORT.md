# Security Sweep Report

- **วันที่:** 2026-10-31
- **ขอบเขต:** ทั้ง repository (backend `backend/src`, frontend `frontend/src`, config, migrations) ณ branch `feature/platform-hardening-phase1` (ฐาน main @ `9a6c72bd`)
- **ลักษณะงาน:** **Analysis only — ไม่แก้ไขโค้ด** นอกเหนือจากงาน TASK 1-5 ของ Platform Hardening Phase 1 (สิ่งที่แก้ไปแล้วระบุไว้แยกหมวด)
- **รูปแบบ:** Critical / High / Medium / Low + file, line, issue, recommendation

---

# Critical

## C-1. PII ทั้งฐานข้อมูลหลุดอยู่ใน git history

- **File:** git history — `full_backup.sql` และ `backend/.wrangler/state/v3/d1/.../*.sqlite` (commit เก่า, ถูกลบแล้วแต่ยัง reachable ผ่าน history)
- **Line:** commit `ded4cd63` ลงทะเบียนไว้ในแผน remediation 2026-10-31
- **Issue:** backup ไฟล์ .sql จริงและ local D1 sqlite (มี email, nationalId, form_data ของผู้สมัคร) ถูก commit เข้า history แม้ตอนนี้ไฟล์ถูกลบแล้ว แต่ `git log`/`git show` ยังดึงข้อมูลได้ — ใครที่ clone repo (remote = github.com:Badbunny191/recruitment) ได้ มีข้อมูลส่วนบุคคลผู้สมัครทั้งหมด
- **Recommendation:** rewrite git history (git-filter-repo) เพื่อลบ path เหล่านั้นออกจากทุก commit + rotate ข้อมูลที่สัมผัส + แจ้งผู้เกี่ยวข้องตาม PDPA **ห้ามใช้ `git rm` ธรรมดา** (ไม่ลบ history) — อยู่ใน Remediation Plan 2026-10-31 รอการตัดสินใจของเจ้าของระบบ

# High

## H-1. CSP script-src ต้องใช้ 'unsafe-inline' (ข้อจำกัดของ Next static export)

- **File:** `frontend/public/_headers`
- **Line:** บรรทัด `Content-Security-Policy`
- **Issue:** Next.js `output: 'export'` ฉีด inline `<script>` bootstrap ในทุกหน้า ทำให้ script-src ต้องเปิด 'unsafe-inline' — ลดประสิทธิภาพการกัน XSS ของ CSP ลงอย่างมาก (CSP ยังกัน external script, object, frame จาก origin อื่นได้)
- **Recommendation:** ระยะถัดไป — (a) ย้าย inline script เป็นไฟล์ภายนอกเท่าที่ Next ทำได้ หรือ (b) สร้าง nonce/hash ต่อ build ด้วย build step เขียนทับ `_headers` หลัง `next build` (อ่าน hash จาก `out/index.html` แล้ว generate) จนได้ script-src ที่ไม่ต้อง 'unsafe-inline'

## H-2. JWT ไม่ผูกกับสถานะบัญชีแบบ fail-closed

- **File:** `backend/src/middlewares/account-state.middleware.ts`
- **Line:** ทั้งไฟล์ (gate หลัง authMiddleware)
- **Issue:** เมื่อ query สถานะบัญชี (isActive / mustChangePassword) จาก D1 ล้มเหลว middleware ทำ **fail-open** (`[ACCOUNT_STATE_GATE_DB_ERROR]` → ปล่อยผ่าน) — ช่วง D1 error token ที่ถูก disable ไปแล้วยังใช้งานได้ชั่วคราว (ยืนยันแล้วใน Evidence Verification 2026-10-28 ว่าเป็น design tradeoff ที่มีเหตุผลด้าน availability, โจมตีจาก API ภายนอกไม่ได้)
- **Recommendation:** เพิ่ม retry/fallback สั้น ๆ หรือ cache สถานะล่าสุด (TTL สั้น) ก่อน fail-open และเพิ่ม metric/alert บน `[ACCOUNT_STATE_GATE_DB_ERROR]`

# Medium

## M-1. CORS `origin: '*'` ทั้ง API

- **File:** `backend/src/index.ts`
- **Line:** 80
- **Issue:** ยอมทุก origin อ่าน response ของ API (credentials ไม่เปิด + JWT อยู่บน header จึงโจมตีได้ยาก แต่ response ที่ public เปิดให้อ่าน cross-origin ครบ)
- **Recommendation:** ตั้ง allowlist `https://sao-recruitment-frontend.pages.dev` (+ domain จริงอื่นถ้ามี) และตั้ง `maxAge` เพื่อลด preflight ทุก request (P3 เดิมจาก go-live audit)

## M-2. GET /admin/applications/:id และ /:id/pdf เปิดให้ VIEWER (รวม nationalId + PDF ที่มี nationalId ฝังใน template)

- **File:** `backend/src/routes/admin.routes.ts`
- **Line:** 2427 (`/:id`), 2491 (`/:id/pdf`)
- **Issue:** role middleware ระดับ route ไม่มี — ผ่าน global authMiddleware (VIEWER อ่านได้) รวมถึง field PII ที่ frontend หน้ารายชื่อตัดออกแต่ endpoint detail ยังส่งครบ (ยืนยันแล้ว 2026-10-28: เป็น P1/P2 เงื่อนไข — VIEWER เป็นบุคลากรภายใน ต้องตัดสินใจเชิงนโยบาย)
- **Recommendation:** ถ้า VIEWER ไม่ควรเห็น PII เต็ม → แยก projection ตาม role หรือใส่ `adminOnlyMiddleware` ที่ endpoint ที่เปิด nationalId/PDF และประกาศ policy ให้ชัด

## M-3. ไม่มี rate limit ระดับ endpoint บน mutation ของ admin ฝั่งเขียน (เช่น bulk-status, export)

- **File:** `backend/src/routes/admin.routes.ts`
- **Line:** 2641 (bulk-status), 2321/2326 (export)
- **Issue:** rate limit มีเฉพาะ login (`rateLimitMiddleware({ keyPrefix: 'admin-login' })`) และ public submit — admin mutation ไม่มี throttle เมื่อ token หลุด/ถูกขโมยสามารถยิงรัวได้
- **Recommendation:** ใส่ rateLimitMiddleware กลุ่ม admin write (จำกัดพอประมาณไม่ฉุดงานจริง)

## M-4. ลายเซ็นไฟล์แนบ: signed URL TTL 60 นาที ไม่มี one-time enforcement ฝั่ง view

- **File:** `backend/src/lib/attachment-signing.ts`, `backend/src/routes/public.routes.ts` (GET files)
- **Line:** (mint TTL — attachment-urls endpoint admin.routes.ts:2393)
- **Issue:** URL ที่ mint แล้วใช้ซ้ำได้จนหมดอายุ 60 นาที (ดีต่อ UX แต่ถ้า URL หลุดออกไป — log/copy/paste — ใครก็เปิดไฟล์ได้ในหน้าต่างเวลานั้น)
- **Recommendation:** ยอมรับได้สำหรับระบบภายใน หากต้องการเข้มขึ้น → ลด TTL + เพิ่ม jti allowlist หรือ binding กับ session

## M-5. err.message ที่ส่งกลับ client แก้แล้ว 3 จุด แต่ยังมีจุดเสี่ยงค้างอีก 1 จุดเชิง contract

- **File:** `backend/src/routes/template-descriptor.routes.ts`
- **Line:** 386, 508
- **Issue:** `c.json({ error: err.message, code: err.code })` — `err` เป็น `ApplicationContextError` ที่ข้อความเป็น friendly Thai ที่ระบบกำหนดเอง (ไม่ใช่ raw DB error) จึงยังไม่ใช่ leak จริง แต่ contract พึ่ง "ข้อความของ exception ต้องปลอดรายละเอียดภายใน" ตลอดอายุ class นี้ ถ้าใคร throw ด้วยข้อความดิบจะรั่วทันที
- **Recommendation:** กันอนาคต — ให้ ApplicationContextError รับ `safeMessage` แยกจาก `internalMessage` หรือ map code → ข้อความไทยที่ route ฝั่งส่งออก

# Low

## L-1. `application-number.service.ts` คืน `error: err.message` ใน result object (internal only)

- **File:** `backend/src/services/application-number.service.ts`
- **Line:** 176
- **Issue:** field `error` ของ build result ไม่เคยถูกอ่านโดย caller (public.routes.ts:400-406 อ่านแค่ ok/reason) จึงไม่ถึง client — แต่เป็นรายละเอียดภายในที่ควรลบเพื่อไม่ให้ caller ใหม่หยิบไปใช้
- **Recommendation:** ลบ field `error` ออกจาก return (ข้อมูลเดียวกันอยู่ใน throw/console.error)

## L-2. console.log ใน pdf.service ฝังข้อความ error ที่อาจมีชื่อ field/รอบ

- **File:** `backend/src/lib/pdf.service.ts`
- **Line:** 283
- **Issue:** log เฉพาะ server (ไม่ไป client) — ยังไม่ใช่ leak แต่ log ควรมี applicationId เท่านั้น ไม่ต้องพ่วง err ทั้งก้อนเมื่อเป็น formData ของผู้สมัคร
- **Recommendation:** log เฉพาะ `err.message` + applicationId

## L-3. Raw SQL ในโค้ดปลอดภัยทุกจุดที่สแกน (บันทึกไว้เป็นหลักฐาน)

- **File:** `backend/src/routes/admin.routes.ts`, `backend/src/lib/applications-list-query.ts`, `backend/src/lib/applications-selector.ts`
- **Line:** 87 จุด `sql\`` ทั้ง repo
- **Issue:** ไม่พบ interpolation ของข้อมูล user เข้า SQL — ทุก `${...}` เป็น column reference ของ drizzle หรือ constant (เช่น LOGIN_MAX_FAILED_ATTEMPTS) → ไม่มี injection path
- **Recommendation:** คง convention: ห้าม interpolate string จาก request ลง `sql\`` โดยตรง (ใช้ placeholder `?`/bind)

## L-4. Hardcoded secrets: ไม่พบใน source ทั้ง backend/frontend

- **File:** (ผล sweep grep รูปแบบ secret/password/api_key ทั้ง src)
- **Line:** —
- **Issue:** ไม่พบค่าจริงในโค้ด; `frontend/.env.local.example` เป็น template ไม่มีค่าจริง; secret ทั้งหมดมาจาก env (JWT_SECRET, TURNSTILE_SECRET_KEY, R2 credentials)
- **Recommendation:** เพิ่ม CI grep guard (gitleaks/trufflehog) เพื่อกัน regression

## L-5. Upload validation แข็งแรงแล้ว (บันทึกผลตรวจ)

- **File:** `backend/src/routes/upload.routes.ts`
- **Line:** 40-58
- **Issue:** MIME บังคับ `application/pdf`, size cap 10MB, filename ผ่าน `sanitizeDisplayFilename` แล้ว และ ledger 029 ครอบ lifecycle — ไม่พบช่องโหว่
- **Recommendation:** ต่อยอดได้: ตรวจ magic bytes (`%PDF-`) นอกจาก content-type เพื่อกันไฟล์ปลอม

## L-6. ไม่มี Content-Security-Policy ฝั่ง API (ตั้งใจ — บันทึกเหตุผล)

- **File:** `backend/src/index.ts`
- **Line:** secureHeaders block (TASK 2)
- **Issue:** CSP เป็น policy ระดับเอกสาร HTML; API ตอบ JSON/PDF จึงไม่ตั้ง ส่วนเว็บจริงคุมที่ `frontend/public/_headers`
- **Recommendation:** คงเดิม หากเพิ่มหน้า HTML ที่ backend serve ในอนาคต ต้องตั้ง CSP ทันที

## L-7. Admin session อยู่บน localStorage (JWT)

- **File:** `frontend/src/app/(admin)/admin/*` (ใช้ `localStorage.getItem('adminToken')`)
- **Line:** หลายจุด
- **Issue:** XSS ที่เบราว์ได้จะอ่าน token ได้ (อยู่นอกขอบเขต DO NOT TOUCH: JWT storage redesign ห้ามแตะในเฟสนี้)
- **Recommendation:** ระยะยาว — ย้ายไป httpOnly cookie พร้อม CSRF strategy; ระยะสั้น — รักษา CSP (TASK 2) + ปิด dependency ผ่าน audit

---

## สิ่งที่ sweep ยืนยันว่าแข็งแรงแล้ว (ไม่ต้องแก้)

| เรื่อง | หลักฐาน |
|---|---|
| Global error handler ไม่ส่ง stack/SQL ออก client | `backend/src/index.ts` onError → ข้อความกลาง + log เต็มเฉพาะ server |
| Login lockout + rate limit | `admin.routes.ts:90`, test `admin-login-lockout.test.ts` |
| RBAC SUPER_ADMIN บน audit-logs | fix `aa697348` + test `audit-logs-rbac.test.ts` |
| Excel formula injection guard | `excel-formula-injection.test.ts` |
| Turnstile fail-closed เมื่อ enable แต่ secret หาย | test ใหม่ TASK 5 (TS5) |
| Idempotency replay guard + cache เฉพาะ 2xx | `d398f751` + test 16 เคส |
| Bulk payload cap ทุกช่องทาง (ids/excludeIds) | TASK 4 + test BS25/BC1-BC8 |
| Signed attachment (Hybrid) + ledger lifecycle | migration 029 + test attachment-lifecycle |
| Archive round ปิดรับ submit | fix `864e4d43` + test |

## ลำดับที่แนะนำให้แก้ต่อ

1. **C-1** rewrite history (ปลดล็อกด้วยการตัดสินใจของเจ้าของระบบ — ดู Remediation Plan 2026-10-31)
2. **M-1** CORS allowlist + maxAge (งานเล็ก ปิด P3 เดิมไปในตัว)
3. **M-3** rate limit admin write
4. **H-1** CSP nonce ต่อ build
5. **M-2** นโยบาย VIEWER/PII ให้ชัดที่ตัว endpoint
