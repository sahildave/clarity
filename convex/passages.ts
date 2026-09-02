import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import {
  ARTWORK_COLOR_MAX,
  ARTWORK_STOPS_MAX,
  CLIENT_ID_MAX,
  PASSAGE_DURATION_MAX,
  PASSAGE_PUSH_BATCH,
  PASSAGE_REMOVE_BATCH,
  PASSAGE_TEXT_MAX,
  PASSAGE_TITLE_MAX,
} from './limits';
import { requireUserId } from './lib';
import { passageFields } from './schema';

const { userId: _userId, deletedAt: _deletedAt, ...clientPassageFields } = passageFields;

/** A user writes passages by hand, so the library stays small. One bounded
 * read covers it, deleted rows included, so the client can apply removals. */
const LIST_LIMIT = 500;

/**
 * Size checks the schema validators cannot express.
 *
 * `push` is public, so its argument is whatever an authenticated caller sends.
 * Without these, one call could store an arbitrary number of arbitrarily long
 * strings under a single account. See `limits.ts` for why each number is what
 * it is; the app's own values sit far below all of them.
 */
function assertField(name: string, value: string, max: number) {
  if (value.length > max) {
    throw new Error(`passage ${name} exceeds ${max} characters`);
  }
}

function assertStops(name: string, stops: readonly string[]) {
  if (stops.length > ARTWORK_STOPS_MAX) {
    throw new Error(`passage artwork ${name} accepts at most ${ARTWORK_STOPS_MAX} stops`);
  }
  for (const stop of stops) assertField(`artwork ${name} stop`, stop, ARTWORK_COLOR_MAX);
}

function assertPassageWithinLimits(passage: {
  clientId: string;
  title: string;
  text: string;
  duration: string;
  artwork: { base: string[]; blob: string[] };
}) {
  assertField('clientId', passage.clientId, CLIENT_ID_MAX);
  assertField('title', passage.title, PASSAGE_TITLE_MAX);
  assertField('text', passage.text, PASSAGE_TEXT_MAX);
  assertField('duration', passage.duration, PASSAGE_DURATION_MAX);
  assertStops('base', passage.artwork.base);
  assertStops('blob', passage.artwork.blob);
}

export const list = query({
  args: {},
  returns: v.array(
    v.object({ _id: v.id('passages'), _creationTime: v.number(), ...passageFields }),
  ),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query('passages')
      .withIndex('by_user_created', (q) => q.eq('userId', userId))
      .order('asc')
      .take(LIST_LIMIT);
  },
});

/** Idempotent on `clientId`. A row that already exists is left alone, deleted
 * or not: a stale device re-pushing a passage the user removed elsewhere must
 * not bring it back. */
export const push = mutation({
  args: { passages: v.array(v.object(clientPassageFields)) },
  returns: v.object({ inserted: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    if (args.passages.length > PASSAGE_PUSH_BATCH) {
      throw new Error(`push accepts at most ${PASSAGE_PUSH_BATCH} passages per call`);
    }
    for (const passage of args.passages) assertPassageWithinLimits(passage);
    let inserted = 0;
    let skipped = 0;
    for (const passage of args.passages) {
      const existing = await ctx.db
        .query('passages')
        .withIndex('by_user_client', (q) =>
          q.eq('userId', userId).eq('clientId', passage.clientId),
        )
        .unique();
      if (existing !== null) {
        skipped += 1;
        continue;
      }
      await ctx.db.insert('passages', { ...passage, userId });
      inserted += 1;
    }
    return { inserted, skipped };
  },
});

/** Soft delete. Unknown ids are ignored so a retry is harmless. */
export const remove = mutation({
  args: { clientIds: v.array(v.string()), at: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    if (args.clientIds.length > PASSAGE_REMOVE_BATCH) {
      throw new Error(`remove accepts at most ${PASSAGE_REMOVE_BATCH} ids per call`);
    }
    for (const clientId of args.clientIds) assertField('clientId', clientId, CLIENT_ID_MAX);
    for (const clientId of args.clientIds) {
      const existing = await ctx.db
        .query('passages')
        .withIndex('by_user_client', (q) => q.eq('userId', userId).eq('clientId', clientId))
        .unique();
      if (existing !== null && existing.deletedAt === undefined) {
        await ctx.db.patch(existing._id, { deletedAt: args.at });
      }
    }
    return null;
  },
});
