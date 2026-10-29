# Phase 2 — ApplicationsSelector: Selection Model (transition coverage)

**Branch:** `feature/applications-phase2-selector`
**Date:** 2026-10-29
**Status:** Tests green, **not committed, not pushed, not merged**

---

## 0. Starting state — read this first

The brief says "เปลี่ยน selection model จาก `Set<id>` เป็น `ApplicationsSelector`".
On entry, **that change was already on this branch and already committed.**

Verified before writing anything:

| Area | State found on entry | Evidence |
|---|---|---|
| `ApplicationsSelection` type (`state` / `ids` / `excludeIds`) | Present | `applications-selection-state.ts:92-98` |
| explicit mode | Present | `toggleRow`, `normalizeSelection` |
| all-filtered mode | Present | `selectAllFiltered`, `toggleHeader` |
| `excludeIds` support | Present | `toggleRow` all-filtered branch, `buildApplicationsSelector` |
| `selectedCount` from `total` | Present | `resolveSelectedCount(sel, filteredTotal)` |
| header checked | Present | `isHeaderChecked` |
| header indeterminate | Present | `isHeaderIndeterminate` |
| Component holds `ApplicationsSelection`, not `Set<string>` | Present | `ApplicationsClient.tsx:437` |
| `Set<string>` in component | **none** (only a local `Set` for PDF target lookup, unrelated to selection) | grep |

So the six scope items were **already satisfied**. Rebuilding them would have
been churn, and rewriting committed code to "match a phase name" is exactly the
kind of change that breaks working behaviour.

**What was genuinely missing is the test coverage the brief asks for.** The eight
required cases were split across two suites, and the four *transition* cases
(page / pageSize / sort / filter change) were asserted **only as a boolean**:

```ts
// applications-list-state.test.ts:270-281  (pre-existing)
ok(!shouldClearSelection(prev, next), `เปลี่ยน ${label} ต้องไม่ล้าง selection`);
```

That proves the *predicate* returns false. It does **not** prove the selection
object survives intact — no `ids`, no `excludeIds`, no count, no selector was
ever checked after a page change. A regression that cleared selection inside
`normalizeSelection` or dropped `excludeIds` on re-derive would pass that test.

This phase closes that gap.

---

## 1. Files changed

### New files

| File | Purpose |
|---|---|
| `frontend/src/lib/__tests__/applications-selection-transitions.test.ts` | 35 tests — the 8 required cases, asserted against the selection model *through* list-state changes |

### Modified files

| File | Change |
|---|---|
| `frontend/package.json` | Registered `test:applications-selection-transitions`, added to the `test` chain |

### Explicitly not touched

- **No production source change.** `git diff` on `frontend/src/lib/*.ts` and
  `ApplicationsClient.tsx` is empty.
- **No backend change.** `git status -- backend/` is empty. Backend selector API
  untouched.
- No `pdf-targets` endpoint.
- No export flow change.
- No bulk endpoint contract change.
- No commit, no push, no merge.

---

## 2. What the new suite proves

The suite composes the two existing pure modules — `applications-list-state`
(the list-state machine) and `applications-selection-state` (the selection
model) — and asserts the **selection object itself**, not a boolean.

The harness mirrors what the component actually does:

```ts
function afterListChange(selection, prev, patch) {
  const next = applyListStatePatch(prev, patch);
  return shouldClearSelection(prev, next) ? clearSelection() : selection;
}
```

| Case | Tests | What is asserted |
|---|---|---|
| **T1** explicit selection | 3 | state/ids/count; selector is `kind:'ids'` in click order; selecting all 13 → header checked on both pages |
| **T2** all-filtered selection | 4 | `ids` stays `[]` (no materialization); selector is `kind:'filter'` with trimmed search; every row on both pages selected; `total 0` → idle |
| **T3** excludeIds | 5 | count drops; row unselected; `excludeIds` reaches the selector; header indeterminate not checked; re-toggle removes; excluding all → idle |
| **T4** selectedCount | 3 | all three states; no negative count; display strings |
| **T5** page change | 5 | selection object **identical**; count still from `total` not page rows; exclusion of a page-2 row survives to page 2; selector has no `page`; header per current page |
| **T6** pageSize change | 4 | selection identical; `all-filtered + excludeIds` intact; page resets to 1 while selection survives; selector unchanged |
| **T7** sort change | 4 | selection identical; click order preserved (not re-sorted); selector has no `sort`; page resets |
| **T8** filter change | 5 | cleared to idle on status / search / round; no residue on re-select; page resets |
| **T9** sequences | 2 | page → pageSize → sort in a row leaves selection byte-identical; repeated page changes never move the count |

**Total: 35 tests.**

### Why the assertions are shaped this way

Two properties carry the whole feature and are asserted directly:

1. **`all-filtered` never materializes ids.** `T2` asserts `sel.ids === []` while
   the count equals the server total. That is the entire point of storing the
   complement — a 50,000-row round must not become 50,000 strings in React state.
