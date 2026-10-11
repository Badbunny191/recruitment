# RFC: Template Versioning Redesign

**Document Status:** Draft  
**Author:** Development Team  
**Date:** 2026-10-11  
**Version:** 1.0  

---

## 1. Problem Statement

ระบบ Template Versioning ปัจจุบันมีความสับสนในการทำงาน ทำให้ User ไม่เข้าใจว่ากำลังแก้ไข Version ไหนอยู่

### 1.1 ปัญหาหลัก

| # | ปัญหา | ผลกระทบ |
|---|--------|----------|
| 1 | **Save Draft สร้าง Version ใหม่ทุกครั้ง** | User กด Save 3 ครั้ง → ได้ 3 Drafts ที่ถูกทิ้งไว้ |
| 2 | **ไม่มี UPDATE endpoint** | Backend ไม่รองรับการอัปเดต Draft เดิม |
| 3 | **Builder ไม่บอกชัดว่ากำลังแก้ไข Version ไหน** | User งงว่ากำลัง edit v1, v2, หรือ v3? |
| 4 | **Archive/Delete อยู่ผิดที่** | User ลบ Draft โดยไม่รู้ตัว |
| 5 | **Publish vs Save สับสน** | User ไม่แน่ใจว่าต่างกันอย่างไร |

---

## 2. Goals

| # | เป้าหมาย | คำอธิบาย |
|---|----------|----------|
| 1 | **Published = Read Only** | Version ที่ Published แล้ว Lock ห้ามแก้ไข |
| 2 | **Draft = Editable** | Draft เท่านั้นที่แก้ไขได้ |
| 3 | **Save Draft = Update Draft เดิม** | กด Save หลายครั้ง → อัปเดต Draft ตัวเดิม |
| 4 | **Create Draft = สร้าง Version ใหม่** | Clone หรือสร้างใหม่ → Version ที่ 2, 3, 4... |
| 5 | **Builder แสดง Version ที่กำลัง Edit ชัดเจน** | มี Header/Label บอกตลอด "กำลังแก้ไข v2" |
| 6 | **UX ตอบคำถามได้เสมอว่าตอนนี้แก้ Version ไหน** | Status Bar + Version Badge + Header ชัดเจน |

---

## 3. Version State Machine

```
┌─────────────────────────────────────────────────────────────────┐
│                    VERSION STATE MACHINE                          │
└─────────────────────────────────────────────────────────────────┘

     ┌─────────────┐
     │  (ไม่มี)   │
     └──────┬──────┘
            │ สร้าง Draft ใหม่
            ▼
     ┌─────────────┐       ┌─────────────┐
     │   DRAFT     │──────►│  PUBLISHED  │
     │  (แก้ไขได้) │Publish │  (lock แล้ว)│
     └─────────────┘       └──────┬──────┘
            │                      │
            │                      │ Clone เป็น Draft ใหม่
            │                      ▼
            │              ┌─────────────┐
            │              │   DRAFT     │ (Version ใหม่)
            │              │  (แก้ไขได้) │
            │              └─────────────┘
            │
            ▼
     ┌─────────────┐
     │  ARCHIVED   │◄── Archive
     │ (เก็บไว้)  │
     └─────────────┘
```

---

## 4. User Journeys

### 4.1 Flow 1: สร้าง Template ใหม่ทั้งหมด

```
1. หน้า Templates → กด "สร้าง Template ใหม่"
2. กรอกชื่อ/คำอธิบาย → บันทึก
3. เข้า Builder → ยังไม่มี Draft
   └─ แสดง: "กด + เพิ่ม Section เพื่อเริ่มต้น"
4. กด + Section → ตั้งชื่อ "ข้อมูลส่วนตัว"
5. เพิ่ม Field ต่างๆ
6. กด Save Draft (ครั้งที่ 1)
   └─ POST /admin/templates/:id/versions
   └─ สร้าง Draft v1 (Version แรก)
7. แก้ไขต่อ → กด Save Draft (ครั้งที่ 2)
   └─ PUT /admin/template-versions/:id
   └─ อัปเดต Draft v1 (ไม่ใช่สร้าง v2 ใหม่!)
8. พร้อม → กด Publish
   └─ PATCH /admin/template-versions/:id/publish
   └─ v1 กลายเป็น Published (lock)
9. หน้า Builder แสดง v1 (readonly)
```

### 4.2 Flow 2: แก้ไข Published Template

