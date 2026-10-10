# PHASE 0 & 1: Bug Analysis & Impact Assessment

**Project:** Recruitment System  
**Date:** 2026-10-08  
**Phase:** Stabilization & Impact Analysis (BEFORE Migration)

---

## PHASE 0: BUG FIX REPORT

### Bug #1: `defaultOptions.join is not a function`

**Location:** `frontend/src/app/(public)/apply/page.tsx` (lines 95-115)

**Root Cause:**
```typescript
// API returns JSON string, but code assumes array
options: field.options  // Can be string "[\"opt1\",\"opt2\"]" or array
```

**Fix Required:**
```typescript
const parseOptions = (input: any): string[] => {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') {
    try { return JSON.parse(input); } 
    catch { return []; }
  }
  return [];
};
```

**Status:** ⚠️ Needs Fix

---

### Bug #2: `options.map is not a function`

**Location:** `frontend/src/app/(public)/apply/page.tsx` (line ~120)

**Root Cause:** Same as Bug #1 - `options` can be string or array

**Fix:** Use `parseOptions()` helper before calling `.map()`

**Status:** ⚠️ Needs Fix

---

### Bug #3: File Configuration Not Persisting

**Location:** `backend/src/routes/admin.routes.ts` (line ~25-35)

**Root Cause:**
```typescript
// Only stringifies if truthy - null values not handled
if (data.fileConfig) insertValues.fileConfig = JSON.stringify(data.fileConfig);
```

**Fix Required:**
```typescript
if (data.fileConfig !== undefined) {
  insertValues.fileConfig = data.fileConfig 
    ? JSON.stringify(data.fileConfig) 
    : null;
}
```

**Also in PATCH:**
```typescript
if (data.fileConfig !== undefined) {
  updateValues.fileConfig = data.fileConfig 
    ? JSON.stringify(data.fileConfig) 
    : null;
}
```

**Status:** ⚠️ Needs Fix

---

### Bug #4: Invalid Date Display

**Location:** Multiple files - `rounds/page.tsx`, `page.tsx` (public)

**Root Cause:**
```typescript
// No validation before formatting
new Date(round.closeDate).toLocaleDateString('th-TH')
// Can output "Invalid Date" if value is null/undefined
```

**Fix Required:**
```typescript
const formatDate = (value: any): string => {
  if (!value) return '-';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
};
```

**Status:** ⚠️ Needs Fix

---

### Bug #5: Apply Page Field Types Missing

**Location:** `frontend/src/app/(public)/apply/page.tsx`

**Current:** Only handles TEXT, TEXTAREA, DROPDOWN, FILE

**Missing:**
- NUMBER
- DATE
- CHECKBOX
- RADIO

**Fix:** Add render cases for all 8 field types

**Status:** ⚠️ Needs Fix

---

### Bug #6: Template Builder Missing Validation Support

**Location:** `frontend/src/app/(admin)/admin/templates/builder/TemplateBuilderClient.tsx`

**Missing:**
- `helpText` - not sent to API
- `placeholder` - not sent to API
- `validationRules` - not supported

**Fix:** Add these fields to payload in `onSubmit`

**Status:** ⚠️ Needs Fix

---

## PHASE 1: IMPACT ANALYSIS

### 1. Tables Affected

| Table | Current | New Architecture | Impact |
|-------|---------|------------------|--------|
| `templates` | No status column | Add `status` (ACTIVE/INACTIVE/ARCHIVED) | **HIGH** |
| `template_versions` | status: DRAFT/PUBLISHED/ARCHIVED | status: CURRENT/DRAFT/ARCHIVED | **HIGH** |
| `template_fields` | Basic fields | No change | **LOW** |
| `recruitment_rounds` | `templateVersionId` | `templateId` + `snapshotData` | **CRITICAL** |
| `applications` | No change | No change | **NONE** |
| `audit_logs` | No change | No change | **NONE** |

---

### 2. Existing Data Migration Required

#### Migration 1: Template Versions
```sql
-- Update PUBLISHED -> CURRENT
UPDATE template_versions SET status = 'CURRENT' WHERE status = 'PUBLISHED';
```

#### Migration 2: Recruitment Rounds
```sql
-- Add new columns
ALTER TABLE recruitment_rounds ADD COLUMN template_id TEXT;
ALTER TABLE recruitment_rounds ADD COLUMN snapshot_version_id TEXT;
ALTER TABLE recruitment_rounds ADD COLUMN snapshot_data TEXT DEFAULT '[]';

-- Migrate data from templateVersions to templates
UPDATE recruitment_rounds 
SET template_id = (
  SELECT templateId FROM template_versions 
  WHERE id = recruitment_rounds.templateVersionId
);

-- Create snapshot data (requires application code)
-- snapshot_data = JSON of fields from templateVersion
```

#### Migration 3: Templates Status
```sql
ALTER TABLE templates ADD COLUMN status TEXT DEFAULT 'ACTIVE';
```

---

### 3. Existing API Impact

