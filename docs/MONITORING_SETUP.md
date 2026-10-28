# Monitoring Setup — SAO Recruitment System

> เอกสารนี้ตอบคำถามเดียว: **ตั้ง monitoring ให้ระบบนี้ยังไง และมันจะไม่เตือนมั่ว**
>
> อ่านคู่กับ [`RUNBOOK_INCIDENT_RESPONSE.md`](./RUNBOOK_INCIDENT_RESPONSE.md) (เจอ alert แล้วทำอะไร)
> และ [`LOGS_AND_DEBUGGING.md`](./LOGS_AND_DEBUGGING.md) (หาสาเหตุจาก log)

**Last Updated:** 2026-10-28

---

## 1. ภาพรวม — อะไรถูกเฝ้า และอะไรไม่ถูกเฝ้า

ระบบมีสอง endpoint ที่แยกกันโดยเจตนา (ดูเหตุผลเต็มใน `backend/src/routes/health.routes.ts`)

| Endpoint | ชนิด | ตรวจอะไร | แตะ D1 | ใช้กับ monitor |
|---|---|---|---|---|
| `GET /health` | liveness | Worker ตอบได้ไหม | ❌ ไม่แตะ | ✅ **primary** |
| `GET /health/ready` | readiness | D1 (`SELECT 1`) + `JWT_SECRET` | ✅ แตะ (อ่าน 0 rows) | ✅ **secondary** |

Production URLs

```
https://sao-recruitment-backend.hrmsao.workers.dev/health
https://sao-recruitment-backend.hrmsao.workers.dev/health/ready
https://sao-recruitment-frontend.pages.dev
```

### ⚠️ สิ่งที่ readiness **ไม่** ตรวจ — ต้องรู้ก่อนตั้งใจไว้วางใจ

`/health/ready` เขียวไม่ได้แปลว่าระบบใช้งานได้ครบ ทุกข้อต่อไปนี้พังได้โดย readiness ยังคืน `200`:

| องค์ประกอบ | readiness รู้ไหม | ถ้าพังจะเห็นอาการที่ไหน |
|---|---|---|
| D1 binding (`DB`) | ✅ ตรวจ | `checks.db` = `error` / `timeout` |
| `JWT_SECRET` | ✅ ตรวจ (มี/ไม่มี) | `checks.jwt_secret` = `missing` |
| R2 binding (`R2_BUCKET`) | ❌ ไม่ตรวจ | upload / ดาวน์โหลดไฟล์ผู้สมัครพัง แต่ health เขียว |
| `TURNSTILE_SECRET_KEY` | ❌ ไม่ตรวจ | ขึ้นกับว่าเปิดใช้จริงหรือยัง (ดูข้อ 6) |
| Cron GC (ลบ TEMP 7 วัน) | ❌ ไม่ตรวจ | ไม่มีสัญญาณเลย — รู้ตัวตอน R2 บวม |
| PDF generation pipeline | ❌ ไม่ตรวจ | request-level error เท่านั้น ดูใน Workers Logs |
| Frontend (Pages) | ❌ คนละ Worker | ต้องตั้ง monitor แยก |

> **สรุป:** readiness เป็น **dependency probe** ไม่ใช่ **functional monitor**
> อย่าใช้เป็นหลักฐานว่า "ระบบปกติ" ใช้เป็นหลักฐานว่า "dependency หลักยังอยู่"

---

## 2. UptimeRobot — ตั้งค่าสำหรับโปรเจกต์นี้

### 2.1 ทำไมต้องตั้ง 3 monitor ไม่ใช่ 1

| # | Monitor | URL | เหตุผล |
|---|---|---|---|
| M1 | Backend liveness | `/health` | จับ "Worker ตาย" — เบาที่สุด ยิงถี่ได้ |
| M2 | Backend readiness | `/health/ready` | จับ "D1 / secret มีปัญหา" — ต้องยิงห่างกว่า |
| M3 | Frontend | `https://sao-recruitment-frontend.pages.dev` | Pages deploy พังแยกจาก Worker |

### 2.2 ค่าที่ต้องตั้ง — M1 Backend liveness

| Field | ค่า | เหตุผล |
|---|---|---|
| Monitor Type | **HTTP(s)** | ไม่ใช่ Keyword — `/health` คืน 200 + JSON คงที่ |
| Friendly Name | `SAO Backend — liveness` | ตั้งให้อ่านแล้วรู้ทันทีใน alert |
| URL | `https://sao-recruitment-backend.hrmsao.workers.dev/health` | |
| Monitoring Interval | 5 นาที (ถี่กว่านี้ไม่เพิ่มสัญญาณ) | endpoint ไม่แตะ DB ต้นทุนต่ำ แต่ไม่จำเป็นต้อง 1 นาที |
| Timeout | **≥ 10 วินาที** | ต้องมากกว่า `DB_PROBE_TIMEOUT_MS` (3000 ms) ของ readiness และมากกว่า cold start |
| HTTP Method | GET | |
| Alert When | Down, และ Response time > threshold (ถ้าแพ็กเกจรองรับ) | |
| Alert Contacts | ช่องทางที่ **มีคนเห็นจริง** (ดูข้อ 4) | |

