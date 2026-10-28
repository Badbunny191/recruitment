# Runbook — Incident Response

> เอกสารนี้ใช้ **ตอนระบบมีปัญหาแล้ว** ไม่ใช่ตอนติดตั้ง
> ถ้ายังไม่ได้ตั้ง monitor ไปที่ [`MONITORING_SETUP.md`](./MONITORING_SETUP.md) ก่อน
> ถ้าต้องหาสาเหตุจาก log ไปที่ [`LOGS_AND_DEBUGGING.md`](./LOGS_AND_DEBUGGING.md)

**Last Updated:** 2026-10-28
**Wrangler version ที่ใช้เขียนเอกสารนี้:** 3.114.17

---

## 0. กฎสามข้อ

1. **แยกให้ออกก่อนว่า "Worker ตาย" หรือ "D1 มีปัญหา"** — สองอย่างนี้แก้คนละทาง ถ้าเดาผิดจะยิ่งพัง
2. **ประกาศก่อนแก้** — บอกทีมว่าเกิดอะไร กำลังทำอะไร กันคนสองคนแก้พร้อมกัน
3. **ห้าม rollback ก่อนเก็บหลักฐาน** — rollback ทับ log ที่ต้องใช้หาสาเหตุทันที

---

## 1. Severity

| ระดับ | นิยาม | ตัวอย่าง | ตอบภายใน |
|---|---|---|---|
| **P1** | ผู้สมัครใช้งานไม่ได้เลย หรือข้อมูลเสี่ยงเสียหาย | `/health` down, submit ไม่ได้, login ไม่ได้ทั้งระบบ | 15 นาที |
| **P2** | ฟีเจอร์หลักพังบางส่วน แต่ระบบยังรับงานได้ | upload ไฟล์พัง, PDF ออกไม่ครบ, admin บางหน้าพัง | 1 ชั่วโมง |
| **P3** | รบกวน แต่มีทางเลี่ยง | ช้าเป็นบางช่วง, export Excel ผิด format | วันทำการถัดไป |
| **P4** | ไม่กระทบผู้ใช้ | log ไม่ครบ, dashboard แสดงผลเพี้ยน | backlog |

**ถ้าไม่แน่ใจให้ยกระดับขึ้น** — P2 ที่กลายเป็น P1 ทีหลังแย่กว่า P1 ที่กลายเป็น P2

---

## 2. Decision Tree — เห็นสัญญาณแล้วทำอะไร

### 2.1 เริ่มตรงนี้เสมอ

```bash
curl -s -o /dev/null -w "liveness: %{http_code} (%{time_total}s)\n" \
  https://sao-recruitment-backend.hrmsao.workers.dev/health

curl -s -w "\nreadiness: %{http_code} (%{time_total}s)\n" \
  https://sao-recruitment-backend.hrmsao.workers.dev/health/ready
```

### 2.2 อ่านผล

#### กรณี A — liveness ตอบ `200` แต่ readiness `503`

**แปลว่า:** Worker ยังมีชีวิต ปัญหาอยู่ที่ dependency → **P1 ถ้า db error/timeout, P2 ถ้าแค่ jwt_secret**

ดู `checks` ใน response แล้วแยก:

| `checks.db` | `checks.jwt_secret` | แปลว่า | ไปทำ |
|---|---|---|---|
| `timeout` | `ok` | D1 ค้าง ไม่ตอบภายใน 3 วินาที (`DB_PROBE_TIMEOUT_MS`) | §3.1 |
| `error` | `ok` | D1 ตอบแต่ผิดปกติ — binding ผิด, DB ถูกลบ, query ล้ม | §3.2 |
| `ok` | `missing` | `JWT_SECRET` หายจาก environment | §3.3 |
| `timeout`/`error` | `missing` | สองอย่างพังพร้อมกัน — มักหมายถึง deploy/env ผิดทั้งชุด | §3.4 |

