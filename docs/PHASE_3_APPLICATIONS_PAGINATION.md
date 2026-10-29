# Phase 3 — Applications Server-Side Pagination

**Branch:** `feature/applications-pagination-phase1`
**Date:** 2026-10-29
**Status:** Implemented, tests green, **not committed, not pushed, not merged**

---

## 0. Starting state (important)

Phase 3 was **partly already implemented** in commit `be5eaead`
("feat: implement applications pagination foundation"). Before writing anything I
verified what existed rather than rebuilding it:

| Area | State found on entry |
|---|---|
| `GET /admin/applications` accepting `sort` / `page` / `pageSize` | Already present (`admin.routes.ts:2102-2161`) |
| Sort whitelist (4 values) + tie-break | Already present (`applications-list-query.ts:159-223`) |
| `buildApplicationsListOrderBy()` | Already present, shared with `/applications/ids` |
| Frontend sending `page`/`pageSize`/`sort` on every request | Already present (`ApplicationsClient.tsx:637-644`) |
| `total`/`totalPages` from backend only | Already present (`readPagination`, `pagination.totalPages`) |
| Client `Array.sort()` / `sortedApps.slice()` | Already removed — verified by grep, none remain |
| Backend tests (PG1–PG18) | Already present, 18/18 passing |

So the backend scope of this brief was **already satisfied and already tested**.
I did not rewrite it. What was genuinely missing, and what this phase actually
delivered, is listed in section 1.

---

## 1. Files changed

### New files

| File | Purpose |
|---|---|
| `frontend/src/lib/applications-list-state.ts` | Pure list-state machine: URL hydrate, page-reset rules, selection-clear rules, URL patch builder, request key, request guard |
| `frontend/src/lib/__tests__/applications-list-state.test.ts` | 30 tests covering the 6 required frontend behaviours + request key / stale guard |

### Modified files

| File | Change |
|---|---|
| `frontend/src/app/(admin)/admin/applications/ApplicationsClient.tsx` | Replaced the bare `fetchSeqRef` sequence counter with `createRequestGuard()` (request key over all 6 dimensions) **and** a real `AbortController` on the list fetch; added unmount abort cleanup |
| `frontend/package.json` | Registered `test:applications-list-state` and added it to the `test` chain |

### Explicitly not touched

- No `all-filtered` mode, no `excludeIds` mode
- No `ApplicationsSelector` UI
- No `pdf-targets` endpoint
- No export selector, no bulk selector UX
- No changes to bulk status, export, PDF, checkbox, or selection-count behaviour
- No commit, no push, no deploy, no merge

---

## 2. What was actually built

### 2.1 Request key + stale guard

The brief requires a request key of `{ roundId, q, status, sort, page, pageSize }`
to stop an old response overwriting a newer one. The previous code used a simple
incrementing integer (`fetchSeqRef`), which works but is opaque and untestable.

Replaced with `createRequestGuard()`:

- `begin(state)` → returns a key built from all six dimensions, marks it latest
- `isCurrent(key)` → true only for the latest key
- `current()` → the latest key, or `null` before any request

`search` is trimmed before keying, so whitespace-only edits do not trigger a
spurious refetch.

### 2.2 AbortController

The brief says "if an AbortController already exists, use it". None existed for
the list fetch (the only one was `pdfBulkAbortRef`, for PDF downloads). Added:

- `listAbortRef` — aborts the previous in-flight list request before starting a new one
- `signal` passed to both `fetch` calls in `fetchData`
- `AbortError` is swallowed, not logged as an error (rapid filter changes are normal)
- unmount cleanup aborts any pending request

Guard and abort are complementary: **abort** cancels the network, **guard**
decides whether the result may write state.

### 2.3 List-state machine extracted

The page-reset and selection-clear rules lived inside two component `useEffect`s.
This project has **no jsdom and no testing-library** (verified: both absent from
`node_modules`), so those rules could not be tested at all while they stayed in
the component. They are now pure functions in `applications-list-state.ts`:

| Function | Rule |
|---|---|
| `hydrateListState(params)` | Reads all 6 dimensions from URL, with fallbacks |
| `applyListStatePatch(prev, patch, opts)` | Applies a change and enforces page reset |
| `isPageResettingChange(prev, next)` | round / search / status / sort changed |
| `shouldClearSelection(prev, next)` | round / search / status changed only |
| `isInitialRoundHydration(prev, next)` | `roundId '' → value` is init, not a round change |
| `buildListStateUrlPatch(state)` | State → URL patch, defaults omitted |
| `buildRequestKey(state)` | The 6-dimension key |
| `createRequestGuard()` | Stale-response guard |
| `resolvePageAfterResponse(page, totalPages)` | Clamp target page |

