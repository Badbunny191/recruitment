# Phase 5 — ApplicationsSelector Backend Foundation

**Branch:** `feature/applications-pagination-phase1`
**Date:** 2026-10-29
**Status:** Implemented, tests green, **not committed, not pushed, not deployed**
**Reference:** `docs/PHASE_3_APPLICATIONS_PAGINATION.md`

---

## 0. Starting state (important)

A selector foundation **already existed** from Phase 2 (`backend/src/lib/applications-selector.ts`,
13 tests, wired into bulk-status and export-selected). This brief specifies a **different shape**:

| | Phase 2 (found) | Phase 5 (brief) |
|---|---|---|
| filter payload | flat: `{ kind:'filter', roundId, status?, search? }` | nested: `{ kind:'filter', filter:{ roundId, search?, status? } }` |
| exclusions | none | `excludeIds?: string[]` |
| `resolveSelectorWhere` | existed, filter path = list where only | existed, extended (status list, excludeDraft, excludeIds) |
| bulk-status `updated` | `selector.ids.length` for kind `ids` | must not use `ids.length` |

So this phase **evolved** the existing module rather than creating a parallel one. The flat Phase 2
payload is still accepted (see §5).

---

## 1. Files changed

### Modified (8 files, +791 / −72)

| File | Change |
|---|---|
| `backend/src/lib/applications-selector.ts` | New canonical contract (nested `filter` + `excludeIds`). `resolveSelectorWhere(selector, { excludeDraft })` extended. Added `canonicalizeSelector()`, `MAX_SELECTOR_EXCLUDE_IDS = 80`, `SELECTABLE_APPLICATION_STATUSES`. `describeSelector` now reports `excludeCount`. |
| `backend/src/schemas/validators.ts` | `ApplicationsSelectorFilterSchema` accepts nested **and** flat; added `ApplicationsSelectorFilterCriteriaSchema`; `excludeIds` capped at 80 via Zod `.max()`. |
| `backend/src/routes/admin.routes.ts` | bulk-status: `matched` added to every response; `updated` = rows actually written; audit records `matched`. |
| `backend/src/services/excel-export.service.ts` | filter path now uses `resolveSelectorWhere(selector, { excludeDraft: true })` instead of its own inline `buildExportWhere` call; selector canonicalized at the service boundary. |
| `backend/src/routes/excel-export.routes.ts` | Canonicalizes the zod-parsed selector before handing it to the service. |
| `backend/src/lib/__tests__/applications-selector.test.ts` | SE4/SE9/SE10/SE13 updated to the canonical shape; **SE14–SE29 added**. |
| `backend/src/routes/__tests__/bulk-status-validation.test.ts` | **BS19–BS25 added**. |
| `backend/src/services/__tests__/excel-export.service.test.ts` | **SEL-P5-A…G added**. |

### Not touched

- No frontend source changes (brief says frontend tests: none). `frontend/src/lib/applications-selection.ts`
  still emits the flat Phase 2 shape, which the backend still accepts.
- No `pdf-targets` endpoint, no bulk PDF integration, no UI Select-All-Across-Pages, no client `all-filtered` submit path.
- No commit, no push, no deploy.

---

## 2. The contract as implemented

```ts
type ApplicationsSelector =
  | { kind: 'ids'; ids: string[] }
  | {
      kind: 'filter';
      filter: { roundId: string; search?: string | null; status?: string | null };
      excludeIds?: string[];
    }
```

`resolveSelectorWhere(selector, options?)` is the single resolver. Every endpoint calls it; no
endpoint builds its own selector SQL.

| Selector | Where clause produced |
|---|---|
| `kind:'ids'` | `deletedAt IS NULL AND id IN (...)` — empty list → `1 = 0` (never "all") |
| `kind:'filter'` | `buildApplicationsListWhere(roundId, search)` **+** status list **+** `[excludeDraft]` **+** `id NOT IN (excludeIds)` |

The filter base deliberately reuses `buildApplicationsListWhere`, so "select all filtered" is the same
set the user sees on the list page — the Phase 2 equivalence property is preserved (SE10 still passes).