> **สำคัญ:** `timeout` กับ `error` ต่างกัน
> `timeout` = D1 ไม่ตอบ (มักเป็นปัญหาฝั่ง Cloudflare)
> `error` = D1 ตอบแล้วแต่ผลไม่ใช่ที่คาด (มักเป็นปัญหาฝั่งเรา — binding/config)

#### กรณี B — liveness ไม่ตอบ หรือได้ 5xx

**แปลว่า:** Worker ตาย หรือ deploy ล่าสุดพัง → **P1** → §4

#### กรณี C — ทั้งสองเขียว แต่ผู้ใช้บอกว่าใช้งานไม่ได้

**แปลว่า:** readiness ไม่ครอบคลุมสิ่งนั้น (R2, PDF, Turnstile, frontend) → **P2**
ไปดู §5 ก่อน แล้วค่อยไป [`LOGS_AND_DEBUGGING.md`](./LOGS_AND_DEBUGGING.md)

#### กรณี D — frontend พัง แต่ backend เขียว

**แปลว่า:** Pages deploy มีปัญหา → §6

---

## 3. แก้ตามสาเหตุ

### 3.1 `checks.db = "timeout"`

1. เช็ค Cloudflare status ก่อน — <https://www.cloudflarestatus.com/>
   ถ้า D1 มี incident ประกาศ: **หยุดแก้ รอ Cloudflare** แล้วแจ้งผู้ใช้
2. ถ้า Cloudflare ปกติ ให้ดูว่ามี query หนักผิดปกติไหม:
   ```bash
   cd backend
   npx wrangler tail sao-recruitment-backend --format pretty --status error
   ```
3. ถ้าเพิ่ง deploy มา → §4 (rollback)
4. ถ้าไม่มีอะไรเปลี่ยนเลยและ D1 ค้างจริง → escalate ไป Cloudflare support พร้อม timestamp

**ห้าม:** เพิ่ม timeout ใน probe เพื่อให้ health กลับมาเขียว นั่นคือการปิดสัญญาณ ไม่ใช่การแก้

### 3.2 `checks.db = "error"`

สาเหตุที่พบบ่อย เรียงตามความน่าเป็น:

