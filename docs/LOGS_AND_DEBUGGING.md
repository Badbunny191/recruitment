# Logs & Debugging

> เอกสารนี้ตอบคำถาม: **หา log ที่ไหน และอ่านยังไงไม่ให้หลุดข้อมูลผู้สมัคร**
>
> ใช้คู่กับ [`RUNBOOK_INCIDENT_RESPONSE.md`](./RUNBOOK_INCIDENT_RESPONSE.md) (เจอแล้วทำอะไร)
> และ [`MONITORING_SETUP.md`](./MONITORING_SETUP.md) (ตั้ง alert)

**Last Updated:** 2026-10-28
**Wrangler version ที่ใช้เขียนเอกสารนี้:** 3.114.17

---

## 1. Log มีสองที่ — และมันไม่เหมือนกัน

| ที่ | เก็บอะไร | ย้อนหลังได้ | ใช้ตอนไหน |
|---|---|---|---|
| **`wrangler tail`** | request ที่เกิด **ตอนนี้** เท่านั้น | ❌ ไม่ได้ | กำลังเกิดเหตุ ต้องดูสด |
| **Workers Logs (dashboard)** | invocation + console output ที่เก็บไว้ | ✅ ตาม retention ของแพ็กเกจ | เหตุการณ์ผ่านไปแล้ว |
| **`audit_logs` (D1)** | action ที่ระบบบันทึก (login, status change, PDF download) | ✅ ตลอดไป | ต้องรู้ว่า "ใครทำอะไร" |

### ⚠️ ข้อจำกัดที่คนพลาดบ่อยที่สุด

**`wrangler tail` ไม่เห็นอดีต** ถ้าเหตุเกิดไปแล้ว 20 นาที การรัน tail จะได้แค่ request ใหม่
ต้องไปดู Workers Logs บน dashboard — **อย่าเสียเวลา tail ตอนที่ปัญหาจบไปแล้ว**

### `audit_logs` ไม่ใช่ request log

`audit_logs` เก็บเฉพาะ action ที่ระบบเลือกบันทึกไว้ **ไม่ครอบคลุม error/latency ของ request ทั่วไป**
ถ้าต้องการ "request นี้พังเพราะอะไร" ต้องใช้ Workers Logs ไม่ใช่ `audit_logs`

---

## 2. Observability เปิดอยู่แล้ว — ไม่ต้องไปกดอะไร

จาก `backend/wrangler.toml`:

```toml
[observability]
enabled = true
head_sampling_rate = 1
```

- `enabled = true` → เปิดทั้ง invocation logs + trace logs
- `head_sampling_rate = 1` → เก็บ **100%** ของ request
- frontend ก็เปิดใน `frontend/wrangler.jsonc` (`"observability": { "enabled": true }`)

> ถ้า volume สูงจนค่า log แพง ให้ลด `head_sampling_rate` เป็น `0.1` (10%)
> แต่ระวัง: sampling ต่ำลง = เหตุการณ์ที่เกิดน้อยครั้งอาจไม่ถูกเก็บเลย

**ตำแหน่งบน dashboard:** Cloudflare Dashboard → Workers & Pages → `sao-recruitment-backend` → Logs
(หรือ Real-time Logs สำหรับ stream สดในเบราว์เซอร์)

---

## 3. `wrangler tail` — Quick Start

### 3.1 เตรียมก่อน

```bash
cd backend
npx wrangler login          # ครั้งแรกเท่านั้น
npx wrangler whoami         # ยืนยันว่า login อยู่และมีสิทธิ์ account ถูกตัว
```

ต้องมีสิทธิ์อ่าน Worker ของ account ที่มี `sao-recruitment-backend` อยู่

### 3.2 คำสั่งพื้นฐาน

```bash
cd backend

# ดูทุกอย่าง (อ่านยาก แต่เห็นครบ)
npx wrangler tail sao-recruitment-backend --format pretty

# เฉพาะ request ที่ error — ใช้บ่อยที่สุดตอน incident
npx wrangler tail sao-recruitment-backend --format pretty --status error

# เฉพาะ POST (submit / upload)
npx wrangler tail sao-recruitment-backend --format pretty --method POST

# ค้นข้อความใน console.log/error
npx wrangler tail sao-recruitment-backend --format pretty --search "UNHANDLED_ERROR"

# เฉพาะ health probe (ดูว่า monitor ยิงเข้ามาจริงไหม)
npx wrangler tail sao-recruitment-backend --format pretty --search "HEALTH"

# เฉพาะ cron GC
npx wrangler tail sao-recruitment-backend --format pretty --search "AttachmentCleanup"
```

### 3.3 `--format pretty` vs `--format json`

| Format | ใช้ตอน |
|---|---|
| `pretty` | อ่านด้วยตาบนหน้าจอ |
| `json` | ส่งต่อให้ tool อื่น, grep, หรือเก็บเป็นไฟล์ |