```
1. หน้า Builder แสดง Published v1 (readonly)
2. กด "แก้ไข Template" หรือ "สร้าง Draft ใหม่"
   └─ Confirm: "จะสร้าง Draft v2 จาก Published v1"
3. ยืนยัน → POST /admin/templates/:id/versions
   └─ พร้อม cloneFromVersionId: "v1-id"
   └─ สร้าง Draft v2 (copy ทุกอย่างจาก v1)
4. Builder แสดง Draft v2 (กำลังแก้ไข)
5. แก้ไข → Save → Publish
6. v2 กลายเป็น Published
7. v1 กลายเป็น Archived (ถ้าไม่มี round กำลังใช้)
```

### 4.3 Flow 3: กลับมาแก้ไข Draft ที่ยังไม่ Published

```
1. เปิดหน้า Builder
2. GET /admin/templates/:id/versions
   └─ พบ Draft v3 อยู่
3. Builder แสดง Draft v3 (กำลังแก้ไข)
4. แก้ไข → กด Save Draft
   └─ PUT /admin/template-versions/:id
   └─ อัปเดต Draft v3 (ไม่ใช่สร้าง v4!)
5. พร้อม → กด Publish
```

---

## 5. API Design

### 5.1 Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/templates/:id/versions` | ดึงรายการ versions ทั้งหมด |
| GET | `/admin/template-versions/:id` | ดึง version พร้อม sections + fields |
| POST | `/admin/templates/:id/versions` | สร้าง Draft ใหม่ (Mode A: ว่าง, Mode B: clone) |
| **PUT** | `/admin/template-versions/:id` | **อัปเดต Draft เดิม** ⭐ NEW |
| PATCH | `/admin/template-versions/:id/publish` | Publish Draft → Published |
| PATCH | `/admin/template-versions/:id/archive` | Archive Published |
| DELETE | `/admin/template-versions/:id` | ลบ Draft (ถ้าไม่มี round ใช้งาน) |

### 5.2 PUT /admin/template-versions/:id (NEW)

**Request:**
```json
{
  "sections": [
    { "tempId": "temp-xxx", "name": "ข้อมูลส่วนตัว", "displayOrder": 1 }
  ],
  "fields": [
    {
      "fieldId": "uuid-xxx",
      "sectionId": "uuid-xxx",
      "displayOrder": 1,
      "isRequired": true,
      "overrideLabelTh": null,
      "overrideOptions": null
    }
  ]
}
```

**Behavior:**
1. DELETE existing template_sections WHERE templateVersionId = :id
2. DELETE existing template_fields WHERE templateVersionId = :id
3. INSERT new template_sections
4. INSERT new template_fields
5. UPDATE template_versions SET updatedAt = NOW()

**Response:**
```json
{
  "success": true,
  "versionId": "uuid-xxx",
  "versionNumber": 2
}
```

### 5.3 POST /admin/templates/:id/versions (Update)

**Request (Mode A: ว่าง):**
```json
{
  "templateId": "uuid-xxx"
}
```

**Request (Mode B: Clone):**
```json
{
  "templateId": "uuid-xxx",
  "cloneFromVersionId": "uuid-published"
}
```

**Behavior (Mode A):**
- สร้าง Version ใหม่ (DRAFT)
- ไม่มี sections/fields (ว่างเปล่า)

**Behavior (Mode B):**
- สร้าง Version ใหม่ (DRAFT)
- Copy sections + fields จาก source version
- Map sectionId ด้วย UUID ใหม่

---

## 6. Frontend State Management

### 6.1 State Variables

```typescript
interface BuilderState {
  // Versions list
  versions: TemplateVersion[];
  
  // Current editing
  currentVersionId: string | null;      // Version ที่กำลังแก้ไข
  currentVersionStatus: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  
  // Draft reference
  draftVersionId: string | null;         // Draft version ล่าสุด
  
  // Published reference  
  publishedVersionId: string | null;     // Published version ล่าสุด
  
  // Form data (local)
  formData: {
    sections: Section[];
    fields: Field[];
  };
  
  // Dirty state
  hasUnsavedChanges: boolean;
}
```

### 6.2 Logic ตอนโหลด

