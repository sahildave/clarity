import type { MutationCtx, QueryCtx } from './_generated/server';

/**
 * The one place the caller's identity is read. Every function starts here and
 * none takes a userId argument, so a row can only ever be written under the
 * subject Clerk signed for.
 *
 * `identity.subject` is the Clerk user id, the same value the app's auth bridge
 * keeps in MMKV as the synchronous sign-in flag.
 */
export async function requireUserId(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) throw new Error('Not authenticated');
  return identity.subject;
}
