# Drizzle Migration Archive (Legacy)

> **สถานะ:** FROZEN — ห้ามแก้ไข (Read Only Historical Archive)
>
> **Production Source of Truth:** [`backend/migrations`](../migrations)

---

## สถานะ

⚠️ โฟลเดอร์นี้เป็น Historical Archive

ไม่ใช่ Production Source of Truth

ปัจจุบันระบบใช้งาน

```
backend/migrations
```

เป็น Migration Source of Truth อย่างเป็นทางการ

---

## วัตถุประสงค์

โฟลเดอร์นี้ถูกเก็บไว้เพื่อ

- อ้างอิงประวัติ migration ในอดีต
- ตรวจสอบย้อนหลัง (Audit)
- เปรียบเทียบ schema
- ใช้ประกอบการวิเคราะห์ปัญหา migration เดิม
- ติดตามที่มาของ table/column definitions เฉพาะจุด

**โฟลเดอร์นี้ไม่ใช่ Production Migration Source**

---

## Source of Truth ปัจจุบัน

Production Migration Source of Truth อย่างเป็นทางการคือ

```
backend/migrations
```

Migration ใหม่ การเปลี่ยนแปลง schema และการ deploy production ทั้งหมด **ต้อง** ดำเนินการผ่านโฟลเดอร์ดังกล่าว

ดูนโยบาย Governance ฉบับเต็มได้ที่ [`docs/MIGRATION_GOVERNANCE.md`](../../../docs/MIGRATION_GOVERNANCE.md) และ [`docs/MIGRATION_AUDIT_2026.md`](../../../docs/MIGRATION_AUDIT_2026.md)

---

## สิ่งที่อนุญาต

การใช้งานแบบอ่านอย่างเดียว (Read Only) ที่อนุญาตให้ทำได้

- ✅ อ่านเพื่อศึกษา
- ✅ ตรวจสอบประวัติ migration
- ✅ เปรียบเทียบ schema
- ✅ ใช้อ้างอิงระหว่างการ Audit
- ✅ อ้างถึงประวัติ migration ในเอกสารหรือรายงาน Incident

---

## สิ่งที่ห้ามทำ

การกระทำต่อไปนี้ **ห้ามทำโดยเด็ดขาด** ในโฟลเดอร์นี้

- ❌ ห้ามสร้าง migration ใหม่ในโฟลเดอร์นี้
- ❌ ห้าม generate migration ใหม่จาก Drizzle มาที่นี่
- ❌ ห้ามแก้ไขไฟล์ migration เดิม
- ❌ ห้าม rename ไฟล์ migration เดิม
- ❌ ห้ามลบไฟล์ migration เดิม
- ❌ ห้ามเพิ่ม snapshot file ใหม่
- ❌ ห้ามแก้ไข `meta/_journal.json`
- ❌ ห้ามแก้ไข `meta/*_snapshot.json` ไฟล์ใด ๆ
- ❌ ห้ามนำไปใช้ deploy production
- ❌ ห้ามรัน migration apply tooling กับโฟลเดอร์นี้
- ❌ ห้ามใช้โฟลเดอร์นี้เป็น Source of Truth
- ❌ ห้ามพัฒนา migration ใหม่ภายในโฟลเดอร์นี้
- ❌ ห้าม import หรืออ้างอิงโฟลเดอร์นี้จาก runtime migration runners

ไฟล์ทั้งหมดภายใต้ `backend/drizzle/**` ถูก **freeze และห้ามแก้ไข** ยกเว้นไฟล์ `README.md` นี้

---

## Historical Note

Production ได้ย้ายไปใช้

```
backend/migrations
```

เป็น Source of Truth อย่างเป็นทางการสำหรับการเปลี่ยนแปลง database schema ทั้งหมดแล้ว

Drizzle folder ถูก **freeze** และถือเป็น **read-only archive** ตลอดอายุโครงการที่เหลือ

หากต้องการเข้าใจสถานะ schema ในอดีต ให้เริ่มจากที่นี่

หากต้องการเปลี่ยนแปลง schema ใหม่ ให้ไปที่ [`backend/migrations`](../migrations) และปฏิบัติตามกระบวนการ governance ที่ระบุใน [`docs/MIGRATION_GOVERNANCE.md`](../../../docs/MIGRATION_GOVERNANCE.md)

---

## เนื้อหาภายใน Archive

Archive นี้ประกอบด้วย

- ไฟล์ `.sql` migration ที่สร้างจาก Drizzle (ประวัติ)
- `meta/_journal.json` — migration journal ภายในของ Drizzle (frozen)
- `meta/*_snapshot.json` — Drizzle schema snapshot ณ จุดเวลาของแต่ละ migration (frozen)

> ⚠️ **คำเตือน:** ไฟล์เหล่านี้สอดคล้องกับ workflow ของ Drizzle tooling ในช่วงพัฒนาซึ่งถูกแทนที่ไปแล้ว ห้ามตีความลำดับ หมายเลข หรือชื่อใน journal ว่าเป็นข้อมูลทางการสำหรับ production schema ปัจจุบัน ให้ตรวจสอบกับ [`backend/migrations`](../migrations) และ production ledger เสมอ