| Endpoint | Method | Impact | Action |
|----------|--------|--------|--------|
| `/admin/templates` | GET | **LOW** | Add `currentVersionNumber`, `hasDraft` fields |
| `/admin/templates/:id/versions` | GET | **MEDIUM** | Deprecated, replace with `GET /admin/templates/:id` |
| `/admin/templates/:id/versions` | POST | **HIGH** | Replace with `POST /admin/templates/:id/draft` |
| `/admin/rounds` | POST | **CRITICAL** | Accept `templateId`, create snapshot |
| `/admin/rounds/:id` | PATCH | **LOW** | No change needed |
| `/public/rounds/:id/schema` | GET | **HIGH** | Return `snapshotData` directly |
| `/admin/applications/:id` | GET | **MEDIUM** | Use `snapshotData` for schema |

---

### 4. Frontend Pages Affected

| Page | Impact | Changes Required |
|------|--------|------------------|
| `/admin/templates` | **MEDIUM** | Show version number + draft badge |
| `/admin/templates/builder` | **CRITICAL** | Full rewrite: Current + Draft workflow |
| `/admin/rounds` | **HIGH** | Use templateId instead of templateVersionId |
| `/admin/fields` | **LOW** | Already working |
| `/admin/applications` | **LOW** | Already working |
| `/apply` | **HIGH** | Handle new schema structure |
| `/` (public) | **LOW** | Already working |

---

### 5. Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Existing applications broken during migration | **CRITICAL** | HIGH | Test with existing data first |
| Round loses snapshot if migration fails | **HIGH** | MEDIUM | Backup before migration |
| Template loses version history | **MEDIUM** | LOW | Document current state |
| Frontend breaks if API format changes | **HIGH** | HIGH | Maintain backward compatibility where possible |
| File upload breaks after schema change | **MEDIUM** | MEDIUM | Test file upload thoroughly |

---

### 6. Rollback Plan

1. **Before Migration:**
   - Backup database (full SQL dump)
   - Document current state of all tables
   - Test in staging environment

2. **Migration Steps (with checkpoints):**
   ```
   Step 1: Backup DB
   Step 2: Add columns (backward compatible)
   Step 3: Migrate template_versions status
   Step 4: Migrate recruitment_rounds data
   Step 5: Deploy new API (backward compat mode)
   Step 6: Deploy new Frontend
   Step 7: Remove old columns (after verification)
   ```

3. **If Rollback Needed:**
   - Restore from backup
   - Revert API to old version
   - Revert Frontend to old version

---

## PHASE 2: ARCHITECTURE VALIDATION

### snapshotData Structure (FINAL)

```typescript
interface SnapshotField {
  // Identity
  fieldId: string;           // From Field Master
  
  // Display
  label: string;              // overrideLabelTh || labelTh
  helpText?: string | null;
  placeholder?: string | null;
  displayOrder: number;
  
  // Type & Options
  type: FieldType;           // TEXT, DROPDOWN, FILE, etc.
  options?: string[] | null; // For DROPDOWN, RADIO
  
  // Validation
  isRequired: boolean;
  validationType?: string | null;
  validationMessage?: string | null;
  validationRules?: Record<string, any> | null;
  
  // File Config (only for FILE type)
  fileConfig?: {
    allowedFileTypes?: string[];
    maxFiles?: number;
    maxSizeMB?: number;
  } | null;
}
```

### snapshotData Requirements

| Requirement | Status |
|-------------|--------|
| Round can render form from `snapshotData` alone | ✅ |
| No lookup to Template required | ✅ |
| No lookup to Template Version required | ✅ |
| No lookup to Field Master required | ✅ |
| Immutable after round creation | ✅ |

---

## DELIVERABLE SUMMARY

### 1. Bug Fix Report
- ✅ 6 bugs identified
- ✅ Fixes documented
- **Status: READY TO FIX**

### 2. Impact Analysis
- ✅ Tables analyzed
- ✅ Migration steps documented
- **Status: COMPLETE**

### 3. Migration Plan
- ✅ Step-by-step plan
- ✅ Rollback strategy
- **Status: READY TO EXECUTE**

### 4. Risk Assessment
- ✅ 5 risks identified
- ✅ Mitigations documented
- **Status: COMPLETE**

### 5. Go/No-Go Recommendation

```
┌────────────────────────────────────────────────────────────┐
│                    RECOMMENDATION: GO                      │
│                                                            │
│  Prerequisites:                                            │
│  ✅ Fix all 6 bugs in Phase 0                             │
│  ✅ Test in staging environment                           │
│  ✅ Backup production database                            │
│  ✅ Prepare rollback plan                                  │
│                                                            │
│  Estimated Effort: 8-10 hours                              │
│  - Bug fixes: 2 hours                                     │
│  - Migration & deployment: 3 hours                        │
│  - Testing & verification: 3 hours                        │
│  - Buffer: 2 hours                                       │
└────────────────────────────────────────────────────────────┘
```

---

## NEXT STEPS

### Immediate (Before Any Migration)

1. **Fix Bugs in Current System:**
   - File config handling
   - Date validation
   - Options parsing
   - Apply page field types

2. **Stabilize Current Version:**
   - All templates work
   - All rounds work
   - Apply page works for all field types

### After Stabilization

1. **Execute Migration:**
   - Add new columns (backward compatible)
   - Update API endpoints
   - Update Frontend
   - Remove old columns

2. **Verify:**
   - Existing applications still work
   - New rounds use snapshot
   - Template editing works

---

*Document Version: 1.0*  
*Author: AI Assistant*  
*Status: PENDING USER APPROVAL*
