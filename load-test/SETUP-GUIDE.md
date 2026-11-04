# SETUP GUIDE — การเตรียมระบบก่อนรัน Load Test

## 1. สิ่งที่ต้องมี

| รายการ | ที่มา | ตรวจว่าพร้อมยังไง |
|---|---|---|
| Node.js 18+ | ในเครื่อง | `node --version` |
| wrangler (มากับ backend) | `backend/node_modules` (3.x) | รันจาก script อัตโนมัติ (cwd=backend) |
| Cloudflare login ของ project | `cd backend && npx wrangler whoami` | ต้องเห็น account ของ sao-recruitment |
| บัญชี admin ของระบบ | สร้างไว้แล้วในระบบ (ไม่มี default credential ใน git) | ล็อกอินหน้า `/admin` ได้ |
| Playwright | ติดตั้งในขั้นถัดไป | `npx playwright --version` |

## 2. ติดตั้ง

```bash
cd load-test
npm install                      # playwright
npx playwright install chromium  # browser
cp .env.example .env
```

แก้ `.env`:

```ini
# ค่า default ชี้ production แล้ว — แก้เฉพาะเมื่อจะยิงที่อื่น
LOAD_TEST_FRONTEND_URL=https://sao-recruitment-frontend.pages.dev
LOAD_TEST_API_URL=https://sao-recruitment-backend.hrmsao.workers.dev/api/v1

# ⭐ บังคับใส่ — ใช้กับ setup-round / seed / admin-check / cleanup
LOAD_TEST_ADMIN_EMAIL=admin@yourdomain.example
LOAD_TEST_ADMIN_PASSWORD=********
```

> ความปลอดภัย: `.env` ถูก git ignore แล้ว ห้าม commit รหัสผ่านทุกกรณี

## 3. เตรียมบัญชี admin

ระบบบังคับ `mustChangePassword` กับบัญชีใหม่ — ถ้ายังไม่เปลี่ยนรหัส:

1. ล็อกอินที่ `https://sao-recruitment-frontend.pages.dev/admin`
2. เปลี่ยนรหัสผ่านให้เรียบร้อย (หน้า profile / change-password)
3. ใส่รหัส "ใหม่" ลง `.env` — ไม่งั้น script จะตอบ 403 MUST_CHANGE_PASSWORD

สิทธิ์ที่ต้องการ:
- `ADMIN` — สร้าง template/round, ดู applications, export, PDF
- `SUPER_ADMIN` — เพิ่มเฉพาะหน้า Audit Logs ใน admin-check (ขาดได้ ไม่บล็อก)

## 4. สร้างไฟล์ทดสอบ + รอบทดสอบ

```bash
node test-assets/generate-assets.mjs   # TEST-resume.pdf, TEST-portfolio.pdf, TEST-idcard.png, TEST-photo.jpg
node setup-round.mjs --dry-run         # ดูว่าจะทำอะไรบ้าง
node setup-round.mjs                   # สร้างจริง (Admin API) → results/state.json
```

เงื่อนไขที่ setup ตรวจให้:
- `field_master` ต้องมีฟิลด์มาตรฐานครบ (`field-fullname`, `field-email`, `field-phone`, ... ) — ถ้าไม่ครบ script จะหยุดพร้อมบอกฟิลด์ที่ขาด
- รอบ `[TEST] Load Test 250 Users` ต้องปรากฏในหน้าแรก (script ตรวจ `/public/rounds/active` ให้)

## 5. รันครั้งแรก (แนะนำเป็นลำดับ)

