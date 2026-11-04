# TODO — จุดที่ต้องเชื่อม/ตรวจกับ SAO Recruitment จริง

รายการนี้คือ **จุดที่ harness ต้องพึ่งโครงสร้างของระบบจริง** เวลาระบบเปลี่ยน (หรือตอนตรวจก่อนรันครั้งแรก)
แต่ละข้อระบุ: ไฟล์ที่ต้องแก้ + สิ่งที่ต้องตรวจใน production

## P0 — ตรวจก่อนรันครั้งแรกเสมอ

- [ ] **1. `field_master` ใน production ต้องมีฟิลด์ชุดมาตรฐาน**
      setup-round.mjs ต้องการ: `field-fullname`, `field-national-id`, `field-email`, `field-phone`,
      `field-gender`, `field-address`, `field-education`, `field-experience`, `field-resume`, `field-portfolio`
      - ตรวจ: สคริปต์จะ abort พร้อมรายชื่อฟิลด์ที่ขาดเอง / หรือ `GET /api/v1/admin/fields`
      - ถ้าขาด: รัน seed field_master ตาม `backend/seed.sql` ก่อน (ห้ามแต่ง id เอง — submit ฝั่ง backend อ่าน `field-email`/`field-fullname` แบบ hardcode)
- [ ] **2. บัญชี admin ต้องใช้งานได้เต็ม** (ACTIVE, ไม่ mustChangePassword, ไม่ถูกล็อก)
      - ไฟล์: `load-test/.env` (`LOAD_TEST_ADMIN_EMAIL/PASSWORD`)
- [ ] **3. ยืนยัน Turnstile บนหน้า review ผ่านได้จริงด้วยเบราว์เซอร์จริง 1 ครั้ง (smoke)**
      - ถ้า Turnstile ตั้งโหมด interactive challenge → harness จะหยุดทั้งรันตามข้อกำหนด
        (ไม่มีการ bypass ใน harness) — ถ้าต้องการรัน load test ต่อ ต้องพิจารณาช่วงเวลา/โดเมน
        ที่ Turnstile เป็น non-interactive หรือทดสอบในสภาพแวดล้อมที่มี Turnstile test keys (local)

## P1 — จุดผูกกับโครงสร้างจริง (แก้เมื่อระบบเปลี่ยน)

- [ ] **4. URL ปลายทาง** — `config.mjs` / `.env`
      - frontend: `https://sao-recruitment-frontend.pages.dev`, backend: `...workers.dev/api/v1`
      - ถ้าเปลี่ยนโดเมน/โปรเจกต์ Pages-Workers ให้แก้ `LOAD_TEST_FRONTEND_URL` / `LOAD_TEST_API_URL`
- [ ] **5. selector ของหน้า apply/review** — `lib/user-flow.mjs`
      - ใช้อยู่: input `#<fieldId>` (จาก `id={field.fieldId}` ใน `frontend/src/app/(public)/apply/page.tsx`),
        ปุ่ม "ตรวจสอบข้อมูล", ปุ่ม "ยืนยันส่งใบสมัคร", checkbox `#confirm`, `label[for=<fieldId>]` ครอบ FileUpload
      - ถ้าแก้หน้า apply → ตรวจ selector เหล่านี้ด้วย smoke spec (`npx playwright test`) ทันที
- [ ] **6. ข้อความปุ่ม/label ภาษาไทย** — ถ้า UX เปลี่ยนข้อความปุ่ม ให้แก้ `getByRole('button', { name: ... })` ใน
      `lib/user-flow.mjs` + `tests/apply-flow.spec.mjs`
- [ ] **7. schema ของรอบ (dynamic form)** — `run-load-test.mjs` อ่าน `GET /public/rounds/:id/schema` สด ๆ ทุกครั้ง
      - ฟิลด์ชนิดใหม่ (นอกจาก TEXT/TEXTAREA/DROPDOWN/RADIO/CHECKBOX/NUMBER/DATE/FILE/MASTER_DATA)
        ต้องเพิ่ม case ใน `fillFormFields`
- [ ] **8. file upload เฉพาะ PDF** — `backend/src/schemas/validators.ts` (`contentType: z.literal('application/pdf')`)
      และ `upload.routes.ts` (ตรวจ `file.type !== 'application/pdf'`)
      - ปัจจุบัน: ระบบจริงรับเฉพาะ PDF → flow ใช้ `TEST-resume.pdf`
      - ไฟล์ `TEST-idcard.png` / `TEST-photo.jpg` สร้างไว้สำหรับ "ทดสอบ validation ปฏิเสธไฟล์" —
        **ถ้าอนาคตระบบรับภาพ ให้เพิ่มขั้นอัปโหลดภาพใน `lib/user-flow.mjs`** (ตอนนี้ถูกปฏิเสธทั้ง client accept และ server)