The component still owns its own state; the module is the single source of the
rules, and the tests exercise the rules directly.

---

## 3. Tests added

### Backend

The backend scope was already covered by `applications-list-pagination.test.ts`
(committed in `be5eaead`). I ran it and confirmed all six required areas are
covered — I did not duplicate it:

| Requirement | Existing test | Result |
|---|---|---|
| Sort all 4 values | PG12 (`submittedAt-asc`), PG13 (`fullname-asc`), PG14 (`fullname-desc`), PG3 (default `submittedAt-desc`) | ✓ |
| Pagination | PG4, PG5, PG16 | ✓ |
| Page boundary | PG6 (`page=99` → empty data, correct total), PG7 (`page=0/-1/abc/1.5` → 400) | ✓ |
| PageSize boundary | PG7 (`pageSize=0/-5/xyz` → 400, `pageSize=201` → 400, `pageSize=200` → 200) | ✓ |
| Tie-break correctness | PG3, PG12, PG13, PG14 (duplicate names `echo`/`ECHO`, NULL `submittedAt` sorted last both directions) | ✓ |
| Sort + filter + pagination together | PG18 | ✓ |

Run: `node --import tsx src/routes/__tests__/applications-list-pagination.test.ts`
→ **18 passed / 0 failed**

### Frontend

New suite `applications-list-state.test.ts` — **30 tests**, mapped to the six
required behaviours:

| Requirement | Tests |
|---|---|
| 1. Page change | LS1 ×3 — page changes, pageSize/sort/filters preserved, not a page-reset, selection kept |
| 2. PageSize change | LS2 ×4 — resets to page 1, same pageSize does not reset, selection kept, pageSize wins over a simultaneous page patch |
| 3. Sort change | LS3 ×3 — resets to page 1, selection kept, all 4 sort values are page-resetting |
| 4. URL hydrate | LS4 ×6 — all 6 dimensions, empty URL defaults, garbage values fall back, legacy `?view=`, **round-trip write→read**, defaults omitted from URL |
| 5. `page=999` clamp | LS5 ×4 — clamps to last page, in-range returns `null`, `totalPages=0` → 1, hydrate-then-clamp |
| 6. Selection survives page change | LS6 ×4 — survives page/pageSize/sort, cleared on round/search/status, page also resets, initial round hydration is not a round change |

Plus request-key/guard coverage: key changes on each of the 6 dimensions, search
trimming, stale response discarded, duplicate request still current, no key
current before the first request, and a simulated race (filter change → page
reset → two in-flight requests, older one discarded).

---

## 4. `npm test` results

```
backend:  npm test → exit 0
frontend: npm test → exit 0
```

New suite confirmed running inside `npm test`:

```
ผลการทดสอบ: ผ่าน 30 / FAIL 0
ทุกกรณีผ่าน ✅
```

Backend pagination suite inside `npm test`:

```
ผลการทดสอบ: ผ่าน 18 / FAIL 0
```

No pre-existing suite regressed on either side.

---

## 5. `tsc` results

```
backend:  npx tsc --noEmit → B_TSC=0
frontend: npx tsc --noEmit → F_TSC=0
```

No `error TS` output from either project.

---

## 6. Before / after payload size

Measured on the real route against an in-memory D1, seeded with **500
applications in one round**, each carrying a realistic ~5.0 KB `formData` blob.
These are actual response byte counts, not estimates.

| Request | Rows returned | Response size |
|---|---|---|
| **Before** — `?roundId=round-1` (no `page`, client-side pagination) | 500 | **126.3 KB** |
| **After** — `?roundId=...&page=1&pageSize=10` (UI default) | 10 | **2.6 KB** |
| **After** — `?roundId=...&page=1&pageSize=50` | 50 | 12.7 KB |
| **After** — `?roundId=...&page=1&pageSize=100` | 100 | 25.4 KB |

**At the UI default page size: 126.3 KB → 2.6 KB, a 97.9% reduction (48.5×).**

Metadata correctness on the same dataset:

```
pagination.total              = 500   (matches seeded row count)
pagination.totalPages @10     = 50
pagination.totalPages @50     = 10
pagination.totalPages @100    = 5
sort=fullname-asc page1 ∩ page2 = 0 duplicate rows
```

Caveat: measured on a synthetic in-memory D1, not production. Real sizes depend
on row count and on actual name/email lengths. The `formData` exclusion is what
drives most of the win, and that exclusion is already in the committed
`APPLICATION_LIST_COLUMNS` projection (7 columns, no `formData`, no `nationalId`).

---

## 7. Before / after request pattern

### Before — client-side pagination + client-side sorting

