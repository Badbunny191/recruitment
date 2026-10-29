# Phase 4 — ApplicationsSelector Foundation

**Branch:** `feature/applications-pagination-phase1`
**Date:** 2026-10-29
**Status:** Implemented, tests green, **not committed, not pushed, not deployed**
**Reference:** `docs/PHASE_3_APPLICATIONS_PAGINATION.md`

---

## 0. Starting state

Phase 2 had already built `frontend/src/lib/applications-selection.ts` (pure
selector builders: `resolveSelectionState`, `buildApplicationsSelector`,
`buildBulkStatusPayload`, `buildExportSelectedPayload`) and the backend already
accepts a `selector` body on both `bulk-status` and `export-selected`
(`normalizeSelectorInput`, `resolveSelectorWhere`). Phase 3 left that foundation
**additive and unused** — the component still held a bare `Set<string>`.

Phase 4 closes that gap on the client only: the component now holds a real
selection state model, and the header checkbox understands
"all filtered minus exclusions".

Verified on entry rather than assumed:

| Area | State found |
|---|---|
| `SelectionState` / `ApplicationsSelector` types | Already existed in `applications-selection.ts` (Phase 2) |
| Backend `selector` support on bulk-status | Already present (`admin.routes.ts:2632`) |
| Backend `selector` support on export-selected | Already present (`excel-export.routes.ts:64`) |
| Component selection state | Bare `Set<string>` (`ApplicationsClient.tsx:348`) |
| Header checkbox semantics | Page-only (`pageIds`), not all-filtered |
| `excludeIds` anywhere | Did not exist |

---

## 1. Files changed

### New files

| File | Purpose |
|---|---|
| `frontend/src/lib/applications-selection-state.ts` | Selection state model: 3 states, `excludeIds`, count, header state, transitions, selector bridge |
| `frontend/src/lib/__tests__/applications-selection-state.test.ts` | 44 tests across the 6 required areas |

### Modified files

| File | Change |
|---|---|
| `frontend/src/app/(admin)/admin/applications/ApplicationsClient.tsx` | `Set<string>` → `ApplicationsSelection`; header/row/count/export/bulk/PDF wired to the model |
| `frontend/package.json` | Registered `test:applications-selection-state` and added it to the `test` chain |

### Explicitly not touched

- **No backend change** — `git status -- backend/` is empty.
- No `bulk-status` API change (backend already accepted `selector` since Phase 2).
- No `export-selected` API change (same).
- No `pdf-targets` endpoint.
- No commit, no push, no deploy, no merge.

---

## 2. The state model

### 2.1 Types

```ts
type SelectionState = 'idle' | 'explicit' | 'all-filtered';

interface ApplicationsSelection {
  state: SelectionState;
  ids: readonly string[];        // ใช้เมื่อ explicit
  excludeIds: readonly string[]; // ใช้เมื่อ all-filtered
}
```

The selector type itself (`{ kind: 'ids' } | { kind: 'filter' }`) is **not**
redefined — Phase 4 re-exports and reuses the Phase 2 `ApplicationsSelector`
so the payload shape cannot drift between the two modules.

### 2.2 Why `excludeIds` exists

After Phase 3 the list renders one server page at a time. "Select all filtered"
therefore describes a set the client **does not hold the ids for** — a 50,000-row
round would otherwise mean holding 50,000 strings in React state just to send
them back. `all-filtered` stores the complement instead: *everything, except
these*. Deselecting one row appends to `excludeIds`; re-selecting removes it.

### 2.3 Invariants (enforced by `normalizeSelection`)

| State | Invariant |
|---|---|
| `idle` | `ids = []`, `excludeIds = []` |
| `explicit` | `ids` non-empty, `excludeIds = []` |
| `all-filtered` | `ids = []`, `excludeIds` deduped |

Anything inconsistent is repaired, never carried: `explicit` with no ids becomes
`idle`; `idle` with leftover ids drops them; unknown state becomes `idle`.

### 2.4 Functions

| Function | Rule |
|---|---|
| `createSelection()` | `idle` |
| `normalizeSelection(sel)` | Repair to invariant |
| `resolveSelectedCount(sel, filteredTotal)` | `0` / `ids.length` / `filteredTotal - excludeIds.length`, clamped at 0 |
| `isRowSelected(sel, id)` | Row checkbox state |
| `isHeaderChecked(sel, pageIds, filteredTotal)` | All filtered rows selected |
| `isHeaderIndeterminate(sel, pageIds, filteredTotal)` | Some but not all |
| `toggleRow(sel, id, filteredTotal)` | Row click, state-aware |
| `selectAllFiltered(filteredTotal)` | → `all-filtered`, no exclusions |
| `toggleHeader(sel, pageIds, filteredTotal)` | Header click |
| `clearSelection()` | → `idle` |
| `buildSelectionSelector(sel, filter)` | → `ApplicationsSelector` or `null` |
| `describeSelectionBlocker(sel, filter)` | Why a selector cannot be built |
| `canSubmitSelection(sel, filter)` | Button enablement |
| `describeSelectionCount(sel, filteredTotal)` | Human-readable count |

---

## 3. Header checkbox behaviour

| Current state | Click result |
|---|---|
| `idle` | `all-filtered`, no exclusions → count = `filteredTotal` |
| `explicit` (partial) | `all-filtered` (the wider set wins) |
| `all-filtered`, no exclusions | `idle` |
| `all-filtered`, with exclusions | `all-filtered`, exclusions cleared |

`checked` and `indeterminate` can never both be true — `isHeaderIndeterminate`
returns `false` whenever `isHeaderChecked` is true, and there is a test that
asserts this across every state.

