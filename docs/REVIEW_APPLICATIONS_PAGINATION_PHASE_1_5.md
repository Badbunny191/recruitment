# Review — Applications Pagination Phase 1–5

**Branch:** `feature/applications-pagination-phase1`
**Reviewed:** 2026-10-29
**Mode:** REVIEW ONLY — no code changed, no commit, no push
**Working tree:** clean at review start

## Verdict

| | |
|---|---|
| **PASS** | Yes, with concerns |
| **CONCERNS** | 5 |
| **BLOCKERS** | 0 |
| **Decision** | **Ready for merge** |

No blocker was found. Every claim below is traceable to a file:line, a test run, or a
typecheck run performed during this review.

### Evidence base

| Check | Command | Result |
|---|---|---|
| Backend selector suite | `node --import tsx src/lib/__tests__/applications-selector.test.ts` | 29/29 pass |
| Bulk-status suite | `node --import tsx src/routes/__tests__/bulk-status-validation.test.ts` | 25/25 pass |
| Excel export suite | `node --import tsx src/services/__tests__/excel-export.service.test.ts` | 111 pass, 0 fail |
| List pagination suite | `node --import tsx src/routes/__tests__/applications-list-pagination.test.ts` | 18 pass, 0 fail |
| List state suite | `node --import tsx src/lib/__tests__/applications-list-state.test.ts` | 30 pass, 0 fail |
| Selection state suite | `node --import tsx src/lib/__tests__/applications-selection-state.test.ts` | 44/44 pass |
| Selection (client) suite | `node --import tsx src/lib/__tests__/applications-selection.test.ts` | 12/12 pass |
| List params suite | `node --import tsx src/lib/__tests__/applications-list-params.test.ts` | 25 pass, 0 fail |
| PDF bulk suite | `node --import tsx src/lib/__tests__/pdf-bulk-download.test.ts` | 20 pass, 0 fail |
| Backend typecheck | `npx tsc --noEmit` (backend) | exit 0 |
| Frontend typecheck | `npx tsc --noEmit` (frontend) | exit 0 |

Total: 314 assertions passing, 0 failing, both typechecks clean.

---

## 1. Regression

### 1.1 Bulk status — PASS

- Legacy `{ ids }` still resolves to `kind: 'ids'` (`backend/src/lib/applications-selector.ts:153-159`).
- `{ selector: { kind: 'ids' } }` is equivalent to `{ ids }` — proven by BS12.
- `{ selector: { kind: 'filter' } }` resolves server-side; no id array is accepted from the client.
- DRAFT and ARCHIVED are still rejected before the selector is resolved
  (`backend/src/routes/admin.routes.ts:2611-2621`), and again by zod
  (`UpdatableApplicationStatusEnum`, `backend/src/schemas/validators.ts:348`).
- Sending both `selector` and `ids` is rejected — fail closed
  (`applications-selector.ts:142-147`, BS16).
- Empty match does not write to the DB and does not create an audit row
  (`admin.routes.ts:2676-2709`, BS14).

**One intentional behavior change, correctly handled.** `updated` used to echo
`ids.length`; it now reports rows actually matched (`admin.routes.ts:2673`, `2723`).
The client reads `data.updated` at
`frontend/src/app/(admin)/admin/applications/ApplicationsClient.tsx:874`, so the
number shown to the user is now truthful. BS19 and BS21 pin this down. This is a
fix, not a regression.

### 1.2 Export filtered — PASS

`handleExcelExport` (`ApplicationsClient.tsx:413-439`) is unchanged in contract:
it sends `roundId`, `search`, and the status param, and the backend applies
`buildExportWhere` with the DRAFT default
(`backend/src/services/excel-export.service.ts:366-388`). Suite covers 1,000-row
cap, chunking, and audit.

### 1.3 Export selected — PASS

- `explicit` sends legacy `{ roundId, applicationIds }` (`ApplicationsClient.tsx:459-463`).
- `all-filtered` sends `{ roundId, selector }`.
- Backend rejects a selector whose `filter.roundId` differs from the request
  `roundId` (`excel-export.service.ts:772-779`, SEL-SEL-F).
- DRAFT is excluded via `excludeDraft: true` (`excel-export.service.ts:799`).
- Cap boundary at 1,000 is exact: 1,001 rejected, 1,000 accepted
  (SEL-P5-E).

