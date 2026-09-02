import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Every table is scoped by `userId`, the Clerk subject from
 * `ctx.auth.getUserIdentity()`. It is never a client argument; `requireUserId`
 * in `lib.ts` is the one place it is read.
 *
 * Every row also carries the device-side id as `clientId`. Local ids are pure
 * functions of local state (`s/<completedAt>/<seq>` for sessions,
 * `custom-<createdAt>` for passages), so a device that retries a push after a
 * kill re-sends byte-identical rows and the `by_user_client` lookup makes the
 * replay a no-op instead of a duplicate.
 */

const accentLocale = v.union(
  v.literal('en-US'),
  v.literal('en-GB'),
  v.literal('en-AU'),
  v.literal('en-CA'),
  v.literal('en-IN'),
);

const skillKey = v.union(
  v.literal('accuracy'),
  v.literal('fluency'),
  v.literal('intonation'),
  v.literal('pace'),
  v.literal('fillers'),
);

/**
 * Mirrors `SessionRecord` in `types/history.ts` field for field. Scalar-only,
 * exactly as on device: no audio, no waveforms. There is deliberately no stored
 * score; every consumer recomputes it from these raw measures, so the score
 * definition can change without a backfill.
 */
export const sessionFields = {
  userId: v.string(),
  clientId: v.string(),
  v: v.number(),
  seq: v.number(),
  completedAt: v.number(),
  tzOffsetMinutes: v.number(),
  mode: v.union(v.literal('passage'), v.literal('drill'), v.literal('freestyle')),
  endedReason: v.union(
    v.literal('completed'),
    v.literal('stopped'),
    v.literal('abandoned'),
    v.literal('interrupted'),
    v.literal('error'),
  ),
  durationMs: v.number(),
  accuracy: v.number(),
  fluency: v.number(),
  completeness: v.number(),
  intonation: v.number(),
  paceWpm: v.number(),
  targetWpm: v.number(),
  fillerCount: v.number(),
  source: v.union(v.literal('azure'), v.literal('live')),
  wordCounts: v.object({
    good: v.number(),
    mispronounced: v.number(),
    omitted: v.number(),
    inserted: v.number(),
  }),
  challengingWords: v.array(v.string()),
  passageId: v.optional(v.string()),
  topicId: v.optional(v.string()),
  contentTitle: v.optional(v.string()),
  appVersion: v.optional(v.string()),
  spokenWords: v.optional(v.number()),
  pauseCount: v.optional(v.number()),
  longestPauseMs: v.optional(v.number()),
  /**
   * Compact per-word verdicts (`w` word, `s` status), kept so word mastery can
   * be rebuilt on a new device by folding the session log. The device record
   * stays scalar-only; only the sync layer reads this.
   */
  wordDeltas: v.optional(v.array(v.object({ w: v.string(), s: v.string() }))),
};

/** Mirrors `CustomPassage` in `types/session.ts`. Artwork is stored rather than
 * re-derived so a passage looks the same on every device. */
export const passageFields = {
  userId: v.string(),
  clientId: v.string(),
  title: v.string(),
  text: v.string(),
  targetWpm: v.number(),
  duration: v.string(),
  artwork: v.object({
    base: v.array(v.string()),
    blob: v.array(v.string()),
  }),
  createdAt: v.number(),
  /** Soft delete, so a removal propagates instead of another device's copy
   * resurrecting the row on its next push. */
  deletedAt: v.optional(v.number()),
};

/**
 * One document per user. Every field carries its own write stamp so two
 * devices reconcile field by field: a device that changed only the accent
 * cannot overwrite the other device's daily goal. The stamps mirror the
 * `set/<field>At` keys `lib/settings-store.ts` already keeps.
 */
export const settingsValueFields = {
  accentLocale,
  improveClarity: v.boolean(),
  displayName: v.string(),
  goalMinutes: v.number(),
  prioritySkill: v.union(skillKey, v.null()),
  onboardingCompletedAt: v.union(v.number(), v.null()),
};

export const settingsStampFields = {
  accentLocale: v.number(),
  improveClarity: v.number(),
  displayName: v.number(),
  goalMinutes: v.number(),
  prioritySkill: v.number(),
  onboardingCompletedAt: v.number(),
};

export default defineSchema({
  // `by_user` ends in the implicit `_creationTime`, which is what the pull
  // cursor ranges over: server insertion order is the only order that cannot
  // miss a session another device recorded earlier but pushed later.
  sessions: defineTable(sessionFields)
    .index('by_user_client', ['userId', 'clientId'])
    .index('by_user', ['userId']),

  passages: defineTable(passageFields)
    .index('by_user_client', ['userId', 'clientId'])
    .index('by_user_created', ['userId', 'createdAt']),

  settings: defineTable({
    userId: v.string(),
    ...settingsValueFields,
    stamps: v.object(settingsStampFields),
  }).index('by_user', ['userId']),
});
