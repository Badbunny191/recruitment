# PDF Cache Strategy — เปรียบเทียบ 3 แนวทาง

> **Sprint 2 — Task 2** | วันที่: 2026-10-31 | Branch: `feature/sprint2-recoverability-and-pdf`
>
> **สถานะ: Design only — ห้าม implement ตามข้อกำหนดของ sprint**
>
> อ้างอิงโครงสร้างจริงจาก `docs/PDF_ARCHITECTURE_AUDIT.md` (Task 1)

---

## 0. ข้อเท็จจริงสำคัญก่อนเปรียบเทียบ

**Option B ในโจทย์ = สิ่งที่ production ใช้อยู่แล้วตั้งแต่วันแรกของ Document Composer:**
`getApplicationPdf()` (`backend/src/lib/pdf.service.ts:58-144`) เช็ค R2 (`pdf/applications/{id}/v3.pdf`) ก่อนทุกครั้ง — HIT คืนเลย, MISS render สดแล้ว `r2.put` กลับ (best-effort `:120-136`) คำถามจริง ๆ ของเอกสารนี้จึงไม่ใช่ "เลือก A/B/C" แต่คือ **"Option B เดิมพอหรือต้องอัปเกรดตรงไหน"** โดยมีตัวเลือกลาก A/C เข้ามาบางส่วน

สภาพ cache ปัจจุบัน 2 ชั้น:

| ชั้น | ครอบคลุม | Persistence | ขนาด |
|---|---|---|---|
| R2 object cache | PDF ใบสมัคร (download เท่านั้น) | ถาวรจนกว่า invalidation หรือ bump `PDF_CACHE_VERSION` (v3, `pdf-types.ts:199`) | ไม่จำกัด (ต่อใบ 1 object) |
| In-isolate LRU | preview เท่านั้น | ตายพร้อม isolate, TTL 60s | 6 entries / 2 MB (`pdf-preview-cache.ts:29-31`) |

---

## 1. Option A — Generate ตอน Submit เก็บลง R2 ใช้ซ้ำตลอด

**กลไก:** ใน `POST /public/applications/submit` (`public.routes.ts:580`) ต่อท้าย db.batch ด้วย `getApplicationPdf()` เพื่อ force render แล้วเก็บ R2 ก่อนคืน 201

| เกณฑ์ | ผล |
|---|---|
| CPU | **ย้ายภาระ ไม่ได้ลดภาระ** — render ยังเกิด 1 ครั้งต่อใบ แต่ย้ายไปช่วง submit ซึ่งเป็น request สำคัญที่สุดของผู้สมัคร (Turnstile + validation + db.batch + idempotency อยู่แล้ว) |
| Memory | เพิ่มพีคของ submit request (PDFDocument + bytes ≈ หลัก 100 KB–หลัก MB ต่อเอกสาร) |
| Complexity | ต่ำ (แทรก call เดียว) แต่ต้องตอบคำถามที่ยากกว่า: submit ล้มเพราะ render fail → ผู้สมัครเห็น error ทั้งที่ข้อมูลบันทึกแล้ว? ทำ async ไม่ได้เพราะ Workers ไม่มี background work นอก `ctx.waitUntil` |
| Storage | เท่าเดิม (1 object/ใบ) + **ต้องเก็บ PDF ของใบ DRAFT ที่ไม่เคยมีใครโหลด** |
| Correctness | **แย่สุดของ 3 ตัวเลือก** — DRAFT ถูกแก้ได้จนถึงขณะ submit แต่ข้อมูลหลัง submit เปลี่ยนได้ผ่าน invalidation เหมือนเดิม; จุดเจ็บคือ DRAFT เสียเปล่า + fail-coupling กับ submit |
| Operational Risk | สูงเชิง semantics — เปลี่ยน SLA ของ "การสมัครสำเร็จ" ให้ผูกกับ renderer |

