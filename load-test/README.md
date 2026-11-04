# SAO Recruitment — Load Test Harness

ชุดทดสอบจำลองผู้สมัคร **250 คน** ผ่านหน้าเว็บจริงของ SAO Recruitment ด้วย **Playwright** (Chromium จริง)
รวมถึง Seeder / Cleanup / Report ที่ใช้ทรัพยากร Cloudflare **เดิมทั้งหมด** (ห้ามสร้าง Worker / D1 / R2 ใหม่)

```
load-test/
├── setup-round.mjs            สร้างรอบ [TEST] Load Test 250 Users ผ่าน Admin API
├── run-load-test.mjs          ⭐ Playwright จำลองผู้สมัคร (batch 5 คน, think-time สุ่ม 5-30 วิ)
├── seed.mjs                   Seeder 50/100/250/500 คน ลง D1 เดิม (ทดสอบ Dashboard/Search/Export/PDF)
├── admin-check.mjs            ทดสอบฝั่ง admin: Search / Excel Export / PDF Composer / Dashboard
├── cleanup-test-data.mjs      ⭐ Hard Delete ข้อมูลทดสอบทั้งหมด + ตรวจซาก = 0
├── report.mjs                 สร้าง load-test-report.md
├── test-assets/               ไฟล์ทดสอบ PDF/JPG/PNG (ขึ้นต้น TEST- เสมอ)
├── lib/                       โมดูลร่วม (flow, applicants, admin-api, wrangler)
├── tests/apply-flow.spec.mjs  Smoke test 1 ผู้ใช้ (npx playwright test)
└── results/                   ผลลัพธ์ + screenshots (git ignored)
```

## วิธีรัน (ลำดับเต็ม)

```bash
# 0) เตรียมเครื่อง (ครั้งเดียว)
cd load-test
npm install
npx playwright install chromium
cp .env.example .env            # แล้วใส่ LOAD_TEST_ADMIN_EMAIL / LOAD_TEST_ADMIN_PASSWORD
node test-assets/generate-assets.mjs   # สร้าง TEST-*.pdf/jpg/png

# 1) สร้างรอบทดสอบ (idempotent — รันซ้ำได้)
node setup-round.mjs            # หรือ npm run setup

# 2) ทดสอบเบา ๆ ก่อนเสมอ (5 คน)
node run-load-test.mjs --users 5

# 2b) โหมด HEADED — ผู้ใช้คลิก Turnstile เองในเบราว์เซอร์จริง (ไม่ bypass)
node run-load-test.mjs --users 1 --headed
#   หรือจาก root: npm run loadtest:headed -- --users 1
#   ปรับเวลารอผู้ใช้คลิก: --manual-timeout 900 (วินาที, default 15 นาที)

# 2c) Stress test (think-time = 0) — ทุกรันมีตัวตนใหม่ ไม่ชนข้อมูลรันก่อนหน้า
npm run load-test:stress-50     # 50 users
npm run load-test:stress-100    # 100 users
npm run load-test:stress-250    # 250 users
#   identity ของแต่ละรัน: TEST-<yyyymmddHHMMSS>-<seq>@test.local (+บัตร/เบอร์ฝัง stamp เดียวกัน)
#   ⚠ think=0 จะเจอ 429 เยอะตามธรรมชาติ (rate limit 5 req/min/IP ครอบ submit+upload) —
#     harness ถอยหลังตาม Retry-After และนับเหตุการณ์ในรายงาน ไม่ bypass

# 3) รันเต็ม 250 คน (batch 5, ใช้เวลาประมาณ 25-45 นาที)
node run-load-test.mjs

# 4) ทดสอบฝั่ง admin (Search/Export/PDF/Dashboard) — วัดเวลาตอบ
node admin-check.mjs

# 5) (ถ้าต้องการ) เติมข้อมูลเพิ่มสำหรับ Dashboard/Search/Export/PDF
node seed.mjs 250               # 50 | 100 | 250 | 500

# 6) สร้างรายงาน
node report.mjs                 # → load-test/load-test-report.md

# 7) ล้างข้อมูลทดสอบทั้งหมด (Hard Delete)
node cleanup-test-data.mjs --remote          # แสดงรายการก่อน + พิมพ์ DELETE เพื่อยืนยัน
# หรือจาก root: npm run cleanup:test-data -- --remote
```

จาก root ของ repo สั่งผ่าน npm ได้ทุกขั้น:

```bash
npm run loadtest:setup
npm run loadtest:run -- --users 5      # smoke
npm run loadtest:run                   # เต็ม 250
npm run loadtest:check
npm run loadtest:seed -- 250
npm run loadtest:report
npm run cleanup:test-data -- --remote --yes
```

