/**
 * Apply Draft — sessionStorage helper
 * --------------------------------------------
 * Stores the in-progress application data between `/apply` and
 * `/apply/review` so the user can navigate back to edit without losing
 * their input.
 *
 * The "Edit" button on the review page calls `loadApplyDraft(roundId)`,
 * which gives the apply page the exact data to rehydrate. The apply
 * page then writes back the (possibly modified) draft via
 * `saveApplyDraft(roundId, …)` on the next "ตรวจสอบข้อมูล" click.
 *
 * Storage choice: `sessionStorage` (per-tab) is correct here:
 *   - Same tab navigation between /apply and /apply/review must persist.
 *   - A new tab starting a fresh application should NOT inherit a draft.
 *   - Closing the tab should drop the draft (privacy + correctness).
 *
 * Schema versioning: each save bumps a `version` field. If the schema
 * changes between sessions (e.g. we add a new required field), the page
 * can detect an old draft and discard it instead of sending a partial
 * payload to the server.
 */

const DRAFT_PREFIX = 'applyDraft:';
const DRAFT_VERSION = 1;

export type FileAttachmentDraft = {
  fieldId: string;
  fileUrl: string;
  // Optional metadata captured at upload time so the review page can
  // show a friendly file name + type without re-fetching.
  fileName?: string;
  contentType?: string;
  // Attachment Lifecycle (Migration 029) — capability + signed view URL
  // จาก response ตอน upload (undefined = ไฟล์จาก draft รูปแบบเก่า —
  // ลบได้เฉพาะ state และเปิดดูผ่านลิงก์เดิมซึ่งจะ 403 เพราะไม่มี signature)
  ledgerId?: string;
  deleteToken?: string;
  viewUrl?: string;
};

export type ApplyDraft = {
  version: number;
  roundId: string;
  formData: Record<string, unknown>;
  attachments: FileAttachmentDraft[];
  // The submissionToken is duplicated into the draft so the review page
  // can read it without an extra round-trip to sessionStorage. On a
  // successful submit the page clears BOTH the draft and the token.
  submissionToken: string;
  // When the draft was last saved, for debugging / display.
  savedAt: number;
};

function isStorageAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const probe = '__probe__';
    window.sessionStorage.setItem(probe, probe);
    window.sessionStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

const useFallback = !isStorageAvailable();
const memoryFallback: Map<string, string> = new Map();

function key(roundId: string): string {
  return `${DRAFT_PREFIX}${roundId}`;
}

function readRaw(roundId: string): string | null {
  const k = key(roundId);
  if (useFallback) {
    return memoryFallback.get(k) ?? null;
  }
  try {
    return window.sessionStorage.getItem(k);
  } catch {
    return memoryFallback.get(k) ?? null;
  }
}

function writeRaw(roundId: string, value: string): void {
  const k = key(roundId);
  if (useFallback) {
    memoryFallback.set(k, value);
    return;
  }
  try {
    window.sessionStorage.setItem(k, value);
  } catch {
    memoryFallback.set(k, value);
  }
}

function removeRaw(roundId: string): void {
  const k = key(roundId);
  if (useFallback) {
    memoryFallback.delete(k);
    return;
  }
  try {
    window.sessionStorage.removeItem(k);
  } catch {
    memoryFallback.delete(k);
  }
}

/**
 * Persist a draft. Always overwrites the previous draft for the same
 * round. Pass `submissionToken: ''` if the caller doesn't have one yet —
 * the apply page will hydrate it on the next mount.
 */
export function saveApplyDraft(input: {
  roundId: string;
  formData: Record<string, unknown>;
  attachments: FileAttachmentDraft[];
  submissionToken: string;
}): ApplyDraft {
  const draft: ApplyDraft = {
    version: DRAFT_VERSION,
    roundId: input.roundId,
    formData: input.formData,
    attachments: input.attachments,
    submissionToken: input.submissionToken,
    savedAt: Date.now(),
  };
  writeRaw(input.roundId, JSON.stringify(draft));
  return draft;
}

/**
 * Load the draft for a round. Returns `null` if no draft exists, or if
 * the stored draft is from an older schema version (discarded silently).
 */
export function loadApplyDraft(roundId: string): ApplyDraft | null {
  const raw = readRaw(roundId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ApplyDraft;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== DRAFT_VERSION) {
      // Schema changed — drop the old draft.
      removeRaw(roundId);
      return null;
    }
    if (parsed.roundId !== roundId) {
      // Mismatched round — shouldn't happen, but be defensive.
      removeRaw(roundId);
      return null;
    }
    return parsed;
  } catch {
    // Corrupted — drop it.
    removeRaw(roundId);
    return null;
  }
}

/**
 * Remove the draft for a round. Call this on a successful submit and
 * when the user explicitly cancels the apply flow.
 */
export function clearApplyDraft(roundId: string): void {
  removeRaw(roundId);
}

/**
 * Returns the list of round IDs that currently have a draft. Used by
 * the home page to show a "Resume your application" hint. Not required
 * by the spec but cheap to add for the next PR.
 */
export function listDraftRoundIds(): string[] {
  if (useFallback) {
    return Array.from(memoryFallback.keys())
      .filter((k) => k.startsWith(DRAFT_PREFIX))
      .map((k) => k.slice(DRAFT_PREFIX.length));
  }
  try {
    const ids: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(DRAFT_PREFIX)) ids.push(k.slice(DRAFT_PREFIX.length));
    }
    return ids;
  } catch {
    return [];
  }
}

/**
 * Test-only helper. Not used in production code.
 */
export function __resetApplyDraftsForTests(): void {
  memoryFallback.clear();
  if (typeof window !== 'undefined' && !useFallback) {
    try {
      const keys: string[] = [];
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const k = window.sessionStorage.key(i);
        if (k && k.startsWith(DRAFT_PREFIX)) keys.push(k);
      }
      keys.forEach((k) => window.sessionStorage.removeItem(k));
    } catch { /* ignore */ }
  }
}
