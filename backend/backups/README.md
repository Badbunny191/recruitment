# backend/backups/

## 📦 Database Backup Storage

โฟลเดอร์นี้ใช้เก็บ full database backup ที่ export ด้วย:

```bash
wrangler d1 export sao-db /tmp/backup-pre-YYYYMMDD_HHMMSS.sql --remote
```

---

## 🔴 กฎสำคัญ

### ห้าม Commit ไฟล์ Backup ที่มี Production Credentials

- ไฟล์ backup ที่ export จาก production อาจมี seed data ที่มี default credentials
- ก่อน commit ต้อง scrub:
  - default admin password
  - default email
  - API keys
  - session tokens
  - user PII

### ใช้ .gitignore

ไฟล์ backup ส่วนใหญ่ควรอยู่ใน `.gitignore` ยกเว้นกรณีที่ต้องการเก็บเป็น historical record

---

## 📁 ไฟล์ที่มีอยู่

*(ยังไม่มี — โฟลเดอร์นี้ถูกสร้างขึ้นเพื่อรองรับ backup ในอนาคต)*

---

## ✅ Backup Best Practices

### ทำ Backup ก่อนทุก Production Migration

```bash
# 1. ตั้งชื่อไฟล์ด้วย timestamp
BACKUP_FILE="/tmp/backup-pre-$(date +%Y%m%d_%H%M%S).sql"

# 2. Export
wrangler d1 export sao-db "$BACKUP_FILE" --remote

# 3. เก็บใน R2 (long-term storage)
wrangler r2 object put sao-storage/backups/$(basename "$BACKUP_FILE") --file="$BACKUP_FILE"

# 4. Verify backup ก่อน apply migration
wrangler d1 execute sao-db --remote --command="SELECT COUNT(*) FROM sqlite_master WHERE type='table';"
```

### Backup Schedule

| Frequency | Owner | Destination |
|---|---|---|
| Pre-migration (manual) | DevOps / Releaser | R2 |
| Daily (cron) | DevOps | R2 |
| Weekly (manual export) | DevOps | Local NAS |

### Retention Policy

- R2: เก็บ 90 วัน
- Local: เก็บ 7 วัน
- Quarterly snapshot: เก็บถาวร

---

## 🔄 Restore Procedure

```bash
# 1. Download backup จาก R2
wrangler r2 object get sao-storage/backups/<file>.sql /tmp/restore.sql

# 2. Verify file integrity
wc -l /tmp/restore.sql
head -20 /tmp/restore.sql

# 3. Restore ไปยัง D1
wrangler d1 execute sao-db --remote --file=/tmp/restore.sql

# 4. Verify
wrangler d1 execute sao-db --remote --command="SELECT COUNT(*) FROM applications;"
```

---

## 📚 เอกสารเพิ่มเติม

- [Migration Governance Policy](../../docs/MIGRATION_GOVERNANCE.md)
- [Production Readiness Report](../../docs/PRODUCTION_READINESS_REPORT.md)

---

**หากพบปัญหาในการ backup/restore กรุณาเปิด incident ใน #production-support**
