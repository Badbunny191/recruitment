# Backup Activation Checklist — เปิดใช้ d1-backup.yml จริง

> **Sprint 3 — Task 1** | วันที่: 2026-10-31 | Branch: `feature/sprint3-backup-activation`
>
> ขั้นตอนนำ `.github/workflows/d1-backup.yml` (Sprint 2) ขึ้นใช้งานจริง คู่กับ
> `docs/D1_BACKUP_AUTOMATION.md` (spec) และ `docs/FIRST_BACKUP_RUNBOOK.md` (run แรก)
> เป้าหมาย: ผู้ดูแลระบบทำตามเช็กลิสต์นี้จบภายใน ~30 นาที โดยไม่ต้องอ่านโค้ด workflow

---

## 0. ผลตรวจ workflow ก่อนเปิดใช้ (ผู้ทำ sprint ตรวจแล้ว 2026-10-31)

| รายการ | ผล | หลักฐาน |
|---|---|---|
| YAML syntax | ✓ ผ่าน (13 steps, triggers = schedule + workflow_dispatch) | parse ด้วย YAML parser วันที่ 2026-10-31 |
| wrangler subcommands ครบทุกตัวที่ใช้ | ✓ 8/8 (`d1 export`, `d1 execute`, `r2 bucket info/create`, `r2 bucket lifecycle add/list`, `r2 object put/get`) | รัน `--help` ทุกตัวบน wrangler 3.114.17 (เวอร์ชัน pin ใน workflow) |
| `r2 object put/get` ชี้ R2 จริง | ✓ default = remote (`--local` เป็น opt-in เท่านั้น) | `wrangler r2 object put --help` บน 3.114.17 |
| **บั๊กที่พบและแก้แล้ว** | `jq '.results[0]'` อ่านผล `d1 execute --json` ผิด shape — root เป็น array จริง → `manifest.facts = null` เงียบ ๆ ทำให้ restore drill ไม่มี baseline ให้เทียบ | **แก้เป็น `jq '.[0].results[0]'`** — พิสูจน์ shape จาก prod D1 จริง (`[{results:[{applications:20,...}], meta:{size_after:765952}}]` วันที่ 2026-10-31) |
| npm install ที่ root ปลอดภัย | ✓ root package.json ไม่มี preinstall/postinstall hooks | `grep package.json` |
| ขนาด DB ปัจจุบัน | ≈ 0.75 MB (765,952 bytes), applications = 20 แถว | meta.size_after จาก d1 execute วันที่ 2026-10-31 |

---

## 1. Required Secrets

ตั้งใน **GitHub → repo `Badbunny191/recruitment` → Settings → Secrets and variables → Actions → New repository secret**:

- [ ] **`CF_ACCOUNT_ID`** — Account ID ของ Cloudflare (dashboard หน้าแรก, ค่าเดียวกับ `05621e…` ที่ใช้อยู่)
- [ ] **`CF_BACKUP_API_TOKEN`** — Custom API token สร้างตามสิทธิ์ §2 ด้านล่าง (ห้ามใช้ Global API Key)
- [ ] **`BACKUP_GPG_RECIPIENT`** — *(แนะนำอย่างยิ่ง)* public key fingerprint หรือ email ของคู่กุญแจ GPG สำหรับเข้ารหัส dump — **ไม่ตั้ง = อัปโหลด plaintext ที่มี PII ผู้สมัครเต็ม** (workflow จะ emit `::warning::` ทุกรอบ)
- [ ] *(ไม่บังคับ, ไว้ล่วงหน้า)* `BACKUP_GPG_KEY` — ไม่ถูกใช้ตอน backup (ใช้แค่ public key) สงวนไว้ให้ restore drill อัตโนมัติในอนาคต

วิธียืนยันว่าตั้งครบ: หน้า Secrets ต้องแสดงชื่อ secret อย่างน้อย 2 ตัว (`CF_ACCOUNT_ID`, `CF_BACKUP_API_TOKEN`) — GitHub ไม่อนุญาตให้อ่านค่าย้อนกลับ ตรวจได้แค่ "มีชื่ออยู่"

## 2. Required Permissions

