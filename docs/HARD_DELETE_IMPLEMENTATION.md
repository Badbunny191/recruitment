# Hard Delete for Master Data - Implementation Summary

## Overview
This document summarizes the changes made to implement hard delete functionality for Master Data management.

## Requirements Summary

| Entity | Delete Type | FK Check | Confirm Dialog |
|--------|-------------|----------|----------------|
| Organizations | Soft Delete (no change) | N/A | No Delete button |
| Job Families | **Hard Delete** | ✅ Check positions | Yes |
| Position Levels | **Hard Delete** | ✅ Check positions | Yes |
| Positions | **Hard Delete** | ❌ No FK | Yes |

## Files Modified

### Backend (`backend/src/routes/admin.routes.ts`)

#### 1. Job Families (lines ~1850-1900)
- **Changed**: DELETE endpoint from soft delete to **hard delete**
- **Added**: FK check from `positions` table
- **Error message**: Thai language
```
ไม่สามารถลบ Job Family "{name}" ได้ เนื่องจากมี Position ที่อ้างอิงถึงอยู่ {count} รายการ
```

#### 2. Position Levels (lines ~1970-2000)
- **Changed**: DELETE endpoint from soft delete to **hard delete**
- **Added**: FK check from `positions` table
- **Error message**: Thai language
```
ไม่สามารถลบ Position Level "{name}" ได้ เนื่องจากมี Position ที่อ้างอิงถึงอยู่ {count} รายการ
```

#### 3. Positions (lines ~2100-2120)
- **Changed**: DELETE endpoint from soft delete to **hard delete**
- **No FK check** (no tables reference positions)

#### 4. Organizations
- **No changes** - remains soft delete only
- **No Delete button** in UI

### Frontend

#### 1. `MasterListPage.tsx`
- Added `allowDelete` config option (default: false)
- Added `entityNameThForDelete` config option for delete dialog
- Added delete button (red, only shown when `allowDelete: true`)
- Added confirmation dialog with warning message

#### 2. `job-families/page.tsx`
- Added `allowDelete: true`

#### 3. `position-levels/page.tsx`
- Added `allowDelete: true`

#### 4. `positions/page.tsx`
- Added delete button (custom page, not using MasterListPage)
- Added confirmation dialog

#### 5. `organizations/page.tsx`
- **No changes** - no delete button (uses enable/disable only)

## API Changes

### DELETE /admin/job-families/:id
**Before**: Soft delete (set isActive=false)
**After**: Hard delete with FK check

**Success Response (200)**:
```json
{ "success": true }
```

**Error Response (400)** - Has references:
```json
{
  "error": "ไม่สามารถลบ Job Family \"Engineering\" ได้ เนื่องจากมี Position ที่อ้างอิงถึงอยู่ 5 รายการ",
  "referenceCount": 5,
  "references": "positions"
}
```

### DELETE /admin/position-levels/:id
**Before**: Soft delete (set isActive=false)
**After**: Hard delete with FK check

**Success Response (200)**:
```json
{ "success": true }
```

**Error Response (400)** - Has references:
```json
{
  "error": "ไม่สามารถลบ Position Level \"Senior\" ได้ เนื่องจากมี Position ที่อ้างอิงถึงอยู่ 3 รายการ",
  "referenceCount": 3,
  "references": "positions"
}
```

### DELETE /admin/positions/:id
**Before**: Soft delete (set isActive=false)
**After**: Hard delete (no FK check needed)

**Success Response (200)**:
```json
{ "success": true }
```

### DELETE /admin/organizations/:id
**No changes** - remains soft delete
