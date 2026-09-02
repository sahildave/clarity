import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { requireUserId } from './lib';
import { settingsStampFields, settingsValueFields } from './schema';

type SettingsKey = keyof typeof settingsValueFields;
const KEYS = Object.keys(settingsValueFields) as SettingsKey[];

/** The whole document, or null when this user has never pushed. Null is what
 * tells a fresh install "no account data yet, run onboarding". */
export const get = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id('settings'),
      _creationTime: v.number(),
      userId: v.string(),
      ...settingsValueFields,
      stamps: v.object(settingsStampFields),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query('settings')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .unique();
  },
});

/** Every value and stamp optional: a push carries only the fields whose local
 * stamp beat the server's. */
const partialValues = {
  accentLocale: v.optional(settingsValueFields.accentLocale),
  improveClarity: v.optional(settingsValueFields.improveClarity),
  displayName: v.optional(settingsValueFields.displayName),
  goalMinutes: v.optional(settingsValueFields.goalMinutes),
  prioritySkill: v.optional(settingsValueFields.prioritySkill),
  onboardingCompletedAt: v.optional(settingsValueFields.onboardingCompletedAt),
};

const partialStamps = {
  accentLocale: v.optional(v.number()),
  improveClarity: v.optional(v.number()),
  displayName: v.optional(v.number()),
  goalMinutes: v.optional(v.number()),
  prioritySkill: v.optional(v.number()),
  onboardingCompletedAt: v.optional(v.number()),
};

/**
 * Field-by-field last-write-wins. A field lands only when its stamp is strictly
 * newer than the stored one; ties keep the server's copy, which is the only
 * party that has seen every device. Fields absent from the patch are untouched.
 *
 * The first push from a user creates the document from the patch plus
 * defaults, so a device that has only ever set the accent still produces a
 * complete row.
 */
export const push = mutation({
  args: {
    patch: v.object(partialValues),
    stamps: v.object(partialStamps),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query('settings')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .unique();

    if (existing === null) {
      const stamps = { ...ZERO_STAMPS };
      const values = { ...DEFAULTS };
      for (const key of KEYS) {
        const value = args.patch[key];
        if (value === undefined) continue;
        (values as Record<string, unknown>)[key] = value;
        stamps[key] = args.stamps[key] ?? 0;
      }
      await ctx.db.insert('settings', { userId, ...values, stamps });
      return null;
    }

    const next: Record<string, unknown> = {};
    const stamps = { ...existing.stamps };
    let changed = false;
    for (const key of KEYS) {
      const value = args.patch[key];
      if (value === undefined) continue;
      const stamp = args.stamps[key] ?? 0;
      if (stamp <= stamps[key]) continue;
      next[key] = value;
      stamps[key] = stamp;
      changed = true;
    }
    if (changed) await ctx.db.patch(existing._id, { ...next, stamps });
    return null;
  },
});

/** Mirrors `DEFAULT_SETTINGS` in `lib/settings-store.ts`. Kept in step by hand:
 * Convex functions cannot import from the app tree. */
const DEFAULTS = {
  accentLocale: 'en-US' as const,
  improveClarity: true,
  displayName: '',
  goalMinutes: 20,
  prioritySkill: null,
  onboardingCompletedAt: null,
};

const ZERO_STAMPS: Record<SettingsKey, number> = {
  accentLocale: 0,
  improveClarity: 0,
  displayName: 0,
  goalMinutes: 0,
  prioritySkill: 0,
  onboardingCompletedAt: 0,
};