**Token `CF_BACKUP_API_TOKEN`** (Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom):

| Permission | Scope | เหตุผล |
|---|---|---|
| Account \| D1 \| **Edit** | Include → เฉพาะ account นี้ | `d1 export` (อ่าน dump) + `d1 execute --json` (นับแถว manifest) |
| Account \| Workers R2 Storage \| **Object Read & Write** | Include → เฉพาะ account นี้ (หรือระบุ bucket `sao-recruitment-backups` เท่านั้นถ้ามีตัวเลือก) | put/get object, สร้าง bucket ครั้งแรก, set lifecycle rule |
| Zone Resources | ไม่เลือก | workflow ไม่แตะ domain ใด ๆ |

**GitHub-side permissions** — ตั้งไว้ในไฟล์ workflow แล้ว (`permissions: contents: read`) ไม่ต้องทำอะไร; ถ้า org เปิดข้อจำกัด Actions: ต้องอนุญาต workflow ที่มี `schedule` สำหรับ repo นี้

**ข้อจำกัดที่ยอมรับ:** token นี้อ่านข้อมูลผู้สมัครทั้งหมดได้ผ่าน D1 (จำเป็นต่อ dump) → ตั้งชื่อ token ชัดว่า backup, หมุนเวียนทุก 6-12 เดือน, และตั้ง `BACKUP_GPG_RECIPIENT` เสมอ

## 3. Verification Steps (เรียงตามลำดับทำจริง)

**ขั้นก่อนเปิด (ครั้งเดียว):**
- [ ] 3.1 สร้าง token + ตั้ง secrets ครบตาม §1-§2
- [ ] 3.2 สร้างคู่กุญแจ GPG และตั้ง `BACKUP_GPG_RECIPIENT` (public) — เก็บ private key ไว้ ≥2 เครื่องแอดมิน (ใช้ตอน restore)
- [ ] 3.3 ยืนยัน branch `main` มีไฟล์ `.github/workflows/d1-backup.yml` อยู่จริง (Actions tab เห็น workflow "D1 Backup")

**ขั้นเปิดใช้ (run แรก):**
- [ ] 3.4 กด **Actions → D1 Backup → Run workflow** (workflow_dispatch) — อย่ารอ cron คืนแรก
- [ ] 3.5 รอ run เสร็จ (สีเขียว, ≤ 20 นาที) — ดู `docs/FIRST_BACKUP_RUNBOOK.md` สำหรับเกณฑ์ "สำเร็จจริง" ทุกข้อ
- [ ] 3.6 เช็ค job summary ของ run: ต้องแสดง `r2 key`, `size`, `sha256` (ถ้าแถวว่าง = fail ก่อน export — ดู §4)
- [ ] 3.7 ยืนยัน object บน R2 จริง: `npx wrangler r2 object get sao-recruitment-backups/d1/daily/<YYYY>/<MM>/<DD>/manifest-<TS>.json --file /tmp/m.json && cat /tmp/m.json`
- [ ] 3.8 ยืนยัน lifecycle rule: `npx wrangler r2 bucket lifecycle list sao-recruitment-backups` ต้องมี `d1-backup-expire-90d`
- [ ] 3.9 ยืนยัน warning ไม่โผล่ใน log (GPG ทำงาน) — ถ้าข้ามขั้น 3.2 จะเห็น `::warning::GPG encryption is NOT configured`

**ขั้นหลังเปิด:**
- [ ] 3.10 รอ cron คืนถัดไป (02:00 Asia/Bangkok) แล้วยืนยันว่า run อัตโนมัติสีเขียว — จบขั้นนี้ถือว่า "backup ทำงานจริง"
- [ ] 3.11 เปิด notification: GitHub → Watch → Custom → ✓ Actions (หรืออย่างน้อย "failures only") เพื่อรับแจ้งเมื่อ backup fail

## 4. Failure Recovery (step ไหนพังแก้ยังไง)

