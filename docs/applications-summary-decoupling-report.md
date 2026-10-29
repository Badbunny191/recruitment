# Applications Summary Decoupling — Implementation Report

**Branch:** `feature/applications-pagination-phase1`
**Date:** 2026-10-29
**Status:** Complete (uncommitted, awaiting review)

---

## 1. Files Changed

| File | Change |
|------|--------|
| `frontend/src/app/(admin)/admin/applications/ApplicationsClient.tsx` | Added `summaryError` state; fetchSummary now detects non-OK responses and sets error instead of silently treating 500 as empty data; KpiCard accepts `error` prop and renders `—` placeholder with `data-testid="kpi-error"`; error banner with retry button rendered above KPI grid; filter pill counts hidden when summary errored |
| `frontend/src/components/__tests__/applications-summary-decoupling.test.tsx` | Added 2 new tests: summary 500 → KPI error + table still functional; retry button re-fetches and clears error on success |

**Total:** 2 files, +124 / −8 lines

---

## 2. Tests Added

Two tests appended to the existing Phase 1.2 decoupling suite:

1. **`summary 500 → KPI แสดง error และ table ยัง render/ใช้งานได้`**
   - Stubs summary endpoint to return HTTP 500
   - Asserts all 6 KPI cards have `data-kpi-error="true"` and `data-kpi-loading="false"`
   - Asserts `[data-testid="kpi-error"]` markers present in all cards (no fake zeros)
   - Asserts `[data-testid="kpi-error-banner"]` is rendered
   - Asserts table rows render normally, no spinner stuck
   - Asserts pagination still works (list refetches on page change)
   - Asserts summary is NOT re-fetched on page change (still 1 call total)

2. **`กด "ลองอีกครั้ง" ที่ KPI error → ยิง summary ใหม่และหาย error เมื่อสำเร็จ`**
   - First summary call returns 500, second returns valid data
   - Clicks retry button in error banner
   - Asserts summary called twice total
   - Asserts error banner removed after successful retry
   - Asserts KPI cards show real numbers (42) and no error markers remain

**Full suite result:** 12/12 passed ✓

---

## 3. Before / After Request Flow

### Before (this session's starting point — commit b7e45a92)

```
mount
  ├─ GET /admin/rounds
  ├─ GET /admin/applications?roundId=...&search=...&sort=...&page=1&pageSize=10
  └─ GET /admin/applications/summary?roundId=...     ← separate effect, round-only dep ✓

page change / sort change / search change / pageSize change
  └─ GET /admin/applications?...                     ← list only ✓
  (summary NOT re-fetched)                           ← already correct ✓

summary returns HTTP 500
  └─ res.json() parsed anyway → setSummary(data.data || {total:0, byStatus:{}})
     → KPI silently shows 0 for every status         ← BUG: fake data, no error signal
```

### After (this session)

```
mount / round change
  ├─ GET /admin/applications?...                     ← list (independent)
  └─ GET /admin/applications/summary?roundId=...     ← separate effect, round-only dep

page / sort / search / pageSize change
  └─ GET /admin/applications?...                     ← list only, summary untouched

summary returns HTTP 500
  ├─ setSummaryError("โหลดสถิติไม่สำเร็จ (HTTP 500)")
  ├─ KPI cards render "—" placeholder (data-testid="kpi-error")
  ├─ Error banner shown with retry button
  ├─ Filter pill counts hidden (no stale zeros)
  └─ Table unaffected — renders normally, pagination works

retry button clicked
  └─ fetchSummary() re-called → clears error on success, restores real numbers
```

---

## 4. Before / After Loading Behavior

| Aspect | Before | After |
|--------|--------|-------|
| `summaryLoading` state | Existed, separate from table `loading` ✓ | Unchanged |
| `summaryError` state | Did not exist | Added — `string \| null` |
| KPI during summary load | Skeleton (`data-testid="kpi-skeleton"`) ✓ | Unchanged |
| KPI on summary 500 | Silent: showed `0` for all statuses | Explicit: `—` marker + error banner + retry |
| KPI on summary network error | Silent: logged to console only | Explicit: same error UI as HTTP error |
| Table blocked by summary | No (already decoupled in b7e45a92) ✓ | Unchanged |
| Table blocked by summary error | N/A (error was invisible) | No — table fully independent |
| Filter pill counts during error | Showed stale/fake zeros | Hidden (`undefined`) until summary recovers |
| Retry capability | None | Banner button calls `fetchSummary()` directly |

---

## 5. Regressions Found

**None.** All pre-existing tests continue to pass:

- 10 original Phase 1.2 decoupling tests: ✓
- All other application tests (status filter, list params, list state, selection state, loading gate): ✓
- Full `npm test` chain: exit 0

One behavioral note worth flagging for review: when summary errors, the filter pill counts are now hidden entirely rather than showing potentially stale values from a previous successful fetch. This is intentional (stale counts mislead users into filtering by wrong totals), but it means the pills look "emptier" during an error state. The error banner explains why.

---

## 6. npm test Result

```
TEST_EXIT=0
```

Full chain completed without failure. Last test output confirmed all scenarios passed including the two new summary-error tests.

---

## 7. tsc Result

```
TSC_EXIT=0
```

No type errors. New `summaryError` state, `error` prop on `KpiCard`, and `data-kpi-error` attribute all type-check cleanly against existing interfaces.

---

## Notes for Reviewer

- **No API contract changes.** Same endpoints, same response shapes. Only client-side error handling improved.
- **No migration, no selector model changes, no bulk/export/pdf touches.** Scope strictly limited to summary decoupling gap (error visibility).
- **Not committed, not pushed, not merged.** Working tree has 2 modified files ready for review.
- The original task spec listed 6 required test cases. All 6 were already covered by the existing test file from commit b7e45a92. This session added coverage for the one gap the spec called out implicitly ("summary 500 → KPI error → table still usable") which was previously untested because the implementation silently swallowed errors.
