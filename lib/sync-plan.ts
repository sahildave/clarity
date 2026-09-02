/**
 * What to push and what to apply, decided from plain data.
 *
 * PURE module: no React, no `services/`, no Convex client. The sync component
 * (`components/convex-sync.tsx`) feeds it the local snapshots, the remote query
 * results, and the durable cursors, and executes whatever comes back. Keeping
 * the decisions here is what lets `scripts/test-sync.ts` cover them under bun
 * with no simulator and no deployment.
 *
 * The rules, per store:
 *
 *  - Sessions are immutable events. Push everything past the `pushedSeq`
 *    cursor except rows that arrived from the server this session; the server
 *    dedupes on the device id anyway, so a wrong guess costs a round trip, not
 *    a duplicate.
 *  - Passages are add plus soft delete. Compared as whole sets, so no cursor.
 *  - Settings reconcile field by field on write stamps; ties go to the server.
 */

import type { WordDelta } from '@/lib/history-store';
import type { SessionRecord } from '@/types/history';
import type { CustomPassage } from '@/types/session';
import type { Settings } from '@/types/settings';

// --- sessions ----------------------------------------------------------------

/** A session row as the server stores it: the record minus `id`, plus the
 * device id it came from and the verdicts that let mastery rebuild. */
export type RemoteSession = Omit<SessionRecord, 'id'> & {
  clientId: string;
  wordDeltas?: WordDelta[];
};

/** Server-added fields on a row read back from a query. */
export type RemoteSessionRow = RemoteSession & {
  _id: string;
  _creationTime: number;
  userId: string;
};

export function toRemoteSession(record: SessionRecord, deltas: WordDelta[] | null): RemoteSession {
  const { id, ...rest } = record;
  const out: RemoteSession = { ...rest, clientId: id };
  if (deltas && deltas.length > 0) out.wordDeltas = deltas;
  return out;
}

/** Strip server bookkeeping. The result is fed through `parseRecord` by the
 * store's import path, so nothing here is trusted yet. */
export function fromRemoteSession(row: RemoteSessionRow): SessionRecord {
  const { _id, _creationTime, userId, clientId, wordDeltas, ...rest } = row;
  return { ...rest, id: clientId };
}

export function expandWordDeltas(deltas: readonly WordDelta[]): { word: string; status: string }[] {
  return deltas.map(({ w, s }) => ({ word: w, status: s }));
}

/**
 * Records still to upload, oldest first, capped at `batch`. `exclude` holds
 * the ids that arrived FROM the server during this run: they carry seqs above
 * the cursor but were never local writes.
 */
export function planSessionPush(
  records: readonly SessionRecord[],
  pushedSeq: number,
  exclude: ReadonlySet<string>,
  batch: number,
): SessionRecord[] {
  const out: SessionRecord[] = [];
  for (const record of records) {
    if (record.seq <= pushedSeq || exclude.has(record.id)) continue;
    out.push(record);
  }
  out.sort((a, b) => a.seq - b.seq);
  return out.slice(0, batch);
}

/** After a drain with nothing left to push, the cursor can jump to the highest
 * seq in the store; that folds imported rows in so they are never re-offered. */
export function settledSeq(records: readonly SessionRecord[], pushedSeq: number): number {
  let max = pushedSeq;
  for (const record of records) if (record.seq > max) max = record.seq;
  return max;
}

// --- passages ----------------------------------------------------------------

export type RemotePassage = {
  clientId: string;
  title: string;
  text: string;
  targetWpm: number;
  duration: string;
  artwork: { base: string[]; blob: string[] };
  createdAt: number;
  deletedAt?: number;
};

export function toRemotePassage(passage: CustomPassage): RemotePassage {
  return {
    clientId: passage.id,
    title: passage.title,
    text: passage.text,
    targetWpm: passage.targetWpm,
    duration: passage.duration,
    artwork: { base: [...passage.artwork.base], blob: [...passage.artwork.blob] },
    createdAt: passage.createdAt,
  };
}

/** Null when the row is malformed, so one bad server row cannot take the
 * library with it. */