| อาการ (step ที่ fail) | สาเหตุที่พบบ่อย | วิธีแก้ |
|---|---|---|
| Export D1 — 401/10000 auth error | token ผิด/หมดอายุ/สิทธิ์ D1 ไม่ครบ | สร้าง token ใหม่ตาม §2 แล้วอัปเดต secret `CF_BACKUP_API_TOKEN` → กด Re-run |
| Export D1 — `Couldn't find DB sao-db` | ชื่อ DB/สิทธิ์ account ไม่ตรง | ยืนยันชื่อ `npx wrangler d1 list` ด้วย token เดียวกัน; เช็ค Account Resources ของ token |
| Validate dump — size ต่ำกว่า 10 KB / ไม่มี `CREATE TABLE` | dump เสีย/ข้อมูลหายผิดปกติ | **ห้ามอัปโหลดต่อโดยข้าม** — ตรวจ `SELECT COUNT(*)` บน prod; ถ้า prod ปกติแต่ dump เสียซ้ำ แจ้งเป็น incident (อาจเป็นปัญหา D1 export เอง) |
| Collect manifest facts — jq error | shape ของ `--json` เปลี่ยน (wrangler upgrade) | เทียบผล `wrangler d1 execute ... --json` ด้วยมือ แล้วแก้ jq line ให้ตรง shape ใหม่ |
| Ensure bucket / lifecycle — 403 | token ขาด R2 permission หรือ bucket ถูกล็อก | ยืนยันสิทธิ์ R2 Object Read & Write; สร้าง bucket เองใน dashboard ได้ (workflow ข้ามขั้น create ให้เอง) |
| Upload — put fail | network/API transient | กด Re-run failed jobs (ทุก step idempotent — bucket/lifecycle เช็คก่อนสร้าง) |
| Verify upload — sha mismatch | upload เสียหายระหว่างทาง (หายาก) | Re-run ทั้ง job — รอบใหม่สร้างไฟล์ใหม่พร้อม TS ใหม่เอง |
| GPG encrypt — secret ผิด | fingerprint ไม่มีใน keyring / รูปแบบผิด | ตั้ง `BACKUP_GPG_RECIPIENT` เป็น fingerprint 40 ตัว หรือ email ที่ bind กับ public key |
| run ทั้งก้อนสีเหลือง (cancel) | run ซ้อนจาก dispatch มือ + cron ชนกัน | ไม่ใช่ปัญหา — `concurrency: d1-backup` ทำให้รอบใหม่รอ; ตรวจรอบล่าสุดที่สำเร็จเป็นหลัก |

**หลักการ:** ทุก run เป็นอิสระจากกัน — รอบที่พังไม่กระทบ backup เมื่อวาน ความเสี่ยงจริงคือ "พังติดกันหลายวันโดยไม่รู้" จึงต้องทำ 3.11 (notification) และสุ่มเช็ค R2 สัปดาห์ละครั้ง

## 5. Rollback Procedure (ปิด backup / ยกเลิก)

**ปิดชั่วคราว (หยุดรอบอัตโนมัติ เก็บ object เดิมไว้):**
1. GitHub → Actions → D1 Backup → `···` → **Disable workflow** — cron หยุดทันที, dispatch มือก็หยุดด้วย
2. แจ้งผู้ดูแลว่า RPO เด้งกลับไปเป็น "Time Travel 30 วันเท่านั้น" (`RECOVERABILITY_REVIEW.md` สถานการณ์ B)

**เปิดกลับ:** Enable workflow → กด Run workflow หนึ่งครั้งเพื่อยืนยัน → ตรวจ job summary

**ยกเลิกถาวร + เก็บกู้ของ:**
1. Disable workflow ตามข้างบน
2. Download backup ล่าสุดทั้งหมดออกก่อน (`r2 object get` ตาม runbook ขั้น 1)
3. `npx wrangler r2 bucket delete sao-recruitment-backups` (ถามยืนยัน — ลบ object ทั้ง bucket)
4. Cloudflare dashboard → API Tokens → **Roll/ลบ** `CF_BACKUP_API_TOKEN`
5. ลบ secrets บน GitHub (`CF_ACCOUNT_ID`, `CF_BACKUP_API_TOKEN`, `BACKUP_GPG_RECIPIENT`)

ห้ามลบ bucket ก่อน download — ภายใน bucket นี้คือ copy เดียวของ D1 นอก Time Travel