## หลักการสำคัญ (ฝังอยู่ในโค้ด)

| ข้อกำหนด | การบังคับใน harness |
|---|---|
| Batch ละ 5 คน ห้ามยิงพร้อมกัน 250 | `run-load-test.mjs` แบ่งเป็น batch (`--batch`, default 5) + เว้นช่วงสุ่ม 2-8 วิ ระหว่าง batch |
| สุ่มเวลา 5-30 วินาที | think-time รวมของแต่ละ user สุ่ม 5-30 วิ แล้วกระจายเป็นพักระหว่างการกรอก |
| ไม่ bypass Turnstile / Bot Protection | ใช้เบราว์เซอร์จริงรอ widget จริง; challenge ค้าง → **หยุดทั้งรัน + บันทึกปัญหา + รายงาน** (`abort.reason = TURNSTILE_*`) |
| โหมด HEADED (Manual Turnstile Assist) | `--headed`: เปิดเบราว์เซอร์จริงบนหน้าจอ → เมื่อเจอ Cloudflare challenge สคริปต์ **รอผู้ใช้คลิกเอง** (ไม่คลิกแทน ไม่แก้ token) แล้วกดส่งต่ออัตโนมัติเมื่อปุ่มเปิดใช้งาน; บันทึกเวลารอ Turnstile/เวลาผู้ใช้ยืนยัน/เลขที่ที่ได้ |
| เจอ Rate limit (429) | ถอยหลังตาม `Retry-After` แล้วกดใหม่ (เหมือนผู้ใช้จริง) — นับเหตุการณ์ทุกครั้งไว้ในรายงาน |
| ข้อมูลทดสอบแยกจากของจริง | รอบ `[TEST] Load Test 250 Users` (roundCode `TEST`), เลขที่ `TEST-000001...` (pattern `{ROUND_CODE}-{RUNNING:6}` — validator ของระบบอนุญาตเฉพาะ token + ตัวคั่น), อีเมล `TEST-xxxxxx@test.local`, ไฟล์แนบชื่อ `TEST-*` |
| ลบได้ 100% | `cleanup-test-data.mjs` — Hard Delete เท่านั้น, allowlist เฉพาะ TEST, แสดงรายการก่อนลบ, ตรวจซากซ้ำต้องได้ 0 |

## Logging & Report

- **ระหว่างรัน**: สรุปต่อ batch ในคอนโซล + `results/live-<ts>.jsonl` (เขียนทีละคน — พังกลางทางก็มีข้อมูล)
- **ไฟล์ผล**: `results/results-<ts>.json` (ครบทุก user: status, timings ทุกขั้น, errors, URL, screenshots)
- **Screenshot ตอน error**: `results/screenshots/user-TEST-xxxxxx-<step>-<ts>.png`
- **รายงาน**: `load-test-report.md` — Success/Fail Count, Average/Slowest/Fastest Response, Error Summary, Upload Summary, PDF Summary, Performance Summary, ข้อจำกัดการทดสอบ

## จุดที่ผูกกับระบบจริง (แก้ตรงนี้เมื่อโครงสร้างเปลี่ยน)

ดูรายละเอียดใน [TODO.md](./TODO.md) — สรุปสั้น:

1. `config.mjs` — URL ปลายทาง + ชื่อรอบ/โค้ด/pattern
2. `lib/user-flow.mjs` — selector ของหน้า apply/review (`#field-fullname`, ปุ่ม "ตรวจสอบข้อมูล", "ยืนยันส่งใบสมัคร", `#confirm`)
3. `setup-round.mjs` — ชุด field_master ที่ใช้สร้าง template ทดสอบ
4. `lib/wrangler.mjs` + `cleanup-test-data.mjs` — ชื่อ D1 (`sao-db`) / R2 bucket (`sao-storage`) / ตาราง-คอลัมน์ตาม schema จริง
5. `lib/admin-api.mjs` — endpoint admin ที่ใช้ (login / rounds / templates / applications)

## ข้อควรระวัง

- **รัน load test เต็ม = เขียนข้อมูลจริงลง D1/R2 ของ production** (ตามข้อกำหนด "ใช้ environment ปัจจุบัน") — ต้อง cleanup ให้ครบหลังเสร็จ
- รัน smoke (`--users 5`) ก่อนเสมอ
- ห้ามรัน 2 ชุดพร้อมกันจาก IP เดียว (rate limit ตีกันเอง)
- บัญชี admin ต้องไม่อยู่สถานะ `mustChangePassword` (login ผ่านหน้าเว็บ + เปลี่ยนรหัสก่อน แล้วใส่รหัสใหม่ใน `.env`)