```typescript
const loadVersions = async () => {
  const versions = await fetchVersions();
  
  const draftVersions = versions.filter(v => v.status === 'DRAFT');
  const publishedVersions = versions.filter(v => v.status === 'PUBLISHED');
  
  const latestDraft = draftVersions.sort(byVersionDesc)[0];
  const latestPublished = publishedVersions.sort(byVersionDesc)[0];
  
  if (latestDraft) {
    // มี Draft อยู่ → โหลด Draft มาแก้ไข
    setCurrentVersionId(latestDraft.id);
    setCurrentVersionStatus('DRAFT');
    await loadFields(latestDraft.id);
  } else if (latestPublished) {
    // ไม่มี Draft แต่มี Published → แสดง Published (readonly)
    setCurrentVersionId(latestPublished.id);
    setCurrentVersionStatus('PUBLISHED');
    await loadFields(latestPublished.id);
  } else {
    // ไม่มี Version ใดๆ → สร้าง Draft ใหม่
    await createNewDraft();
  }
};
```

### 6.3 Logic ตอน Save

```typescript
const onSaveDraft = async (formData) => {
  if (draftVersionId) {
    // ✅ มี Draft อยู่แล้ว → UPDATE
    await updateDraftVersion(draftVersionId, formData);
  } else {
    // ❌ ไม่มี Draft → CREATE ใหม่
    const newVersion = await createDraftVersion(templateId, formData);
    setDraftVersionId(newVersion.id);
    setCurrentVersionId(newVersion.id);
  }
  setHasUnsavedChanges(false);
};
```

---

## 7. UI Design

### 7.1 Status Bar (บนสุด)

```
┌─────────────────────────────────────────────────────────────────┐
│  🟢 Published: v3 (10 ต.ค. 2569)    📝 Draft: v4 (แก้ไขล่าสุด) │
│                                                                  │
│  สถานะ: กำลังแก้ไข Draft v4 · มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Action Bar

```
┌─────────────────────────────────────────────────────────────────┐
│  [+ เพิ่ม Section]  [💾 Save Draft]  [🔵 Publish v4]           │
└─────────────────────────────────────────────────────────────────┘
```

**หลักการ:**
- **Save Draft** = บันทึกการเปลี่ยนแปลง (Update Draft เดิม)
- **Publish** = เผยแพร่ Draft ที่พร้อม

### 7.3 Version History (ซ่อน/แสดงได้)

```
┌─ Version History ─────────────────────────────────────────────┐
│  [▼ ซ่อน]  [🔼 แสดง]                                          │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 📝 v4 · Draft · กำลังแก้ไขอยู่           สร้าง: วันนี้    │ │
│  │ [View] [Save Draft] [Publish] [Delete]                      │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 🟢 v3 · Published · ✅                      สร้าง: 10 ต.ค. │ │
│  │ [View] [Clone เป็น Draft ใหม่]                              │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ ⚪ v2 · Archived                      สร้าง: 5 ต.ค.        │ │
│  │ [View] [Clone เป็น Draft ใหม่]                              │ │
│  └─────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

### 7.4 Builder Header

```
┌─────────────────────────────────────────────────────────────────┐
│  Template: สมัครงาน HR                    [← กลับ] [Admin]      │
├─────────────────────────────────────────────────────────────────┤
│  📝 กำลังแก้ไข Draft v4                                          │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  สถานะ: Draft (แก้ไขได้)  ·  มีการเปลี่ยนแปลงที่ยังไม่บันทึก │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 7.5 กรณีต่างๆ

**กรณี 1: มี Published + มี Draft**
```
┌─────────────────────────────────────────────────────────────────┐
│  🟢 Published: v3        📝 Draft: v4 (แก้ไขล่าสุด)             │
│                                                                  │
│  [💾 Save Draft]  [🔵 Publish v4]                               │
│                                                                  │
│  📝 กำลังแก้ไข Draft v4                                         │
└─────────────────────────────────────────────────────────────────┘
```

**กรณี 2: มี Published + ไม่มี Draft**
```
┌─────────────────────────────────────────────────────────────────┐
│  🟢 Published: v3        📝 Draft: ไม่มี                       │
│                                                                  │
│  [📋 สร้าง Draft ใหม่]  [📋 Clone v3 เป็น Draft]               │
│                                                                  │
│  🟢 กำลังดู Published v3 (🔒 อ่านอย่างเดียว)                   │
└─────────────────────────────────────────────────────────────────┘
```

**กรณี 3: ไม่มี Published + มี Draft**
```
┌─────────────────────────────────────────────────────────────────┐
│  🟢 Published: ไม่มี        📝 Draft: v1 (แก้ไขล่าสุด)         │
│                                                                  │
│  [💾 Save Draft]  [🔵 Publish v1]                              │
│                                                                  │
│  📝 กำลังแก้ไข Draft v1 (Version แรก)                           │
└─────────────────────────────────────────────────────────────────┘
```

**กรณี 4: ไม่มี Published + ไม่มี Draft (Template ว่าง)**
```
┌─────────────────────────────────────────────────────────────────┐
│  🟢 Published: ไม่มี        📝 Draft: ไม่มี                   │
│                                                                  │
│  [+ เพิ่ม Section]  [💾 Save Draft]  [🔵 Publish]              │
│                                                                  │
│  ⚠️ ยังไม่มี Draft · กด + เพิ่ม Section เพื่อเริ่มต้น         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Key UX Principles