### 1.4 Bulk PDF — PASS

- No backend change. Still one `GET /admin/applications/:id/pdf` per row,
  concurrency 2 (`frontend/src/lib/pdf-bulk-download.ts:29-32`).
- Cap 100 enforced before the run starts (`pdf-bulk-download.ts:75-77`).
- `all-filtered` resolves ids from `GET /applications/ids`, then filters through
  `isRowSelected` so `excludeIds` are honored (`ApplicationsClient.tsx:557-560`).
- Partial failure, cancel, and in-order ZIP writing all covered (20/20).

---

## 2. Selection semantics

### 2.1 Explicit — PASS

`{ kind: 'ids', ids }`. Deduped, empty list means "no rows" and never "all rows"
(`applications-selector.ts:336-342`, SE12). Survives page, pageSize, and sort
changes; cleared on round, search, or status change
(`frontend/src/lib/applications-selection-state.ts:100-109`).

### 2.2 All-filtered — PASS

`{ kind: 'filter', filter: { roundId, status?, search? } }`. `roundId` is mandatory
(`applications-selector.ts:229-232`). Status accepts a single value or a
comma-separated list (`applications-selector.ts:279-286`). Unknown status values
match zero rows rather than falling back to the whole round
(`applications-selector.ts:318-324`, SE24).

### 2.3 excludeIds — PASS (backend) / CONCERN (UI)

Backend support is complete and correct:

- Deduped and stripped of empty values (`applications-selector.ts:247`, SE17).
- Empty array produces no `NOT IN` bind at all (`applications-selector.ts:254`, SE18).
- Capped at 80 with a hard reject, not a silent truncation
  (`applications-selector.ts:89`, `248-253`, SE20, BS25). The cap is justified by
  D1's ~100 bind limit.
- Applied to both bulk-status and export (SE21, BS23, SEL-P5-B).
- Audit records `excludeCount`, never the id list (`applications-selector.ts:399`).

The UI side is where the gap sits — see CONCERN 1.

---

## 3. State transitions

| Transition | Rule | Verified |
|---|---|---|
| page | keeps pageSize, keeps selection | LS1 |
| pageSize | resets page to 1, keeps selection | LS2 |
| sort | resets page to 1, keeps selection | LS3 |
| search | resets page to 1, clears selection + notice | LS6, `ApplicationsClient.tsx:768-782` |
| status | resets page to 1, clears selection + notice | LS6 |
| round | resets page to 1, clears selection + notice | LS6 |

Server-side ordering is deterministic for all four sort ids, with a three-level
tie-break and NULLs last in both directions
(`backend/src/lib/applications-list-query.ts:209-223`). PG16 proves that
page 1..N union equals the full set with no duplicates and no gaps for every
sort value.

Selection clearing is announced, not silent
(`ApplicationsClient.tsx:778-780`, rendered at `1203-1217`).

---

## 4. URL hydration — PASS for initial load, CONCERN for Back/Forward

Initial hydration reads all six dimensions from the URL
(`ApplicationsClient.tsx:259-270`): `round`, `q`, `status` (with legacy `view`
fallback), `sort`, `page`, `pageSize`. Invalid values fall back to defaults
without throwing (LS4).

Round selection priority is URL, then localStorage, then first ACTIVE round
(`ApplicationsClient.tsx:621-645`). The `roundId: '' → value` transition is
correctly treated as initialization, not a round change, so the restored page
survives (`ApplicationsClient.tsx:754-758`).

Writing is guarded by a local `urlParamsRef` rather than reading back from
`searchParams`, which avoids the classic lost-update when two `router.replace`
calls land in the same tick (`ApplicationsClient.tsx:272-297`). Defaults are not
written to the URL.

See CONCERN 2 for the Back/Forward gap.

---

## 5. Race conditions — PASS

Three layers, all present:

1. **Request key** over all six dimensions
   (`frontend/src/lib/applications-list-state.ts:171-180`).
2. **Guard** discards any response whose key is not the latest
   (`applications-list-state.ts:196-210`, `ApplicationsClient.tsx:721`, `729`, `732`).
3. **AbortController** cancels the superseded network request
   (`ApplicationsClient.tsx:690-692`), plus an unmount cleanup at `737`.

