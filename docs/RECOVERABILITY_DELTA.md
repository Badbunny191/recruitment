# Recoverability Delta — คะแนนก่อน vs หลัง Sprint 3

> **Sprint 3 — Task 7** | วันที่: 2026-10-31 | Branch: `feature/sprint3-backup-activation`
>
> อัปเดตคะแนนจาก `RECOVERABILITY_REVIEW.md` (Sprint 2 — baseline) หลังงาน Sprint 3
> ทุกคะแนน "หลัง" ผูกกับ**เงื่อนไข**ที่ระบุชัด — ตัวเลขจะเป็นจริงเมื่อเงื่อนไขเสร็จจริงเท่านั้น

---

## 1. คะแนนรวม

| มิติ | Sprint 2 (ก่อน) | Sprint 3 (หลัง) | เปลี่ยนเพราะอะไร | เงื่อนไขให้คะแนน "หลัง" มีผลจริง |
|---|---|---|---|---|
| Current State (recoverability โดยรวม) | **3.5/10** (มีแผน ใช้ไม่ได้) → Sprint 2 ประเมิน "6/10 เมื่อเปิดใช้" | **6.5/10** | เส้นทางเปิดใช้กลายเป็นเช็กลิสต์ 30 นาทีที่ตรวจแล้วว่าทำตามได้ + เจอ/แก้บั๊กที่ทำให้ manifest ใช้ไม่ได้จริง (jq) + run แรกมีเกณฑ์ "สำเร็จจริง" V1-V5 | ทำ `BACKUP_ACTIVATION_CHECKLIST.md` §3 ครบ (ตั้ง secrets + run แรกผ่าน V1-V5) — **ยังไม่ทำ = ยังอยู่ 3.5** |
| Recovery Readiness (พร้อมหน้างานเมื่อเกิดเหตุ) | 3/10 → Sprint 2 ประเมิน 5.5/10 | **7/10** | Restore drill จาก "เอกสารออกแบบ" เป็นเช็กลิสต์ Phase A-D ที่หยิบขึ้นมาทำได้ + มีตารางบันทึก RTO จริง + กำหนด abort criteria ต่อเฟส | รัน drill ซ้อมจริง ≥ 1 ครั้ง (Phase A-C) แล้วบันทึก RTO → ขยับเป็น 8/10 |

**เหตุผลที่คะแนน "หลัง" ไม่ขึ้นไปสูงกว่านี้** (honest gap):

1. Backup ยังไม่ได้ run จริงแม้แต่ครั้งเดียว (รอ secrets จากผู้ดูแล — สิ่งที่เราทำได้คือทำให้เส้นทางสั้นและตรวจแล้ว)
2. Drill ยังไม่เคยซ้อม — RTO 20-35 นาทียังเป็นค่าประเมิน ไม่ใช่ค่าวัดจริง
3. ไฟล์แนบ R2 ยังไม่มี copy ที่สอง (ช่องว่างสถานการณ์ C เดิม — ตอนนี้วัดขนาดจริงและรู้ต้นทุนแล้ว แต่ยังไม่ได้ทำ)

## 2. แยกตามสถานการณ์ (เทียบ `RECOVERABILITY_REVIEW.md` §1-§5)