```bash
# เก็บ log ลงไฟล์เพื่อวิเคราะห์ทีหลัง (ระวัง PII — ดูข้อ 6)
npx wrangler tail sao-recruitment-backend --format json > /tmp/tail-$(date +%s).json
```

### 3.4 Flags ที่มีจริงใน wrangler 3.114.17

ยืนยันจาก `npx wrangler tail --help`:

| Flag | ค่า | หมายเหตุ |
|---|---|---|
| `--format` | `json` \| `pretty` | |
| `--status` | `ok` \| `error` \| `canceled` | รับได้หลายค่า |
| `--method` | HTTP method | รับได้หลายค่า |
| `--header` | `"Name: Value"` | filter ตาม header |
| `--search` | ข้อความ | **ค้นใน console.log messages เท่านั้น** ไม่ค้นใน response body |
| `--ip` | IP หรือ `self` | |
| `--sampling-rate` | ตัวเลข % | เพิ่ม sampling สำหรับ session นี้ |
| `--version-id` | Worker version | ดูเฉพาะ version ที่ระบุ |

### 3.5 สิ่งที่ tail ทำไม่ได้

- ❌ **ไม่เห็น request ที่ผ่านไปแล้ว** — ใช้ Workers Logs แทน
- ❌ **`--search` ไม่ค้นใน response body** — ค้นเฉพาะ console output
- ❌ **ไม่เห็น log ของ Pages frontend** — Pages มี log แยก ดูที่ dashboard → Pages → deployment → Functions logs
  (แต่โปรเจกต์นี้เป็น static export จึงแทบไม่มี function log ให้ดู)
- ⚠️ **การเห็น scheduled/cron invocation ยังไม่ยืนยัน** — ต้องทดสอบเองก่อนเขียนลง runbook
  (`--search "AttachmentCleanup"` แล้วรอรอบ 01:00 น. ไทย ถ้าไม่เห็น ให้ไปดู Workers Logs แทน)

---

## 4. Log ที่ระบบนี้เขียนไว้ — จุดที่ควร grep

### 4.1 Health probe

| Tag | มาจาก | แปลว่า |
|---|---|---|
| `[HEALTH] d1_probe_failed` | `health.routes.ts:100` | D1 probe ล้ม พร้อม `reason: 'timeout' \| 'error'` |
| `[HEALTH] d1_probe_unexpected_result` | `health.routes.ts:94` | query สำเร็จแต่ผลไม่ใช่ `1` — binding ผิดตัว |

### 4.2 Error ที่ไม่ถูกจับ

| Tag | มาจาก | แปลว่า |
|---|---|---|
| `[UNHANDLED_ERROR]` | `index.ts` `app.onError` | error ที่ไม่มีใคร catch — **มี stack + cause เต็ม** |

`[UNHANDLED_ERROR]` เป็นจุดที่ข้อมูลหลุดง่ายที่สุด เพราะ log ทั้ง `message`, `cause`, `stack`
ถ้า error มาจาก D1/SQL, `message` มักมี query และค่าที่ bind อยู่ข้างใน

### 4.3 Attachment / PDF / Auth

| Tag | มาจาก |
|---|---|
| `[AttachmentCleanup] scheduled run` | `index.ts` — cron GC สำเร็จ |
| `[AttachmentCleanup] scheduled run failed` | `index.ts` — cron GC ล้ม |
| `[PDF] Error generating PDF for application <id>` | `admin.routes.ts:2518` |
| `[LOGIN_ATTEMPT_UPDATE_FAILED]` | `admin.routes.ts:148` |
| `[AUDIT_LOGS] Failed to resolve entity displays` | `admin.routes.ts:3313` |
| `insertApplicationWithRetry: non-unique error` | `public.routes.ts:569` — **log error object เต็ม** |

> ⚠️ `public.routes.ts:569` log error object ทั้งก้อน ซึ่งอาจมี SQL และค่าที่ bind
> ถ้าเป็น error จาก insert application **มีโอกาสมีข้อมูลผู้สมัครติดมา** — redact ก่อนแชร์ทุกครั้ง

---

## 5. วิธีดู log ของ cron GC (กรณีที่ health ไม่บอก)

cron GC ไม่มี health signal — ถ้าตายจะรู้ตัวตอน R2 บวมหรือผู้ใช้บ่นว่าไฟล์ค้าง

**รอบการทำงาน:** `0 18 * * *` UTC = **01:00 น. เวลาไทย** วันละครั้ง

```bash
# วิธีที่ 1: tail แล้วรอรอบ (ต้องเปิดค้างไว้ตอน 01:00 น.)
cd backend
npx wrangler tail sao-recruitment-backend --format pretty --search "AttachmentCleanup"

# วิธีที่ 2: ดูย้อนหลังใน Workers Logs บน dashboard (แนะนำถ้าเลยเวลาไปแล้ว)
# Dashboard → Workers → sao-recruitment-backend → Logs → filter "AttachmentCleanup"
```