### 2.3 ค่าที่ต้องตั้ง — M2 Backend readiness

**นี่คือตัวที่ตั้งผิดแล้วจะได้ alert มั่วทั้งวัน** เพราะ endpoint นี้ออกแบบให้คืน `503` เมื่อ dependency ไม่พร้อม

| Field | ค่า | เหตุผล |
|---|---|---|
| Monitor Type | **Keyword** (ไม่ใช่ HTTP(s) เปล่า ๆ) | ต้องเช็คเนื้อหา ไม่ใช่แค่ status code |
| Friendly Name | `SAO Backend — readiness (D1)` | |
| URL | `https://sao-recruitment-backend.hrmsao.workers.dev/health/ready` | |
| Keyword Type | **exists** | |
| Keyword | `"status":"ok"` | ตรงกับ response จริงของ endpoint |
| Case Sensitive | ไม่ต้อง | |
| Monitoring Interval | **10–15 นาที** | probe แตะ D1 ทุกครั้ง — ไม่ต้องถี่ |
| Timeout | **≥ 10 วินาที** | ต้องเกิน 3 วินาทีของ probe ไม่งั้นตัดก่อนได้ 503 กลับมา แล้วแยกไม่ออกว่า Worker ตายหรือ DB ค้าง |

**ทำไมต้อง Keyword ไม่ใช่ HTTP(s):**

`/health/ready` คืน `503` + `{"status":"degraded",...}` เมื่อ D1 กระตุก ถ้าตั้งเป็น HTTP(s) monitor
ที่ถือว่า non-2xx = down จะได้ alert ทุกครั้งที่ D1 มี blip 2 วินาที
แล้วทีมจะเริ่มชินกับ alert (alert fatigue) จนพลาดของจริง — ซึ่งเป็นเหตุผลที่แยก endpoint ตั้งแต่แรก

> **ทางเลือก:** ถ้าอยากรู้ว่า degraded ด้วย (ไม่ใช่แค่ down) ให้ตั้ง **สอง** monitor
> ชี้ URL เดียวกัน: ตัวหนึ่ง Keyword `"status":"ok"` (แจ้งเตือนปกติ)
> อีกตัว Keyword `"status":"degraded"` (แจ้งเตือนระดับเตือน) — แต่ระวัง noise เพิ่ม

### 2.4 ค่าที่ต้องตั้ง — M3 Frontend

| Field | ค่า |
|---|---|
| Monitor Type | HTTP(s) |
| URL | `https://sao-recruitment-frontend.pages.dev` |
| Monitoring Interval | 5–10 นาที |
| Timeout | ≥ 10 วินาที |
| Alert When | Down |

> ระวัง: Pages ที่ build พังมักยังคืน `200` พร้อมหน้า error ของ Cloudflare
> ถ้าต้องการจับเคสนี้จริงต้องใช้ Keyword monitor เช็คข้อความที่ควรมีในหน้า

### 2.5 สิ่งที่ **ไม่ควร** ทำ

- ❌ **อย่า monitor `/health/ready` ด้วย interval 1 นาที** — probe แตะ D1 ทุกครั้ง เปล่าประโยชน์และเพิ่ม noise
- ❌ **อย่าใช้ HTTP(s) monitor กับ `/health/ready`** — 503 โดยออกแบบ จะกลายเป็น false positive
- ❌ **อย่าตั้ง timeout ต่ำกว่า 5 วินาที** — จะตัดก่อน endpoint ตอบ แล้ว debug ไม่ได้ว่าอะไรพัง
- ❌ **อย่า monitor endpoint ที่ต้อง auth** — `/api/v1/admin/*` จะได้ 401 ตลอด
- ❌ **อย่าใช้ `SELECT COUNT(*)` ใน probe เพื่อให้ monitor มีอะไรดู** — full table scan กิน D1 quota
  (มี test กันไว้แล้วใน `backend/src/routes/__tests__/health-readiness.test.ts`)

### 2.6 Maintenance Window

ตั้ง maintenance window ทุกครั้งที่มีการ deploy backend หรือ migration ที่แตะ D1
ไม่งั้นจะได้ alert ปลอมระหว่าง deploy ซึ่งเป็นช่วงที่คนกำลังยุ่งที่สุด

| งาน | ระยะเวลาที่ควรตั้ง |
|---|---|
| `wrangler deploy` backend | 10 นาที |
| D1 migration | 30 นาที (เผื่อ verify) |
| Pages deploy | 10 นาที |

> จำนวน maintenance window ที่ตั้งได้และความยาวสูงสุด **ขึ้นกับแพ็กเกจ** — ตรวจในหน้า dashboard ของบัญชีที่ใช้

