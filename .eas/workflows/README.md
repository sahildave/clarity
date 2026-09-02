# Clarity agentic workflows — TestFlight feedback in, verified fix PR out

Two entry points, one fix loop:

- **TestFlight autofix** (`testflight-autofix.yml`): a tester submits
  crash or screenshot feedback and one EAS Workflows run carries it all
  the way to a PR — triage the feedback into a GitHub issue, reproduce it
  on an [EAS Simulator](https://docs.expo.dev/), fix, verify on a second
  simulator session, and open a PR with the smallest evidence that proves
  the claim.
- **Manual** ("tag an issue, get a fix"): label any GitHub issue `repro`
  and the same fix loop runs via agent-fix.yml.

A human reviews and merges; agents never merge.

## The loop

```
TestFlight tester submits crash/screenshot feedback
   │  testflight-autofix.yml — fired by the App Store Connect
   │  beta_feedback event. testflight-sweep.yml — the same job on a
   │  6-hourly cron, as the chain target, and via `eas workflow:run`
   │  for manual/testing; split files because EAS rejects
   │  ${{ app_store_connect.* }} env on non-ASC triggers
   │
   │  job 1 `triage` — short mutex + agent (.agents/triage-prompt.md):
   │    fetch via `eas testflight:feedback`, dedupe by the
   │    TestFlight-Feedback-IDs footer, cluster + rank, QUEUE each
   │    new actionable report as an issue labeled `testflight-queued`
   │    (real-audio reports get `needs-human`; recording/results UI is
   │    drivable through scripted speech). Concurrent triage waits on
   │    the short lock instead of starting a duplicate model.
   │
   │  job 2 `claim` — scripts/testflight-drain.sh claim (fast, no
   │    node_modules): EAS can't queue runs, so concurrent event
   │    runs race. An atomic git-ref lock (agent-fix-lock, stolen
   │    after 3h if stale) serializes them; the winner claims the
   │    OLDEST queued issue, relabels it `testflight`, outputs its
   │    number. Losers output nothing; their queued work is picked
   │    up by the holder's chain or the cron.
   │
   │  job 3 `fix` — skipped unless claim output an issue number
   │    (it emits the sentinel `none`, not an empty string, because
   │    EAS `set-output` rejects an empty VALUE):
   │    scripts/testflight-drain.sh fix runs the fix agent, releases
   │    the lock, and if the queue still has work dispatches a sweep
   │    run to drain the next issue (the chain).
   ▼
fix loop — .agents/fix-prompt.md (also reachable via: human labels
   │        an issue `repro`
   │        → .github/workflows/agent-repro-dispatch.yml
   │        → agent-fix.yml — this path bypasses the queue and lock)
   │ 1. read the issue
   │ 2. choose evidence: screenshot, session replay, or structural/runtime proof
   │ 3. EAS Simulator session: sign in as the dev test user and reproduce
   │ 4. issue comment: steps + observations + selected evidence class
   │ 5. minimal fix per AGENTS.md + `bun run test`
   │ 6. eas build --profile simulator (fix build)
   │ 7. second EAS Simulator session: verify with matching evidence
   ▼
PR labeled `agent-fix`
   Fixes #N · root cause · evidence class · verification
   static UI: before/after images · motion/timing: replay links
   structural/runtime: assertion, log, or regression test
```

The device work uses `eas simulator:*` + `agent-device` — plain shell
commands, no MCP, no macOS worker.

The autofix design follows brentvatne/euxy (crash-triage.yml +
feedback-triage.yml): the `beta_feedback` trigger with its
`${{ app_store_connect.* }}` context, and `eas testflight:feedback` for
the content (the ASC API key comes from the EAS credentials service, so
no ASC secrets live in this repo). Queued issues are labeled
`testflight-queued`, in-progress ones `testflight`, and NEVER `repro` —
`repro` would fire the GitHub bridge and dispatch a duplicate fix run.
If a fix agent fails or gives up, the drain labels the issue
`needs-human` and moves on; the queue never wedges on one bad issue.

Autofix one-time setup, on top of the setup below:

1. **No new secrets.** The existing `production` env vars cover it:
   `GITHUB_TOKEN` (issue writes), `EXPO_TOKEN` (eas-cli + the stored ASC
   key), `CLAUDE_CODE_OAUTH_TOKEN`.
2. **ASC event trigger**: connect App Store Connect in the EAS dashboard
   project settings, or the `beta_feedback` trigger never fires. The
   daily cron still sweeps screenshot feedback without it, but crashes
   are only fetchable by submission id from the event context.
3. Crons only run from the default branch, so the workflow must be on
   `main`.
4. Manual run: `eas workflow:run .eas/workflows/testflight-sweep.yml`
   (the autofix file only accepts the ASC event trigger).

## One-time setup

1. **GitHub repo secret**: `EXPO_TOKEN`
   ([robot access token](https://expo.dev/settings/access-tokens)).
2. **EAS `production` environment variables**:
   - `CLAUDE_CODE_OAUTH_TOKEN` — `claude setup-token` (do NOT also set
     `ANTHROPIC_API_KEY`; it takes precedence and bills the API).
   - `GITHUB_TOKEN` — fine-grained PAT for `SchroederNathan/clarity`:
     Issues, Contents, Pull requests (read/write).
   - `EXPO_TOKEN` — same robot token, for simulator sessions and the
     verification build.
3. **EAS `development` environment**: it must use the Clerk development
   publishable key and matching Convex development deployment. Set
   `EXPO_PUBLIC_DEV_SIGNIN_EMAIL` to an existing `+clerk_test` account. It is a
   public test identifier; do not set `EXPO_PUBLIC_DEV_SIGNIN_PASSWORD` in EAS.
   In that Clerk development instance, enable **Email verification code** for
   sign-in. Verify it with
   `clerk config pull --instance dev --keys auth_email`; `sign_in_strategies`
   must contain `email_code`.
4. **Label**: `gh label create repro --color 1D76DB`.
5. **Seed one simulator build** (the repro installs the latest finished
   one): `eas build --platform ios --profile simulator`. Rebuild whenever
   native/config inputs change or the baseline code on `main` changes. The
   profile compiles scripted passage and freestyle speech, QA seed hooks, and
   the dev-user sign-in into an otherwise release-style preview app.
6. EAS Simulator must be enabled on the account
   (`npx --yes eas-cli@latest simulator:availability --json`).

## Constraints worth knowing

- The cloud simulator has no real microphone. Scripted sessions make session
  controls and results UI testable, but microphone routing, permissions,
  transcription/scoring accuracy, and audio quality still need a physical
  device.
- Simulator auth uses Clerk's development-only fixed OTP for the configured
  `+clerk_test` user. Email-code sign-in must be enabled on the Clerk development
  instance. No password is stored in EAS or bundled in the app.
- Event and sweep triage share a short git-ref mutex. This prevents concurrent
  agents from filing the same TestFlight feedback ID twice before GitHub search
  can observe the first issue.
- Static UI gets before/after screenshots. Motion, pressed states, gestures,
  timing, and crash sequences use the EAS session replay. Structural/runtime
  fixes use snapshots, logs, and tests. The agent does not capture all three by
  default.
- The fix agent checks the latest simulator artifact's commit before starting a
  session. It reuses a compatible build and creates a fresh baseline only when
  relevant code or config changed, avoiding billable sessions on stale builds.
- Screenshots render inline in the PR because the repo is public
  (raw.githubusercontent.com URLs from the fix branch).
- The run takes ~25–40 minutes end to end; the fix-verification EAS build
  is most of it.

## Running a demo take

1. Demo bug is on `main` and the seed simulator build is fresh.
2. File the issue as a user would: *"App crashes when I save a custom
   passage. I pasted my speech, tapped Save to Library, and the app died."*
3. Add the `repro` label. That is the entire human action.
4. Watch: ack comment → EAS run → repro session →
   evidence comment on the issue → fix build → verification session →
   `agent-fix` PR with the selected evidence.
5. Manual dispatch, when a take needs a re-run:
   `eas workflow:run .eas/workflows/agent-fix.yml -F issue_number=<n>`
   Between takes: delete the agent comments, the `agent/fix-issue-<n>`
   branch, and close the test issue.
