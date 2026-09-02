import { useAuth } from '@clerk/expo';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { useEffect, useRef, useState } from 'react';

import { api } from '@/convex/_generated/api';
import { PASSAGE_PUSH_BATCH, PASSAGE_REMOVE_BATCH } from '@/convex/limits';
import { EXPORT_KIND, EXPORT_VERSION, type HistoryExport } from '@/lib/history-schema';
import {
  expandWordDeltas,
  fromRemoteSession,
  planPassages,
  planSessionPush,
  planSettings,
  settledSeq,
  toRemotePassage,
  toRemoteSession,
  type SettingsStamps,
} from '@/lib/sync-plan';
import {
  applyWordVerdicts,
  getRecords,
  getWordDeltas,
  importHistory,
  removeWordDeltas,
  subscribe as subscribeHistory,
} from '@/services/session-history';
import {
  applyRemoteSettings,
  getSettingUpdatedAt,
  getSettings,
  subscribe as subscribeSettings,
} from '@/services/settings';
import {
  getPendingPassageDeletes,
  getSessionsPulledAt,
  getSessionsPushedSeq,
  isSyncSuspended,
  markSettingsResolved,
  resumeSync,
  setSessionsPulledAt,
  setSessionsPushedSeq,
  settlePassageDeletes,
} from '@/services/sync-state';
import {
  applyRemotePassages,
  getCustomPassages,
  subscribe as subscribePassages,
} from '@/services/user-passages';
import type { Settings } from '@/types/settings';

/** Matches `PUSH_BATCH` in `convex/sessions.ts`. */
const SESSION_PUSH_BATCH = 50;
/**
 * Small on purpose. A session carries up to `WORD_DELTAS_MAX` per-word verdicts
 * (2000, the store's own cap), which is roughly 80 KB of response for one row.
 * A 200-row page of those is ~16 MB and blows Convex's read limit, and a query
 * that exceeds it fails EVERY time it runs: the pull would never recover.
 * 25 pages the same history in more, safely sized round trips.
 */
const SESSION_PULL_PAGE = 25;
/**
 * How long a fresh install waits for the account's settings before falling
 * through to onboarding. Offline, the query never answers; the user must still
 * be able to start. A later sync reconciles the answers on their stamps.
 */
const GATE_TIMEOUT_MS = 3000;

/**
 * Renders nothing. Keeps the local stores and Convex in step, in both
 * directions, for the signed-in user.
 *
 * This is the ONLY place `useConvexAuth`, `useQuery`, and `useMutation` touch
 * app data. Screens keep reading MMKV through the stores, synchronously, so the
 * first frame renders offline exactly as it did before accounts existed. Convex
 * changes what is IN the stores, never how the gate reads them.
 *
 * Push and pull both run in effects, never in render, and a failure leaves the
 * durable cursor where it was so the next change retries.
 */
export function ConvexSync() {
  const { isAuthenticated } = useConvexAuth();
  useGateResolution();
  if (!isAuthenticated) return null;
  return <AuthenticatedSync />;
}

/**
 * The three sync effects, mounted only while Convex holds a session.
 *
 * Its MOUNT is what lifts the teardown latch (`services/sync-state.ts`). A
 * sign-out or a deletion sets the latch, this subtree unmounts a beat later
 * when Convex drops the session, and the next mount belongs to whoever signs
 * in next. Lifting it on every render instead would undo the suspension the
 * moment a Clerk state change re-rendered the tree, which is precisely what a
 * teardown does.
 *
 * In render, not an effect: child effects run before a parent's, so an effect
 * here would leave the children's first push looking at a stale latch.
 */
function AuthenticatedSync() {
  const mounted = useRef(false);
  if (!mounted.current) {
    mounted.current = true;
    resumeSync();
  }
  return (
    <>
      <SessionSync />
      <PassageSync />
      <SettingsSync />
    </>
  );
}

/**
 * Lifts the splash hold. Resolved by whichever comes first: the settings query
 * answering (in `SettingsSync`), Clerk reporting signed-out, or the timeout.
 */
