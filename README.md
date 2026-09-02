# Clarity

![Clarity app screens](gh-preview.png)

Clarity is a speech-practice app for iOS and Android. Read a passage, work
through a one-minute drill, or speak off the cuff. Clarity follows along,
scores the session, and turns the result into a concrete next step.

[Website](https://exponathan-clarity.expo.app/) ·
[Join the iOS beta](https://testflight.apple.com/join/CMRNm4w4)

## What Clarity does

- **Guided and freestyle practice.** Use the built-in library, add your own
  passage, target one speaking skill with a drill, or answer a random prompt.
- **Live feedback.** A reference-aware teleprompter tracks the current word
  while showing elapsed time, pace, waveform, and transcript activity.
- **Detailed results.** Each session gets a speaking score out of 100 and five
  skill scores: Articulation, Flow, Pacing, Fillers, and Expression. Scripted
  sessions also include a word-by-word breakdown and recording playback.
- **AI coaching.** The result screen streams a short summary and three tips
  grounded in that session's measurements.
- **Targeted follow-up.** Clarity keeps a running list of difficult words, plays
  model pronunciation, and can generate a short passage that practices them.
- **Progress tracking.** Week, month, and all-time views cover score trends,
  practice time, sessions, streaks, skill movement, records, and mastered words.
- **Account sync.** Clerk handles sign-in. Convex syncs sessions, custom
  passages, and settings across devices without making the first screen wait on
  the network.

## How a session works

1. `expo-speech-recognition` streams native transcription while the app records
   the session audio.
2. Clarity's incremental aligner maps that transcript onto the reference text.
   It handles skipped, repeated, inserted, and partially spoken words while the
   teleprompter is moving.
3. When Azure Speech credentials are available, Clarity adds word, syllable,
   phoneme, fluency, and prosody detail. Without Azure, the local alignment still
   produces a complete fallback result.
4. The app writes the result to MMKV first. A single sync bridge sends local
   records to Convex after Clerk authenticates the account.
5. Expo Router API routes handle coaching, generated practice passages, and
   pronunciation audio without putting the AI Gateway key in the app bundle.

## Stack

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), React Native 0.86,
  React 19, and Expo Router with typed routes
- `expo-speech-recognition` and `expo-audio` for recognition and recording
- Azure Speech pronunciation assessment for optional phoneme-level analysis
- Clerk for authentication and Convex for account data sync
- MMKV for synchronous, offline-first local storage
- Expo Router API routes, Vercel AI Gateway, and AI SDK 7 for generated features
- RevenueCat for Clarity Pro purchases and subscription state
- EAS Observe for startup, navigation, practice, auth, and error telemetry
- SF Pro Rounded, Hugeicons Pro, Reanimated, and Expo Glass Effect for the UI

## Run locally

Clarity requires a development build. Expo Go cannot load the native modules
used by speech recognition, MMKV, and RevenueCat.

### Requirements

- [Bun](https://bun.sh/) and the native toolchain for the platform you plan to
  run, either Xcode for iOS or Android Studio for Android
- A Hugeicons Pro token for the private icon packages
- Matching Clerk and Convex development projects
- A physical device if you need to test microphone and speech behavior

### Install and configure

Create the ignored local environment file first. Bun reads it during dependency
installation, including the `HUGEICONS_TOKEN` referenced by `.npmrc`.

```bash
cp .env.example .env.local
# Fill in HUGEICONS_TOKEN and the required development values.
bun install --frozen-lockfile
```

Start the Convex watcher. Its first run links or creates a development deployment
and writes the deployment URL and identifier to `.env.local`.

```bash
bun run convex
```

Each Convex deployment also needs the Frontend API URL for the matching Clerk
instance. Set this on the backend, not in `.env.local`:

```bash
bunx convex env set CLERK_FRONTEND_API_URL 'https://your-instance.clerk.accounts.dev'
```

Leave `bun run convex` running, then build the native app in another terminal:

```bash
bun run ios
# or
bun run android
```

### Environment variables

[`.env.example`](.env.example) documents the values normally set locally or in
EAS. These are the groups that matter during setup:

| Area | Variables | When they are needed |
| --- | --- | --- |
| App auth and sync | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_CONVEX_URL` | Required for the app to start and authenticate |
| Convex auth | `CLERK_FRONTEND_API_URL` | Required on each Convex deployment; set with `convex env set` |
| Private packages | `HUGEICONS_TOKEN` | Required when installing dependencies |
| Native Google sign-in | `EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME` | Required for configured native Google sign-in; iOS values vary by app variant |
| Generated features | `AI_GATEWAY_API_KEY` | Enables coaching, generated word-practice passages, and model pronunciation audio |
| Pronunciation assessment | `EXPO_PUBLIC_AZURE_SPEECH_KEY`, `EXPO_PUBLIC_AZURE_SPEECH_REGION` | Optional; local alignment supplies fallback scoring |
| Purchases | `EXPO_PUBLIC_RC_IOS_API_KEY`, `EXPO_PUBLIC_RC_ANDROID_API_KEY` | Required in release builds; development builds use the RevenueCat Test Store by default |
| Local QA | `EXPO_PUBLIC_MOCK_PRACTICE`, `EXPO_PUBLIC_DEV_SIGNIN_EMAIL`, `EXPO_PUBLIC_DEV_SIGNIN_PASSWORD` | Optional scripted speech and local test-account sign-in |
| Build behavior | `APP_VARIANT`, `EXPO_PUBLIC_OBSERVE_IN_DEV` | Selects the app variant and optionally sends debug telemetry |

Variables prefixed with `EXPO_PUBLIC_` are compiled into the client bundle. Keep
server credentials, including `AI_GATEWAY_API_KEY`, unprefixed.

### Simulator testing

The iOS Simulator does not provide reliable speech input. Set
`EXPO_PUBLIC_MOCK_PRACTICE=1` for deterministic passage and freestyle sessions,
or use the EAS `simulator` profile. That profile also enables QA-only sign-in and
history seeding while disabling Expo Updates so a shared preview update cannot
replace the test bundle.

```bash
bunx eas-cli build --platform ios --profile simulator
```

Use a physical device to test microphone permissions, audio routing,
transcription quality, Azure assessment, and recording playback.

## Commands

| Command | Purpose |
| --- | --- |
| `bun start` | Start the native Metro server |
| `bun run ios` | Build and run the iOS app |
| `bun run android` | Build and run the Android app |
| `bun run convex` | Push Convex functions and watch the backend |
| `bun run typecheck` | Type-check the app and Convex programs |
| `bun run test` | Run the history, sync, stats, alignment, scoring, WAV, entitlement, and settings suites |
| `bun run web` | Start the separate marketing-site route tree |
| `bun run export:web` | Export the marketing site and its API routes |
| `bun run deploy:web` | Deploy a preview to EAS Hosting |
| `bun run deploy:web:prod` | Deploy the production marketing site |

## Project layout

```text
app/              Native screens, navigation, session flow, and API routes
web/              Marketing-site router root and matching API routes
components/       Shared UI and feature components
hooks/            React state and session orchestration
services/         Recognition, storage, sync, purchases, and other side effects
lib/              Pure scoring, alignment, history, and statistics logic
constants/        Theme tokens, passages, drills, topics, goals, and vocabulary
convex/           Authenticated backend functions and schema
types/            Shared TypeScript models
scripts/          Bun logic suites and release support scripts
.eas/workflows/   Preview, TestFlight, feedback triage, and verified-fix workflows
```

Screens read synchronously from the local stores. `components/convex-sync.tsx`
is the only app-data bridge to Convex, so network state never becomes a screen's
source of truth. Pure modules in `lib/` remain free of React Native imports and
run directly in the Bun test scripts.

All visual tokens come from `constants/theme.ts`. Reusable design primitives
live in `components/ui/`. Read [AGENTS.md](AGENTS.md) before changing UI or
backend code; it records the project's design-system and Convex constraints.

## Builds and deployment

`APP_VARIANT` gives development, preview, and production builds separate app
names, identifiers, URL schemes, and iOS icons so they can be installed side by
side. EAS has four build profiles:

- `development` creates an internal development client.
- `preview` creates an internal build on the preview update channel.
- `simulator` creates a deterministic iOS QA build against development services.
- `production` creates the store build and auto-increments its version.

The EAS workflow on `main` fingerprints the native layer, builds or repacks the
iOS binary, and uploads it to TestFlight. The feedback workflows can turn
TestFlight reports or GitHub issues into simulator-verified fix pull requests.
See [the workflow guide](.eas/workflows/README.md) for setup and operating notes.

## License

MIT. See [LICENSE](LICENSE).
