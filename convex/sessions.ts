import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import {
  CHALLENGING_WORDS_MAX,
  CLIENT_ID_MAX,
  SESSION_LABEL_MAX,
  WORD_DELTAS_MAX,
  WORD_MAX,
  WORD_STATUS_MAX,
} from './limits';
import { requireUserId } from './lib';
import { sessionFields } from './schema';

/** The client-supplied half of a row: everything except the owner. */
const { userId: _userId, ...clientSessionFields } = sessionFields;

/** Bounded so one call stays well inside a mutation's write limits. The client
 * batches to this size. */
export const PUSH_BATCH = 50;

/** The page ceiling for `since`. Chosen for the RESPONSE, not the read: a row
 * carries up to `WORD_DELTAS_MAX` verdicts, so a large page is a large payload
 * and a query that outgrows Convex's limit never succeeds again. */
const SINCE_LIMIT = 50;

/**
 * Size checks the schema validators cannot express. `push` is public, so its
 * argument is whatever an authenticated caller sends, and `v.string()` /
 * `v.array(...)` bound only the shape. The app's own values sit far below every
 * number here; see `limits.ts`.
 */
function assertField(name: string, value: string, max: number) {
  if (value.length > max) throw new Error(`session ${name} exceeds ${max} characters`);
}

function assertRecordWithinLimits(record: {
  clientId: string;
  challengingWords: string[];
  passageId?: string;
  topicId?: string;
  contentTitle?: string;
  appVersion?: string;
  wordDeltas?: { w: string; s: string }[];
}) {
  assertField('clientId', record.clientId, CLIENT_ID_MAX);
  if (record.passageId !== undefined) {
    assertField('passageId', record.passageId, SESSION_LABEL_MAX);
  }
  if (record.topicId !== undefined) assertField('topicId', record.topicId, SESSION_LABEL_MAX);
  if (record.contentTitle !== undefined) {
    assertField('contentTitle', record.contentTitle, SESSION_LABEL_MAX);
  }
  if (record.appVersion !== undefined) {
    assertField('appVersion', record.appVersion, SESSION_LABEL_MAX);
  }
  if (record.challengingWords.length > CHALLENGING_WORDS_MAX) {
    throw new Error(`session accepts at most ${CHALLENGING_WORDS_MAX} challenging words`);
  }
  for (const word of record.challengingWords) assertField('challenging word', word, WORD_MAX);
  const deltas = record.wordDeltas;
  if (deltas === undefined) return;
  if (deltas.length > WORD_DELTAS_MAX) {
    throw new Error(`session accepts at most ${WORD_DELTAS_MAX} word verdicts`);
  }
  for (const delta of deltas) {
    assertField('word verdict word', delta.w, WORD_MAX);
    assertField('word verdict status', delta.s, WORD_STATUS_MAX);
  }
}

/**
 * Idempotent append. A record whose `clientId` already exists for this user is
 * skipped, so a device that retries after a kill mid-push cannot double a
 * session. Sessions are immutable once written; there is no update path.
 */
export const push = mutation({
  args: { records: v.array(v.object(clientSessionFields)) },
  returns: v.object({ inserted: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    if (args.records.length > PUSH_BATCH) {
      throw new Error(`push accepts at most ${PUSH_BATCH} records per call`);
    }
    for (const record of args.records) assertRecordWithinLimits(record);
    let inserted = 0;
    let skipped = 0;
    for (const record of args.records) {
      const existing = await ctx.db
        .query('sessions')
        .withIndex('by_user_client', (q) =>
          q.eq('userId', userId).eq('clientId', record.clientId),
        )
        .unique();
      if (existing !== null) {
        skipped += 1;
        continue;
      }
      await ctx.db.insert('sessions', { ...record, userId });
      inserted += 1;
    }
    return { inserted, skipped };
  },
});

/**
 * Pull cursor over SERVER insertion time, not `completedAt`: a device that was
 * offline can push an old session long after newer ones exist, and a cursor on
 * completion time would never see it. Returns rows inserted strictly after
 * `after`, oldest first, capped at `limit`; the client advances `after` to the
 * last row's `_creationTime` and re-subscribes until a page comes back short.
 */
export const since = query({
  args: { after: v.number(), limit: v.number() },
  returns: v.array(
    v.object({ _id: v.id('sessions'), _creationTime: v.number(), ...sessionFields }),
  ),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await ctx.db
      .query('sessions')
      .withIndex('by_user', (q) => q.eq('userId', userId).gt('_creationTime', args.after))
      .order('asc')
      .take(Math.min(Math.max(1, args.limit), SINCE_LIMIT));
  },
});
