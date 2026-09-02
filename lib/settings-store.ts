/**
 * The settings store: hydration, validation, and writes.
 *
 * PURE module. The key-value backend is injected as `KvBackend` (the same
 * interface `lib/history-store.ts` defines), so this runs under bun in
 * `scripts/test-settings.ts`. `services/settings.ts` owns the singleton and the
 * React glue.
 *
 * Two properties carried over from the history store, for the same reasons:
 *
 *  1. `getSettings()` returns a STABLE reference whose identity changes only
 *     after a successful write. `useSyncExternalStore` requires it.
 *  2. A value that cannot be validated is replaced by its default rather than
 *     read back. A settings file is not worth failing a launch over, and a
 *     corrupt accent code must not reach the Azure request as a locale.
 *
 * Every field also records WHEN it was last written (`set/<field>At`). The sync
 * layer resolves two devices field by field on those stamps, so a device that
 * changed only the accent cannot overwrite the other device's daily goal. A
 * field never written on this device reads as 0, which is what lets the server
 * win on a fresh install.
 */

import { ACCENTS, DEFAULT_ACCENT } from '@/constants/accents';
import { DEFAULT_GOAL_MINUTES, isGoalMinutes } from '@/constants/goals';
import { SKILL_ORDER } from '@/constants/metrics';
import type { KvBackend } from '@/lib/history-store';
import type { SkillKey } from '@/types/history';
import type { AccentLocale, Settings } from '@/types/settings';

export type SettingsKey = keyof Settings;

const SETTINGS_KEY: Record<SettingsKey, string> = {
  accentLocale: 'set/accentLocale',
  improveClarity: 'set/improveClarity',
  displayName: 'set/displayName',
  goalMinutes: 'set/goalMinutes',
  prioritySkill: 'set/prioritySkill',
  onboardingCompletedAt: 'set/onboardingCompletedAt',
};

const stampKey = (key: SettingsKey) => `${SETTINGS_KEY[key]}At`;

/** Every `set/` key this store owns, for a clean account-scoped wipe. */
export const SETTINGS_KEY_PREFIX = 'set/';

/**
 * `improveClarity` defaults to ON.
 *
 * Not an arbitrary choice: `expo-observe` already dispatches performance and
 * error metrics from release builds today, so ON is the state the app is
 * actually in. Defaulting it OFF would show every existing user a switch that
 * misdescribes their install.
 */
export const DEFAULT_SETTINGS: Settings = {
  accentLocale: DEFAULT_ACCENT,
  improveClarity: true,
  displayName: '',
  goalMinutes: DEFAULT_GOAL_MINUTES,
  prioritySkill: null,
  onboardingCompletedAt: null,
};

function parseAccentLocale(raw: string | undefined): AccentLocale {
  if (raw == null) return DEFAULT_SETTINGS.accentLocale;
  const match = ACCENTS.find((accent) => accent.locale === raw);
  return match ? match.locale : DEFAULT_SETTINGS.accentLocale;
}

function parseSkill(raw: string | undefined): SkillKey | null {
  if (raw == null) return null;
  return (SKILL_ORDER as readonly string[]).includes(raw) ? (raw as SkillKey) : null;
}

/** Positive epoch ms, or null. A zero or negative stamp is not a completion. */
function parseTimestamp(raw: number | undefined): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null;
}

export type SettingsStore = {
  /** Stable snapshot. Identity changes only on a successful write. */
  getSettings(): Settings;
  subscribe(listener: () => void): () => void;
  /**
   * Persist one field. Returns false when the write could not be verified, in
   * which case the snapshot is left alone: a switch that flips in the UI and
   * reverts on next launch is worse than one that does not move.
   */
  set<K extends SettingsKey>(key: K, value: Settings[K]): boolean;
  /** Epoch ms of the last local write to `key`; 0 when never written here. */
  getUpdatedAt(key: SettingsKey): number;
  /**
   * Take the server's word for a field, stamping it with the SERVER's time so a
   * later local write still wins on a newer stamp. Returns true when the
   * snapshot changed. Skips fields whose local stamp is newer.
   */
  applyRemote(patch: Partial<Settings>, stamps: Partial<Record<SettingsKey, number>>): boolean;
  /** Testing/reset seam: drop every stored setting back to its default. */
  reset(): void;
};

export type SettingsStoreDeps = {
  /** Injected clock so tests can pin stamps. */
  now?: () => number;
};