function useGateResolution() {
  const { isLoaded, isSignedIn } = useAuth();
  useEffect(() => {
    if (isLoaded && !isSignedIn) markSettingsResolved();
  }, [isLoaded, isSignedIn]);
  useEffect(() => {
    const timer = setTimeout(markSettingsResolved, GATE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);
}

// --- sessions ----------------------------------------------------------------

function SessionSync() {
  const push = useMutation(api.sessions.push);
  /** Ids that arrived from the server this run. Never pushed back. */
  const pulledIds = useRef(new Set<string>());

  // Push: everything past the cursor, in seq order, one batch at a time.
  useEffect(() => {
    let cancelled = false;
    let running = false;

    const run = async () => {
      if (running || isSyncSuspended()) return;
      running = true;
      try {
        for (;;) {
          const records = getRecords();
          const batch = planSessionPush(
            records,
            getSessionsPushedSeq(),
            pulledIds.current,
            SESSION_PUSH_BATCH,
          );
          if (batch.length === 0) {
            // Nothing local left: fold any imported rows into the cursor so
            // they are never offered again.
            setSessionsPushedSeq(settledSeq(records, getSessionsPushedSeq()));
            break;
          }
          await push({
            records: batch.map((record) => toRemoteSession(record, getWordDeltas(record.id))),
          });
          if (cancelled) break;
          setSessionsPushedSeq(batch[batch.length - 1].seq);
          for (const record of batch) removeWordDeltas(record.id);
        }
      } catch (error) {
        console.warn('[sync] session push failed; will retry on the next change', error);
      } finally {
        running = false;
      }
    };

    void run();
    const unsubscribe = subscribeHistory(() => void run());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [push]);

  // Pull: page through everything inserted after the cursor, then stay
  // subscribed at the tail for other devices' sessions.
  const [after, setAfter] = useState(getSessionsPulledAt);
  const page = useQuery(api.sessions.since, { after, limit: SESSION_PULL_PAGE });

  useEffect(() => {
    if (!page || page.length === 0 || isSyncSuspended()) return;
    const localIds = new Set(getRecords().map((record) => record.id));
    // Recorded here and folded at write time; folding again would double count.
    const fresh = page.filter((row) => !localIds.has(row.clientId));
    for (const row of fresh) pulledIds.current.add(row.clientId);

    if (fresh.length > 0) {
      // Through the store's import path, so server rows cross the same
      // untrusted-bytes boundary (`parseRecord`) as bytes on disk.
      const envelope: HistoryExport = {
        kind: EXPORT_KIND,
        version: EXPORT_VERSION,
        exportedAt: Date.now(),
        records: fresh.map(fromRemoteSession),
        words: [],
      };
      const summary = importHistory(JSON.stringify(envelope), 'merge');
      if (!summary.ok) {
        // A rejected envelope imported NOTHING. Returning before the cursor
        // moves retries this page later; folding its verdicts anyway would put
        // word mastery permanently ahead of the sessions that explain it.
        console.warn('[sync] session import rejected', summary.reason);
        return;
      }
      // Only the rows the store kept. `parseRecord` can reject one row out of a
      // valid envelope (`summary.failed`), and that row's verdicts have no
      // session behind them.
      const stored = new Set(getRecords().map((record) => record.id));
      for (const row of fresh) {
        if (!stored.has(row.clientId)) continue;
        if (row.wordDeltas && row.wordDeltas.length > 0) {
          applyWordVerdicts(expandWordDeltas(row.wordDeltas), row.completedAt, row.endedReason);
        }
      }
    }

    const last = page[page.length - 1]._creationTime;
    setSessionsPulledAt(last);
    setAfter(last);
  }, [page]);

  return null;
}

// --- passages ----------------------------------------------------------------

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

function PassageSync() {
  const push = useMutation(api.passages.push);
  const remove = useMutation(api.passages.remove);
  const remote = useQuery(api.passages.list, {});
  const remoteRef = useRef(remote);
  remoteRef.current = remote;

  useEffect(() => {
    let cancelled = false;
    let running = false;

    const run = async () => {
      const rows = remoteRef.current;
      if (rows === undefined || running || isSyncSuspended()) return;
      running = true;
      try {
        const pending = getPendingPassageDeletes();
        const plan = planPassages(getCustomPassages(), rows, pending);

        if (plan.addLocal.length > 0 || plan.removeLocal.length > 0) {
          applyRemotePassages(plan.addLocal, plan.removeLocal);
        }
        // Both mutations cap their batch (see `convex/limits.ts`), so a
        // library larger than one batch goes up in several calls rather than
        // being refused whole.
        for (const batch of chunk(plan.push, PASSAGE_PUSH_BATCH)) {
          if (cancelled) return;
          await push({ passages: batch.map(toRemotePassage) });
        }
        if (cancelled) return;
        for (const batch of chunk(plan.removeRemote, PASSAGE_REMOVE_BATCH)) {
          if (cancelled) return;
          await remove({ clientIds: batch, at: Date.now() });
        }
        if (cancelled) return;
        // Only what the server has: the ids just patched, plus the ones its
        // snapshot already showed deleted. A pending id merely MISSING from
        // that snapshot stays pending, because the row may exist in a copy
        // this run did not read.
        const settled = [...plan.settle, ...plan.removeRemote];
        if (settled.length > 0) settlePassageDeletes(settled);
      } catch (error) {
        console.warn('[sync] passage sync failed; will retry on the next change', error);
      } finally {
        running = false;
      }
    };

    void run();
    const unsubscribe = subscribePassages(() => void run());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [push, remove, remote]);

  return null;
}

// --- settings ----------------------------------------------------------------

function readLocalStamps(): SettingsStamps {
  return {
    accentLocale: getSettingUpdatedAt('accentLocale'),
    improveClarity: getSettingUpdatedAt('improveClarity'),
    displayName: getSettingUpdatedAt('displayName'),
    goalMinutes: getSettingUpdatedAt('goalMinutes'),
    prioritySkill: getSettingUpdatedAt('prioritySkill'),
    onboardingCompletedAt: getSettingUpdatedAt('onboardingCompletedAt'),
  };
}

function SettingsSync() {
  const push = useMutation(api.settings.push);
  const remote = useQuery(api.settings.get, {});
  const remoteRef = useRef(remote);
  remoteRef.current = remote;

  // The account's answer is in, whether or not it has a document yet.
  useEffect(() => {
    if (remote !== undefined) markSettingsResolved();
  }, [remote]);

  useEffect(() => {
    let cancelled = false;
    let running = false;

    const run = async () => {
      const doc = remoteRef.current;
      if (doc === undefined || running || isSyncSuspended()) return;
      running = true;
      try {
        const local: Settings = getSettings();
        const plan = planSettings(local, readLocalStamps(), doc);
        if (plan.apply) applyRemoteSettings(plan.apply.patch, plan.apply.stamps);
        if (plan.push && !cancelled) await push(plan.push);
      } catch (error) {
        console.warn('[sync] settings sync failed; will retry on the next change', error);
      } finally {
        running = false;
      }
    };

    void run();
    const unsubscribe = subscribeSettings(() => void run());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [push, remote]);

  return null;
}