`filteredTotal` comes from `pagination.total` (the server's count), never from
`apps.length`. That is the whole point: the client cannot count what it has not
fetched.

---

## 4. Component wiring

| Location | Before | After |
|---|---|---|
| `useState` | `Set<string>` | `ApplicationsSelection` |
| Header checkbox | `areAllFilteredSelected(pageIds, selectedIds)` | `isHeaderChecked(selection, pageIds, totalItems)` |
| Row checkbox | `selectedIds.has(app.id)` | `isRowSelected(selection, app.id)` |
| Row toggle | manual `Set` copy | `toggleRow(selection, id, totalItems)` |
| Bulk bar | `selectedIds.size` | `describeSelectionCount(...)` |
| Export button | `Array.from(selectedIds)` | `selector.kind === 'ids' ? { applicationIds } : { selector }` |
| Bulk status | `{ ids: [...] }` | `{ ids }` for explicit, `{ selector }` for all-filtered |
| Bulk PDF | `selectedIds` | explicit → `selection.ids`; all-filtered → filtered ids minus exclusions |
| Clear-on-filter-change | `setSelectedIds(new Set())` | `setSelection(clearSelection())` |

The `excel-export.ts` helpers (`areAllFilteredSelected`,
`isFilteredPartiallySelected`, `toggleAllFilteredSelection`) are no longer
imported by the component. **They are deliberately left in place** — their own
test suite (`excel-export.test.ts`, 30 tests) still exercises them and deleting
them would be a separate cleanup with its own blast radius.

---

## 5. Fail-closed: `all-filtered` + `excludeIds`

The backend selector contract (Phase 2) supports exactly two shapes:
`{ kind: 'ids', ids }` and `{ kind: 'filter', roundId, status?, search? }`.
There is **no** way to express "filter minus these ids".

So `buildSelectionSelector` returns `null` for `all-filtered` with a non-empty
`excludeIds`, and `describeSelectionBlocker` returns:

> ลบรายการออกจาก "เลือกทั้งหมด" แล้ว — backend ยังไม่รองรับ excludeIds

The affected buttons disable with that reason as the tooltip. This is
intentional: silently sending the full filter would apply a bulk status change
to rows the user explicitly deselected. Failing closed is the only safe option
until the backend grows exclusion support.

**Practical consequence:** "select all filtered, then deselect one row" is fully
supported in the state model and in the UI's header/row rendering, but
bulk-status / export / PDF-selected for that exact state are blocked with a
visible reason. Everything else works end to end.

---

## 6. Tests

`frontend/src/lib/__tests__/applications-selection-state.test.ts` — **44 tests**:

| Required area | Tests |
|---|---|
| explicit | P4-1a…f — idle start, single select, accumulate, deselect to idle, no duplicates, cross-page ids |
| all-filtered | P4-2a…e — select all, count from server not page, all rows checked, zero total, clear |
| excludeIds | P4-3a…g — add exclusion, count drops, row unselected, re-toggle, all-excluded → idle, no dupes, clamp |
| selectedCount | P4-4a…c — all states, invalid totals, display strings |
| header checked | P4-5a…f — idle, all-filtered, with exclusions, explicit complete, explicit partial, zero total |
| header indeterminate | P4-6a…f — idle, partial, exclusions, mutual exclusion with checked, toggleHeader both ways, wider-set-wins |

Plus `normalizeSelection` invariant repair (P4-7a…e) and selector fail-closed
behaviour (P4-8a…f), including a test that the Phase 4 selector output equals
the Phase 2 `buildApplicationsSelector` output for the same input.

### Results

```
frontend: node --import tsx src/lib/__tests__/applications-selection-state.test.ts
  → PASSED: 44/44

frontend: npm test → exit 0
backend:  npm test → exit 0
frontend: npx tsc --noEmit → exit 0
```

No pre-existing suite regressed. `applications-selection.test.ts` (Phase 2,
12 tests) and `excel-export.test.ts` (30 tests) both still pass unchanged.

---

## 7. Known limitations

1. **`excludeIds` cannot be submitted.** Described in section 5. The state model
   and header/row UI support it; the three submit paths block it with a reason.
   Closing this needs a backend selector extension (e.g. `excludeIds` on
   `kind: 'filter'`), which is explicitly out of scope here.

2. **`all-filtered` count trusts `pagination.total`.** If the underlying data
   changes between the list fetch and the bulk action, the displayed count can
   be stale. The server remains authoritative on what it actually updates.

3. **No component-level (DOM) tests.** Same constraint as Phase 3: this project
   has no jsdom/testing-library wired for this page. The rules are covered
   through the extracted pure module; the React wiring is verified by typecheck,
   build, and code review only.

4. **`excel-export.ts` selection helpers are now dead code** for the component
   but still exported and still tested. Left in place deliberately (see §4).

5. **Selection is not persisted across reloads.** Unchanged from before; a
   refresh starts at `idle`.

---

## 8. Verification summary

| Check | Result |
|---|---|
| Frontend `npm test` | exit 0 |
| Backend `npm test` | exit 0 |
| Frontend `tsc --noEmit` | exit 0 |
| Frontend `npm run build` | exit 0 |
| New tests | 44, all passing |
| Backend files changed | none (`git status -- backend/` empty) |
| bulk-status API changed | no |
| export API changed | no |
| pdf-targets touched | no |
| Committed | **no** |
| Pushed | **no** |
| Deployed | **no** |

### Working tree

```
 M frontend/package.json
 M frontend/src/app/(admin)/admin/applications/ApplicationsClient.tsx
?? frontend/src/lib/__tests__/applications-selection-state.test.ts
?? frontend/src/lib/applications-selection-state.ts
```

---

## 9. Awaiting review

Nothing has been committed, pushed, or deployed. The working tree above is the
complete change set.
