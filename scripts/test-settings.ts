/**
 * Self-tests for the settings store. Pure JS — run with:
 *   bun scripts/test-settings.ts
 */

import { ACCENTS, accentFor, hasPhonemeDetail } from '@/constants/accents';
import { DEFAULT_GOAL_MINUTES, GOAL_OPTIONS } from '@/constants/goals';
import { createMemoryKv } from '@/lib/history-store';
import { createSettingsStore, DEFAULT_SETTINGS } from '@/lib/settings-store';

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

// ---------------------------------------------------------------------------
section('defaults');
{
  const store = createSettingsStore(createMemoryKv());
  assertEq(store.getSettings().accentLocale, 'en-US', 'accent defaults to en-US');
  assertEq(store.getSettings().improveClarity, true, 'improveClarity defaults on');
  assertEq(store.getSettings(), DEFAULT_SETTINGS, 'snapshot equals the documented defaults');
}

// ---------------------------------------------------------------------------
section('snapshot identity is stable');
{
  const store = createSettingsStore(createMemoryKv());
  const first = store.getSettings();
  assert(store.getSettings() === first, 'repeated reads return the SAME reference');
  store.set('accentLocale', 'en-GB');
  assert(store.getSettings() !== first, 'identity changes after a write');
  const second = store.getSettings();
  // A no-op write must not churn the reference: useSyncExternalStore would
  // re-render every subscriber for nothing.
  store.set('accentLocale', 'en-GB');
  assert(store.getSettings() === second, 'writing the same value does not churn identity');
}

// ---------------------------------------------------------------------------
section('writes persist and notify');
{
  const kv = createMemoryKv();
  const store = createSettingsStore(kv);
  let notified = 0;
  const unsubscribe = store.subscribe(() => notified++);

  assert(store.set('accentLocale', 'en-IN'), 'accent write reported success');
  assertEq(store.getSettings().accentLocale, 'en-IN', 'accent applied');
  assertEq(notified, 1, 'subscriber notified once');

  assert(store.set('improveClarity', false), 'toggle write reported success');
  assertEq(store.getSettings().improveClarity, false, 'toggle applied');
  assertEq(notified, 2, 'subscriber notified again');

  unsubscribe();
  store.set('accentLocale', 'en-AU');
  assertEq(notified, 2, 'unsubscribed listener stops hearing');

  // Same backend, fresh store: this is what the next app launch sees.
  const reloaded = createSettingsStore(kv);
  assertEq(reloaded.getSettings().accentLocale, 'en-AU', 'accent survives a reload');
  assertEq(reloaded.getSettings().improveClarity, false, 'toggle survives a reload');
}

// ---------------------------------------------------------------------------
section('a corrupt accent never reaches the Azure request');
{
  const kv = createMemoryKv();
  // Whatever put this here, it is not a locale we support, and it would be sent
  // verbatim as the recognition language.
  kv.set('set/accentLocale', 'klingon');
  const store = createSettingsStore(kv);
  assertEq(store.getSettings().accentLocale, 'en-US', 'unknown locale falls back to the default');

  const kv2 = createMemoryKv();
  kv2.set('set/accentLocale', '');
  assertEq(
    createSettingsStore(kv2).getSettings().accentLocale,
    'en-US',
    'empty locale falls back too',
  );
}

// ---------------------------------------------------------------------------
section('an unverifiable write leaves the snapshot alone');
{
  const kv = createMemoryKv();
  const store = createSettingsStore(kv);
  const before = store.getSettings();
  let notified = 0;
  store.subscribe(() => notified++);

  // A backend that accepts writes and drops them. Memory must equal disk, so
  // the snapshot must NOT move: a control that flips and then reverts on the
  // next launch is worse than one that does not move at all.
  const broken = { ...kv, set: () => {} };
  const brokenStore = createSettingsStore(broken);
  assertEq(brokenStore.set('accentLocale', 'en-GB'), false, 'write reports failure');
  assertEq(brokenStore.getSettings().accentLocale, 'en-US', 'snapshot unchanged after a lost write');

  // A backend that throws must not take the app down either.
  const throwing = {
    ...kv,
    set: () => {
      throw new Error('disk full');
    },
  };
  const throwingStore = createSettingsStore(throwing);
  assertEq(throwingStore.set('improveClarity', false), false, 'throwing write reports failure');
  assertEq(throwingStore.getSettings().improveClarity, true, 'snapshot unchanged');

  assertEq(store.getSettings(), before, 'the healthy store was untouched throughout');
  assertEq(notified, 0, 'and never notified');
}