### 8.1 "ตอนนี้กำลังแก้ไข Version ไหน?"

| ต้องแสดง | ตำแหน่ง | ตัวอย่าง |
|---------|--------|----------|
| **Version ที่กำลังแก้ไข** | Header ด้านบน | "กำลังแก้ไข Draft v4" |
| **สถานะ** | Header ด้านบน | "Draft (แก้ไขได้)" หรือ "Published (🔒 อ่านอย่างเดียว)" |
| **Published ล่าสุด** | Status Bar | "Latest Published: v3" |
| **Current Draft** | Status Bar | "Current Draft: v4" |
| **Badge** | ทุก Version | v4 [Draft] [กำลังแก้ไข] |

### 8.2 Save vs Publish

| ปุ่ม | ความหมาย | ผลลัพธ์ |
|------|----------|---------|
| **Save Draft** | บันทึกการเปลี่ยนแปลง | Update Draft เดิม (ไม่สร้าง Version ใหม่) |
| **Publish** | เผยแพร่ Draft ที่พร้อม | Draft → Published (lock) |

### 8.3 ไม่ควรมี

- ❌ Archive/Delete ใน Action Bar (ย้ายไป Version History)
- ❌ ปุ่ม Clone ทุก Version (มีปุ่ม "สร้าง Draft ใหม่" ที่ Status Bar)
- ❌ คำว่า "Save as Draft" (เพราะมันสร้าง Version ใหม่ทุกครั้ง ซึ่งผิด)

---

## 9. Backend Changes Required

### 9.1 เพิ่ม PUT Endpoint

```typescript
// src/routes/admin.routes.ts

adminRoutes.put('/templates/:templateId/versions/:versionId', 
  auditMiddleware('TEMPLATE_VERSION'),
  async (c) => {
    const db = drizzle(c.env.DB);
    const { templateId, versionId } = c.req.param();
    const payload = c.req.valid('json');

    // Verify version exists and is DRAFT
    const version = await db.select()
      .from(templateVersions)
      .where(eq(templateVersions.id, versionId))
      .get();

    if (!version) {
      return c.json({ error: 'Version not found' }, 404);
    }

    if (version.status !== 'DRAFT') {
      return c.json({ error: 'Can only update DRAFT version' }, 400);
    }

    // Delete existing sections/fields
    await db.delete(templateSections)
      .where(eq(templateSections.templateVersionId, versionId));
    await db.delete(templateFields)
      .where(eq(templateFields.templateVersionId, versionId));

    // Insert new sections
    const sectionIdMap = new Map<string, string>();
    for (const s of payload.sections) {
      const newSectionId = uuidv4();
      sectionIdMap.set(s.tempId, newSectionId);
      await db.insert(templateSections).values({
        id: newSectionId,
        templateVersionId: versionId,
        name: s.name,
        displayOrder: s.displayOrder,
        isActive: true,
        createdAt: sql`(unixepoch())`,
        updatedAt: sql`(unixepoch())`,
      });
    }

    // Insert new fields
    for (const f of payload.fields) {
      const realSectionId = f.sectionId 
        ? (sectionIdMap.get(f.sectionId) ?? null) 
        : null;
      
      await db.insert(templateFields).values({
        id: uuidv4(),
        templateVersionId: versionId,
        fieldId: f.fieldId,
        sectionId: realSectionId,
        displayOrder: f.displayOrder,
        isRequired: f.isRequired,
        // ... other fields
      });
    }

    // Update version timestamp
    await db.update(templateVersions)
      .set({ updatedAt: sql`(unixepoch())` })
      .where(eq(templateVersions.id, versionId));

    return c.json({ 
      success: true, 
      versionId,
      versionNumber: version.versionNumber 
    });
  }
);
```

---

