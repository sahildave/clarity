/**
 * The app's EAS Observe event catalog.
 *
 * Every `Observe.logEvent` call in the app goes through this module. Event names
 * are the grouping key in the dashboard and renaming one splits its history in
 * two, so they are declared once here instead of typed out at each call site.
 * Attributes leave the device, so keeping the payloads in one file makes what we
 * export reviewable without reading through the session engine.
 *
 * Rules for anything added here:
 * - Names are lowercase, dot-separated, and never change once shipped. Pair each
 *   with a `displayName`, which is what the dashboard's session timeline shows;
 *   grouping still keys off `name`, so the label is free to read like a sentence.
 * - No user content. Passage text, transcripts, freestyle topics, and custom
 *   passage titles stay on device; content ids, counts, durations, and scores
 *   are what ship.
 * - Every call is fire-and-forget. `logEvent` persists the event locally and
 *   returns; the batch is dispatched alongside the metrics when the app
 *   backgrounds.
 *
 * None of this leaves a debug build unless EXPO_PUBLIC_OBSERVE_IN_DEV=1 is set,
 * because the `Observe.configure` call in `app/_layout.tsx` drops debug-build
 * metrics by default.
 */

import { Observe } from 'expo-observe';

import type { SessionEndedReason, SessionMode } from '@/types/history';
import type { PracticeErrorCode, SessionResult } from '@/types/session';
import type { AccentLocale } from '@/types/settings';

// ---- global attributes ------------------------------------------------------

/**
 * Attributes merged into every metric and log event, so the automatic startup
 * and navigation timings can be sliced by them too and not just the events below.
 *
 * `setGlobalAttributes` takes the whole map (passing an empty object clears it)
 * rather than merging into what is already there, so the app's copy is held here
 * and re-sent in full whenever one value changes.
 */
const globals: Record<string, string | number | boolean> = {};

function setGlobal(key: string, value: string | number | boolean) {
  if (globals[key] === value) return;
  globals[key] = value;
  Observe.setGlobalAttributes(globals);
}

/**
 * Which speech engine this build practices with. Mirrors the switch in
 * `hooks/use-practice-session.ts`, read from the env var rather than imported so
 * this module does not pull the recognition engine in behind it.
 *
 * Worth tagging on everything: a mock session never touches the recognizer or
 * Azure, so its timings and scores must not be read as field data.
 */
setGlobal('practice_engine', process.env.EXPO_PUBLIC_MOCK_PRACTICE === '1' ? 'mock' : 'real');

/**
 * Whether Clarity Pro is active. Called by the subscription provider whenever
 * the entitlement resolves or changes, so every later metric carries the tier
 * the customer was actually on — including startup TTI, which is the one place
 * a slow first customer-info read would show up.
 */
export function setSubscriptionTier(tier: 'pro' | 'free' | 'unknown') {
  setGlobal('subscription_tier', tier);
}

/**
 * Whether a Clerk session is active. Set by the auth bridge whenever Clerk
 * settles, so sign-in funnel metrics and everything after can be split by it.
 */
export function setAuthState(state: 'signed-in' | 'signed-out') {
  setGlobal('auth_state', state);
}

// ---- practice lifecycle -----------------------------------------------------

/**
 * An attempt began. Emitted from `beginSession`, the one call every start goes
 * through: the passage, drill, and freestyle screens all open their crash
 * checkpoint there, and so does a restart mid-read.
 */
export function practiceStarted(a: {
  mode: SessionMode;
  passageId?: string;
  topicId?: string;
  targetWpm?: number;
}) {
  Observe.logEvent('practice.started', {
    displayName: 'Practice started',
    attributes: {
      mode: a.mode,
      // Ids only. A custom passage's title is the user's own writing.
      contentId: a.passageId ?? a.topicId ?? 'unknown',
      targetWpm: a.targetWpm ?? 0,
    },
  });
}

/**
 * An attempt reached an end. Emitted from `recordSession`, the single funnel
 * every terminal path uses — finished the passage, stopped early, or abandoned
 * by dismissing or restarting mid-read — in both passage and freestyle mode.
 *
 * `scoringSource` is the one to watch. 'live' means Azure was unavailable or
 * failed and the scores came from the live recognition layer instead, which
 * surfaces to nobody: without it in the data, an Azure region outage looks like
 * everyone's pronunciation quietly getting less precise.
 */
export function practiceEnded(
  result: SessionResult,
  meta: { mode: SessionMode; endedReason: SessionEndedReason; persisted: boolean },
) {
  Observe.logEvent('practice.ended', {
    displayName: 'Practice ended',
    attributes: {
      mode: meta.mode,
      endedReason: meta.endedReason,
      scoringSource: result.source,
      durationMs: result.durationMs,
      score: result.overallScore,
      paceWpm: result.paceWpm,
      targetWpm: result.targetWpm,
      spokenWords: result.spokenWords,
      fillerCount: result.fillerCount,
      hasAudio: result.audioUri != null,
      // False also covers "nothing was spoken, so there was nothing to save",
      // which is why it is a separate signal from `endedReason`.
      persisted: meta.persisted,
    },
  });
}