// ---------------------------------------------------------------------------
section('an unreadable backend still boots');
{
  const throwing = {
    ...createMemoryKv(),
    getString: () => {
      throw new Error('unreadable');
    },
    getBoolean: () => {
      throw new Error('unreadable');
    },
  };
  const store = createSettingsStore(throwing);
  assertEq(store.getSettings(), DEFAULT_SETTINGS, 'hydration degrades to defaults, does not throw');
}

// ---------------------------------------------------------------------------
section('reset');
{
  const kv = createMemoryKv();
  const store = createSettingsStore(kv);
  store.set('accentLocale', 'en-CA');
  store.set('improveClarity', false);
  store.set('displayName', 'Someone');
  store.reset();
  assertEq(store.getSettings(), DEFAULT_SETTINGS, 'reset restores defaults');
  assertEq(
    createSettingsStore(kv).getSettings(),
    DEFAULT_SETTINGS,
    'and clears the stored keys, so a reload agrees',
  );
}

// ---------------------------------------------------------------------------
section('onboarding fields');
{
  const kv = createMemoryKv();
  const store = createSettingsStore(kv);
  assertEq(store.getSettings().displayName, '', 'name defaults empty');
  assertEq(store.getSettings().goalMinutes, DEFAULT_GOAL_MINUTES, 'goal defaults to the old constant');
  assertEq(store.getSettings().prioritySkill, null, 'priority defaults to null');
  assertEq(store.getSettings().onboardingCompletedAt, null, 'onboarding starts incomplete');

  assert(store.set('displayName', 'Nate'), 'name write ok');
  assert(store.set('goalMinutes', 5), 'goal write ok');
  assert(store.set('prioritySkill', 'pace'), 'priority write ok');
  assert(store.set('onboardingCompletedAt', 1_700_000_000_000), 'completion write ok');
  const reloaded = createSettingsStore(kv);
  assertEq(reloaded.getSettings().displayName, 'Nate', 'name survives reload');
  assertEq(reloaded.getSettings().goalMinutes, 5, 'goal survives reload');
  assertEq(reloaded.getSettings().prioritySkill, 'pace', 'priority survives reload');
  assertEq(reloaded.getSettings().onboardingCompletedAt, 1_700_000_000_000, 'completion survives reload');

  // null round-trips: stored as an absent key, read back as null, and the
  // verify step must agree or the write reports failure.
  assert(reloaded.set('prioritySkill', null), 'clearing priority reports success');
  assertEq(reloaded.getSettings().prioritySkill, null, 'priority cleared');
  assertEq(createSettingsStore(kv).getSettings().prioritySkill, null, 'and stays cleared on reload');
  assert(reloaded.set('onboardingCompletedAt', null), 'clearing completion reports success');
  assertEq(createSettingsStore(kv).getSettings().onboardingCompletedAt, null, 'completion cleared on reload');
}

// ---------------------------------------------------------------------------
section('corrupt onboarding values fall back');
{
  const kv = createMemoryKv();
  kv.set('set/goalMinutes', 7); // not an offered option
  kv.set('set/prioritySkill', 'charisma');
  kv.set('set/onboardingCompletedAt', -5);
  const store = createSettingsStore(kv);
  assertEq(store.getSettings().goalMinutes, DEFAULT_GOAL_MINUTES, 'unknown goal falls back');
  assertEq(store.getSettings().prioritySkill, null, 'unknown skill falls back to null');
  assertEq(store.getSettings().onboardingCompletedAt, null, 'negative stamp is not a completion');
  assert(GOAL_OPTIONS.some((o) => o.minutes === DEFAULT_GOAL_MINUTES), 'the default is an offered option');
}

