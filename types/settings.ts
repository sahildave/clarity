/**
 * User settings. Small, flat, and versioned by nothing: every field has a
 * default, and an unreadable value falls back to it rather than failing the
 * read (see `lib/settings-store.ts`).
 *
 * The onboarding answers live here too, rather than in a separate profile
 * store, so one store, one hydration path, and one sync policy cover them all.
 */

import type { SkillKey } from '@/types/history';

/** The English locales offered in Settings. See `constants/accents.ts`. */
export type AccentLocale = 'en-US' | 'en-GB' | 'en-AU' | 'en-CA' | 'en-IN';

export type Settings = {
  /**
   * The accent pronunciation is graded against. Passed straight to Azure as the
   * recognition locale, so this changes real scores.
   */
  accentLocale: AccentLocale;
  /**
   * The user's answer to "use my data to improve Clarity".
   *
   * NOT WIRED TO ANYTHING YET. It is stored and shown, and nothing reads it, so
   * the Settings copy deliberately states the preference rather than describing
   * a behaviour the app does not currently have. To connect it, call
   * `Observe.configure({ integrations: Observe.getIntegrations(), dispatchingEnabled: value })`
   * — passing the existing integrations back is required, because expo-observe
   * throws if the router integration changes after the tree has mounted.
   */
  improveClarity: boolean;
  /** What the Home greeting calls the user. Empty string means unset. */
  displayName: string;
  /** Daily goal in minutes of active speaking. See `constants/goals.ts`. */
  goalMinutes: number;
  /**
   * The skill the user said they want to work on. Seeds the cold-start
   * recommendations only; once enough sessions exist the measured skill profile
   * takes over (`lib/recommendations.ts`). `null` is "not sure yet".
   */
  prioritySkill: SkillKey | null;
  /**
   * Epoch ms when onboarding finished, or null. The root navigator reads this
   * synchronously to decide between the onboarding group and the tabs, so it
   * must never move to an async store.
   */
  onboardingCompletedAt: number | null;
};
