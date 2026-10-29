# Applications Summary Decoupling — Final Report

**Branch:** `feature/applications-summary-optimization`
**Date:** 2026-10-29
**Status:** Implemented, uncommitted, awaiting review
**Scope:** Frontend only (`ApplicationsClient.tsx` + its test suite)

---

## 0. Starting point (important)

Requirements 1–4 and 6 were **already implemented and committed** on this branch before this
session. Verified by reading the code, not the commit messages:

| Commit | What it did |
|---|---|
| `b5e0e6cf` | Split summary out of `Promise.all` |
| `b7e45a92` | Moved summary into its own effect keyed on round only |
| `f3fcbcdc` | Added `summaryError` + retry banner + `—` placeholder |

So this session's work was: **audit every requirement against the actual code**, find what was
still broken, fix it, and prove it with tests. One real gap was found (requirement 5, see §1).

---

## 1. Files changed (this session)

| File | Change |
|---|---|
| `frontend/src/app/(admin)/admin/applications/ApplicationsClient.tsx` | Pagination footer no longer prints `ไม่พบรายการ` / `แสดง 1-10 จาก N` while the list is still loading. Now shows `กำลังโหลด...` until the list result is real. |
| `frontend/src/components/__tests__/applications-summary-decoupling.test.tsx` | Added test #13 covering the above. |

**Diff:** 2 files, +29 / −5 lines. Nothing else touched.

### The bug that was fixed

Before:

```tsx
{search.trim()
  ? `พบ ${totalItems} รายการ`
  : totalItems === 0
    ? 'ไม่พบรายการ'          // ← shown while list still loading (totalItems defaults to 0)
    : `แสดง ...`}
```

`totalItems` comes from `pagination.total`, which is `0` until the list response lands. So on
every load and every filter change the footer asserted "ไม่พบรายการ" — a false statement — before
any data existed. That is a direct violation of requirement 5.

After:

```tsx
{loading || roundsStatus === 'loading'
  ? 'กำลังโหลด...'
  : search.trim()
    ? `พบ ${totalItems} รายการ`
    : totalItems === 0
      ? 'ไม่พบรายการ'
      : `แสดง ...`}
```

The test was written **first** and confirmed failing (12 passed, 1 failed) before the fix, then
confirmed passing after. Not a test written to match the code.

---

## 2. Tests added

Suite: `frontend/src/components/__tests__/applications-summary-decoupling.test.tsx`
Run: `npm run test:applications-summary-decoupling`

**13 tests, all passing.** Coverage against the required list:

| Required test | Test in suite | Status |
|---|---|---|
| summary ไม่ refetch เมื่อ page เปลี่ยน | `summary ไม่ refetch เมื่อ page เปลี่ยน` | ✅ pre-existing |
| summary ไม่ refetch เมื่อ pageSize เปลี่ยน | `summary ไม่ refetch เมื่อ pageSize เปลี่ยน` | ✅ pre-existing |
| summary ไม่ refetch เมื่อ sort เปลี่ยน | `summary ไม่ refetch เมื่อ sort เปลี่ยน` | ✅ pre-existing |
| summary ไม่ refetch เมื่อ search เปลี่ยน | `summary ไม่ refetch เมื่อ search เปลี่ยน (ผ่าน URL hydrate)` | ✅ pre-existing |
| summary refetch เมื่อ round เปลี่ยน | `summary refetch เมื่อ round เปลี่ยน` | ✅ pre-existing |
| table render ได้ก่อน summary | `table render ได้แม้ summary ยังโหลด` | ✅ pre-existing |
| summary error ไม่ block table | `summary 500 → KPI แสดง error และ table ยัง render/ใช้งานได้` | ✅ pre-existing |
| retry ทำงาน | `กด "ลองอีกครั้ง" ที่ KPI error → ยิง summary ใหม่และหาย error เมื่อสำเร็จ` | ✅ pre-existing |

Additional coverage beyond the required list:

- `effect ของ summary ไม่มี search/sort/page/pageSize ใน dependency` — reads the component source
  and asserts `fetchSummary` deps contain only `selectedRoundId`/`API_URL`, and the effect dep is
  `fetchSummary` alone. Catches a regression that a network-counting test could miss.
- `KPI แสดง skeleton ระหว่างรอ summary แล้วหายเมื่อข้อมูลมา` — asserts zero digits inside KPI
  cards while loading (no fake `0`).
- `KPI แสดงตัวเลขจริงหลัง summary กลับมา (ไม่มี skeleton ค้าง)`
- `KPI loading ไม่ปนกับ loading ของตาราง (แยกกันจริง)` — list pending + summary resolved → KPI
  shows numbers while table still spins.
- **`ระหว่าง list ยังโหลด → footer ต้องไม่สรุป "ไม่พบรายการ"`** ← added this session (requirement 5).

Method note: tests count **real network calls** from a URL-based `fetch` stub rather than
inspecting component state, so they stay valid if internal state names change.

---

## 3. `npm test`

```
EXIT=0
```

Full frontend suite, all green. Per-suite results from the run:

```
25 passed, 0 failed      49 passed, 0 failed      61 passed, 0 failed
16 passed, 0 failed      77 passed, 0 failed      47 passed, 0 failed
25 passed, 0 failed      44 passed, 0 failed      31 passed, 0 failed
20 passed, 0 failed      25 passed, 0 failed
Results: 9 passed, 0 failed      (applications-loading-gate)
Results: 13 passed, 0 failed     (applications-summary-decoupling)
Results: 5 passed, 0 failed      (applications-bulk-selection)
PASS: all 15 / all 8 / all 16 tests passed
Results: 62 passed, 0 failed     Results: 62 passed, 0 failed
Results: 11 passed, 0 failed     Results: 9 passed, 0 failed
ผลรวม: 19 ผ่าน, 0 ล้มเหลว
Total: 11 | Passed: 11 | Failed: 0
ผลรวม: 5 / 2 / 3 passed, 0 failed
```

No failures anywhere.

---

## 4. `tsc --noEmit`

```
TSC_EXIT=0
```

Clean, no output.

---

## 5. Before / after request flow

### Before (original `Promise.all` — commit before `b5e0e6cf`)

```
mount
  └─ Promise.all([
       GET /admin/applications?roundId&search&sort&page&pageSize   ~225 ms
       GET /admin/applications/summary?roundId                     ~600-800 ms
     ])
     → table waits for BOTH → first paint ≈ 600-800 ms

search / sort / page / pageSize change
  └─ Promise.all([ list, summary ])     ← summary re-fetched every time, wasted
```

### After (current branch)

```
mount
  ├─ GET /admin/rounds
  ├─ GET /admin/applications?...        ~225 ms → table renders here
  └─ GET /admin/applications/summary?roundId=...   ~600-800 ms → KPI fills in later

search / sort / page / pageSize change
  └─ GET /admin/applications?...        ← list only. summary NOT re-fetched.

round change
  └─ GET /admin/applications?...  +  GET /admin/applications/summary?roundId=...

status update / bulk status update (success)
  └─ fetchData() + fetchSummary()   ← intentional: KPI numbers actually change
```

Two deliberate `fetchSummary()` calls exist outside the round-change effect: single status update
and bulk status update. Both genuinely change the KPI counts, so refreshing there is correct and
is not one of the forbidden triggers.

---

## 6. Before / after loading behavior

| | Before | After |
|---|---|---|
| Table first paint | waits for summary (~600-800 ms) | as soon as list returns (~225 ms) |
| KPI during list load | blocked by table loading | own skeleton, independent |
| KPI during summary load | n/a (blocked everything) | 6 skeletons, no digits rendered |
| Summary 500 | `json()` parsed anyway → KPI silently showed `0` for every status | `—` in each card + amber banner with retry; table unaffected |
| Summary pending forever | table never rendered | table renders normally; KPI skeleton persists |
| Pagination footer during load | `ไม่พบรายการ` (false) | `กำลังโหลด...` |
| Filter pill counts during load | `0` badges | no badge rendered |

---

## 7. Regression risk

**Low.** Assessment by area:

- **Request flow / API contract** — unchanged. Same URLs, same params, same response shapes.
  Backend untouched.
- **Table rendering** — the only render-path change is the pagination footer string, gated on
  `loading || roundsStatus === 'loading'`. Both flags already existed and already gate the table
  body spinner, so the footer now agrees with the body instead of contradicting it.
- **Stale-response races** — summary uses its own `AbortController` (`summaryAbortRef`) and only
  clears `summaryLoading` when not aborted, so a slow round-1 response cannot clear the skeleton of
  a round-2 request. Unchanged this session.
- **Selection / bulk status / export / PDF** — untouched. Verified by the 5 bulk-selection tests and
  the export/PDF suites staying green.
- **`roundsStatus` dependency in the footer** — if rounds fail, `roundsStatus === 'error'`, so the
  footer falls through to the normal branch and the table shows the rounds empty state. Correct.

Residual risks worth a reviewer's eye:

1. The footer now says `กำลังโหลด...` during every page/sort change, which is a visible text change
   from the previous behavior. Intended, but it is a UX change, not just a bug fix.
2. `kpiLoading = summaryLoading || roundsStatus === 'loading'` means KPI skeletons also wait on the
   rounds list. That is correct (no round selected = no summary to fetch) but means KPI can lag the
   table by the rounds request duration on cold load.
3. The source-reading test (`effect ของ summary ไม่มี ... ใน dependency`) is regex-based against
   `ApplicationsClient.tsx`. It will fail if the `useCallback` formatting is restructured, even if
   behavior is unchanged. That is a deliberate tripwire, but it is brittle by design.

---

## 8. Restrictions compliance

| Restriction | Status |
|---|---|
| ห้ามแตะ backend | ✅ no backend files in diff |
| ห้ามแตะ applications selector | ✅ untouched |
| ห้ามแตะ bulk status | ✅ untouched (only reads its existing `fetchSummary()` call) |
| ห้ามแตะ export | ✅ untouched |
| ห้ามแตะ pdf | ✅ untouched |
| ห้ามแตะ pagination architecture | ✅ only footer display text changed; `Pagination` component and state untouched |
| ห้าม commit | ✅ nothing committed |
| ห้าม push | ✅ nothing pushed |
| ห้าม merge | ✅ nothing merged |

Working tree:

```
 M frontend/src/app/(admin)/admin/applications/ApplicationsClient.tsx
 M frontend/src/components/__tests__/applications-summary-decoupling.test.tsx
```

HEAD remains `776b5a6f`. Ready for review.