1. **binding `DB` ชี้ผิด database** — ตรวจ `backend/wrangler.toml`:
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "sao-db"
   database_id = "c8c9e923-0b64-4203-880b-ea5af58d316f"
   ```
   ⚠️ มี binding ที่สองชื่อ `DB_LOCAL` ชี้ `sao-db-local` — **อย่าให้สลับกัน**
2. **database ถูกลบ/ย้าย** — `npx wrangler d1 list` ดูว่ายังมี `sao-db` ไหม
3. **migration พังกลางทาง** — ดู `docs/MIGRATION_GOVERNANCE.md` และ `docs/D1_MIGRATION_RECOVERY_PLAN.md`
4. **query ใน probe ถูกแก้** — ต้องเป็น `SELECT 1` เท่านั้น ถ้ามีคนเปลี่ยนเป็น `COUNT(*)` จะ timeout/error
   (มี test กันไว้ที่ `backend/src/routes/__tests__/health-readiness.test.ts`)

> probe log ฝั่ง server ไว้แล้วด้วย tag `[HEALTH] d1_probe_failed` หรือ `[HEALTH] d1_probe_unexpected_result`
> หาใน Workers Logs หรือ tail — ดู [`LOGS_AND_DEBUGGING.md`](./LOGS_AND_DEBUGGING.md)

### 3.3 `checks.jwt_secret = "missing"`

`JWT_SECRET` หายจาก environment ของ Worker — **login พังทั้งระบบ**

```bash
cd backend
# ดูว่ามี secret ตั้งไว้ไหม (ไม่แสดงค่า)
npx wrangler secret list
```

ถ้าหาย: ตั้งกลับด้วยค่าที่ **เหมือนเดิม** (จาก password manager ตาม §14 ของ README)

```bash
npx wrangler secret put JWT_SECRET
```

> ⚠️ **ถ้าใส่ค่าใหม่ (ไม่ใช่ค่าเดิม) ผู้ใช้ที่ login ค้างอยู่จะถูก logout ทั้งหมด**
> และ token ที่ออกไปแล้วจะใช้ไม่ได้ — ต้องแจ้งผู้ใช้ก่อน ถ้าเลี่ยงได้ให้ใช้ค่าเดิม

### 3.4 พังทั้งชุด (db + jwt_secret)

มักเกิดจาก deploy ที่ไม่มี environment ครบ → §4 rollback แล้วตรวจ env ก่อน deploy ใหม่

---

## 4. Worker ตาย / deploy ล่าสุดพัง — Rollback

### 4.1 เก็บหลักฐานก่อน (ห้ามข้าม)

```bash
cd backend
npx wrangler deployments list
```

จด **version ID ของตัวที่กำลังมีปัญหา** ไว้ก่อน rollback ไม่งั้นจะย้อนกลับมาดูไม่ได้

### 4.2 Rollback

```bash
cd backend
npx wrangler rollback --name sao-recruitment-backend --message "P1: revert <สิ่งที่พัง>"
```

หรือระบุ version ที่ต้องการย้อนไป:

```bash
npx wrangler rollback <version-id> --name sao-recruitment-backend
```

### 4.3 ตรวจหลัง rollback

```bash
curl -s https://sao-recruitment-backend.hrmsao.workers.dev/health
curl -s https://sao-recruitment-backend.hrmsao.workers.dev/health/ready
```

ต้องได้ `200` + `"status":"ok"` ทั้งคู่ก่อนประกาศจบเหตุ

### 4.4 ⚠️ Rollback ไม่ย้อน database

`wrangler rollback` ย้อน **code** เท่านั้น **ไม่ย้อน migration ที่ apply ไปแล้ว**
ถ้า incident เกี่ยวกับ schema → ไปที่ `docs/D1_MIGRATION_RECOVERY_PLAN.md` และ `docs/MIGRATION_GOVERNANCE.md`
**อย่า** รัน rollback SQL เองโดยไม่ปรึกษา — เคยมีเหตุการณ์ `015_rollback.sql` ถูก apply สลับลำดับ
(ดู `docs/MIGRATION_AUDIT_2026.md` Finding #3)

---

## 5. Health เขียวแต่ผู้ใช้ใช้งานไม่ได้

readiness ตรวจแค่ D1 + `JWT_SECRET` ต่อไปนี้พังได้โดยไม่กระเทือน health:

| อาการผู้ใช้ | น่าจะเป็น | ตรวจ |
|---|---|---|
| อัปโหลดไฟล์ไม่ได้ | R2 binding / credential | `npx wrangler r2 bucket list` + ดู log upload |
| ดาวน์โหลด/พรีวิว PDF ไม่ได้ | PDF pipeline / font asset | ดู log ที่มี `[UNHANDLED_ERROR]` |
| ไฟล์ TEMP ค้างเยอะ / R2 บวม | cron GC ไม่ทำงาน | §5.1 |
| หน้าเว็บขาว | Pages deploy | §6 |
| ฟอร์ม submit ไม่ผ่าน | rate limit / idempotency / validation | ดู `RATE_LIMIT_*`, `IDEMPOTENCY_*` ใน `wrangler.toml` |

### 5.1 ตรวจ cron GC

`backend/src/index.ts` มี `scheduled()` ที่ลบไฟล์ TEMP อายุเกิน 7 วัน วันละครั้ง (18:00 UTC = 01:00 น. ไทย)
ถ้ามันล้ม จะเห็นแค่ `console.error('[AttachmentCleanup] scheduled run failed:', err)` ใน log
**ไม่มี health signal ไม่มี alert** — ต้องไปหาใน log เอง

```bash
cd backend
npx wrangler tail sao-recruitment-backend --format pretty --search "AttachmentCleanup"
```

> ต้องรันช่วง 01:00 น. ไทย หรือดูย้อนหลังใน Workers Logs บน dashboard
> (tail เห็นเฉพาะ request สด — ดูข้อจำกัดใน `LOGS_AND_DEBUGGING.md`)

---

## 6. Frontend (Pages) พัง

```bash
# ดู deployment ล่าสุด
npx wrangler pages deployment list --project-name=sao-recruitment-frontend
```

ถ้า deploy ล่าสุดพัง: rollback ที่ Cloudflare Dashboard → Pages → project → Deployments → เลือก deployment ดีตัวก่อน → Rollback

**อาการที่เจอบ่อยและสาเหตุ** (รายละเอียดใน README §10):

| อาการ | สาเหตุ |
|---|---|
| หน้าขาว + `curl -I` ได้ 403 | `pages_build_output_dir` ตั้งเป็น `.next` แทน `out` |
| หน้าขาว แต่ 200 | `NEXT_PUBLIC_API_URL` ผิด หรือ CORS |
| 404 บน dynamic route | ไม่ได้ใช้ `output: 'export'` + query params |

---

## 7. Template ประกาศให้ทีม

### เริ่มเหตุ

```
[P?] <ระบบ> ผิดปกติ — เริ่ม <HH:MM>
อาการ: <ผู้ใช้เห็นอะไร>
กระทบ: <ใคร/กี่คน/ฟีเจอร์ไหน>
สถานะ: กำลังตรวจสอบ
ผู้รับผิดชอบ: <ชื่อ>
ถัดไป: อัปเดตภายใน <X> นาที
```

### ระหว่างแก้

```
[P?] อัปเดต <HH:MM>
พบ: <สาเหตุที่เจอ หรือ "ยังไม่ทราบ">
ทำ: <สิ่งที่กำลังทำ>
ผล: <อะไรเปลี่ยน>
```

### จบเหตุ

```
[P?] แก้ไขแล้ว — <HH:MM>
สาเหตุ: <root cause>
วิธีแก้: <rollback / fix / config>
ระยะเวลากระทบ: <X> นาที
ติดตามผล: <สิ่งที่ต้องทำต่อ + ใคร + เมื่อไหร่>
```

---

## 8. หลังจบเหตุ (ภายใน 48 ชั่วโมง)

- [ ] เขียน postmortem สั้น ๆ: ไทม์ไลน์, root cause, สิ่งที่ทำให้เจอช้า/เร็ว
- [ ] ถ้าเจอช้าเพราะ **ไม่มีสัญญาณ** → เพิ่ม monitor (ดู §4 ของ `MONITORING_SETUP.md`)
- [ ] ถ้าแก้ช้าเพราะ **ไม่มี runbook** → เพิ่มหัวข้อในเอกสารนี้
- [ ] ถ้าเป็น bug → เปิด issue พร้อม log ที่ redact แล้ว
- [ ] ตรวจว่าไม่มี secret/PII หลุดไปใน ticket หรือ chat ที่ใช้คุยกันตอนแก้

---

## 9. ข้อจำกัดที่ต้องรู้

| ข้อ | รายละเอียด |
|---|---|
| `wrangler rollback` ไม่ย้อน D1 | code เท่านั้น |
| ไม่มี version/SHA ใน health response | ยืนยัน deploy ที่ live ไม่ได้จาก endpoint ต้องดู dashboard |
| readiness ไม่ครอบคลุม R2 / Turnstile / cron | ดูตารางใน `MONITORING_SETUP.md` §1 |
| `wrangler tail` เห็นเฉพาะ request สด | เหตุการณ์ที่ผ่านไปแล้วต้องดู Workers Logs บน dashboard |
| ไม่มี on-call rotation ในเอกสารนี้ | ต้องตกลงกันในทีมว่าใครรับ P1 |