2. **`page` / `pageSize` / `sort` are not part of the selector.** `T5`, `T6`, `T7`
   each assert the selector is unchanged and contains no `page`/`sort` key. A
   selector describes a *set*, not an *order* or a *window*.

---

## 3. Mutation check — do the tests actually bite?

Passing tests prove nothing if they cannot fail. Three deliberate regressions were
introduced, each run, then reverted (`git diff` confirmed clean afterwards):

| Mutation | Result |
|---|---|
| `shouldClearSelection` also clears on `page` change | **8 failures** — T5 ×3, T6 ×2, T7 ×1, T9 ×1, plus a pageSize assertion |
| `resolveSelectedCount` ignores `excludeIds` (`return total`) | **8 failures** — T3, T4 ×3, T5, T6, T7, T9 |
| `buildApplicationsSelector` drops the `excludeIds` key | **1 failure** — T3 selector shape |

Each mutation is caught by the test that specifically covers it. The suite is not
vacuous.

---

## 4. `npm test`

```
frontend: npm test → FRONTEND_TEST_EXIT=0
backend:  npm test → BACKEND_TEST_EXIT=0
```

New suite confirmed running **inside** the `npm test` chain:

```
Phase 2: Applications Selection — Transitions
ผลการทดสอบ: ผ่าน 35 / FAIL 0
```

Zero `FAIL n` / `FAILED:` lines across the whole frontend log. No pre-existing
suite regressed on either side.

---

## 5. `tsc`

```
frontend: npx tsc --noEmit → F_TSC=0   (0 "error TS")
backend:  npx tsc --noEmit → B_TSC=0   (0 "error TS")
```

Note: the new test file carries `// @ts-nocheck` at the top, matching the
convention of every other suite in `src/lib/__tests__/` (they run under
`node --import tsx`, not through the project's type plumbing). The **production
modules it exercises are fully typechecked** — `tsc` covers
`applications-selection-state.ts` and `applications-list-state.ts` with no errors,
so the types under test are verified even though the test harness itself is not.

---

## 6. Design compliance review

| Requirement | Status | Evidence |
|---|---|---|
| เปลี่ยนเฉพาะ selection state | ✅ | No production file changed |
| ยังไม่ทำ pdf-targets | ✅ | No `pdf-targets` file or reference touched |
| ยังไม่เปลี่ยน export flow | ✅ | `excel-export.service.ts` / `excel-export.routes.ts` untouched |
| ยังไม่เปลี่ยน bulk endpoint contract | ✅ | `admin.routes.ts` untouched |
| ยังไม่แตะ backend selector API | ✅ | `git status -- backend/` empty |
| Frontend represents "เลือกทุกใบที่ตรง filter" | ✅ | `T2` — `kind:'filter'`, `ids: []`, count from `total` |
| ไม่ materialize allFilteredIds | ✅ | `T2` asserts `sel.ids === []`; no id array is ever built for the filtered set |
| Tests: explicit / all-filtered / excludeIds / selectedCount | ✅ | T1–T4 |
| Tests: page / pageSize / sort / filter change | ✅ | T5–T8 |

### One thing worth flagging

The brief's premise ("เปลี่ยนจาก `Set<id>` เป็น `ApplicationsSelector`") did not
match the branch. That work landed earlier — `docs/PHASE_4_APPLICATIONS_SELECTOR_FOUNDATION.md`
describes it, and the commits `2df65504` / `0ee192e9` / `776b5a6f` carry it. I
did not re-do it. If the intent was to verify that phase rather than repeat it,
this report plus the 35 new tests is that verification.

---

## 7. Verification summary

| Check | Result |
|---|---|
| Frontend `npm test` | exit 0 |
| Backend `npm test` | exit 0 |
| Frontend `tsc --noEmit` | exit 0, 0 errors |
| Backend `tsc --noEmit` | exit 0, 0 errors |
| New tests | 35, all passing |
| Mutation check | 3/3 mutations caught |
| Production files changed | **none** |
| Backend files changed | **none** |
| pdf-targets / export / bulk contract touched | none |
| Committed | **no** |
| Pushed | **no** |
| Merged | **no** |

### Working tree

```
 M frontend/package.json
?? frontend/src/lib/__tests__/applications-selection-transitions.test.ts
```

That is the complete change set.

---

## 8. Known limitations

1. **No component-level (DOM) test.** This project has no jsdom and no
   testing-library, so the wiring between `ApplicationsClient` and the selection
   model is still verified by typecheck and review only. The new suite tests the
   *rules* the component calls, not the component's call sites.

2. **`excludeIds` cap of 80 is not exercised here.** `applications-selection-state.test.ts`
   already covers the cap boundary (P4-8e2 / P4-8e3). Not duplicated.

3. **The pre-existing boolean assertions in `applications-list-state.test.ts` were
   left in place.** They are not wrong, just weaker than the new suite. Removing
   them would be a separate cleanup with its own blast radius.

4. **`all-filtered` count trusts `pagination.total`.** If rows change between the
   list fetch and the bulk action, the displayed count can be stale. The server
   stays authoritative — unchanged from before, and inherent to the feature.