// ---------------------------------------------------------------------------
section('write stamps and remote application');
{
  const kv = createMemoryKv();
  let clock = 1000;
  const store = createSettingsStore(kv, { now: () => clock });
  assertEq(store.getUpdatedAt('accentLocale'), 0, 'never-written field stamps as 0');
  store.set('accentLocale', 'en-GB');
  assertEq(store.getUpdatedAt('accentLocale'), 1000, 'write records the clock');

  let notified = 0;
  store.subscribe(() => notified++);

  // Server is newer: it wins and the stamp becomes the server's.
  assert(store.applyRemote({ accentLocale: 'en-AU' }, { accentLocale: 2000 }), 'newer remote applied');
  assertEq(store.getSettings().accentLocale, 'en-AU', 'remote value landed');
  assertEq(store.getUpdatedAt('accentLocale'), 2000, 'stamp is the server time');
  assertEq(notified, 1, 'one notification');

  // Local is newer: remote is ignored for that field only.
  clock = 3000;
  store.set('goalMinutes', 10);
  const changed = store.applyRemote(
    { goalMinutes: 30, displayName: 'Remote' },
    { goalMinutes: 2500, displayName: 2500 },
  );
  assert(changed, 'the newer field still applies');
  assertEq(store.getSettings().goalMinutes, 10, 'local newer goal kept');
  assertEq(store.getSettings().displayName, 'Remote', 'remote name applied');

  // Identical remote: no identity churn, no notification.
  const before = store.getSettings();
  const n = notified;
  assertEq(store.applyRemote({ displayName: 'Remote' }, { displayName: 9000 }), false, 'identical remote is a no-op');
  assert(store.getSettings() === before, 'identity unchanged');
  assertEq(notified, n, 'no notification');

  // A fresh install (all stamps 0) always takes the server, including a tie at 0.
  const fresh = createSettingsStore(createMemoryKv(), { now: () => 5 });
  assert(fresh.applyRemote({ prioritySkill: 'fillers' }, { prioritySkill: 0 }), 'fresh install takes remote');
  assertEq(fresh.getSettings().prioritySkill, 'fillers', 'remote priority landed');
}

// ---------------------------------------------------------------------------
section('confirming an unchanged value stamps it');
{
  const kv = createMemoryKv();
  let clock = 1000;
  const store = createSettingsStore(kv, { now: () => clock });
  const before = store.getSettings();
  let notified = 0;
  store.subscribe(() => notified++);

  // What the onboarding goal step does when nobody taps: Continue confirms the
  // preselected default.
  clock = 4000;
  assert(store.set('goalMinutes', before.goalMinutes), 'confirming the default reports success');
  assertEq(store.getUpdatedAt('goalMinutes'), 4000, 'the confirmation is stamped');
  assert(store.getSettings() === before, 'the snapshot keeps its identity');
  assertEq(notified, 1, 'the sync layer is notified');

  // The stamp is the whole point: without it an older server value wins.
  assertEq(
    store.applyRemote({ goalMinutes: 30 }, { goalMinutes: 3000 }),
    false,
    'an older remote loses to a confirmed default',
  );
  assertEq(store.getSettings().goalMinutes, before.goalMinutes, 'the confirmed value stands');
}

// ---------------------------------------------------------------------------
section('accent catalog');
{
  assertEq(ACCENTS[0].locale, 'en-US', 'en-US is first and is the default');
  assert(new Set(ACCENTS.map((a) => a.locale)).size === ACCENTS.length, 'locales are unique');
  assert(
    ACCENTS.every((a) => /^en-[A-Z]{2}$/.test(a.locale)),
    'every locale is a well-formed BCP-47 English tag',
  );
  assert(
    ACCENTS.every((a) => a.label.length > 0 && a.region.length > 0),
    'every accent has a label and a region',
  );

  // Measured against the live endpoint: only en-US returns phoneme SYMBOLS.
  // If this ever changes, the Settings note is what goes stale.
  assert(hasPhonemeDetail('en-US'), 'en-US has phoneme detail');
  assertEq(
    ACCENTS.filter((a) => hasPhonemeDetail(a.locale)).map((a) => a.locale),
    ['en-US'],
    'and it is the only one, which is what the Settings note claims',
  );

  assertEq(accentFor('en-GB').label, 'British', 'accentFor resolves a known locale');
  assertEq(
    accentFor('nonsense' as never).locale,
    'en-US',
    'accentFor falls back rather than returning undefined',
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