`excludeDraft` exists because export excludes DRAFT while the list query does not (the Phase 3 known
limitation #7). Rather than copy `buildExportWhere` into the selector, the flag is passed by the export
caller only. One resolver, two semantics, explicit at the call site.

---

## 3. Bulk Status — matched / updated

`updated` no longer derives from `ids.length`. Both numbers now come from the DB:

- `matched` = rows the selector actually matched (`SELECT` before the `UPDATE`)
- `updated` = rows actually written (same where clause, so equal to `matched` on success)

Response shape (additive — `success` / `updated` / `data` all still present):

```json
{ "success": true, "matched": 1, "updated": 1, "data": { "status": "QUALIFIED", ... } }
```

**Behaviour change worth reviewing:** previously `{ ids: [live, ghost, ghost] }` returned
`updated: 3` while writing 1 row. It now returns `matched: 1, updated: 1`. HTTP status is unchanged
(200 for kind `ids`, 400 for an empty filter). This is the change the brief asked for, but it is a
visible number change for any caller that trusted the old value — see §5.

---

## 4. Export Selected — MAX_EXPORT_ROWS

Cap logic is unchanged in value and placement: the row set is resolved, then `> MAX_EXPORT_ROWS`
returns `TOO_MANY_ROWS` (422) **before** any workbook is built. `excludeIds` reduces the set before
the cap is applied, so excluding rows can bring an over-cap selection back under the limit.

---

## 5. Backward compatibility review

| Legacy payload | Still works? | Evidence |
|---|---|---|
| `{ ids: [...] }` (bulk-status) | Yes | BS1–BS11, BS19–BS21 |
| `{ applicationIds: [...] }` (export-selected) | Yes | SEL-route-P, SEL-route-Q, SEL-SEL-A |
| `{ selector: { kind:'ids', ids } }` | Yes | BS12, SEL-SEL-A |
| `{ selector: { kind:'filter', roundId, status?, search? } }` (flat, Phase 2) | Yes | BS13–BS18, BS24, SEL-SEL-C…G, SEL-P5-A |
| `{ selector: { kind:'filter', filter:{...} } }` (nested, Phase 5) | Yes | SE14–SE16, BS24, SEL-P5-A |
| `selector` + `ids` together | Rejected 400 | BS16, SE5 |
| Neither | Rejected 400 | BS6, SE6 |

Two mechanisms keep the flat shape alive: `normalizeSelectorObject` falls back to reading `roundId`
off the selector when `filter` is absent, and `canonicalizeSelector` does the same for callers that
invoke the export service directly (bypassing zod).

**One intentional break:** the *canonical* return value of `normalizeSelectorInput` for a flat filter
is now nested. Code that read `selector.roundId` off the normalize result must read
`selector.filter.roundId`. Only the Phase 2 unit test did this (SE4/SE9/SE10/SE13) and it was updated.
No production code read the flat field.

---

## 6. Tests added

### `applications-selector.test.ts` — 29 tests (was 13)

New: SE14 nested canonicalization · SE15 flat ≡ nested · SE16 nested without roundId rejected ·
SE17 excludeIds dedupe · SE18 empty excludeIds → no key · SE19 non-array excludeIds rejected ·
SE20 cap enforcement (80 ok, 81 rejected) · SE21 excludeIds actually excludes · SE22 non-matching
excludeIds harmless · SE23 comma-separated status union · SE24 unknown statuses → 0 rows ·
SE25 excludeDraft drops DRAFT · SE26 status=DRAFT matches `buildExportWhere` exactly ·
SE27 excludeDraft inert for kind `ids` · SE28 canonicalizeSelector · SE29 audit has no ids.

### `bulk-status-validation.test.ts` — 25 tests (was 18)

BS19 ids with ghosts → `matched:1, updated:1` · BS20 soft-deleted not counted · BS21 all-ghost ids →
200 with `updated:0` · BS22 filter counts · BS23 filter + excludeIds · BS24 nested ≡ flat ·
BS25 excludeIds over cap → 400.

### `excel-export.service.test.ts` — 111 tests (was 104)

SEL-P5-A nested ≡ flat · SEL-P5-B excludeIds removes rows from the file · SEL-P5-C exclude-all → 422 ·
SEL-P5-D over cap → `TOO_MANY_ROWS` · SEL-P5-E cap boundary (1,001 rejected, 1,000 via exclusion passes) ·
SEL-P5-F non-matching excludeIds harmless · SEL-P5-G audit `excludeCount`, no ids.

---

## 7. `npm test`

```
backend:  npm test → exit 0
frontend: npm test → exit 0
```

Per-suite confirmation:

```
applications-selector.test.ts        PASSED: 29/29
bulk-status-validation.test.ts       PASSED: 25/25
excel-export.service.test.ts         ผลลัพธ์: 111 ผ่าน, 0 ล้ม
```

No pre-existing suite regressed on either side.

---

## 8. `tsc`

```
backend:  npx tsc --noEmit → B_TSC=0
frontend: npx tsc --noEmit → F_TSC=0
```

No `error TS` output from either project.

---

## 9. Known limitations

1. **`excludeIds` cap is 80, not unbounded.** `NOT IN (...)` becomes bind parameters on D1 (~100 per
   statement). 80 leaves room for roundId/status/search/date binds. Over the cap the request is
   rejected rather than silently truncated. A round where a user deselects more than 80 rows needs a
   different representation (e.g. an explicit id list) — not solved here.

2. **`excludeIds` is not validated against the filter set.** An id outside the filtered set is simply
   harmless (SE22, SEL-P5-F). It is not an error. That is deliberate — the set can change between the
   user's click and the request — but it means `matched` can be lower than the user's arithmetic.

3. **`matched` and `updated` are always equal today.** They are separate fields because they answer
   different questions and could diverge if the update ever gains a guard (e.g. skip rows already in
   the target status). Today the same where clause drives both.

4. **No row cap for bulk-status `kind:'filter'`.** Carried over from Phase 2/3, still open. A filter
   matching 50,000 rows will update all of them in one statement. Not in this brief's scope.

5. **DRAFT divergence still exists between list and export.** `buildApplicationsListWhere` does not
   exclude DRAFT; export does. Now expressed explicitly as `excludeDraft` instead of being an
   accidental difference between two builders — but the underlying semantic difference is unchanged.

6. **`SELECTABLE_APPLICATION_STATUSES` duplicates `ALL_APPLICATION_STATUSES`** in
   `excel-export.service.ts`. They hold the same five values. Merging them would create an import
   cycle (service → selector → service), so they are kept separate with a comment on each side.
   A future move to `db/schema` or a constants module would close it.

7. **`status` accepts comma-separated values but `normalizeSelectorInput` stores it as one trimmed
   string.** Parsing happens at resolve time. Fine for the current callers; a caller that needs the
   parsed list must re-parse.

8. **Frontend still emits the flat shape.** `frontend/src/lib/applications-selection.ts` was not
   changed (brief: no frontend work). It keeps working via the fallback, but the two sides now differ
   in canonical form. Aligning them is a Phase 6 item.

9. **`applications-selection-state.ts` still blocks `all-filtered` + `excludeIds`** with the message
   "backend ยังไม่รองรับ excludeIds". That blocker is now stale — the backend supports it. Left as-is
   because the brief scopes out the client submit path; flagging it so it is not forgotten.

---

## 10. Verification summary

| Check | Result |
|---|---|
| Backend `npm test` | exit 0 |
| Frontend `npm test` | exit 0 |
| Backend `tsc --noEmit` | exit 0 |
| Frontend `tsc --noEmit` | exit 0 |
| Selector tests | 29/29 |
| Bulk-status tests | 25/25 |
| Export tests | 111/111 |
| `updated` derived from `ids.length` | removed (BS19–BS21) |
| Duplicate selector logic in export | removed — uses `resolveSelectorWhere` |
| Legacy payloads | all still accepted (§5) |
| Committed | **no** |
| Pushed | **no** |
| Deployed | **no** |

### Working tree

```
 M backend/src/lib/__tests__/applications-selector.test.ts
 M backend/src/lib/applications-selector.ts
 M backend/src/routes/__tests__/bulk-status-validation.test.ts
 M backend/src/routes/admin.routes.ts
 M backend/src/routes/excel-export.routes.ts
 M backend/src/schemas/validators.ts
 M backend/src/services/__tests__/excel-export.service.test.ts
 M backend/src/services/excel-export.service.ts
```

Branch `feature/applications-pagination-phase1`, HEAD `2df65504`. Nothing staged.

---

## 11. Awaiting review

Nothing has been committed, pushed, deployed, or merged. Two things I would want a decision on
before this lands:

1. The `updated` semantic change for kind `ids` (§3) — correct per the brief, but it changes a number
   existing callers may have relied on.
2. The `excludeIds` cap of 80 (§9.1) — a real product constraint that the UI will have to respect.
