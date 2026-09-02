/**
 * The practice-history store: hydration, validation, appends, quarantine,
 * crash recovery, word-mastery aggregates, and export/import.
 *
 * PURE module. The key-value backend is injected as `KvBackend`, so everything
 * here — including the riskiest logic, migration and quarantine — runs under bun
 * against `createMemoryKv()` in `scripts/test-history.ts`. `services/storage.ts`
 * supplies the MMKV backend in the app, and `services/session-history.ts` owns
 * the module-level singleton and the React glue.
 *
 * Two invariants hold the whole thing together:
 *
 *  1. `getRecords()` returns a STABLE array reference whose identity changes only
 *     inside a successful mutation. `useSyncExternalStore` requires it, and it is
 *     why hydration must stay synchronous.
 *  2. Memory equals disk. A write that cannot be verified is NOT added to the
 *     snapshot, and the caller is told. The previous store logged failures and
 *     kept the record in memory, so a session could show in the UI and be gone
 *     on the next launch.
 */

import {
  KEY,
  META_KEY,
  deltaKey,
  makeRecordKey,
  parseExport,
  parseRecord,
  parseRecordKey,
  parseWordStat,
  wordKey,
  EXPORT_KIND,
  EXPORT_VERSION,
  type HistoryExport,
} from '@/lib/history-schema';
import {
  RECORD_SCHEMA_VERSION,
  type InflightSession,
  type SessionEndedReason,
  type SessionMode,
  type SessionRecord,
  type WordCounts,
  type WordStat,
} from '@/types/history';

/** The storage surface the store needs. Mirrors the subset of MMKV v4 we use, so
 * the adapter in `services/storage.ts` is a one-liner per method. */
export type KvBackend = {
  getString(key: string): string | undefined;
  getNumber(key: string): number | undefined;
  getBoolean(key: string): boolean | undefined;
  set(key: string, value: string | number | boolean): void;
  remove(key: string): boolean;
  contains(key: string): boolean;
  getAllKeys(): string[];
  clearAll(): void;
  trim?(): void;
};

/** In-memory backend for tests and for the degraded path when the native module
 * is missing (a stale dev binary). Not durable, and the store says so. */
export function createMemoryKv(initial?: Record<string, string | number | boolean>): KvBackend {
  const map = new Map<string, string | number | boolean>(Object.entries(initial ?? {}));
  return {
    getString: (k) => (typeof map.get(k) === 'string' ? (map.get(k) as string) : undefined),
    getNumber: (k) => (typeof map.get(k) === 'number' ? (map.get(k) as number) : undefined),
    getBoolean: (k) => (typeof map.get(k) === 'boolean' ? (map.get(k) as boolean) : undefined),
    set: (k, v) => void map.set(k, v),
    remove: (k) => map.delete(k),
    contains: (k) => map.has(k),
    getAllKeys: () => [...map.keys()],
    clearAll: () => map.clear(),
  };
}

/** Attempts shorter than this with nothing spoken are accidental starts. */
export const MIN_MEANINGFUL_MS = 10_000;
/** Cap on retained quarantine entries, so a pathological payload can't grow the
 * store without bound. Oldest are dropped first. */
const MAX_QUARANTINE = 50;

export type RecordSessionInput = {
  mode: SessionMode;
  endedReason: SessionEndedReason;
  passageId?: string;
  topicId?: string;
  contentTitle?: string;
  durationMs: number;
  accuracy: number;
  fluency: number;
  completeness: number;
  intonation: number;
  paceWpm: number;
  targetWpm: number;
  fillerCount: number;
  spokenWords: number;
  pauseCount?: number;
  longestPauseMs?: number;
  source: 'azure' | 'live';
  wordCounts: WordCounts;
  challengingWords: string[];
  /** Per-word verdicts. Folded into the word-mastery aggregates and then
   * dropped — the record deliberately stays scalar-only. */
  words?: readonly { word: string; status: string }[];
};

/** One per-word verdict, compacted for storage and upload: `w` word, `s` status. */
export type WordDelta = { w: string; s: string };

/** Cap on stored verdicts per session. A passage is a few hundred words; this
 * only guards against a runaway recognizer, well under Convex's document limit. */
export const MAX_WORD_DELTAS = 2000;

