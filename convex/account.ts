import { v } from 'convex/values';

import { mutation } from './_generated/server';
import { requireUserId } from './lib';

/** Bounded so one call cannot exceed a mutation's read/write limits. The client
 * loops until `done`. */
const BATCH = 200;

/**
 * Account deletion, required by App Store guideline 5.1.1(v). The app calls
 * this BEFORE deleting the Clerk user: once the user is gone there is no
 * identity left that could delete these rows.
 */
export const deleteAll = mutation({
  args: {},
  returns: v.object({ deleted: v.number(), done: v.boolean() }),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    let budget = BATCH;
    let deleted = 0;

    const sessions = await ctx.db
      .query('sessions')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .take(budget);
    for (const row of sessions) await ctx.db.delete(row._id);
    deleted += sessions.length;
    budget -= sessions.length;

    if (budget > 0) {
      const passages = await ctx.db
        .query('passages')
        .withIndex('by_user_created', (q) => q.eq('userId', userId))
        .take(budget);
      for (const row of passages) await ctx.db.delete(row._id);
      deleted += passages.length;
      budget -= passages.length;
    }

    if (budget > 0) {
      const settings = await ctx.db
        .query('settings')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .unique();
      if (settings !== null) {
        await ctx.db.delete(settings._id);
        deleted += 1;
      }
    }

    // A full batch means there may be more; the client calls again.
    return { deleted, done: deleted < BATCH };
  },
});
