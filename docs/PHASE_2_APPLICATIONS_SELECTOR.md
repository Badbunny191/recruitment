# Phase 2 — ApplicationsSelector Foundation

**Branch:** `feature/applications-pagination-phase1`
**Date:** 2026-10-29
**Status:** Implemented, tests green, **not committed, not pushed**

> **Note on the design document.** No approved design document exists in the
> repository (`docs/`), in `.perch/plans/`, in chat history, or on disk. This
> implementation follows the Phase 2 scope as specified in the task brief, plus
> the Phase 2 marker already present in the code
> (`ApplicationsClient.tsx:867` — "Phase 2 (all-filtered) จะเปลี่ยนให้ครอบทุกหน้า").
> Anything not covered by that brief was left untouched rather than invented.

---

## 1. Files changed

### New files

| File | Purpose |
|---|---|
| `backend/src/lib/applications-selector.ts` | `SelectionState` type, `ApplicationsSelector` union, `normalizeSelectorInput()`, `resolveSelectorWhere()`, `resolveSelectorIds()`, `countSelectorRows()`, `describeSelector()`, `dedupeIds()` |
| `backend/src/lib/__tests__/applications-selector.test.ts` | 13 tests — selector normalization + equivalence |
| `frontend/src/lib/applications-selection.ts` | Client `SelectionState`, `resolveSelectionState()`, `buildApplicationsSelector()`, `buildBulkStatusPayload()`, `buildExportSelectedPayload()`, `describeSelection()`, `canSubmitSelection()` |
| `frontend/src/lib/__tests__/applications-selection.test.ts` | 12 tests — client selection state → selector |

### Modified files

| File | Change |
|---|---|
| `backend/src/schemas/validators.ts` | **Added** `ApplicationsSelectorIdsSchema`, `ApplicationsSelectorFilterSchema`, `ApplicationsSelectorSchema`, `BulkApplicationStatusSelectorSchema`. Legacy `BulkApplicationStatusUpdateSchema` left in place, unchanged. |
| `backend/src/routes/admin.routes.ts` | `bulk-status` now accepts `{ selector }` and `{ ids }`; resolves one where clause via `resolveSelectorWhere()`; audit payload gains `selector` describe. |
| `backend/src/services/excel-export.service.ts` | `SelectedExportRequest` gains optional `selector`; `applicationIds` becomes optional; new `kind: 'filter'` export path; legacy `kind: 'ids'` path unchanged. |
| `backend/src/routes/excel-export.routes.ts` | `ExcelExportSelectedSchema` accepts `applicationIds` **or** `selector` (exactly one); handler passes both through. |
| `backend/src/routes/__tests__/bulk-status-validation.test.ts` | +7 tests (BS12–BS18) for selector support. |
| `backend/src/services/__tests__/excel-export.service.test.ts` | +8 tests (SEL-SEL-A–H) for selector support. |
| `backend/package.json` | `test` script registers the new selector suite. |
| `frontend/package.json` | `test` script + `test:applications-selection` script registered. |

### Explicitly not touched

- No `pdf-targets` endpoint
- No bulk PDF redesign (`pdf-bulk-download.ts`, `ApplicationsClient.tsx` untouched)
- No UI redesign — **`ApplicationsClient.tsx` was not modified at all**
- No dead-code cleanup
- No index work
- No migration

---

## 2. Tests added

| Suite | Count | Covers |
|---|---|---|
| `applications-selector.test.ts` | 13 | Normalization of all 4 payload shapes, fail-closed on ambiguity, `resolveSelectorWhere` for both kinds, **selector ↔ `/applications/ids` equivalence**, dedupe, empty-ids safety, audit describe has no PII |
| `bulk-status-validation.test.ts` (BS12–BS18) | +7 | `selector: ids` ≡ `{ ids }`, `selector: filter` updates all matching rows, empty filter → 400, missing `roundId` → 400, selector+ids together → 400, DRAFT/ARCHIVED still rejected via selector, audit describe |
| `excel-export.service.test.ts` (SEL-SEL-A–H) | +8 | `selector: ids` ≡ `applicationIds` (row order + application numbers identical), reject-all on unexportable ID, `selector: filter` ≡ filtered export, DRAFT excluded, empty filter → 422, round mismatch → 422, audit describe, HTTP route accepts both shapes |
| `applications-selection.test.ts` | 12 | `SelectionState` resolution, all-filtered precedence, null selectors, status/search normalization, payload builders, submit gating |