export type WriteResult =
  | { ok: true; record: SessionRecord; durable: boolean }
  | { ok: false; reason: 'no-speech' | 'persist-failed' | 'counter-failed'; record?: SessionRecord };

export type QuarantineEntry = {
  at: number;
  key: string;
  reason: string;
  raw: string;
};

export type ImportSummary = {
  ok: boolean;
  reason?: string;
  total: number;
  imported: number;
  duplicates: number;
  invalid: number;
  failed: number;
};

export type StorageStats = {
  durable: boolean;
  records: number;
  words: number;
  quarantined: number;
  maxSeq: number;
  schemaVersion: number;
  hydrateMs: number;
  firstAt: number | null;
  lastAt: number | null;
  migratedLegacy: boolean;
  legacyCount: number;
  recoveredInflight: number;
  lastError: string | null;
};

export type HistoryStoreDeps = {
  kv: KvBackend;
  /** False for the in-memory fallback, so callers can warn instead of silently
   * losing data on reload. */
  durable?: boolean;
  now?: () => number;
  /** Minutes returned by `Date.prototype.getTimezoneOffset()` at that instant. */
  tzOffsetMinutes?: (atMs: number) => number;
  /**
   * Hydration runs inside `getSnapshot` during render, so repair writes
   * (quarantine, schema upgrades) are deferred rather than performed mid-render.
   * Nothing is lost if the app dies first: the bad row is still on disk and gets
   * re-detected next launch. Tests inject a synchronous runner.
   */
  scheduleWrite?: (fn: () => void) => void;
  /** Raw text of the pre-MMKV `sessions.json`, read once for migration. */
  readLegacyJson?: () => string | null;
  appVersion?: string;
  onWarn?: (message: string, detail?: unknown) => void;
};

export type HistoryStore = ReturnType<typeof createHistoryStore>;

