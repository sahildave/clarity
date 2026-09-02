/**
 * Self-tests for the sync planner. Pure JS — run with:
 *   bun scripts/test-sync.ts
 *
 * Covers the decisions the sync component executes: which sessions to push and
 * when the cursor may jump, the passage set diff with pending deletes, and the
 * field-by-field settings reconciliation. Also checks the word-verdict sidecar
 * the history store keeps for upload.
 */

import { makeRecordKey } from '@/lib/history-schema';
import { createHistoryStore, createMemoryKv } from '@/lib/history-store';
import {
  expandWordDeltas,
  fromRemoteSession,
  planPassages,
  planSessionPush,
  planSettings,
  settledSeq,
  toRemotePassage,
  toRemoteSession,
  type RemotePassage,
  type RemoteSessionRow,
} from '@/lib/sync-plan';
import { DEFAULT_SETTINGS, createSettingsStore } from '@/lib/settings-store';
import { RECORD_SCHEMA_VERSION, type SessionRecord } from '@/types/history';
import type { CustomPassage } from '@/types/session';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: unknown) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${label}`, detail !== undefined ? JSON.stringify(detail) : '');
  }
}

function assertEq<T>(actual: T, expected: T, label: string) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );
}

function section(name: string) {
  console.log(`\n== ${name}`);
}

/** Key-order independent equality for plain objects. */
function sorted<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.keys(value as object)
      .sort()
      .map((k) => [k, (value as Record<string, unknown>)[k]]),
  ) as T;
}

const NOW = new Date(2026, 7, 26, 12, 0, 0).getTime();

function record(seq: number, overrides: Partial<SessionRecord> = {}): SessionRecord {
  const completedAt = NOW + seq * 60_000;
  return {
    v: RECORD_SCHEMA_VERSION,
    id: makeRecordKey(completedAt, seq),
    seq,
    completedAt,
    tzOffsetMinutes: 0,
    mode: 'passage',
    endedReason: 'completed',
    durationMs: 30_000,
    accuracy: 90,
    fluency: 80,
    completeness: 100,
    intonation: 70,
    paceWpm: 140,
    targetWpm: 150,
    fillerCount: 1,
    spokenWords: 40,
    source: 'azure',
    wordCounts: { good: 38, mispronounced: 2, omitted: 0, inserted: 0 },
    challengingWords: ['rural'],
    ...overrides,
  };
}

// --- sessions ----------------------------------------------------------------

section('session push plan');
{
  const records = [record(1), record(2), record(3), record(4)];
  assertEq(
    planSessionPush(records, 0, new Set(), 50).map((r) => r.seq),
    [1, 2, 3, 4],
    'everything past a zero cursor',
  );
  assertEq(
    planSessionPush(records, 2, new Set(), 50).map((r) => r.seq),
    [3, 4],
    'only past the cursor',
  );
  assertEq(
    planSessionPush(records, 0, new Set(), 2).map((r) => r.seq),
    [1, 2],
    'capped at the batch, oldest first',
  );
  assertEq(
    planSessionPush(records, 0, new Set([records[2].id]), 50).map((r) => r.seq),
    [1, 2, 4],
    'rows that came from the server are never pushed back',
  );
  assertEq(planSessionPush([], 0, new Set(), 50), [], 'empty store');

  assertEq(settledSeq(records, 0), 4, 'settled cursor jumps to the highest seq');
  assertEq(settledSeq(records, 9), 9, 'settled cursor never moves backwards');
}

section('session shape round trip');
{
  const local = record(7, { passageId: 'epic-speech', contentTitle: 'Epic' });
  const remote = toRemoteSession(local, [{ w: 'rural', s: 'mispronounced' }]);
  assert(!('id' in remote), 'remote row has no local id');
  assertEq(remote.clientId, local.id, 'local id travels as clientId');
  assertEq(remote.wordDeltas, [{ w: 'rural', s: 'mispronounced' }], 'deltas attached');
  assert(toRemoteSession(local, null).wordDeltas === undefined, 'no deltas, no field');
  assert(toRemoteSession(local, []).wordDeltas === undefined, 'empty deltas, no field');

  const row: RemoteSessionRow = {
    ...remote,
    _id: 'doc1',
    _creationTime: NOW,
    userId: 'user_1',
  };
  const back = fromRemoteSession(row);
  assertEq(sorted(back), sorted(local), 'strips server fields and restores the id');
  assertEq(
    expandWordDeltas([{ w: 'a', s: 'good' }]),
    [{ word: 'a', status: 'good' }],
    'deltas expand to the fold input',
  );
}

section('word-verdict sidecar in the history store');
{
  const kv = createMemoryKv();
  const store = createHistoryStore({ kv, now: () => NOW, scheduleWrite: (fn) => fn() });
  const written = store.recordSession({
    mode: 'passage',
    endedReason: 'completed',
    durationMs: 20_000,
    accuracy: 90,
    fluency: 90,
    completeness: 100,
    intonation: 80,
    paceWpm: 150,
    targetWpm: 150,
    fillerCount: 0,
    spokenWords: 3,
    source: 'azure',
    wordCounts: { good: 2, mispronounced: 1, omitted: 0, inserted: 0 },
    challengingWords: ['rural'],
    words: [
      { word: 'the', status: 'good' },
      { word: 'rural', status: 'mispronounced' },
      { word: 'juror', status: 'good' },
    ],
  });
  assert(written.ok, 'session recorded');
  if (written.ok) {
    const deltas = store.getWordDeltas(written.record.id);
    assertEq(
      deltas,
      [
        { w: 'the', s: 'good' },
        { w: 'rural', s: 'mispronounced' },
        { w: 'juror', s: 'good' },
      ],
      'verdicts kept beside the record',
    );
    store.removeWordDeltas(written.record.id);
    assertEq(store.getWordDeltas(written.record.id), null, 'removed after upload');
    assertEq(store.getWordStats().length, 3, 'local fold ran at write time');

    // A second device's verdicts fold through the same rules.
    store.applyWordVerdicts([{ word: 'rural', status: 'good' }], NOW + 1, 'completed');
    const rural = store.getWordStats().find((w) => w.word === 'rural');
    assertEq(rural?.seen, 2, 'remote verdict counted');
    assertEq(rural?.cleanStreak, 1, 'streak resumes after a clean remote read');

    store.applyWordVerdicts([{ word: 'rural', status: 'omitted' }], NOW + 2, 'abandoned');
    assertEq(
      store.getWordStats().find((w) => w.word === 'rural')?.seen,
      2,
      'unscorable sessions do not fold, same as locally',
    );
  }

  const cleared = createHistoryStore({ kv, now: () => NOW, scheduleWrite: (fn) => fn() });
  cleared.recordSession({
    mode: 'passage',
    endedReason: 'completed',
    durationMs: 20_000,
    accuracy: 90,
    fluency: 90,
    completeness: 100,
    intonation: 80,
    paceWpm: 150,
    targetWpm: 150,
    fillerCount: 0,
    spokenWords: 1,
    source: 'azure',
    wordCounts: { good: 1, mispronounced: 0, omitted: 0, inserted: 0 },
    challengingWords: [],
    words: [{ word: 'hello', status: 'good' }],
  });
  assert(
    kv.getAllKeys().some((k) => k.startsWith('d/')),
    'sidecar present before the wipe',
  );
  cleared.clearAccountData();
  assert(
    !kv.getAllKeys().some((k) => k.startsWith('d/')),
    'sign-out wipe removes pending verdicts',
  );
}

// --- passages ----------------------------------------------------------------

section('passage plan');
{
  const passage = (id: string, createdAt: number): CustomPassage => ({
    id,
    title: `Title ${id}`,
    text: `Text for ${id}.`,
    targetWpm: 150,
    duration: '~1 min',
    artwork: { base: ['a', 'b'], blob: ['c', 'd'] },
    category: 'custom',
    custom: true,
    createdAt,
  });
  const remoteOf = (p: CustomPassage, deletedAt?: number): RemotePassage => ({
    ...toRemotePassage(p),
    ...(deletedAt !== undefined ? { deletedAt } : {}),
  });

  const a = passage('custom-a', 1);
  const b = passage('custom-b', 2);
  const c = passage('custom-c', 3);
  const d = passage('custom-d', 4);

  // a: both sides. b: local only. c: remote only. d: remote, deleted there but still local.
  const plan = planPassages([a, b, d], [remoteOf(a), remoteOf(c), remoteOf(d, NOW)], []);
  assertEq(plan.push.map((p) => p.id), ['custom-b'], 'local-only rows are pushed');
  assertEq(plan.addLocal.map((p) => p.id), ['custom-c'], 'remote-only live rows are added');
  assertEq(plan.removeLocal, ['custom-d'], 'remote-deleted rows are removed locally');
  assertEq(plan.removeRemote, [], 'no pending deletes, nothing to delete remotely');

  // Pending delete of a row the server still shows live.
  const pending = planPassages([], [remoteOf(a)], ['custom-a']);
  assertEq(pending.removeRemote, ['custom-a'], 'pending delete reaches the server');
  assertEq(pending.addLocal, [], 'a pending delete is not resurrected locally');
  assertEq(pending.settle, [], 'a delete the server has not recorded stays pending');

  // Pending delete of a row that was never uploaded, or already deleted there.
  const gone = planPassages([], [remoteOf(a, NOW)], ['custom-a', 'custom-never']);
  assertEq(gone.removeRemote, [], 'already-deleted and never-uploaded rows need nothing');
  assertEq(gone.settle, ['custom-a'], 'a delete the server already carries is settled');

  // The id is not in this snapshot at all. Absence is not proof: the row may
  // exist in a copy this run did not read, so the delete must stay pending or a
  // later pull brings the passage back.
  const unseen = planPassages([], [], ['custom-never']);
  assertEq(unseen.settle, [], 'a delete missing from the snapshot is never settled');

  // Deleted locally before it was pushed, but the local row is somehow still
  // present: do not push it back.
  const stale = planPassages([b], [], ['custom-b']);
  assertEq(stale.push, [], 'a row marked for delete is not pushed');

  const round = toRemotePassage(a);
  assertEq(round.clientId, 'custom-a', 'passage id travels as clientId');
  const malformed = planPassages([], [{ ...remoteOf(c), artwork: { base: ['x'], blob: [] } }], []);
  assertEq(malformed.addLocal, [], 'a malformed remote row is skipped, not crashed on');
}

// --- settings ----------------------------------------------------------------

section('settings plan');
{
  const zero = {
    accentLocale: 0,
    improveClarity: 0,
    displayName: 0,
    goalMinutes: 0,
    prioritySkill: 0,
    onboardingCompletedAt: 0,
  };

  // Fresh install, no account document: nothing to push, nothing to apply.
  const fresh = planSettings(DEFAULT_SETTINGS, zero, null);
  assertEq(fresh, { push: null, apply: null }, 'defaults never overwrite an account');

  // Fresh install, account exists: server wins on every stamped field.
  const remote = {
    ...DEFAULT_SETTINGS,
    displayName: 'Nate',
    accentLocale: 'en-GB' as const,
    onboardingCompletedAt: NOW - 1000,
    stamps: { ...zero, displayName: 10, accentLocale: 10, onboardingCompletedAt: 10 },
  };
  const restore = planSettings(DEFAULT_SETTINGS, zero, remote);
  assertEq(restore.push, null, 'nothing local to push on a fresh install');
  assertEq(
    restore.apply,
    {
      patch: { accentLocale: 'en-GB', displayName: 'Nate', onboardingCompletedAt: NOW - 1000 },
      stamps: { accentLocale: 10, displayName: 10, onboardingCompletedAt: 10 },
    },
    'server fields with stamps are applied, unstamped defaults are not',
  );

  // Local newer on one field, server newer on another.
  const local = { ...DEFAULT_SETTINGS, displayName: 'Nathan', goalMinutes: 30 };
  const mixed = planSettings(local, { ...zero, displayName: 20, goalMinutes: 5 }, {
    ...remote,
    goalMinutes: 10,
    stamps: { ...remote.stamps, goalMinutes: 8 },
  });
  assertEq(
    mixed.push,
    { patch: { displayName: 'Nathan' }, stamps: { displayName: 20 } },
    'only the strictly newer local field is pushed',
  );
  assertEq(
    mixed.apply,
    {
      patch: { accentLocale: 'en-GB', goalMinutes: 10, onboardingCompletedAt: NOW - 1000 },
      stamps: { accentLocale: 10, goalMinutes: 8, onboardingCompletedAt: 10 },
    },
    'server-newer fields are applied',
  );

  // Ties go to the server: equal stamps, different values, nothing pushed.
  const tie = planSettings(
    { ...DEFAULT_SETTINGS, displayName: 'Local' },
    { ...zero, displayName: 10 },
    { ...remote, displayName: 'Server', stamps: { ...zero, displayName: 10 } },
  );
  assertEq(tie.push, null, 'a tie is not pushed');
  assertEq(
    tie.apply,
    { patch: { displayName: 'Server' }, stamps: { displayName: 10 } },
    'a tie applies the server value',
  );

  // Same value both sides: no traffic either way, whatever the stamps say.
  const same = planSettings(
    { ...DEFAULT_SETTINGS, displayName: 'Nate' },
    { ...zero, displayName: 99 },
    { ...remote, stamps: { ...zero, displayName: 1 } },
  );
  assert(same.push === null || !('displayName' in same.push.patch), 'equal values are not pushed');
}

section('settings store methods work detached');
{
  // services/settings.ts exports these as bare functions, which is how the
  // sync layer calls them. A `this` reference inside would throw at runtime.
  const store = createSettingsStore(createMemoryKv(), { now: () => NOW });
  const { applyRemote, getUpdatedAt, set } = store;
  assertEq(getUpdatedAt('displayName'), 0, 'detached getUpdatedAt reads 0 before any write');
  let threw = false;
  let changed = false;
  try {
    changed = applyRemote({ displayName: 'Remote' }, { displayName: 5 });
  } catch {
    threw = true;
  }
  assert(!threw, 'detached applyRemote does not throw');
  assert(changed, 'detached applyRemote applied the field');
  assertEq(store.getSettings().displayName, 'Remote', 'value landed');
  assertEq(getUpdatedAt('displayName'), 5, 'stamped with the server time');
  assert(set('displayName', 'Local'), 'detached set works');
  assert(!applyRemote({ displayName: 'Older' }, { displayName: 4 }), 'older remote is ignored');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