| สถานการณ์ | Sprint 2 | Sprint 3 | สิ่งที่เปลี่ยนใน sprint นี้ |
|---|---|---|---|
| A. Worker พัง | 7/10 | 7/10 (คงเดิม) | — (rollback ของแพลตฟอร์ม ไม่เกี่ยวกับงาน sprint นี้) |
| B. D1 เสีย | 5/10 วันนี้ (7.5 เมื่อ backup ทำงาน) | **7.5/10** *(เงื่อนไข: activation + run แรกผ่าน)* | เจอ+แก้บั๊ก jq ที่ทำให้ `manifest.facts = null` → baseline เทียบตอน restore ใช้ได้จริง; ตรวจว่า wrangler 3.114.17 มี subcommand ครบ 8/8; เกณฑ์ V1-V5 + Phase A-D ทำให้กู้ไม่ใช่การเดา |
| C. R2 ไฟล์แนบหาย | 2/10 (ต่ำสุด) | **2.5/10** | ยังไม่มี copy ที่สอง (คะแนนตัวเอกสารขึ้นเพราะ: วัดขนาดจริง = 1 ACTIVE object, ต้นทุน ≈ $0, ทางเลือก A-D ชัดพร้อมคำแนะนำ) — ขึ้นเป็น 6-7/10 ได้เมื่อ rclone ทุกคืน implement จริง |
| D. Deploy พลาด | 6/10 | 6.5/10 | ปิด "regression trap" H2 (list/ids ไม่มี cap) + C1 (Excel fetch ทั้งรอบก่อน cap) — โอกาสเกิด incident CPU-timeout ระหว่างใช้งานหนักลดลง (ข้อมูลจำเพาะใน §3) |
| E. Developer ไม่อยู่ | 3/10 | 3.5/10 | งานของ sprint นี้เป็น "เอกสารสั่งงานได้" ทั้งหมด (activation/drill/runbook) — คนใหม่ทำตามได้โดยไม่ต้องถาม; แต่ escrow account/secrets ยังไม่แตะ (จุดตายเดิมคงเดิม) |

## 3. งาน Sprint 3 ที่หักเข้าคะแนน (หลักฐานโค้ดจริง)

| งาน | ไฟล์ | ผลตรวจ |
|---|---|---|
| แก้บั๊ก jq ของ backup workflow | `.github/workflows/d1-backup.yml` | `d1 execute --json` คืน array จริง (พิสูจน์บน prod) — `.[0].results[0]` แก้แล้ว ไม่งั้น `manifest.facts = null` เงียบ ๆ และ drill ไม่มี baseline |
| Activation checklist | `docs/BACKUP_ACTIVATION_CHECKLIST.md` | secrets/permissions/verification/failure/rollback ครบ 5 หมวด + ผลตรวจ workflow ล่วงหน้า |
| First-run runbook | `docs/FIRST_BACKUP_RUNBOOK.md` | ตอบ "รู้ได้ไงว่าสำเร็จจริง" ด้วย V1-V5 (upload/manifest/checksum/lifecycle/retention) |
| Restore drill execution | `docs/RESTORE_DRILL_EXECUTION.md` | Phase A-D + checkbox ทุกข้อ + ตารางบันทึก RTO + rollback D4 |
| Excel hotspot C1 | `backend/src/services/excel-export.service.ts` | COUNT→CAP→FETCH ทั้ง 2 path; รอบ 1,001 ใบไม่ถูกย้ายเข้า Worker แล้ว (test C1-A พิสูจน์ว่าไม่มี statement ดึง `form_data`); suite 117/117 + fail-before-fix 4 เคส |
| List safety cap H2 | `backend/src/routes/admin.routes.ts` + `backend/src/lib/applications-list-query.ts` | cap 2,000 แบบ limit(cap+1)+422 ทั้ง `GET /applications` (ไม่ส่ง page) และ `/ids`; suite 23/23 + fail-before-fix 2 เคส; FE ทุกจุดใช้ paginated path อยู่แล้ว (ตรวจแล้ว) |
| R2 attachment recovery | `docs/R2_ATTACHMENT_RECOVERY.md` | วัด prod จริง + ทางเลือก A-D + ต้นทุนตาราง |

## 4. เส้นทางขึ้นคะแนนถัดไป (ลำดับความคุ้มค่า)

1. **ทำ activation checklist §3 (30 นาที) → 6.5 กลายเป็นของจริง** — จุดคุ้มสูงสุดต่อเวลา
2. ซ้อม drill Phase A-C หนึ่งครั้ง (20-35 นาที) → B ขึ้น 8/10, readiness ขึ้น 8/10 (ได้ RTO จริงมาแทนค่าประเมิน)
3. rclone copy ไฟล์แนบทุกคืน (งาน ~1 วัน) → C จาก 2.5 ขึ้น 6-7/10 — ปิดช่องเดียวที่ "กู้ไม่ได้เลย"
4. Escrow การเข้าถึง Cloudflare + secrets (สถานการณ์ E) → จุดตายเดียวที่เหลือของทั้งระบบ