**Total: 40 new tests.** All pre-existing tests in both suites still pass.

### Key equivalence result

`SE10` proves that `resolveSelectorWhere({ kind: 'filter', roundId, status, search })`
returns **exactly** the same id set as `GET /admin/applications/ids` with the same
filters, across 6 filter combinations. This is the core guarantee of Phase 2:
"select all filtered" means the same set the user sees.

---

## 3. `npm test`

```
backend:  BACKEND_TEST_EXIT=0
frontend: FRONTEND_TEST_EXIT=0
```

New suites confirmed running inside `npm test`:
- `PASSED: 13/13` — applications-selector
- `PASSED: 18/18` — bulk-status-validation (11 original + 7 new)
- `SEL-SEL-A` … `SEL-SEL-H` all ✓ — excel-export.service

---

## 4. `tsc`

```
backend:  B_TSC=0
frontend: F_TSC=0
```

No `error TS` output from either project.

---

## 5. Compatibility review

### Legacy `{ ids }` — bulk-status

| Aspect | Before | After | Verdict |
|---|---|---|---|
| Validation | `BulkApplicationStatusUpdateSchema` | `BulkApplicationStatusSelectorSchema` (same `ids` rules: array, min 1, non-empty strings) | ✅ equivalent |
| `ids: []` | 400 | 400 | ✅ (regression caught by BS5, fixed) |
| `ids: 'string'` | 400 | 400 | ✅ |
| `ids: ['']` | 400 | 400 | ✅ |
| `status` missing | 400 | 400 | ✅ |
| DRAFT / ARCHIVED | 400 + specific message | 400 + same message | ✅ |
| `updated` count | `ids.length` | `ids.length` for `kind: 'ids'` | ✅ preserved exactly |
| Deleted rows | not updated | not updated | ✅ |
| Audit `applicationIds` | raw `ids` | raw `ids` for `kind: 'ids'` | ✅ |
| Audit `previousStatus` / `newStatus` / `actor` / `reason` | present | present | ✅ |
| Response shape | `{success, updated, data}` | identical | ✅ |

### Legacy `{ roundId, applicationIds }` — export-selected

| Aspect | Before | After | Verdict |
|---|---|---|---|
| Schema | `applicationIds` required, min 1, max 1000 | optional but exactly-one-of with `selector`; same min/max | ✅ |
| Missing `applicationIds` | 400 "กรุณาระบุรายการที่เลือก" | 400 "กรุณาระบุ selector หรือ applicationIds อย่างใดอย่างหนึ่ง" | ⚠️ message text changed, status code same |
| Dedupe | `new Set(applicationIds)` | identical for `kind: 'ids'` | ✅ |
| Cross-round reject | 422 + `missingCount` | identical | ✅ |
| Soft-deleted reject | 422 | identical | ✅ |
| Row order | submittedAt desc, id desc | identical | ✅ |
| Audit payload | `{roundId, exportMode:'SELECTED', selectedCount, rowCount, …}` | identical (no `selector` key added on legacy path) | ✅ |
| Filename | from round in D1 | identical | ✅ |

### Frontend

`ApplicationsClient.tsx` is **unchanged**. The existing `{ ids }` and
`{ roundId, applicationIds }` call sites continue to work untouched. The new
`applications-selection.ts` module is additive and not yet wired into the UI
(that is Phase 3 UI work, outside this scope).

---

## 6. Risk review

### Risk 1 — `kind: 'filter'` resolves at execution time (HIGH, by design)

A filter selector is resolved on the server when the request lands, not when the
user clicked. Between click and execution, rows can be added or change status.

