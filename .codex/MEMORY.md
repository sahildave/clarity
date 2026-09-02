# Project Environment

- Expo SDK 57 (`expo` 57.0.16), React Native 0.86.2, React 19.2.3, and Expo Router.
- iOS, Android, and web are configured; native directories are generated and ignored.
- Bun lockfile and Bun-based tests are present, although `package.json` currently declares Yarn 1 in `packageManager`.
- Metro uses the default port 8081. Start it with `bun start`; build locally with `bun run ios` or `bun run android`.
- Expo Go is not supported because the app depends on native speech recognition, MMKV, RevenueCat, and the development client. Real microphone behavior needs a physical device; simulator QA uses mocked speech.
- `bun run typecheck` checks both app and Convex programs. `bun run test` runs the custom logic suites. There is no lint, Jest, Detox, or Maestro configuration.
- `bun run web` starts the separate marketing route tree; `bun run export:web`, `bun run deploy:web`, and `bun run deploy:web:prod` export or deploy it.
- The effective EAS project id is `c062263d-cdf6-4ddc-9b07-4178349c3006`; `app.config.ts` derives the Expo Updates URL from that value so the retired pre-rename project cannot drift back in.
- App variants are selected with `APP_VARIANT`; development, preview, and production use separate identifiers, names, schemes, and icons.
- The `simulator` profile keeps the preview app id but uses the EAS development backend, deterministic passage/freestyle speech, QA seed hooks, dev test-user auth, and disables Expo Updates. Production and normal preview builds keep real speech.
- Auth is Clerk 4.6 with Convex sync. The simulator signs into an existing `+clerk_test` development user with Clerk's fixed test OTP; no password belongs in EAS.
- Installing the private Hugeicons Pro packages requires `HUGEICONS_TOKEN`. Local app startup also needs matching Clerk and Convex development values; each Convex deployment keeps its Clerk Frontend API URL in `CLERK_FRONTEND_API_URL`.
- GitHub Actions runs Expo code review from trusted base-revision configuration. EAS PR previews require the maintainer-controlled `preview-approved` label and bundle in the secrets-free custom `pr-preview` environment (supported by the Production plan), which contains only `APP_VARIANT=preview`.
- TestFlight automation is beta feedback or a six-hour sweep → short triage mutex → locked issue queue → fix agent → two EAS Simulator sessions → verified PR. The agent chooses static screenshots, a session replay, or structural/runtime evidence instead of collecting every artifact.
