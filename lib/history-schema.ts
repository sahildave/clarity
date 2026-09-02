/**
 * Record keys, validation, and schema upgrades for persisted practice history.
 *
 * This is the boundary between untrusted bytes on disk and the `SessionRecord`
 * the rest of the app treats as a given. Nothing else may construct a record
 * from raw storage: a single malformed row used to take down every analytics
 * screen (`lib/stats.ts` dereferences `r.wordCounts.good`), so parsing is
 * total — every payload either yields a valid record or a reason it didn't.
 *
 * PURE module: no React, no `services/`, no react-native imports. Runs under
 * bun for `scripts/test-history.ts`, which is the point — the schema and
 * migration logic are testable without the native storage module.
 */

import {
  RECORD_SCHEMA_VERSION,
  type SessionEndedReason,
  type SessionMode,
  type SessionRecord,
  type WordCounts,
  type WordStat,
} from '@/types/history';

/** Key namespaces inside the one MMKV instance. Every key carries its prefix so
 * `getAllKeys()` can be partitioned without a second index. */
export const KEY = {
  record: 's/',
  quarantine: 'q/',
  word: 'w/',
  passage: 'p/',
  meta: 'meta/',
  /** Per-record word verdicts awaiting upload; see `deltaKey`. */
  delta: 'd/',
} as const;

export const META_KEY = {
  storeVersion: 'meta/storeVersion',
  seq: 'meta/seq',
  migratedJsonV1: 'meta/migratedJsonV1',
  migratedPassagesV1: 'meta/migratedPassagesV1',
  inflight: 'meta/inflight',
} as const;

/** Epoch ms is 13 digits until the year 2286; pad to a fixed width so string
 * order is numeric order. */
const TIME_DIGITS = 16;
const SEQ_DIGITS = 8;

/**
 * `s/<completedAt>/<seq>`, both zero-padded so lexicographic order equals
 * chronological order and `getAllKeys()` needs no sort. `seq` disambiguates two
 * sessions saved in the same millisecond and preserves true insertion order even
 * if the device clock moves backwards.
 */
export function makeRecordKey(completedAt: number, seq: number): string {
  const t = Math.max(0, Math.floor(completedAt)).toString().padStart(TIME_DIGITS, '0');
  const s = Math.max(0, Math.floor(seq)).toString().padStart(SEQ_DIGITS, '0');
  return `${KEY.record}${t}/${s}`;
}

export function parseRecordKey(key: string): { completedAt: number; seq: number } | null {
  if (!key.startsWith(KEY.record)) return null;
  const [t, s] = key.slice(KEY.record.length).split('/');
  const completedAt = Number(t);
  const seq = Number(s);
  if (!Number.isFinite(completedAt) || !Number.isFinite(seq)) return null;
  return { completedAt, seq };
}

/**
 * `d/<recordId>`: the compact per-word verdicts of one session, kept only until
 * the sync layer has pushed them. The record itself stays scalar-only; this
 * sidecar is what lets word mastery rebuild on another device.
 */
export function deltaKey(recordId: string): string {
  return `${KEY.delta}${recordId}`;
}

export function wordKey(word: string): string {
  return `${KEY.word}${normalizeWord(word)}`;
}

/** The one normalization for word aggregates: lowercase, stripped of the
 * punctuation the tokenizer leaves attached. Must stay stable — it is the key. */
export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'-]/gu, '')
    .replace(/^['-]+|['-]+$/g, '');
}

// --- Validation --------------------------------------------------------------

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isString = (v: unknown): v is string => typeof v === 'string';

const MODES: readonly SessionMode[] = ['passage', 'drill', 'freestyle'];
const REASONS: readonly SessionEndedReason[] = [
  'completed',
  'stopped',
  'abandoned',
  'interrupted',
  'error',
];

/** A 0–100 measure, clamped rather than rejected: a slightly out-of-range score
 * from an older build is still usable data, unlike a missing one. */
function measure(value: unknown, fallback: number | null = null): number | null {
  if (!isFiniteNumber(value)) return fallback;
  return Math.max(0, Math.min(100, value));
}