**คำตัดสิน: ปฏิเสธ** — ได้ศูนย์ (render ครั้งเดียวต่อใบอยู่แล้ว) แลกกับความเสี่ยงบน critical path ของผู้สมัคร หากต้องการ pre-warm ให้ทำแบบแยกออกมา (ดู §5)

---

## 2. Option B — Generate ตอน Download ครั้งแรก เก็บลง R2 ใช้ซ้ำภายหลัง (= สถานะปัจจุบัน)

**กลไก:** มีอยู่แล้วครบตามที่อธิบายใน §0

| เกณฑ์ | ผล |
|---|---|
| CPU | render จ่าย 1 ครั้ง/ใบ/เวอร์ชัน descriptor — ใบที่ไม่มีใครโหลดไม่เคยจ่าย (สมเหตุผลเพราะใบสมัครไม่ได้ถูกโหลดทุกใบ) |
| Memory | request เดียว จบแล้วปล่อย — ไม่มีการกักเก็บข้าม request |
| Complexity | ต่ำสุด — โค้ดวิ่งใน production จริงมานาน |
| Storage | ต่ำ — เฉพาะใบที่เคยโหลด + มี invalidation เป็นตัวคุม correctness |
| Correctness | ดี — invalidation 3 จุด + version pinning (`round.templateVersionId`) + bump version ครั้งใหญ่เมื่อ renderer เปลี่ยน (78ad3839 → v3) ช่องโหว่ที่พบ = DELETE field ไม่ invalidate + orphan v1/v2 (PDF_ARCHITECTURE_AUDIT §2.7) |
| Operational Risk | ต่ำ — จุดเดียวที่ยังร้อนคือ **คลื่น miss พร้อมกัน** หลัง invalidation ทั้งรอบ (แก้ descriptor → ลบ cache ทุกใบ → ผู้สมัคร/แอดมินโหลดพร้อมกัน = render storm ระยะสั้น) และ **bulk ZIP** ที่ยิงต่อเนื่อง concurrency 2 |

**คำตัดสิน: เลือกเป็นแกนหลัก + อัปเกรดแบบ targeted** (§5) — ไม่ต้องเขียนใหม่แม้แต่บรรทัดเดียวในวันนี้

---

## 3. Option C — Queue-Based Rendering

**กลไก:** ผลักงาน render เข้า Cloudflare Queue (`wrangler.toml:63-76` มี config คอมเมนต์ไว้แล้ว: `sao-pdf-queue`, max_batch_size 10) consumer ค่อย render แล้วเก็บ R2 — download path เปลี่ยนเป็น "ถ้าไม่มี cache: enqueue แล้วรอ/บอกผู้ใช้กลับมาใหม่"

| เกณฑ์ | ผล |
|---|---|
| CPU | เหมือน A/B (render 1 ครั้ง/ใบ) แต่**กระจายเวลาได้** — ตัดคลื่น miss พร้อมกัน, batch 10/request กระจายต้นทุน embedFont ข้ามงาน (font bytes decode แชร์ต่อ isolate ได้มากขึ้นถ้า consumer ติดกัน) |
| Memory | เท่าเดิมต่อ request |
| Complexity | **สูงขึ้นมาก** — ต้องมี state machine (QUEUED/RENDERING/READY/FAILED), endpoint เช็คสถานะ, retry/DLQ, monitoring ผ่าน dashboard, และ download path กลายเป็น UX แบบ "โหลดไม่ได้ตอนนี้" สำหรับ miss แรกของทุกใบ |
| Storage | + metadata/state |
| Correctness | ต้องออกแบบใหม่ทั้ง invalidation (ยกเลิกงานใน queue เมื่อ descriptor เปลี่ยน?) |
| Operational Risk | **สูงสุด** — เพิ่ม moving part ที่ต้องเฝ้า (queue depth, DLQ), bus factor ของทีมคือ 1 คน, และระบบรับสมัครของ สตง. ระดับรอบสิบ ๆ ถึงร้อยใบ **ไม่มีปัญหา scale ที่ Queue แก้ได้จริงในวันนี้** |

