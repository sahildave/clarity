/**
 * Runs on the Convex backend, not in the app bundle. CLERK_FRONTEND_API_URL is
 * therefore set per deployment with `bunx convex env set`, never in .env.local:
 * Metro never sees this file, and Convex never sees .env.local.
 *
 * The value differs per deployment because each Clerk instance has its own
 * Frontend API: the dev deployment points at the `*.clerk.accounts.dev` URL,
 * prod at `https://clerk.clarityspeech.app`. Pointing prod at the dev URL fails
 * as a silent `Not authenticated` on every call, with no other symptom.
 */
/** The Convex tsconfig carries no Node types; this is the one `process` read. */
declare const process: { env: Record<string, string | undefined> };

export default {
  providers: [
    {
      domain: process.env.CLERK_FRONTEND_API_URL,
      applicationID: 'convex',
    },
  ],
};