export function fromRemotePassage(row: RemotePassage): CustomPassage | null {
  if (row.artwork.base.length !== 2 || row.artwork.blob.length !== 2) return null;
  if (row.text.length === 0) return null;
  return {
    id: row.clientId,
    title: row.title,
    text: row.text,
    targetWpm: row.targetWpm,
    duration: row.duration,
    artwork: {
      base: [row.artwork.base[0], row.artwork.base[1]],
      blob: [row.artwork.blob[0], row.artwork.blob[1]],
    },
    category: 'custom',
    custom: true,
    createdAt: row.createdAt,
  };
}

export type PassagePlan = {
  /** Local passages the server has never seen. */
  push: CustomPassage[];
  /** Deletes made here that the server still shows as live. */
  removeRemote: string[];
  /** Live server passages this device lacks. */
  addLocal: CustomPassage[];
  /** Server-deleted passages this device still shows. */
  removeLocal: string[];
  /**
   * Pending deletes the server has already recorded, so this device can stop
   * carrying them.
   *
   * A pending id absent from `remote` is NOT here. Absence from one snapshot
   * proves nothing: the row may exist and simply not be in the copy this run
   * read. Settling on absence is what let a delete be forgotten and the
   * passage come back on a later pull.
   */
  settle: string[];
};

export function planPassages(
  local: readonly CustomPassage[],
  remote: readonly RemotePassage[],
  pendingDeletes: readonly string[],
): PassagePlan {
  const remoteById = new Map(remote.map((row) => [row.clientId, row]));
  const localIds = new Set(local.map((p) => p.id));
  const pending = new Set(pendingDeletes);
  const plan: PassagePlan = {
    push: [],
    removeRemote: [],
    addLocal: [],
    removeLocal: [],
    settle: [],
  };

  for (const passage of local) {
    const row = remoteById.get(passage.id);
    if (row === undefined) {
      // Deleted here before it was ever uploaded: nothing to push, nothing to
      // delete remotely.
      if (!pending.has(passage.id)) plan.push.push(passage);
    } else if (row.deletedAt !== undefined) {
      plan.removeLocal.push(passage.id);
    }
  }

  for (const row of remote) {
    if (row.deletedAt !== undefined) {
      // The server carries the delete now, so this device need not.
      if (pending.has(row.clientId)) plan.settle.push(row.clientId);
      continue;
    }
    if (localIds.has(row.clientId)) continue;
    if (pending.has(row.clientId)) {
      plan.removeRemote.push(row.clientId);
      continue;
    }
    const passage = fromRemotePassage(row);
    if (passage) plan.addLocal.push(passage);
  }

  return plan;
}

// --- settings ----------------------------------------------------------------

export type SettingsKey = keyof Settings;
export type SettingsStamps = Record<SettingsKey, number>;

export type RemoteSettings = Settings & { stamps: SettingsStamps };

export type SettingsPatch = {
  patch: Partial<Settings>;
  stamps: Partial<SettingsStamps>;
};

export type SettingsPlan = {
  /** Fields whose local write is strictly newer than the server's. */
  push: SettingsPatch | null;
  /** Fields the server knows better; the store re-checks stamps on apply. */
  apply: SettingsPatch | null;
};

const SETTINGS_KEYS: readonly SettingsKey[] = [
  'accentLocale',
  'improveClarity',
  'displayName',
  'goalMinutes',
  'prioritySkill',
  'onboardingCompletedAt',
];

export function planSettings(
  local: Settings,
  localStamps: SettingsStamps,
  remote: RemoteSettings | null,
): SettingsPlan {
  const push: SettingsPatch = { patch: {}, stamps: {} };
  const apply: SettingsPatch = { patch: {}, stamps: {} };
  let pushes = 0;
  let applies = 0;

  for (const key of SETTINGS_KEYS) {
    const localStamp = localStamps[key] ?? 0;
    const remoteStamp = remote?.stamps[key] ?? 0;
    const same = remote !== null && remote[key] === local[key];

    if (localStamp > remoteStamp) {
      // A field never written locally has stamp 0 and never wins, so a fresh
      // install cannot overwrite the account with defaults.
      if (localStamp === 0 || same) continue;
      (push.patch as Record<string, unknown>)[key] = local[key];
      push.stamps[key] = localStamp;
      pushes += 1;
    } else if (remote !== null && remoteStamp > 0 && !same) {
      (apply.patch as Record<string, unknown>)[key] = remote[key];
      apply.stamps[key] = remoteStamp;
      applies += 1;
    }
  }

  return { push: pushes > 0 ? push : null, apply: applies > 0 ? apply : null };
}