/**
 * The engine gave up before it could produce a result. `code` is the same
 * discriminant the error UI branches on, so a spike in 'recognition-unavailable'
 * points at devices and 'permission-denied' points at the onboarding ask.
 */
export function practiceFailed(a: { code: PracticeErrorCode; mode: SessionMode }) {
  Observe.logEvent('practice.failed', {
    displayName: 'Practice failed',
    severity: 'error',
    attributes: { code: a.code, mode: a.mode },
  });
}

/**
 * Why an attempt reached the end scored, but not by Azure. Each of these is a
 * different problem wearing the same face on the Results screen:
 *
 * - 'azure-unconfigured'  the build shipped without the key or region
 * - 'azure-failed'        the assessment request threw
 * - 'azure-no-audio'      nothing gradeable came out of the session, so Azure
 *                         was never asked
 * - 'azure-unusable'      Azure answered and the result builder rejected it
 * - 'processing-failed'   the whole stop-and-score path threw
 */
export type ScoringDegradedReason =
  | 'azure-unconfigured'
  | 'azure-failed'
  | 'azure-no-audio'
  | 'azure-unusable'
  | 'processing-failed';

/**
 * Scoring fell back from Azure Pronunciation Assessment to the live-derived
 * measure. The attempt still ends with a score, so this is invisible in the app
 * and invisible in a crash reporter. `locale` is included because the accent
 * decides which reference Azure grades against, and a failure concentrated in
 * one locale is a different problem from a regional outage.
 */
export function scoringDegraded(a: {
  reason: ScoringDegradedReason;
  locale: AccentLocale;
  durationMs: number;
}) {
  Observe.logEvent('practice.scoring_degraded', {
    displayName: 'Scoring degraded',
    severity: 'warn',
    attributes: { reason: a.reason, locale: a.locale, durationMs: a.durationMs },
  });
}

/**
 * On-device recognition could not start, so the engine retried over the network.
 * Both latency and transcript quality change with it, which means a session that
 * fell back is not comparable to one that did not.
 */
export function recognitionFallback(a: { reason: string }) {
  Observe.logEvent('practice.recognition_fallback', {
    displayName: 'Recognition fell back to network',
    severity: 'warn',
    attributes: { from: 'on-device', to: 'network', reason: a.reason },
  });
}

/**
 * The recorded WAV segments could not be assembled. Scores survive, but the
 * attempt has no playback and its waveform is reconstructed from the mic meter,
 * so Results silently loses a feature rather than showing an error.
 */
export function audioProcessingFailed(a: { segments: number }) {
  Observe.logEvent('practice.audio_processing_failed', {
    displayName: 'Audio processing failed',
    severity: 'warn',
    attributes: { segments: a.segments },
  });
}

// ---- monetization -----------------------------------------------------------

/**
 * Where a paywall came from. The same RevenueCat-hosted screen answers two
 * different questions depending on which raised it, so they are never pooled:
 * 'gate' is the app blocking a locked feature, 'explicit' is the customer going
 * looking for the plans.
 */
export type PaywallSource = 'gate' | 'explicit';

/**
 * How a paywall resolved. One event rather than a presented/closed pair, because
 * the outcome already says whether it was ever shown: 'notPresented' means the
 * customer was entitled and the gate opened without interrupting them, and
 * 'error' means the SDK could not present it at all.
 */
export function paywallResolved(a: { source: PaywallSource; outcome: string }) {
  Observe.logEvent('paywall.resolved', {
    displayName: 'Paywall resolved',
    // 'error' is the SDK failing to show a screen the app decided to show, which
    // is a broken purchase path rather than a customer declining.
    severity: a.outcome === 'error' ? 'error' : 'info',
    attributes: { source: a.source, outcome: a.outcome },
  });
}

// ---- errors -----------------------------------------------------------------
//
// Errors need nothing from this module. The three paths Observe records them by
// are all owned elsewhere:
//
// 1. Unhandled JS errors: automatic. `expo-app-metrics` wraps `ErrorUtils` when
//    the package is first imported, which is before any of our code runs.
// 2. Render-phase errors: the boundary `ObserveRoot` mounts in `app/_layout.tsx`,
//    which is the only path that captures a React component stack.
// 3. Handled errors: `Observe.reportError(cause)` at the `catch` that swallowed
//    them. Called directly at the call site, because unlike an event it carries
//    no name to keep stable and no attribute shape to review.
//
// The events above stay separate from all three on purpose: a degraded score or
// a paywall that would not present is a product outcome with structured
// attributes, not an exception, and pooling them would bury both.