export function createSettingsStore(kv: KvBackend, deps: SettingsStoreDeps = {}): SettingsStore {
  const now = deps.now ?? (() => Date.now());
  const listeners = new Set<() => void>();
  let snapshot: Settings | null = null;

  const hydrate = (): Settings => {
    if (snapshot) return snapshot;
    const next: Settings = { ...DEFAULT_SETTINGS };
    try {
      const improve = kv.getBoolean(SETTINGS_KEY.improveClarity);
      if (typeof improve === 'boolean') next.improveClarity = improve;
      next.accentLocale = parseAccentLocale(kv.getString(SETTINGS_KEY.accentLocale));
      const name = kv.getString(SETTINGS_KEY.displayName);
      if (typeof name === 'string') next.displayName = name;
      const goal = kv.getNumber(SETTINGS_KEY.goalMinutes);
      if (isGoalMinutes(goal)) next.goalMinutes = goal;
      next.prioritySkill = parseSkill(kv.getString(SETTINGS_KEY.prioritySkill));
      next.onboardingCompletedAt = parseTimestamp(kv.getNumber(SETTINGS_KEY.onboardingCompletedAt));
    } catch {
      // A backend that cannot be read yields the defaults, which is a working
      // app rather than a failed launch.
    }
    snapshot = next;
    return snapshot;
  };

  const emit = () => {
    for (const listener of listeners) listener();
  };

  /** Read one field back from disk, through the same parser hydration uses. */
  const readBack = <K extends SettingsKey>(key: K): Settings[K] => {
    switch (key) {
      case 'accentLocale':
        return parseAccentLocale(kv.getString(SETTINGS_KEY.accentLocale)) as Settings[K];
      case 'improveClarity':
        return kv.getBoolean(SETTINGS_KEY.improveClarity) as Settings[K];
      case 'displayName':
        return (kv.getString(SETTINGS_KEY.displayName) ?? '') as Settings[K];
      case 'goalMinutes': {
        const goal = kv.getNumber(SETTINGS_KEY.goalMinutes);
        return (isGoalMinutes(goal) ? goal : DEFAULT_GOAL_MINUTES) as Settings[K];
      }
      case 'prioritySkill':
        return parseSkill(kv.getString(SETTINGS_KEY.prioritySkill)) as Settings[K];
      case 'onboardingCompletedAt':
        return parseTimestamp(kv.getNumber(SETTINGS_KEY.onboardingCompletedAt)) as Settings[K];
    }
  };

  /**
   * Write one field and confirm it landed. `null` is stored as an absent key,
   * so the read-back parser turns it back into `null` and the comparison holds.
   * Throws when the backend does; the caller decides what that means.
   */
  const writeVerified = <K extends SettingsKey>(key: K, value: Settings[K], stamp: number) => {
    if (value === null) kv.remove(SETTINGS_KEY[key]);
    else kv.set(SETTINGS_KEY[key], value as string | number | boolean);
    if (readBack(key) !== value) return false;
    kv.set(stampKey(key), stamp);
    return true;
  };

  /** A plain function, not a method: callers export these detached
   * (`services/settings.ts`), so nothing here may rely on `this`. */
  const getUpdatedAt = (key: SettingsKey): number => {
    try {
      return kv.getNumber(stampKey(key)) ?? 0;
    } catch {
      return 0;
    }
  };

  return {
    getSettings: hydrate,

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    set(key, value) {
      const current = hydrate();
      try {
        if (current[key] === value) {
          // An unchanged value is still an answer. Onboarding PRESELECTS the
          // default accent, goal, and priority, so Continue on an untouched
          // step writes the value it already holds. Returning early left the
          // stamp at 0, which `planSettings` reads as "never answered here" and
          // lets the server's older value overwrite the confirmed one.
          //
          // Only the stamp moves, so the snapshot keeps its identity and no
          // screen re-renders; the notification is for the sync layer, which
          // pushes on the new stamp.
          kv.set(stampKey(key), now());
          emit();
          return true;
        }
        // Memory equals disk: confirm by reading back, not by assuming the
        // write landed.
        if (!writeVerified(key, value, now())) return false;
      } catch {
        return false;
      }
      snapshot = { ...current, [key]: value };
      emit();
      return true;
    },

    getUpdatedAt,

    applyRemote(patch, stamps) {
      const current = hydrate();
      let next: Settings | null = null;
      for (const key of Object.keys(patch) as SettingsKey[]) {
        const value = patch[key];
        if (value === undefined) continue;
        const remoteStamp = stamps[key] ?? 0;
        // Local wins on a strictly newer stamp; ties go to the server, which is
        // the only party that has seen every device.
        if (getUpdatedAt(key) > remoteStamp) continue;
        if (current[key] === value) continue;
        try {
          if (!writeVerified(key, value as never, remoteStamp)) continue;
        } catch {
          continue;
        }
        next = { ...(next ?? current), [key]: value };
      }
      if (!next) return false;
      snapshot = next;
      emit();
      return true;
    },

    reset() {
      try {
        for (const key of kv.getAllKeys()) {
          if (key.startsWith(SETTINGS_KEY_PREFIX)) kv.remove(key);
        }
      } catch {
        // Best effort; the snapshot below is what callers observe.
      }
      snapshot = { ...DEFAULT_SETTINGS };
      emit();
    },
  };
}