## 10. Frontend Changes Required

### 10.1 แยก Create vs Update

```typescript
const onSaveDraft = async (data: FormValues) => {
  setSubmitting(true);
  
  try {
    const payload = buildPayload(data);
    
    if (draftVersionId) {
      // ✅ Mode: UPDATE existing Draft
      const res = await fetch(
        `${API_URL}/admin/templates/${templateId}/versions/${draftVersionId}`,
        {
          method: 'PUT',  // ⭐ เปลี่ยนจาก POST เป็น PUT
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
    } else {
      // ✅ Mode: CREATE new Draft
      const res = await fetch(
        `${API_URL}/admin/templates/${templateId}/versions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateId, ...payload }),
        }
      );
      
      const result = await res.json();
      setDraftVersionId(result.versionId);
      setCurrentVersionId(result.versionId);
    }
    
    setHasUnsavedChanges(false);
    await loadAll(); // Reload versions list
    
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  } finally {
    setSubmitting(false);
  }
};
```

### 10.2 แสดงสถานะชัดเจน

```tsx
// Header แสดง Version ที่กำลังแก้ไข
<div className="version-header">
  {currentVersionStatus === 'DRAFT' && (
    <>
      <Badge variant="warning">📝 Draft v{currentVersion.versionNumber}</Badge>
      <span>กำลังแก้ไขอยู่</span>
      {hasUnsavedChanges && <Badge variant="outline">มีการเปลี่ยนแปลงที่ยังไม่บันทึก</Badge>}
    </>
  )}
  {currentVersionStatus === 'PUBLISHED' && (
    <>
      <Badge variant="success">🟢 Published v{currentVersion.versionNumber}</Badge>
      <span>🔒 อ่านอย่างเดียว</span>
    </>
  )}
</div>
```

---

## 11. Migration Plan

### Phase 1: Backend
1. เพิ่ม PUT `/admin/template-versions/:id` endpoint
2. เพิ่ม validation ว่า PUT ได้เฉพาะ DRAFT version
3. Test PUT flow

### Phase 2: Frontend
1. เปลี่ยน `onSaveDraft` ให้รู้จัก Create vs Update
2. เพิ่ม `hasUnsavedChanges` state
3. เปลี่ยน Status Bar ให้แสดงสถานะชัดเจน
4. ย้าย Archive/Delete ไป Version History

### Phase 3: Testing
1. Test Flow 1: สร้าง Template ใหม่
2. Test Flow 2: แก้ไข Published
3. Test Flow 3: กลับมาแก้ไข Draft
4. Test Edge Cases

---

## 12. Open Questions

| # | คำถาม | Options |
|---|--------|---------|
| 1 | ถ้ามี Draft หลายตัว (กรณีพิเศษ) ควรโหลดตัวไหน? | โหลด Draft ล่าสุด / แจ้ง error ให้ลบก่อน |
| 2 | Archive ควรเกิดขึ้นอัตโนมัติเมื่อ Publish version ใหม่หรือไม่? | ใช่ อัตโนมัติ / ไม่ต้อง / ถาม user |
| 3 | Version ที่มี Round กำลังใช้งานสามารถ Archive ได้หรือไม่? | ได้เลย / ไม่ได้จนกว่า round จะจบ |

---

## 13. Appendix: Current vs Proposed

| Aspect | Current | Proposed |
|--------|---------|----------|
| **Save Draft** | POST (สร้าง Version ใหม่) | PUT (อัปเดต Draft เดิม) |
| **Create Draft** | POST | POST พร้อม `{ templateId }` |
| **Clone** | POST พร้อม `{ cloneFromVersionId }` | คงเดิม |
| **Status Bar** | ซ้ำซ้อนกับ Version History | ชัดเจน + บอกว่ากำลังแก้ไขอะไร |
| **Archive/Delete** | Action Bar | Version History |
| **Builder Header** | ไม่บอก version | "กำลังแก้ไข Draft v4" |

---

## 14. Approval

| Role | Name | Status | Date |
|------|------|--------|------|
| Author | Dev Team | ✅ Draft | 2026-10-11 |
| Backend | | ⏳ Pending | |
| Frontend | | ⏳ Pending | |
| PM | | ⏳ Pending | |

---

**Next Steps:**
1. Review โดย Backend/Frontend teams
2. Approve หรือ Request Changes
3. Implement Phase 1 (Backend PUT endpoint)
4. Implement Phase 2 (Frontend logic)
5. UAT