export function createHistoryStore(deps: HistoryStoreDeps) {
  const { kv } = deps;
  const now = deps.now ?? (() => Date.now());
  const tzOffset = deps.tzOffsetMinutes ?? ((atMs: number) => new Date(atMs).getTimezoneOffset());
  const scheduleWrite = deps.scheduleWrite ?? ((fn: () => void) => void setTimeout(fn, 0));
  const durable = deps.durable ?? true;
  const warn = deps.onWarn ?? (() => {});

  let records: readonly SessionRecord[] | null = null;
  let wordStats: Map<string, WordStat> | null = null;
  /**
   * Cached array view of `wordStats`. Must exist: `getWordStats` feeds
   * `useSyncExternalStore`, whose `getSnapshot` has to return the SAME reference
   * between mutations. Spreading the Map on every call returns a new array each
   * time, which React reads as "changed again" and turns into an infinite render
   * loop.
   */
  let wordStatsList: readonly WordStat[] | null = null;
  const listeners = new Set<() => void>();
  let lastError: string | null = null;
  let seqCounter = 0;
  let hydrateMs = 0;
  let legacyCount = 0;
  let recoveredInflight = 0;

  function notify() {
    for (const listener of listeners) listener();
  }

  // --- quarantine ------------------------------------------------------------

  /**
   * Move an unparseable payload aside instead of dropping it. The quarantine
   * write is verified BEFORE the original key is removed: a row that gets
   * skipped on every boot is strictly better than one that got deleted.
   */
  function quarantine(key: string, raw: string, reason: string) {
    const at = now();
    const qKey = `${KEY.quarantine}${at.toString().padStart(16, '0')}/${key.slice(-24)}`;
    const payload = JSON.stringify({ at, key, reason, raw: raw.slice(0, 4096) });
    try {
      kv.set(qKey, payload);
      if (kv.getString(qKey) !== payload) throw new Error('quarantine verify failed');
      kv.remove(key);
    } catch (error) {
      warn(`[history] could not quarantine ${key}, leaving it in place`, error);
      return;
    }
    const keys = kv.getAllKeys().filter((k) => k.startsWith(KEY.quarantine)).sort();
    for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_QUARANTINE))) {
      kv.remove(stale);
    }
  }

  // --- hydration -------------------------------------------------------------

  function hydrate(): readonly SessionRecord[] {
    if (records) return records;
    const started = now();
    const deferred: (() => void)[] = [];

    try {
      migrateLegacy(deferred);
    } catch (error) {
      warn('[history] legacy migration failed', error);
    }

    const out: SessionRecord[] = [];
    let maxSeq = 0;

    // Keys sort chronologically by construction, so no post-sort is needed.
    for (const key of kv.getAllKeys().sort()) {
      if (!key.startsWith(KEY.record)) continue;
      const raw = kv.getString(key);
      if (raw == null) continue;

      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        deferred.push(() => quarantine(key, raw, 'invalid-json'));
        continue;
      }

      const fromKey = parseRecordKey(key);
      const parsed = parseRecord(json, { fallbackSeq: fromKey?.seq ?? 0 });
      if (!parsed.ok) {
        deferred.push(() => quarantine(key, raw, parsed.reason));
        continue;
      }

      const record = parsed.record;
      maxSeq = Math.max(maxSeq, record.seq);
      out.push(record);

      // Rewrite an upgraded row so the next launch doesn't redo the work, and
      // re-key one whose key disagrees with its contents. Never touch a row from
      // a newer schema: our narrower shape would delete its extra fields.
      if (!parsed.readOnly && (parsed.upgraded || record.id !== key)) {
        deferred.push(() => {
          if (writeRecord(record) && record.id !== key) kv.remove(key);
        });
      }
    }

    // Repair the counter from what is actually on disk. Covers a lost meta key
    // and any records brought in by an import.
    const storedSeq = kv.getNumber(META_KEY.seq) ?? 0;
    seqCounter = Math.max(storedSeq, maxSeq);
    if (seqCounter !== storedSeq) {
      deferred.push(() => kv.set(META_KEY.seq, seqCounter));
    }

    records = out;
    hydrateMs = now() - started;

    try {
      recoverInflight(out, deferred);
    } catch (error) {
      warn('[history] inflight recovery failed', error);
    }

    if (deferred.length > 0) {
      scheduleWrite(() => {
        for (const task of deferred) {
          try {
            task();
          } catch (error) {
            warn('[history] deferred repair failed', error);
          }
        }
        notify();
      });
    }

    return records;
  }

  /**
   * One-time import of the pre-MMKV `sessions.json`.
   *
   * `seq` comes from the row's index rather than the live counter, which makes
   * the whole pass deterministic: a retry after a partial migration regenerates
   * byte-identical keys, so already-imported rows are no-ops instead of
   * duplicates. The old file is never deleted, so it stays a free backup — if
   * MMKV is ever cleared, the guard clears with it and the import re-runs.
   */
  function migrateLegacy(deferred: (() => void)[]) {
    if (kv.getBoolean(META_KEY.migratedJsonV1) === true) return;
    const text = deps.readLegacyJson?.();
    if (text == null) {
      kv.set(META_KEY.migratedJsonV1, true);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      warn('[history] legacy sessions.json is unreadable, leaving it on disk');
      kv.set(META_KEY.migratedJsonV1, true);
      return;
    }

    const envelope = parsed as { version?: unknown; records?: unknown };
    // The version field the old store wrote but never read.
    if (typeof envelope.version === 'number' && envelope.version > 1) {
      warn(`[history] legacy store is version ${envelope.version}, refusing to import`);
      kv.set(META_KEY.migratedJsonV1, true);
      return;
    }
    const rows = Array.isArray(envelope.records) ? envelope.records : [];
    const sorted = [...rows].sort((a, b) => {
      const at = (a as { completedAt?: number })?.completedAt ?? 0;
      const bt = (b as { completedAt?: number })?.completedAt ?? 0;
      return at - bt;
    });

    let imported = 0;
    sorted.forEach((row, index) => {
      const result = parseRecord(row, { fallbackSeq: index + 1 });
      if (!result.ok) {
        deferred.push(() =>
          quarantine(`${KEY.record}legacy/${index}`, JSON.stringify(row), result.reason),
        );
        return;
      }
      if (writeRecord(result.record)) imported += 1;
    });

    legacyCount = imported;
    seqCounter = Math.max(seqCounter, sorted.length);
    kv.set(META_KEY.seq, seqCounter);
    kv.set(META_KEY.migratedJsonV1, true);
  }

  /**
   * Turn a checkpoint the app died during into a real record. Practice time the
   * user actually put in is no longer lost to a crash or a force-quit. The
   * result is unscorable by construction (`endedReason: 'interrupted'`), so it
   * counts toward effort without touching the speaking score.
   */
  function recoverInflight(into: SessionRecord[], deferred: (() => void)[]) {
    const raw = kv.getString(META_KEY.inflight);
    if (raw == null) return;
    kv.remove(META_KEY.inflight);

    let checkpoint: InflightSession;
    try {
      checkpoint = JSON.parse(raw) as InflightSession;
    } catch {
      return;
    }
    // Deliberately NO wall-clock staleness check. Hydration runs once per JS
    // context, before any session can start, so a checkpoint found here is always
    // from a previous run — and the most common real case is the user reopening
    // the app seconds after it died, which a staleness window would discard.
    // Worth enough practice time to be worth recovering, and only if they spoke.
    if (!Number.isFinite(checkpoint.elapsedMs) || checkpoint.elapsedMs < MIN_MEANINGFUL_MS) return;
    if (checkpoint.spokenWords <= 0) return;

    seqCounter += 1;
    kv.set(META_KEY.seq, seqCounter);
    const record = buildRecord(
      {
      mode: checkpoint.mode,
      endedReason: 'interrupted',
      passageId: checkpoint.passageId,
      topicId: checkpoint.topicId,
      contentTitle: checkpoint.contentTitle,
      durationMs: checkpoint.elapsedMs,
      accuracy: 0,
      fluency: 0,
      completeness: 0,
      intonation: 0,
      paceWpm: 0,
      targetWpm: checkpoint.targetWpm ?? 0,
      fillerCount: checkpoint.fillerCount ?? 0,
      spokenWords: checkpoint.spokenWords,
      source: 'live',
        wordCounts: { good: 0, mispronounced: 0, omitted: 0, inserted: 0 },
        challengingWords: [],
      },
      seqCounter,
      checkpoint.updatedAt,
    );

    into.push(record);
    recoveredInflight += 1;
    deferred.push(() => void writeRecord(record));
  }

  // --- writes ----------------------------------------------------------------

  function nextSeq(): number | null {
    const candidate = seqCounter + 1;
    try {
      // Reserved before the record is written, so a crash in between burns a
      // number (gaps are legal) rather than ever reusing one.
      kv.set(META_KEY.seq, candidate);
      if (kv.getNumber(META_KEY.seq) !== candidate) return null;
    } catch (error) {
      lastError = 'counter-failed';
      warn('[history] could not reserve a sequence number', error);
      return null;
    }
    seqCounter = candidate;
    return candidate;
  }

  /** Write and verify byte-for-byte. Deterministic because we construct the
   * object ourselves, so key order is fixed and a string compare is exact. */
  function writeRecord(record: SessionRecord): boolean {
    const json = JSON.stringify(record);
    try {
      kv.set(record.id, json);
      if (kv.getString(record.id) !== json) throw new Error('verify mismatch');
      return true;
    } catch (error) {
      lastError = 'persist-failed';
      warn(`[history] failed to persist ${record.id}`, error);
      try {
        kv.remove(record.id);
      } catch {
        // Nothing more to do; hydrate will quarantine a partial row.
      }
      return false;
    }
  }

  /** `seq` is passed in, never derived here: the caller reserves it through
   * `nextSeq()` so the number in the record is exactly the one persisted to the
   * counter, and the key built from it can't drift. */
  function buildRecord(
    input: RecordSessionInput,
    seq: number,
    completedAtOverride?: number,
  ): SessionRecord {
    const completedAt = completedAtOverride ?? now();
    const record: SessionRecord = {
      v: RECORD_SCHEMA_VERSION,
      id: makeRecordKey(completedAt, seq),
      seq,
      completedAt,
      tzOffsetMinutes: tzOffset(completedAt),
      mode: input.mode,
      endedReason: input.endedReason,
      durationMs: input.durationMs,
      accuracy: input.accuracy,
      fluency: input.fluency,
      completeness: input.completeness,
      intonation: input.intonation,
      paceWpm: input.paceWpm,
      targetWpm: input.targetWpm,
      fillerCount: input.fillerCount,
      spokenWords: input.spokenWords,
      source: input.source,
      wordCounts: input.wordCounts,
      challengingWords: input.challengingWords,
    };
    if (input.passageId != null) record.passageId = input.passageId;
    if (input.topicId != null) record.topicId = input.topicId;
    if (input.contentTitle != null) record.contentTitle = input.contentTitle;
    if (input.pauseCount != null) record.pauseCount = input.pauseCount;
    if (input.longestPauseMs != null) record.longestPauseMs = input.longestPauseMs;
    if (deps.appVersion != null) record.appVersion = deps.appVersion;
    return record;
  }

  function appendToSnapshot(record: SessionRecord) {
    const current = hydrate();
    const last = current[current.length - 1];
    // Appends are chronological in practice; only pay for a sort when a
    // backwards clock or an import puts one out of order.
    records =
      last == null || last.completedAt <= record.completedAt
        ? [...current, record]
        : [...current, record].sort((a, b) => a.completedAt - b.completedAt || a.seq - b.seq);
  }

  /**
   * The one call sites use. Guards out sessions with nothing spoken (any
   * duration — the old guard only rejected short ones, so 15 seconds of silence
   * persisted as a real scored session), persists, folds the per-word verdicts
   * into the mastery aggregates, and reports what actually happened.
   */
  function recordSession(input: RecordSessionInput): WriteResult {
    hydrate();
    // `spokenWords` is the whole guard. It counts words the recognizer actually
    // heard, so zero means silence at any duration — which is strictly stronger
    // than the old duration-plus-`wordCounts.good` pair.
    //
    // That pair must NOT come back: freestyle results carry `words: []`, so
    // `wordCounts.good` is 0 for every freestyle session no matter how much was
    // said, and any freestyle attempt under 10s was being discarded despite a
    // full transcript. Anything that gets past this floor but is still too thin
    // to judge is caught later by `isScorable`, which keeps it out of the skills
    // while still counting its minutes.
    if (input.spokenWords <= 0) return { ok: false, reason: 'no-speech' };

    const seq = nextSeq();
    if (seq == null) return { ok: false, reason: 'counter-failed' };
    const record = buildRecord(input, seq);
    if (!writeRecord(record)) return { ok: false, reason: 'persist-failed', record };

    appendToSnapshot(record);
    if (input.words) {
      recordWords(input.words, record.completedAt, record.endedReason);
      writeDeltas(record.id, input.words);
    }
    lastError = null;
    notify();
    return { ok: true, record, durable };
  }

  /**
   * Keep the verdicts beside the record until they have been uploaded. Best
   * effort: a failed sidecar write costs another device's word mastery for
   * this one session, never the session itself.
   */
  function writeDeltas(recordId: string, words: readonly { word: string; status: string }[]) {
    if (words.length === 0) return;
    const deltas: WordDelta[] = words
      .slice(0, MAX_WORD_DELTAS)
      .map(({ word, status }) => ({ w: word, s: status }));
    try {
      kv.set(deltaKey(recordId), JSON.stringify(deltas));
    } catch (error) {
      warn(`[history] could not keep word verdicts for ${recordId}`, error);
    }
  }

  function getWordDeltas(recordId: string): WordDelta[] | null {
    const raw = kv.getString(deltaKey(recordId));
    if (raw == null) return null;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as WordDelta[]) : null;
    } catch {
      return null;
    }
  }

  function removeWordDeltas(recordId: string) {
    kv.remove(deltaKey(recordId));
  }

  /**
   * Fold verdicts that arrived from another device into the mastery aggregates.
   * The same fold `recordSession` runs locally, so both directions agree.
   */
  function applyWordVerdicts(
    words: readonly { word: string; status: string }[],
    at: number,
    endedReason: SessionEndedReason,
  ) {
    hydrate();
    recordWords(words, at, endedReason);
    notify();
  }

  /** Used by import and by the dev seeder: an already-formed record. */
  function addRecord(record: SessionRecord): boolean {
    hydrate();
    if (kv.contains(record.id)) return false;
    if (!writeRecord(record)) return false;
    seqCounter = Math.max(seqCounter, record.seq);
    kv.set(META_KEY.seq, seqCounter);
    appendToSnapshot(record);
    return true;
  }

  function removeRecord(id: string): boolean {
    hydrate();
    const removed = kv.remove(id);
    if (removed) {
      kv.remove(deltaKey(id));
      records = (records ?? []).filter((r) => r.id !== id);
      notify();
    }
    return removed;
  }

  function clearAll() {
    for (const key of kv.getAllKeys()) {
      if (
        key.startsWith(KEY.record) ||
        key.startsWith(KEY.quarantine) ||
        key.startsWith(KEY.word) ||
        key.startsWith(KEY.delta) ||
        key === META_KEY.seq ||
        key === META_KEY.inflight ||
        // Cleared too, so the legacy file is re-imported on the next hydrate.
        // That is the documented recovery path.
        key === META_KEY.migratedJsonV1
      ) {
        kv.remove(key);
      }
    }
    kv.trim?.();
    records = null;
    wordStats = null;
    wordStatsList = null;
    seqCounter = 0;
    legacyCount = 0;
    recoveredInflight = 0;
    notify();
  }

  /**
   * Sign-out wipe. Removes everything that belongs to the account that was
   * signed in, and KEEPS the legacy-import guard. `clearAll` drops that guard on
   * purpose as a recovery path; here it would be a leak, because the next
   * launch would re-import this device's old `sessions.json` into whichever
   * account signs in next.
   */
  function clearAccountData() {
    for (const key of kv.getAllKeys()) {
      if (
        key.startsWith(KEY.record) ||
        key.startsWith(KEY.quarantine) ||
        key.startsWith(KEY.word) ||
        key.startsWith(KEY.delta) ||
        key === META_KEY.seq ||
        key === META_KEY.inflight
      ) {
        kv.remove(key);
      }
    }
    kv.trim?.();
    records = null;
    wordStats = null;
    wordStatsList = null;
    seqCounter = 0;
    recoveredInflight = 0;
    notify();
  }

  // --- word mastery ----------------------------------------------------------

  function hydrateWords(): Map<string, WordStat> {
    if (wordStats) return wordStats;
    const map = new Map<string, WordStat>();
    for (const key of kv.getAllKeys()) {
      if (!key.startsWith(KEY.word)) continue;
      const raw = kv.getString(key);
      if (raw == null) continue;
      try {
        const stat = parseWordStat(JSON.parse(raw));
        if (stat) map.set(key, stat);
      } catch {
        // A bad word aggregate is derivable again from future sessions, so it is
        // dropped rather than quarantined.
        kv.remove(key);
      }
    }
    wordStats = map;
    wordStatsList = null;
    return map;
  }

  /**
   * Fold one session's per-word verdicts into the running aggregates. Only
   * scorable sessions count: an abandoned read leaves everything after the stop
   * point marked omitted, which would look like a mastery collapse.
   *
   * Insertions are ignored entirely — a filler is penalized through
   * `fillerCount`, so "um" is not a word to master.
   */
  function recordWords(
    words: readonly { word: string; status: string }[],
    at: number,
    endedReason: SessionEndedReason,
  ) {
    if (endedReason !== 'completed' && endedReason !== 'stopped') return;
    const map = hydrateWords();
    const touched = new Set<string>();

    for (const { word, status } of words) {
      if (status === 'inserted') continue;
      const key = wordKey(word);
      if (key === KEY.word) continue; // punctuation-only token
      const existing = map.get(key);
      const stat: WordStat = existing ?? {
        word: key.slice(KEY.word.length),
        seen: 0,
        clean: 0,
        mispronounced: 0,
        omitted: 0,
        cleanStreak: 0,
        everMissed: false,
        firstSeenAt: at,
        lastSeenAt: at,
      };
      stat.seen += 1;
      stat.lastSeenAt = at;
      if (status === 'good') {
        stat.clean += 1;
        stat.cleanStreak += 1;
      } else {
        if (status === 'mispronounced') stat.mispronounced += 1;
        if (status === 'omitted') stat.omitted += 1;
        stat.cleanStreak = 0;
        stat.everMissed = true;
      }
      map.set(key, stat);
      touched.add(key);
    }

    for (const key of touched) {
      const stat = map.get(key)!;
      try {
        kv.set(key, JSON.stringify(stat));
      } catch (error) {
        warn(`[history] failed to persist word stat ${key}`, error);
      }
    }
    // New Map identity so consumers memoized on it re-derive.
    wordStats = new Map(map);
    wordStatsList = null;
  }

  // --- in-flight checkpoint --------------------------------------------------

  function beginSession(session: Omit<InflightSession, 'startedAt' | 'updatedAt'>) {
    const at = now();
    const payload: InflightSession = { ...session, startedAt: at, updatedAt: at };
    try {
      kv.set(META_KEY.inflight, JSON.stringify(payload));
    } catch (error) {
      warn('[history] could not write the in-flight checkpoint', error);
    }
  }

  function checkpointSession(patch: Partial<InflightSession>) {
    const raw = kv.getString(META_KEY.inflight);
    if (raw == null) return;
    try {
      const current = JSON.parse(raw) as InflightSession;
      kv.set(META_KEY.inflight, JSON.stringify({ ...current, ...patch, updatedAt: now() }));
    } catch (error) {
      warn('[history] could not update the in-flight checkpoint', error);
    }
  }

  function endSession() {
    kv.remove(META_KEY.inflight);
  }

  // --- transfer --------------------------------------------------------------

  function exportHistory(): string {
    const envelope: HistoryExport = {
      kind: EXPORT_KIND,
      version: EXPORT_VERSION,
      exportedAt: now(),
      records: [...hydrate()],
      words: [...hydrateWords().values()],
    };
    return JSON.stringify(envelope);
  }

  /**
   * Restore an export. Dedupe is by record id, and ids are a pure function of
   * `(completedAt, seq)`, so importing the same blob twice is a no-op rather
   * than a doubled history.
   */
  function importHistory(json: string, mode: 'merge' | 'replace' = 'merge'): ImportSummary {
    hydrate();
    const parsed = parseExport(json);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason, total: 0, imported: 0, duplicates: 0, invalid: 0, failed: 0 };
    }

    if (mode === 'replace') {
      for (const key of kv.getAllKeys()) {
        if (key.startsWith(KEY.record) || key.startsWith(KEY.word)) kv.remove(key);
      }
      records = [];
      wordStats = new Map();
      wordStatsList = null;
    }

    let imported = 0;
    let duplicates = 0;
    let failed = 0;
    for (const record of parsed.records) {
      if (kv.contains(record.id)) {
        duplicates += 1;
        continue;
      }
      if (addRecord(record)) imported += 1;
      else failed += 1;
    }

    const words = hydrateWords();
    for (const stat of parsed.words) {
      const key = wordKey(stat.word);
      if (mode === 'replace' || !words.has(key)) {
        words.set(key, stat);
        try {
          kv.set(key, JSON.stringify(stat));
        } catch {
          // Word aggregates rebuild from future sessions; not fatal.
        }
      }
    }
    wordStats = new Map(words);
    wordStatsList = null;

    notify();
    return {
      ok: true,
      total: parsed.records.length + parsed.skipped,
      imported,
      duplicates,
      invalid: parsed.skipped,
      failed,
    };
  }

  // --- diagnostics -----------------------------------------------------------

  function getQuarantine(): QuarantineEntry[] {
    const out: QuarantineEntry[] = [];
    for (const key of kv.getAllKeys().filter((k) => k.startsWith(KEY.quarantine)).sort()) {
      const raw = kv.getString(key);
      if (raw == null) continue;
      try {
        out.push(JSON.parse(raw) as QuarantineEntry);
      } catch {
        // ignore
      }
    }
    return out;
  }

  function getStats(): StorageStats {
    const list = hydrate();
    return {
      durable,
      records: list.length,
      words: hydrateWords().size,
      quarantined: kv.getAllKeys().filter((k) => k.startsWith(KEY.quarantine)).length,
      maxSeq: seqCounter,
      schemaVersion: RECORD_SCHEMA_VERSION,
      hydrateMs,
      firstAt: list.length > 0 ? list[0].completedAt : null,
      lastAt: list.length > 0 ? list[list.length - 1].completedAt : null,
      migratedLegacy: kv.getBoolean(META_KEY.migratedJsonV1) === true,
      legacyCount,
      recoveredInflight,
      lastError,
    };
  }

  return {
    getRecords: hydrate,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    recordSession,
    addRecord,
    removeRecord,
    clearAll,
    getWordStats: (): readonly WordStat[] => {
      const map = hydrateWords();
      if (!wordStatsList) wordStatsList = [...map.values()];
      return wordStatsList;
    },
    beginSession,
    checkpointSession,
    endSession,
    clearAccountData,
    exportHistory,
    importHistory,
    getWordDeltas,
    removeWordDeltas,
    applyWordVerdicts,
    getQuarantine,
    getStats,
    getLastError: () => lastError,
  };
}