```
1×  GET /admin/applications?roundId=R
      → every row in the round, every column including formData
2×  GET /admin/applications/summary?roundId=R
      → status counts
3×  client: filterByStatus() → Array.sort() → slice((page-1)*size, page*size)
4×  client: totalPages = Math.ceil(apps.length / pageSize)
```

Every page change, sort change, and pageSize change re-ran steps 3–4 over the
full in-memory array. The network request count was flat (1 list request) but
that single request carried the entire round.

### After — server-side pagination + server-side sorting

```
1×  GET /admin/applications?roundId=R&sort=S&page=P&pageSize=N
      → only the rows for page P, 7 columns, no formData
2×  GET /admin/applications/summary?roundId=R
      → status counts
3×  render rows as received; total/totalPages read from response.pagination
```

Page change, sort change, and pageSize change each issue **one** list request
carrying only that page. No client sort, no client slice, no client total
computation.

When a filter/round/sort change also resets the page, two requests can be in
flight briefly. The request guard discards the older response and the
`AbortController` cancels its network call.

`page=999` handling: the URL value is honoured on hydrate, then clamped to the
server's `totalPages` once the response lands (`resolvePageAfterResponse`),
skipped while loading so stale data never drives the clamp.

---

## 8. Known limitations

1. **No component-level (DOM) tests.** This project has no jsdom and no
   testing-library, so the six required behaviours are tested through the
   extracted pure state machine rather than by rendering `ApplicationsClient`.
   The rules are covered; the React wiring around them (effect ordering, the
   `prevListStateRef` / `prevFilterStateRef` comparisons) is verified by
   typecheck and code review only, not by an automated render test. Adding jsdom
   would close this gap.

2. **The component's two `useEffect`s still hold duplicated rule logic.** The
   page-reset and selection-clear effects in `ApplicationsClient.tsx` were left
   functionally as-is; the new module documents and tests the same rules but the
   component does not yet call `applyListStatePatch` / `shouldClearSelection`
   directly. Wiring it through would be a larger refactor of the component's
   state ownership and was not attempted here. **Risk:** the module and the
   component could drift. Recommendation for Phase 4: make the component consume
   the module so there is one implementation.

3. **`pageSize` default mismatch between layers.** Backend default is 50
   (`APPLICATIONS_LIST_PAGE_SIZE_DEFAULT`), UI default is 10. This is safe today
   only because the frontend always sends `pageSize` explicitly. Any future
   caller that omits `pageSize` gets 50, not 10.

4. **`pageSize` validation is asymmetric.** Backend accepts any integer 1–200;
   frontend `parsePageSize` accepts only `[10, 25, 50, 100]`. A hand-edited URL
   with `pageSize=37` renders as 10 on the client while the API would have
   honoured 37. Intentional (UI constrains choices) but worth knowing.

5. **`/applications/ids` is still unbounded.** The bulk-PDF "filtered" path calls
   `GET /admin/applications/ids`, which returns every matching id with no cap.
   For a 50,000-row round that is still a large response. Unchanged by this
   phase; the brief scoped it out.

6. **`summary` is fetched on every list request.** It does not depend on
   `page`/`pageSize`/`sort`, so changing pages refetches an unchanged summary.
   Minor waste; left alone to avoid touching filter-chip behaviour.

7. **DRAFT divergence (carried over from Phase 2).** `buildApplicationsListWhere`
   does not exclude DRAFT, while `buildExportWhere` does. Pre-existing and
   deliberately untouched — changing either side would alter existing endpoint
   semantics. Still open from the Phase 2 report.

8. **No bulk-status row cap for `kind: 'filter'`.** Carried over from Phase 2,
   still open, still out of scope here.

9. **`applications-selection.ts` is still not wired into the UI.** Phase 2
   foundation remains additive and unused, as intended.

---

## 9. Verification summary

| Check | Result |
|---|---|
| Backend `npm test` | exit 0 |
| Frontend `npm test` | exit 0 |
| Backend `tsc --noEmit` | exit 0 |
| Frontend `tsc --noEmit` | exit 0 |
| New frontend tests | 30, all passing |
| Backend pagination tests (pre-existing) | 18, all passing |
| Pre-existing tests | all still passing |
| Client `Array.sort()` / `slice()` on list | none remain (verified by grep) |
| `totalPages` computed from `apps.length` | none remain |
| Forbidden areas touched | none |
| Committed | **no** |
| Pushed | **no** |
| Merged | **no** |

### Working tree

```
 M frontend/package.json
 M frontend/src/app/(admin)/admin/applications/ApplicationsClient.tsx
?? frontend/src/lib/__tests__/applications-list-state.test.ts
?? frontend/src/lib/applications-list-state.ts
```

---

## 10. Awaiting review

Nothing has been committed, pushed, deployed, or merged. The working tree above
is the complete change set, ready for review.