function parseWordCounts(value: unknown): WordCounts | null {
  if (value == null || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const out: WordCounts = { good: 0, mispronounced: 0, omitted: 0, inserted: 0 };
  for (const key of Object.keys(out) as (keyof WordCounts)[]) {
    const n = raw[key];
    if (!isFiniteNumber(n) || n < 0) return null;
    out[key] = Math.floor(n);
  }
  return out;
}

export type ParseResult =
  | {
      ok: true;
      record: SessionRecord;
      /** The payload was an older schema and the in-memory record differs from
       * what is on disk, so the store may rewrite it. */
      upgraded: boolean;
      /**
       * The payload came from a NEWER schema than this build understands. The
       * record is usable, but the store must never rewrite it: serializing our
       * narrower shape back over it would permanently delete the newer build's
       * fields. This is the OTA-rollback case, and quarantining instead would
       * silently strand real history.
       */
      readOnly: boolean;
    }
  | { ok: false; reason: string };

export type ParseOptions = {
  /** Used when the payload predates `seq` (schema v1). Normally the record's
   * index in the migrated file, so migrated history keeps its original order. */
  fallbackSeq?: number;
};

/**
 * Validate and upgrade one raw payload into a `SessionRecord`.
 *
 * Required: a finite `completedAt`, a known `mode`, a non-negative `durationMs`,
 * and a well-formed `wordCounts`. Everything else is either defaulted or
 * repaired, because a record missing an optional field is still real practice
 * history and discarding it would lose more than it protects.
 */
export function parseRecord(raw: unknown, options: ParseOptions = {}): ParseResult {
  if (raw == null || typeof raw !== 'object') return { ok: false, reason: 'not-an-object' };
  const r = raw as Record<string, unknown>;

  const completedAt = r.completedAt;
  if (!isFiniteNumber(completedAt) || completedAt <= 0) {
    return { ok: false, reason: 'bad-completedAt' };
  }

  const mode = r.mode;
  if (!isString(mode) || !MODES.includes(mode as SessionMode)) {
    return { ok: false, reason: 'bad-mode' };
  }

  const durationMs = r.durationMs;
  if (!isFiniteNumber(durationMs) || durationMs < 0) {
    return { ok: false, reason: 'bad-durationMs' };
  }

  const wordCounts = parseWordCounts(r.wordCounts);
  if (!wordCounts) return { ok: false, reason: 'bad-wordCounts' };

  // A newer schema is kept rather than rejected; see `ParseResult.readOnly`.
  const version = isFiniteNumber(r.v) ? r.v : 1;
  const readOnly = version > RECORD_SCHEMA_VERSION;

  const seq = isFiniteNumber(r.seq) ? Math.floor(r.seq) : (options.fallbackSeq ?? 0);

  // v1 never captured the recording timezone. Falling back to the device's
  // offset *at that instant* (not today's) keeps DST-correct day bucketing for
  // migrated rows.
  const tzOffsetMinutes = isFiniteNumber(r.tzOffsetMinutes)
    ? r.tzOffsetMinutes
    : new Date(completedAt).getTimezoneOffset();

  const endedReason =
    isString(r.endedReason) && REASONS.includes(r.endedReason as SessionEndedReason)
      ? (r.endedReason as SessionEndedReason)
      : 'completed';

  const targetWpm = measure(r.targetWpm, 0) ?? 0;
  const record: SessionRecord = {
    // Preserve a newer version so the store can tell "don't rewrite this".
    v: readOnly ? version : RECORD_SCHEMA_VERSION,
    // v1 ids were random strings rather than keys; re-key so `id` is always the
    // storage key and deletes/import-dedupe stay single lookups.
    id: makeRecordKey(completedAt, seq),
    seq,
    completedAt,
    tzOffsetMinutes,
    mode: mode as SessionMode,
    endedReason,
    durationMs,
    accuracy: measure(r.accuracy, 0) ?? 0,
    fluency: measure(r.fluency, 0) ?? 0,
    completeness: measure(r.completeness, 0) ?? 0,
    intonation: measure(r.intonation, 0) ?? 0,
    // Pace is wpm, not a 0–100 measure, so it is not clamped to 100.
    paceWpm: isFiniteNumber(r.paceWpm) && r.paceWpm >= 0 ? r.paceWpm : 0,
    targetWpm: isFiniteNumber(r.targetWpm) && r.targetWpm >= 0 ? r.targetWpm : targetWpm,
    fillerCount: isFiniteNumber(r.fillerCount) && r.fillerCount >= 0 ? Math.floor(r.fillerCount) : 0,
    source: r.source === 'azure' ? 'azure' : 'live',
    wordCounts,
    challengingWords: Array.isArray(r.challengingWords)
      ? r.challengingWords.filter(isString).slice(0, 5)
      : [],
  };

  if (isString(r.passageId)) record.passageId = r.passageId;
  if (isString(r.topicId)) record.topicId = r.topicId;
  if (isString(r.contentTitle)) record.contentTitle = r.contentTitle;
  if (isString(r.appVersion)) record.appVersion = r.appVersion;
  // Left absent when missing rather than defaulted to 0: `isScorable` only
  // applies the spoken-word floor when the field is present, which is what
  // grandfathers migrated v1 history instead of retroactively unscoring it.
  if (isFiniteNumber(r.spokenWords) && r.spokenWords >= 0) {
    record.spokenWords = Math.floor(r.spokenWords);
  }
  if (isFiniteNumber(r.pauseCount) && r.pauseCount >= 0) {
    record.pauseCount = Math.floor(r.pauseCount);
  }
  if (isFiniteNumber(r.longestPauseMs) && r.longestPauseMs >= 0) {
    record.longestPauseMs = Math.floor(r.longestPauseMs);
  }

  return { ok: true, record, upgraded: version < RECORD_SCHEMA_VERSION, readOnly };
}

export function parseWordStat(raw: unknown): WordStat | null {
  if (raw == null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isString(r.word) || r.word.length === 0) return null;
  const num = (v: unknown) => (isFiniteNumber(v) && v >= 0 ? Math.floor(v) : 0);
  const seen = num(r.seen);
  if (seen === 0) return null;
  return {
    word: r.word,
    seen,
    clean: num(r.clean),
    mispronounced: num(r.mispronounced),
    omitted: num(r.omitted),
    cleanStreak: num(r.cleanStreak),
    everMissed: r.everMissed === true,
    firstSeenAt: num(r.firstSeenAt),
    lastSeenAt: num(r.lastSeenAt),
  };
}

// --- Export envelope ---------------------------------------------------------

export const EXPORT_KIND = 'clarity.history';
export const EXPORT_VERSION = 1;

export type HistoryExport = {
  kind: typeof EXPORT_KIND;
  version: number;
  exportedAt: number;
  records: SessionRecord[];
  words: WordStat[];
};

export type ImportParse =
  | { ok: true; records: SessionRecord[]; words: WordStat[]; skipped: number }
  | { ok: false; reason: string };

/** Parse an export blob back into records. Every row goes through `parseRecord`,
 * so importing a hand-edited or older file can't inject a malformed record. */
export function parseExport(json: string): ImportParse {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  if (raw == null || typeof raw !== 'object') return { ok: false, reason: 'not-an-object' };
  const envelope = raw as Record<string, unknown>;
  if (envelope.kind !== EXPORT_KIND) return { ok: false, reason: 'wrong-kind' };
  if (!Array.isArray(envelope.records)) return { ok: false, reason: 'no-records' };

  const records: SessionRecord[] = [];
  let skipped = 0;
  envelope.records.forEach((row, index) => {
    const parsed = parseRecord(row, { fallbackSeq: index });
    if (parsed.ok) records.push(parsed.record);
    else skipped += 1;
  });

  const words: WordStat[] = [];
  if (Array.isArray(envelope.words)) {
    for (const row of envelope.words) {
      const stat = parseWordStat(row);
      if (stat) words.push(stat);
    }
  }

  return { ok: true, records, words, skipped };
}