Rapid page changes: each change produces a new key; the older response is dropped
and its request aborted. Rapid search changes: `search` is trimmed before keying,
so whitespace-only edits do not fire a duplicate request (LS key tests). Stale
responses: covered by the guard test that simulates a filter change racing a page
reset.

The loading flag is only cleared by the current request (`ApplicationsClient.tsx:732`),
so a stale response cannot flip the spinner off early.

---

## 6. Contract consistency

| Surface | Selector input | DRAFT handling | Ordering | Cap |
|---|---|---|---|---|
| list (`GET /applications`) | n/a (query params) | not filtered | 3-level tie-break | pageSize ≤ 200 |
| ids (`GET /applications/ids`) | n/a | not filtered | same as list | none |
| bulk (`POST /bulk-status`) | ids \| filter (+excludeIds) | n/a (status set explicitly) | none | excludeIds ≤ 80 |
| export filtered (`GET /export`) | n/a | excluded by default | submittedAt DESC, id DESC | 1,000 |
| export selected (`POST /export-selected`) | ids \| filter (+excludeIds) | excluded via `excludeDraft` | submittedAt DESC, id DESC | 1,000 |
| pdf (per-id) | n/a | n/a | n/a | 100 client-side |

The single shared where-builder is reused across list, ids, bulk, and both export
paths (`applications-selector.ts:310-313`, `excel-export.service.ts:799`), so the
"same selector, same set" invariant holds. SE10 proves filter-selector equals
`GET /applications/ids` row-for-row.

The one deliberate asymmetry is DRAFT: the list shows it, export hides it. That is
pre-existing and documented (`applications-list-query.ts:24-26`). It is currently
unreachable in practice — applications are only ever inserted as `SUBMITTED`
(`backend/src/routes/public.routes.ts:421`, `495`) and bulk updates cannot set
DRAFT (`admin.routes.ts:2611`). See CONCERN 3.

---

## CONCERNS

### CONCERN 1 — `excludeIds` is fully built but unreachable from the UI

The backend, the zod schema, the service, and the state model all support
`excludeIds`. The client deliberately refuses to send it:

- `describeSelectionBlocker` returns *"ลบรายการออกจาก 'เลือกทั้งหมด' แล้ว — backend ยังไม่รองรับ excludeIds"*
  (`frontend/src/lib/applications-selection-state.ts:266-268`).
- `buildSelectionSelector` therefore returns `null` (`applications-selection-state.ts:285`).

That message is now factually wrong: the backend does support it, and has since
Phase 5. The consequence is a dead end for the user — after ticking "select all
filtered", unticking any single row disables both the bulk-status button and
"Export ที่เลือก", with the reason exposed only as a `title` tooltip
(`ApplicationsClient.tsx:1194`, `1277`). The state model also transitions to
`all-filtered` with `excludeIds` (`applications-selection-state.ts:202-211`), so
the user can reach a state the UI will not let them submit.

Test P4-8e asserts the current (now stale) behavior, so the suite will keep
passing while the gap persists.

**Impact:** functional gap, not a data-integrity risk. Nothing wrong is ever sent.
**Suggested fix (in scope, no new feature):** delete the `excludeIds` branch in
`describeSelectionBlocker`, pass `excludeIds` through `buildApplicationsSelector`,
and update P4-8e. Roughly 15 lines across two files.

### CONCERN 2 — URL hydration is initial-only; Back/Forward does not re-hydrate

Every list state value is read from `searchParams` into `useState` initializers
(`ApplicationsClient.tsx:348`, `352-357`). Nothing re-syncs those state values when
`searchParams` changes after mount. The only `useEffect` on `searchParams` refreshes
`urlParamsRef` (`ApplicationsClient.tsx:281-283`).

So on a browser Back/Forward within the same mounted component, the URL changes but
`currentPage`, `search`, `sortId`, `statusFilter`, and `pageSize` keep their old
values. The list does not follow the URL. The code comment at
`ApplicationsClient.tsx:256-258` claims Back restores position; that holds only
because navigating to a detail page unmounts the component and remounts it on
return. It does not hold for in-page history moves.

`hydrateListState` in `applications-list-state.ts:67-76` is the function that would
solve this, and it is exported and fully tested (LS4) but never imported by the
component. See CONCERN 5.

