/**
 * Persisted session history: the single store behind Home stats, Practice
 * recommendations, and Analytics.
 *
 * This module is deliberately thin. All the logic — hydration, validation,
 * quarantine, the one-time migration, crash recovery, export/import — lives in
 * `lib/history-store.ts`, which is pure and takes its key-value backend as a
 * parameter so it can be tested under bun. Here we only bind that store to MMKV,
 * to expo-file-system for the legacy import, and to the app's version string.
 */

import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';

import { createHistoryStore } from '@/lib/history-store';
import { durable, kv } from '@/services/kv';
import { summarizeWords } from '@/services/ai-coaching';
import { practiceEnded, practiceStarted } from '@/services/observe-events';
import type { InflightSession, SessionEndedReason, SessionMode } from '@/types/history';
import type { SessionResult } from '@/types/session';

export type { WriteResult, ImportSummary, StorageStats, WordDelta } from '@/lib/history-store';

/** The pre-MMKV store. Never deleted: it stays a free backup, and if MMKV is
 * ever cleared the migration guard clears with it and the import re-runs. */
function readLegacyJson(): string | null {
  try {
    const file = new File(Paths.document, 'user', 'sessions.json');
    return file.exists ? file.textSync() : null;
  } catch {
    return null;
  }
}

const store = createHistoryStore({
  kv,
  durable,
  readLegacyJson,
  appVersion: Constants.expoConfig?.version ?? undefined,
  onWarn: (message, detail) => console.warn(message, detail),
});

export const getRecords = store.getRecords;
export const subscribe = store.subscribe;
export const getWordStats = store.getWordStats;
export const removeRecord = store.removeRecord;
export const clearHistory = store.clearAll;
export const clearAccountHistory = store.clearAccountData;
export const exportHistory = store.exportHistory;
export const importHistory = store.importHistory;
export const getQuarantine = store.getQuarantine;
export const getStorageStats = store.getStats;
export const getLastError = store.getLastError;
export const checkpointSession = store.checkpointSession;
export const endSession = store.endSession;
/** Sync-layer seams: verdicts awaiting upload, and the fold for ones that
 * arrived from another device. */
export const getWordDeltas = store.getWordDeltas;
export const removeWordDeltas = store.removeWordDeltas;
export const applyWordVerdicts = store.applyWordVerdicts;

/**
 * Opens the crash checkpoint for a new attempt, and reports the start to EAS
 * Observe on the way through.
 *
 * This is the one call every start passes: the passage, drill, and freestyle
 * screens all open their checkpoint here on mount, and a restart mid-read
 * re-opens it. Instrumenting the store's entry point rather than those four call
 * sites is what keeps `practice.started` from drifting out of step with
 * `practice.ended` the next time an entry point is added.
 */
export function beginSession(session: Omit<InflightSession, 'startedAt' | 'updatedAt'>) {
  practiceStarted(session);
  store.beginSession(session);
}

export type SessionMeta = {
  mode: SessionMode;
  /** Defaults to 'stopped' — a deliberate finish. */
  endedReason?: SessionEndedReason;
  passageId?: string;
  topicId?: string;
  /** Snapshotted onto the record so deleting a custom passage doesn't orphan it. */
  contentTitle?: string;
};

/**
 * The one call sites use: builds the slim record, persists it, folds the per-word
 * verdicts into the mastery aggregates, and reports what happened.
 *
 * Returns a result rather than `SessionRecord | null` so callers can tell "not
 * saved because nothing was spoken" from "tried to save and the write failed" —
 * and so the results screen can exclude this session from its baseline by id
 * instead of assuming it is the last record in the store.
 */
export function recordSession(result: SessionResult, meta: SessionMeta) {
  const { wordCounts, challengingWords } = summarizeWords(result.words);
  const written = store.recordSession({
    mode: meta.mode,
    endedReason: meta.endedReason ?? 'stopped',
    passageId: meta.passageId,
    topicId: meta.topicId,
    contentTitle: meta.contentTitle,
    durationMs: result.durationMs,
    accuracy: result.accuracy,
    fluency: result.fluency,
    completeness: result.completeness,
    intonation: result.intonation,
    paceWpm: result.paceWpm,
    targetWpm: result.targetWpm,
    fillerCount: result.fillerCount,
    // Computed by the result builders, so the record and the results screen are
    // judged by the same measure.
    spokenWords: result.spokenWords,
    pauseCount: result.pauseCount ?? undefined,
    longestPauseMs: result.longestPauseMs ?? undefined,
    source: result.source,
    wordCounts,
    challengingWords,
    words: result.words,
  });

  // Paired with `practice.started` above. Reported here rather than from the two
  // session screens because every terminal path — finished, stopped early, and
  // abandoned by dismissing or restarting — funnels through this one call.
  practiceEnded(result, {
    mode: meta.mode,
    endedReason: meta.endedReason ?? 'stopped',
    persisted: written.ok,
  });

  return written;
}

if (__DEV__) {
  // Seeding and inspection from the Metro JS debugger. iOS simulators have no
  // speech recognizer, so this is the only way to exercise analytics on one.
  const { installDevHandle } = require('@/services/history-dev') as typeof import('@/services/history-dev');
  installDevHandle(store);
}