```bash
# 5.1 smoke 1 ผู้ใช้แบบ HEADED — เปิดเบราว์เซอร์จริง ผู้ใช้คลิก Turnstile เอง
node run-load-test.mjs --users 1 --headed
#    (หรือ: npm run loadtest:headed -- --users 1  /  ปรับเวลารอ: --manual-timeout 1800)
#    ขั้นตอน: script เปิดหน้าต่าง → เดิน flow ถึงหน้า Review → เจอ Cloudflare challenge
#    → แจ้งใน console แล้ว "รอผู้ใช้คลิกช่องยืนยันมนุษย์เอง" → ปุ่มเปิดใช้งานเมื่อไร
#    สคริปต์กด "ยืนยันส่งใบสมัคร" ต่อให้อัตโนมัติ พร้อม log เลขที่ใบสมัครที่ได้

# 5.2 smoke 1 ผู้ใช้แบบ headless ผ่าน @playwright/test (เห็น trace/screenshot ตอน fail)
npx playwright test

# 5.3 smoke 5 ผู้ใช้แบบ headless
node run-load-test.mjs --users 5

# 5.4 ยืนยันว่าลบได้จริงตั้งแต่ยังข้อมูลน้อย
node cleanup-test-data.mjs --remote          # ดูรายการ → พิมพ์ DELETE
node cleanup-test-data.mjs --remote --dry-run   # ตรวจซาก = 0

# 5.5 (ถ้าข้อมูลโดนลบไปแล้ว) สร้างรอบใหม่ แล้วรันเต็ม
node setup-round.mjs
node run-load-test.mjs        # 250 คน, batch 5, ใช้เวลา ~25-45 นาที
node admin-check.mjs
node report.mjs
```

## 6. โหมด Local (ไม่ยิง production)

```bash
# เปิด dev: npm run dev (root) — frontend :3000, backend :8787
node setup-round.mjs --local
node run-load-test.mjs --local --users 5
node seed.mjs 50 --local
node cleanup-test-data.mjs --local --yes
```

ข้อควรรู้โหมด local:
- Local D1 (`sao-db --local`) ต้อง apply migrations ก่อน: `cd backend && npm run db:migrate`
- Local ยังมี Turnstile ถ้า config บอก enabled — ใช้ Turnstile **test keys** ของ Cloudflare (site key `1x00000000000000000000AA`) ใน `.dev.vars` ถ้าต้องการเดินผ่านได้แบบไม่ interactive (นี่คือ key ทดสอบทางการของ Cloudflare ไม่ใช่การ bypass)
- Rate limit ยังทำงานใน local (5 req/min/IP) — ถ้าอยากปลดในเครื่อง ตั้ง `RATE_LIMIT_ENABLED=false` ใน `backend/.dev.vars` (เฉพาะ local เท่านั้น ห้ามเอาไปตั้งที่ production)

## 7. เปลี่ยนจำนวนผู้สมัคร

| ต้องการ | คำสั่ง |
|---|---|
| รันจริงผ่านหน้าเว็บ N คน | `node run-load-test.mjs --users N --batch B` |
| Seeder (ลง D1 ตรง) | `node seed.mjs 50` / `100` / `250` / `500` (`--start N` เริ่มเลขต่อจากเดิม, `--with-files` เพิ่มไฟล์แนบ R2 จริง) |
| ปรับ think-time | `LOAD_TEST_THINK_MIN/MAX` ใน `.env` (วินาที) |
| ปรับ gap ระหว่าง batch | `LOAD_TEST_BATCH_GAP_MIN/MAX` |

## 8. ตีความผล

- `results/results-*.json` — ข้อมูลดิบราย user
- `results/screenshots/` — ภาพตอน error ทุกจุด
- `load-test/load-test-report.md` — รายงานรวม (รัน `node report.mjs` ซ้ำได้หลังเพิ่ม admin-checks)

## 9. หลังใช้งานเสร็จ — ล้างให้สะอาด

```bash
node cleanup-test-data.mjs --remote --dry-run   # ดูซากก่อน
node cleanup-test-data.mjs --remote             # แสดงรายการ → พิมพ์ DELETE
node cleanup-test-data.mjs --remote --dry-run   # ✅ ต้องขึ้น "ไม่มีข้อมูลทดสอบค้างอยู่เลย"
```

Cleanup ลบ: ใบสมัคร TEST-* + คำตอบ (form_data ใน applications) + attachments + ไฟล์ R2 + PDF cache + audit logs ที่เกี่ยวข้อง + round + round_sequences + template/version/sections/fields `[TEST]` — Hard Delete เท่านั้น
