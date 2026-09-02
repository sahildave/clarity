/**
 * Server-side size limits for client-supplied rows.
 *
 * Every mutation here is public: an authenticated client calls it directly,
 * with whatever payload it likes, and the schema's `v.string()` /
 * `v.array(...)` validators bound only the SHAPE. These bound the SIZE, so one
 * caller cannot spend the deployment's storage and bandwidth on a single push.
 *
 * The numbers are deliberately far above anything the app produces (the title
 * field caps at 48 characters, artwork is two gradient stops), so a limit
 * firing means a hand-written client, not a long passage. Imported by the
 * passage editor too, so the app can never store a row the server will refuse:
 * a refusal has no user-visible path — the sync layer only logs it and retries.
 *
 * No imports on purpose: this module is read by the Convex bundler and by
 * Metro.
 */

/** Passages per `passages.push` call. Mirrors `PUSH_BATCH` in `sessions.ts`. */
export const PASSAGE_PUSH_BATCH = 50;

/** Client ids per `passages.remove` call. */
export const PASSAGE_REMOVE_BATCH = 100;

/** `custom-<createdAt>` on device; the cap is for a client that invents ids. */
export const CLIENT_ID_MAX = 128;

/** The editor's own `maxLength` is 48. */
export const PASSAGE_TITLE_MAX = 200;

/** A long speech runs to a few thousand words. The editor enforces the same
 * number, so nothing storable here is unpushable. */
export const PASSAGE_TEXT_MAX = 50_000;

/** "2 min", "1 hr 5 min". */
export const PASSAGE_DURATION_MAX = 32;

/** Two gradient stops per ramp today (`lib/sync-plan.ts` reads [0] and [1]);
 * the cap leaves room for a third without a deploy. */
export const ARTWORK_STOPS_MAX = 4;

/** "rgba(240,110,50,0.92)". */
export const ARTWORK_COLOR_MAX = 64;

/**
 * Per-word verdicts per session. Mirrors `MAX_WORD_DELTAS` in
 * `lib/history-store.ts`, which is where the device caps them.
 *
 * This one is not only about storage. `sessions.since` returns whole rows, so
 * an unbounded delta array makes the PULL query's response unbounded too, and a
 * query that exceeds Convex's read limit fails every single time it runs. See
 * `SESSION_PULL_PAGE` in `components/convex-sync.tsx` for the other half.
 */
export const WORD_DELTAS_MAX = 2000;

/** `lib/history-schema.ts` slices this to 5 on the way in. */
export const CHALLENGING_WORDS_MAX = 16;

/** One spoken word, plus room for a compound. */
export const WORD_MAX = 64;

/** Verdict codes are words like "mispronounced". */
export const WORD_STATUS_MAX = 32;

/** `passageId`, `topicId`, `contentTitle`, `appVersion`. */
export const SESSION_LABEL_MAX = 200;