- [ ] **9. โครงสร้างตาราง D1** — `cleanup-test-data.mjs` + `seed.mjs`
      - ชื่อตาราง/คอลัมน์ที่ใช้: `applications(id, application_no, round_id, email, fullname, national_id, status, form_data, submitted_at, year, round_code, seq_in_round)`,
        `application_attachments`, `attachment_uploads(r2_key, status, application_id)`, `audit_logs(entity_type, entity_id)`,
        `recruitment_rounds`, `round_sequences`, `template_versions`, `template_sections`, `template_fields`, `templates`
      - migration ใหม่ที่แตะตารางเหล่านี้ → ทบทวน SQL ของ seed/cleanup ทั้งสองไฟล์
- [ ] **10. R2 และ PDF cache key** — `config.mjs` (`R2.bucket = 'sao-storage'`, prefix `pdf/applications`, versions `v1/v2/v3`)
      - ถ้า `PDF_CACHE_VERSION` ใน `backend/src/lib/pdf-types.ts` เพิ่มเวอร์ชันใหม่ → เพิ่มใน `R2.pdfCacheVersions`
- [ ] **11. ชื่อ D1 / binding** — `lib/wrangler.mjs` (`sao-db`, bucket `sao-storage`) ตาม `backend/wrangler.toml`
- [ ] **12. Application number pattern** — `{RUNNING:6}` อยู่เพดาน 999,999/รอบ; ถ้าทดสอบ > 999,999 ใบต้องเปลี่ยน pattern

## P2 — ข้อจำกัดที่ยอมรับไว้ (documented limitation)

- [ ] **13. ทดสอบจาก IP เดียว** — rate limit 5 req/min/IP ทำให้ 429 สูงตามธรรมชาติ; harness ถอยหลังตาม
      Retry-After (ไม่ bypass) ตัวเลข throughput ที่รายงานจึงเป็น "ผ่านระบบป้องกันแล้ว" ไม่ใช่ความจุสูงสุดของ backend
- [ ] **14. Orphan R2 objects ที่ไม่มี ledger row** (กรณี ledger insert ล้มแต่ R2 put สำเร็จ — fail-open ของระบบ)
      หาไม่เจอจาก DB ได้ → cleanup ครอบคลุมเฉพาะ object ที่มีบันทึก; ที่เหลือจะถูก GC ตาม lifecycle เดิม (7 วัน)
      ตรวจภาพรวมเฉพาะจุดได้ด้วย `wrangler r2 object get` ต่อ key ที่ทราบ
- [ ] **15. Audit logs รูปแบบใหม่** — cleanup ลบตาม `entity_id IN (test ids)`; ถ้าอนาคตเพิ่ม action ที่ผูก
      ข้อมูลทดสอบผ่าน payload อย่างเดียว ต้องเพิ่มเงื่อนไขใน `discover()` ของ `cleanup-test-data.mjs`
- [ ] **16. Seeder เขียน D1 ตรง** (ไม่ผ่าน API) — ต้องตาม schema จริงเสมอ; ถ้าเพิ่ม NOT NULL คอลัมน์ใหม่ใน
      `applications` ต้องเติมใน `seed.mjs` ด้วย (มิฉะนั้น INSERT จะ fail — ซึ่งปลอดภัย: fail ชัดเจน ไม่เขียนครึ่ง ๆ)
- [ ] **17. รอบ [TEST] สร้างด้วย `roundCode=TEST` + pattern `{ROUND_CODE}-{RUNNING:6}`** —
      validator ของระบบ (`backend/src/utils/application-pattern.ts`) อนุญาตเฉพาะ token
      (`{YEAR}`, `{ROUND_CODE}`, `{RUNNING:3..6}`) + ตัวคั่น `- / . _` — **ห้ามตัวอักษรลอย** อย่าง `TEST-{RUNNING:6}` (จะ INVALID_PATTERN)
      ถ้า `TEST` ถูกใช้แล้วในปีนั้น (unique ต่อปี, 409) setup จะไล่ลอง `roundCodeFallbacks`
      และ cleanup อนุพันธ์ prefix จาก `round_code` จริงใน DB จึงลบได้ครบทุกโค้ด
- [ ] **18. Local D1 ล้าสมัย** — โหมด `--local` ต้อง `cd backend && npm run db:migrate` ก่อน (เคยพบ local db เป็น schema เก่า)

## เช็กลิสต์ก่อนประกาศ "ทดสอบเสร็จ"

- [ ] `results/results-*.json` + `load-test-report.md` ครบ
- [ ] `admin-checks-*.json` อยู่ในรายงานแล้ว
- [ ] `node cleanup-test-data.mjs --remote --dry-run` → "ไม่มีข้อมูลทดสอบค้างอยู่เลย"
- [ ] ตรวจหน้า `/admin/applications` ด้วยตา: ไม่มี `TEST-` เหลือ
- [ ] รอบ `[TEST]` หายจากหน้าแรก