**คำตัดสิน: ปฏิเสธในตอนนี้** — เป็น over-engineering สำหรับ volume ปัจจุบัน ตรงกับ DO NOT TOUCH ("Queue Implementation") และบทเรียน audit รอบก่อน ("ห้าม Queue โดยไม่จำเป็น") ทบทวนใหม่เมื่อ: รอบเดียวมีผู้สมัคร >2,000 คน หรือเกิด render storm จริงใน production

---

## 4. ตารางสรุปเปรียบเทียบ

| เกณฑ์ | A: ตอน Submit | B: ตอน Download แรก (ปัจจุบัน) | C: Queue |
|---|---|---|---|
| CPU ต่อใบที่มีคนโหลด | 1 render | 1 render | 1 render |
| CPU ต่อใบที่ไม่มีใครโหลด | 1 render (เสียเปล่า) | 0 | 0 (ไม่ enqueue) |
| ผลกระทบ critical path ผู้สมัคร | ช้าลง/เสี่ยง fail | ไม่มี | ไม่มี |
| Memory เพิ่ม | พีคตอน submit | ไม่มี | ไม่มี |
| Complexity เพิ่ม | ต่ำ แต่ coupling สูง | **ไม่มี (มีแล้ว)** | สูงมาก |
| Storage | + DRAFT ที่ไม่ถูกโหลด | เฉพาะที่โหลดแล้ว | เท่า B |
| Correctness | DRAFT/fail-coupling | ดี (ช่องว่างเล็กที่รู้จัก) | ต้องออกแบบ invalidation ใหม่ |
| Operational Risk | กลาง | ต่ำ | สูง |

## 5. Recommendation (ชัดเจน)

**เลือก Option B ที่ใช้อยู่แล้วเป็นแกนหลัก พร้อมอัปเกรด 3 ชิ้นลำดับตาม ROI** (ทั้งหมดไม่ใช่การเปลี่ยนสถาปัตยกรรม):

1. **[สูง] ปิดช่อง invalidation** — เพิ่ม `invalidatePdfCacheForFieldMaster` ตอน `DELETE /admin/fields/:id` (`admin.routes.ts:406-409` ขณะนี้ไม่เรียก) + ต่อยอด cron เดิม (`index.ts:120-134`) ให้ลบ orphan `pdf/applications/*/v1.pdf, v2.pdf` ทิ้ง (ครั้งเดียวพอหลัง deploy)
2. **[กลาง] กัน render storm หลัง invalidation ทั้งรอบ** — ตัวเลือกที่ถูกที่สุด: FE bulk ZIP คง concurrency 2 และเพิ่ม **per-request cache ระดับ isolate สำหรับ download path เหมือน preview** (LRU เล็ก ๆ เก็บ bytes ที่เพิ่ง render, TTL สั้น 60-300s) — รับคลื่นซ้ำภายใน isolate เดียวได้โดยไม่แตะ R2 schema; ทางเลือกถัดไป (แพงกว่า): pre-warm เฉพาะรอบที่เพิ่งแก้ descriptor ผ่าน `ctx.waitUntil` ท้าย request แก้ descriptor
3. **[ต่ำ] วัดก่อนปรับ `useObjectStreams`** — ทดลองใน preview endpoint ก่อน (มี instrumentation พร้อม: `buildRenderPlanMs/renderPlanToPdfMs`) ถ้าลดได้ >20% ค่อยขยาย

**ไม่แนะนำ Option A และ Option C ในทุกกรณีที่ระบุ** (A: เสียเปล่า+เสี่ยง critical path; C: over-engineering, ต้องทบทวนเมื่อ volume หรือ render storm เปลี่ยน)

**เงื่อนไขทบทวน (review trigger):** รอบรับสมัครเดียว >2,000 ใบ, เกิด 1102/503 ซ้ำบน download path, หรือมีความต้องการ PDF รายงานประเภทใหม่ที่ render หนัก (เช่น รวมทั้งรอบเป็นเล่มเดียว)