**สัญญาณว่าปกติ:** มี log `[AttachmentCleanup] scheduled run: {...}` ทุกวัน
**สัญญาณว่าผิด:** ไม่มี log เลยหลายวัน หรือมีแต่ `scheduled run failed`

---

## 6. ⚠️ Redaction — เอกสารเดิมบอกผิด

README §6.2 เขียนว่า:

> *"ห้าม log ข้อมูลอ่อนไหว (national_id, password, token) — ดูระเบียบ redaction ใน `backend/src/middlewares/`"*

**ตรวจแล้ว: ไม่มีระเบียบ redaction อยู่ใน `backend/src/middlewares/`**
grep ทั้ง `src/` ไม่เจอฟังก์ชัน redact/mask ใด ๆ ที่ใช้กับ log

สิ่งที่มีจริงคือ **การป้องกันเชิงโครงสร้าง** ไม่ใช่ redaction:

- `audit.middleware.ts` — entry type **ไม่มี field** สำหรับ password / hash / JWT / temporary password
  ตั้งแต่ระดับ TypeScript จึงใส่เข้าไปไม่ได้ (คอมเมนต์บรรทัด 87–88 ระบุไว้ชัด)
- นั่นป้องกัน `audit_logs` ได้ แต่ **ไม่ป้องกัน `console.error`**

### ผลที่ตามมา

`console.error` ทั้ง 37 จุดใน `src/` log ข้อมูลดิบ ไม่มีตัวกรอง:

- `[UNHANDLED_ERROR]` log `message`, `cause`, `stack` เต็ม
- `public.routes.ts:569` log error object ทั้งก้อน

### กฎที่ต้องใช้แทน (จนกว่าจะมี redaction จริง)

**ก่อน copy log ลง ticket / chat / email ทุกครั้ง ให้ตรวจ:**

| ห้ามหลุด | หน้าตา |
|---|---|
| เลขบัตรประชาชน | 13 หลัก |
| password / hash | `$2a$` / `$2b$` ขึ้นต้น |
| JWT | `eyJ` ขึ้นต้น |
| R2 credential | `R2_SECRET_ACCESS_KEY`, `R2_ACCESS_KEY_ID` |
| attachment token | ค่าใน `X-Attachment-Token` |
| ข้อมูลผู้สมัคร | ชื่อ-นามสกุล, เบอร์โทร, อีเมล, ที่อยู่ |

**วิธี redact แบบเร็ว:**

```bash
# แทนเลขบัตร 13 หลัก
sed -E 's/[0-9]{13}/[REDACTED_ID]/g'

# แทน JWT
sed -E 's/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/[REDACTED_JWT]/g'

# แทน bcrypt hash
sed -E 's/\$2[aby]\$[0-9]{2}\$[A-Za-z0-9.\/]+/[REDACTED_HASH]/g'
```

> **ข้อเสนอ (ต้องแก้โค้ด ไม่ได้ทำในงานเอกสารนี้):** เพิ่มฟังก์ชัน `redactForLog()` กลาง
> แล้วใช้ใน `app.onError` และจุดที่ log error object — บันทึกเป็น finding ไม่ใช่คำสัญญา

---

## 7. Debug flow แบบเร็ว

```
1. curl /health และ /health/ready          → แยก Worker ตาย vs dependency พัง
2. ถ้ากำลังเกิดเหตุ → wrangler tail --status error
   ถ้าผ่านไปแล้ว    → Workers Logs บน dashboard
3. grep tag ที่ตรงจุด: [UNHANDLED_ERROR] / [HEALTH] / [PDF] / [AttachmentCleanup]
4. ถ้าต้องรู้ว่า "ใครทำอะไร" → query audit_logs (ไม่ใช่ request log)
5. ก่อนแชร์ log → redact ตามข้อ 6
```

### Query `audit_logs` เบื้องต้น

```bash
cd backend

# 20 รายการล่าสุด
npx wrangler d1 execute sao-db --remote \
  --command "SELECT id, admin_id, action, entity_type, entity_id, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 20"

# เฉพาะ login
npx wrangler d1 execute sao-db --remote \
  --command "SELECT * FROM audit_logs WHERE action LIKE 'LOGIN%' ORDER BY created_at DESC LIMIT 20"
```

> ⚠️ `--remote` แตะ production D1 จริง ใช้ `SELECT` เท่านั้นในระหว่าง incident
> และระวัง `audit_logs` มี `email` ของ admin อยู่ใน payload — redact ก่อนแชร์

---

## 8. Checklist ก่อนแชร์ log ออกนอกทีม

- [ ] ไม่มีเลขบัตรประชาชน 13 หลัก
- [ ] ไม่มี password / hash / JWT / token
- [ ] ไม่มี R2 credential
- [ ] ไม่มีชื่อ-เบอร์-อีเมลผู้สมัคร
- [ ] ไม่มี `database_id` หรือ internal binding name ที่ไม่จำเป็น
- [ ] ระบุ timestamp + timezone (ไทย vs UTC) ให้ชัด — log ของ Workers เป็น UTC