### 2.7 ข้อจำกัดที่ต้องเช็คเองใน dashboard

ผมยืนยันจากโค้ดได้แค่ว่า endpoint คืนอะไร ไม่ยืนยันตัวเลขแพ็กเกจได้ ตรวจเองในหน้า UptimeRobot:

- จำนวน monitor สูงสุด
- ช่วง interval ที่แพ็กเกจรองรับ (บางแพ็กเกจล็อกขั้นต่ำไว้)
- จำนวน alert contact / integration
- log retention ของตัว UptimeRobot เอง

---

## 3. Alert Routing — ต้องมีคนเห็น

Monitor ที่ไม่มีใครดูคือ log ที่แพงขึ้น

| ระดับ | สัญญาณ | ต้องแจ้งใคร | ภายใน |
|---|---|---|---|
| Critical | M1 down (Worker ตาย) | on-call + หัวหน้าทีม | ทันที |
| Critical | M2 `"status":"ok"` หาย + M1 ยังเขียว | on-call (D1/secret) | ทันที |
| Warning | M2 degraded เป็นช่วงสั้น ๆ (< 5 นาที) แล้วกลับมา | แจ้งในช่องทีม ไม่ต้องปลุก | ในวันทำการ |
| Warning | M3 frontend down | on-call | ทันที |
| Info | Response time สูงขึ้นเรื่อย ๆ | ใส่ backlog | สัปดาห์ |

**ช่องทางที่แนะนำ:** email กลุ่มทีม + chat (LINE/Slack/Teams) — อย่างน้อยหนึ่งช่องที่ดังจริงบนมือถือ
อย่าตั้งแค่ email ส่วนตัวของคนเดียว เพราะคนนั้นจะลาพักร้อนในวันที่ระบบล่ม

---

## 4. สิ่งที่ควรเพิ่มในอนาคต (ยังไม่มีในระบบ)

บันทึกไว้เพื่อไม่ให้เข้าใจผิดว่ามีแล้ว:

| รายการ | สถานะ | หมายเหตุ |
|---|---|---|
| Health signal สำหรับ cron GC | ❌ ไม่มี | `scheduled()` ล้มแล้วได้แค่ `console.error` — ดู `LOGS_AND_DEBUGGING.md` §5 |
| Version/commit SHA ใน `/health/ready` | ❌ ไม่มี | ยืนยันไม่ได้ว่า deploy ไหน live อยู่ ต้องดู dashboard |
| `Cache-Control: no-store` บน health response | ❌ ไม่มี | ถ้ามี CDN/proxy คั่นกลาง อาจ cache ผลเก่า |
| R2 binding probe | ❌ ไม่มี | upload พังโดย health เขียว |
| Synthetic check (login / submit จริง) | ❌ ไม่มี | readiness ไม่ได้ทดสอบ business flow |
| Uptime SLO / error budget | ❌ ไม่มี | ยังไม่มีตัวเลข commitment |

> ทั้งหมดนี้ **ต้องแก้โค้ด** ไม่ใช่เอกสาร — บันทึกไว้เป็น finding ไม่ใช่คำสัญญา

---

## 5. Checklist หลังตั้งเสร็จ

- [ ] M1 `/health` คืน `200` และ `{"status":"ok",...}`
- [ ] M2 `/health/ready` ตั้งเป็น **Keyword** `"status":"ok"` ไม่ใช่ HTTP(s)
- [ ] M2 timeout ≥ 10 วินาที (มากกว่า `DB_PROBE_TIMEOUT_MS` = 3000 ms)
- [ ] M3 frontend ตอบ `200`
- [ ] alert contact อย่างน้อย 1 ช่องที่ดังบนมือถือของคนที่พร้อมตอบ
- [ ] ทดสอบ alert จริงหนึ่งครั้ง (ปิด endpoint หรือชี้ URL ผิด แล้วดูว่าแจ้งเตือนถึงจริง)
- [ ] ตั้ง maintenance window ตอน deploy ครั้งถัดไป
- [ ] ทีมรู้ว่า alert แต่ละตัวหมายถึงอะไร → ลิงก์ `RUNBOOK_INCIDENT_RESPONSE.md`

---

## 6. หมายเหตุเรื่อง Turnstile

`backend/wrangler.toml` ตั้ง `TURNSTILE_ENABLED = "true"` และมี `TURNSTILE_SITE_KEY`
แต่ `TURNSTILE_SECRET_KEY` เป็น optional ใน `Bindings` และ **การ verify token ยังไม่ implement**
(คอมเมนต์ใน `backend/src/types.ts`: *"foundation only — verification not implemented yet"*)

ผลต่อ monitoring: **อย่าเพิ่ม monitor ที่คาดหวังว่า Turnstile จะกัน bot ได้** ตอนนี้มันยังไม่กัน
ถ้าอนาคตเปิด verify จริง ต้องเพิ่ม monitor สำหรับ `/api/v1/public/config` ที่ส่ง site key ออกไปด้วย