**Impact:** moderate UX inconsistency. No data corruption; the next user action
re-syncs the URL from state.
**Suggested fix:** add an effect that re-hydrates state from `searchParams` on
change, using `hydrateListState`, guarded so it does not fight the setters.

### CONCERN 3 — DRAFT asymmetry between list and export

`GET /applications` does not filter DRAFT (`applications-list-query.ts:46-69`);
`buildExportWhere` and `resolveSelectorWhere(..., { excludeDraft: true })` do
(`excel-export.service.ts:386-387`, `applications-selector.ts:325-327`).

If a DRAFT application ever exists, an `all-filtered` selection would count it in
the UI total (`pagination.total`) but silently omit it from the export, so the
exported row count would not match the number on the button.

Currently unreachable: no code path inserts an application with `status = 'DRAFT'`,
and bulk updates reject DRAFT. The risk is latent, not live.

**Impact:** low today, would become a real discrepancy the moment a draft-save
feature is added.
**Suggested fix:** none required for this merge. Note it in the Phase 5 doc so the
next phase does not walk into it.

### CONCERN 4 — Bulk-status audit payload grows with selection size

For `kind: 'filter'`, the audit payload stores the full resolved id list
(`admin.routes.ts:2728`: `applicationIds: selector.kind === 'ids' ? selector.ids : targetIds`).
`previousStatus` also stores one entry per row (`admin.routes.ts:2659-2662`).
`audit_logs.payload` is an unconstrained `text` column
(`backend/src/db/schema.ts:256`).

A filter selection over a 10,000-row round would write roughly 400 KB of UUIDs plus
a status map into a single JSON payload. `describeSelector` already records
`kind`, `roundId`, `status`, `search`, and `excludeCount` without ids
(`applications-selector.ts:392-402`), so the full id array is redundant for filter
selectors.

**Impact:** performance and storage, not correctness. No PII is involved.
**Suggested fix:** store `targetIds` only for `kind: 'ids'`, and rely on
`describeSelector` plus `matched` for filter selectors.

### CONCERN 5 — Tested state machine is largely not wired into the component

`applications-list-state.ts` exports `hydrateListState`, `applyListStatePatch`,
`isPageResettingChange`, `shouldClearSelection`, `isInitialRoundHydration`,
`buildListStateUrlPatch`, and `resolvePageAfterResponse`. A repo-wide search shows
every one of them is referenced only inside its own file. The component imports
exactly one symbol from that module — `createRequestGuard`
(`ApplicationsClient.tsx:52-55`).

The component re-implements the same rules inline as ad-hoc effects
(`ApplicationsClient.tsx:750-762` for page reset, `768-782` for selection clearing,
`259-270` for hydration). The two implementations agree today — the 30 passing
tests describe behavior the component happens to match — but the tests do not
actually guard the component. A future edit to those effects will not fail any test.

**Impact:** false confidence in coverage, plus the stale `excludeIds` message in
CONCERN 1 is a direct symptom of this drift.
**Suggested fix:** either route the component through the state module, or add a
note to the Phase 3 doc stating the module is a reference model, not the runtime path.

---

## Notes (not concerns)

- `resolveSelectorIds` and `countSelectorRows` (`applications-selector.ts:354`, `373`)
  are exported but unused. Harmless; flagged only so they are not mistaken for live code.
- `SELECTABLE_APPLICATION_STATUSES` and `ALL_APPLICATION_STATUSES` duplicate the same
  five values (`applications-selector.ts:98-104`, `excel-export.service.ts:132-134`).
  The comment at `applications-selector.ts:95-96` explains the deliberate choice to
  avoid an import cycle. Acceptable.
- `readPagination` falls back to `data.length` when the server omits `pagination`
  (`frontend/src/lib/applications-list-params.ts:142-148`). The client always sends
  `page`, so this path is unreachable in practice; it is a defensive fallback only.

---

## Recommendation

**Ready for merge.**

Zero blockers. Both typechecks pass and 314 assertions pass across nine suites.
The selector contract is genuinely unified — one where-builder, one normalizer, and
equivalence tests proving list, ids, bulk, and both export paths agree.

CONCERN 1 is the one I would fix before or immediately after merge, because it ships
a user-visible dead end and a message that is now false. It is small and stays inside
the existing scope. CONCERNS 2 through 5 are follow-ups that do not block.

No feature was proposed and no scope was expanded in this review.