- **Bulk-status:** a row that becomes `SUBMITTED` after the click but before the
  request lands *will* be updated.
- **Export:** same, plus the 1,000-row cap is evaluated at execution time, so a
  filter that was under the cap can return `TOO_MANY_ROWS`.

This is inherent to the feature (it is what "select all filtered" means) and is
the reason the audit payload records the selector describe. **Mitigation
available but not built:** a `dryRun`/count-preview endpoint. Out of scope here.

### Risk 2 — DRAFT divergence between list and export (MEDIUM, pre-existing)

`buildApplicationsListWhere` (used by `resolveSelectorWhere` for `kind: 'filter'`)
does **not** exclude DRAFT. `buildExportWhere` (used by the export filter path)
**does** exclude DRAFT by default.

Consequence: a `filter` selector over a round containing DRAFT rows yields
different counts for bulk-status vs export. Public submissions always insert
`SUBMITTED` (`public.routes.ts:421,495`), so DRAFT rows are effectively
unreachable in production — but the divergence is real and pre-existing.

**Decision:** left as-is deliberately. Changing either side would alter existing
endpoint semantics, which this phase is not allowed to do. Flagged for Phase 3.

### Risk 3 — `updated` count semantics differ by kind (LOW)

- `kind: 'ids'` → `updated = ids.length` (legacy, even if some IDs don't exist)
- `kind: 'filter'` → `updated = rows actually matched`

Preserved legacy behavior rather than "fixing" it, because changing it would
break the existing contract. Documented in code.

### Risk 4 — Unbounded `kind: 'filter'` on bulk-status (MEDIUM)

Bulk-status has no row cap. A filter matching 50,000 rows issues one `UPDATE`
over all of them in a single D1 statement. D1 has statement time limits.

- No cap was added because the brief did not specify one and adding one would
  invent product behavior.
- **Recommendation:** decide on a cap (e.g. reuse `MAX_EXPORT_ROWS`) before the
  UI exposes all-filtered selection.

### Risk 5 — `BulkApplicationStatusUpdateSchema` now unused (LOW)

The legacy schema in `validators.ts` is no longer referenced by the handler. It
was **kept** (not deleted) because the brief forbids dead-code cleanup. It is
still exported and still correct; a future cleanup can remove it.

### Risk 6 — Selector + ids together returns 400 (LOW, intentional)

Fail-closed rather than picking one. A client sending both gets a clear 400
instead of a silent guess about which set was meant.

### Risk 7 — No UI wiring yet (INFORMATIONAL)

`applications-selection.ts` is tested but unused by any component. Nothing in the
running app changes behavior. This is intentional: UI redesign is out of scope.

---

## 7. Verification summary

| Check | Result |
|---|---|
| Backend `npm test` | exit 0 |
| Frontend `npm test` | exit 0 |
| Backend `tsc --noEmit` | exit 0 |
| Frontend `tsc --noEmit` | exit 0 |
| New tests | 40, all passing |
| Pre-existing tests | all still passing |
| Forbidden areas touched | none |
| Committed | **no** |
| Pushed | **no** |

### Working tree

```
 M backend/package.json
 M backend/src/routes/__tests__/bulk-status-validation.test.ts
 M backend/src/routes/admin.routes.ts
 M backend/src/routes/excel-export.routes.ts
 M backend/src/schemas/validators.ts
 M backend/src/services/__tests__/excel-export.service.test.ts
 M backend/src/services/excel-export.service.ts
 M frontend/package.json
?? backend/src/lib/__tests__/applications-selector.test.ts
?? backend/src/lib/applications-selector.ts
?? frontend/src/lib/__tests__/applications-selection.test.ts
?? frontend/src/lib/applications-selection.ts
```

### Open items for Phase 3

1. Decide the bulk-status row cap for `kind: 'filter'`.
2. Resolve the DRAFT divergence between list and export filter semantics.
3. Wire `applications-selection.ts` into `ApplicationsClient.tsx` (UI).
4. Consider a count/preview endpoint so the user sees the resolved set before acting.
