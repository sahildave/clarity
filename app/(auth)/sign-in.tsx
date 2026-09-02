import { AppleIcon, GoogleIcon } from '@hugeicons-pro/core-solid-rounded';
import { useSignIn } from '@clerk/expo';
import { useSignInWithApple } from '@clerk/expo/apple';
import { useSignInWithGoogle } from '@clerk/expo/google';
import Constants from 'expo-constants';
import { Observe } from 'expo-observe';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IntroReveal } from '@/components/splash';
import { PrimaryButton, ThemedText } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useMarkInteractive } from '@/hooks/use-mark-interactive';
import { useTheme } from '@/hooks/use-theme';

/**
 * Two deliberately separate ways into the Clerk DEVELOPMENT instance:
 *
 * - Local debug builds can use the password kept in `.env.local`.
 * - The static EAS Simulator build uses Clerk's public test-email convention
 *   and fixed test OTP. It only activates in the simulator QA profile, with a
 *   `pk_test_` key and a `+clerk_test` address. No password enters an EAS env
 *   or the app bundle.
 */
const AUTOMATION_BUILD = process.env.EXPO_PUBLIC_AUTOMATION === '1';
const CLERK_DEVELOPMENT_INSTANCE =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith('pk_test_') === true;
const DEV_EMAIL = process.env.EXPO_PUBLIC_DEV_SIGNIN_EMAIL?.trim() || null;
const DEV_PASSWORD = process.env.EXPO_PUBLIC_DEV_SIGNIN_PASSWORD?.trim() || null;
const DEV_ACCOUNT =
  __DEV__ && DEV_EMAIL && DEV_PASSWORD
    ? { emailAddress: DEV_EMAIL, password: DEV_PASSWORD }
    : null;
const SIMULATOR_TEST_EMAIL =
  AUTOMATION_BUILD &&
  CLERK_DEVELOPMENT_INSTANCE &&
  DEV_EMAIL != null &&
  /\+clerk_test(?:_|@)/i.test(DEV_EMAIL)
    ? DEV_EMAIL
    : null;
const SIMULATOR_AUTH_ERROR = !AUTOMATION_BUILD
  ? null
  : !CLERK_DEVELOPMENT_INSTANCE
    ? 'Simulator sign-in needs the Clerk development environment.'
    : !SIMULATOR_TEST_EMAIL
      ? 'The simulator test user is not configured.'
      : null;
const CLERK_TEST_CODE = '424242';

/** Cancelling a native sheet is not an error and gets no error UI. */
const CANCEL_CODES = new Set(['ERR_REQUEST_CANCELED', 'SIGN_IN_CANCELLED', '-5']);

function isCancel(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' || typeof code === 'number'
    ? CANCEL_CODES.has(String(code))
    : false;
}

function trimmedExtra(key: string): string | null {
  const value = (Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Whether the build can present the Google sheet at all.
 *
 * The Google SDK raises an Objective-C exception, not a JS error, when
 * Info.plist carries no URL scheme for the client ID it was configured with
 * ("missing support for the following URL schemes", GIDSignIn.m). That aborts
 * the process, so the try/catch in `run` never sees it and a build with
 * mismatched credentials crashes on tap instead of showing a message.
 *
 * Both values ship in `extra` (see app.config.ts), so comparing them here
 * turns that crash back into the same failure text every other error gets.
 * The scheme is the client ID's dot-separated parts reversed and lowercased,
 * which is what GIDSignInCallbackSchemes derives. The client ID falls back to
 * the web one because the native module does the same when the iOS one is
 * unset.
 */
function googleIsMisconfigured(): boolean {
  if (Platform.OS !== 'ios') return false;
  const clientId =
    trimmedExtra('EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID') ??
    trimmedExtra('EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID');
  const scheme = trimmedExtra('EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME');
  if (!clientId || !scheme) return true;
  return scheme.toLowerCase() !== clientId.split('.').reverse().join('.').toLowerCase();
}

/** Read once: neither value can change after the build. */
const GOOGLE_MISCONFIGURED = googleIsMisconfigured();

/**
 * The signed-out screen: a gradient and two native sign-in buttons.
 *
 * Both hooks return `{ createdSessionId, setActive }` and need `setActive`
 * called. That is the documented shape for the native hooks; the `finalize()`
 * pattern belongs to Clerk's custom form flows and does not apply here. Both
 * also handle sign-in-or-sign-up internally, so one screen covers new and
 * returning users.
 *
 * No navigation on success. The root navigator's guard reads the new session
 * and swaps this group out on its own.
 */
export default function SignInScreen() {
  useMarkInteractive();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { startAppleAuthenticationFlow } = useSignInWithApple();
  const { startGoogleAuthenticationFlow } = useSignInWithGoogle();
  const { signIn } = useSignIn();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (
    provider: 'apple' | 'google',
    start: () => Promise<{
      createdSessionId: string | null;
      setActive?: (params: { session: string }) => Promise<unknown>;
    }>,
  ) => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const { createdSessionId, setActive } = await start();
      // A resolved flow with no session is not a success. Both native sheets
      // THROW on cancel (see `isCancel`), so reaching here without one means
      // the sign-in needs a step this screen does not offer. Left silent, the
      // button simply looked dead.
      if (!createdSessionId || !setActive) {
        throw new Error(`${provider} sign-in completed without a session`);
      }
      await setActive({ session: createdSessionId });
    } catch (error) {
      if (!isCancel(error)) {
        Observe.reportError(error);
        // Observe keeps the report; the console is where a developer on a
        // device build actually reads it. Compiled out of release.
        if (__DEV__) console.warn(`[auth] ${provider} sign-in failed`, error);
        setFailure(`Could not sign in with ${provider === 'apple' ? 'Apple' : 'Google'}. Try again.`);
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * Only reachable from a build whose Google credentials disagree, which is a
   * packaging mistake rather than anything the person tapping can fix. The
   * message says what they can do next and nothing about why; the identifiers
   * go to Observe, where they belong. The guard only fires on iOS, so the
   * Apple button is always on screen beside it.
   */
  const onGoogle = () => {
    if (GOOGLE_MISCONFIGURED) {
      Observe.reportError(
        new Error('Google sign-in URL scheme does not match the configured client ID'),
      );
      if (__DEV__) {
        console.warn(
          '[auth] google sign-in is misconfigured: Info.plist carries no URL scheme for the ' +
            'configured client ID. Check EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID against ' +
            'EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME.',
        );
      }
      setFailure('Google sign-in is unavailable right now. Please continue with Apple.');
      return;
    }
    run('google', startGoogleAuthenticationFlow);
  };

  /** Custom Clerk flow for the local password account or simulator test OTP. */
  const runDev = async () => {
    if ((!DEV_ACCOUNT && !SIMULATOR_TEST_EMAIL) || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      if (SIMULATOR_TEST_EMAIL) {
        // Clerk development instances do not send mail for +clerk_test
        // addresses; 424242 is their documented deterministic test code.
        const sent = await signIn.emailCode.sendCode({
          emailAddress: SIMULATOR_TEST_EMAIL,
        });
        if (sent.error) throw sent.error;
        const verified = await signIn.emailCode.verifyCode({ code: CLERK_TEST_CODE });
        if (verified.error) throw verified.error;
      } else if (DEV_ACCOUNT) {
        const attempted = await signIn.password(DEV_ACCOUNT);
        if (attempted.error) throw attempted.error;
      }
      if (signIn.status !== 'complete') throw new Error(`Sign-in status ${signIn.status}`);
      const finalized = await signIn.finalize();
      if (finalized.error) throw finalized.error;
    } catch (error) {
      Observe.reportError(error);
      // Dev-only path, so the console is the right place for the detail.
      console.warn('[auth] dev sign-in failed', error);
      setFailure('Dev sign-in failed. Check the Metro console.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Placeholder artwork. Same technique as passage-carousel.tsx and
          progressive-blur.tsx: a CSS gradient with no gradient package. The
          stops are theme tokens so it follows the scheme. */}
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            experimental_backgroundImage: `linear-gradient(to bottom, ${colors.accentBg} 0%, ${colors.background} 70%)`,
          },
        ]}
      />
      <View style={{ flex: 1 }} />
      <View
        style={[
          styles.actions,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}>
        {failure ? (
          <ThemedText variant="footnote" tone="secondary" style={styles.failure}>
            {failure}
          </ThemedText>
        ) : null}
        {SIMULATOR_AUTH_ERROR ? (
          <ThemedText
            variant="footnote"
            tone="secondary"
            style={styles.failure}
            testID="simulator-auth-config-error">
            {SIMULATOR_AUTH_ERROR}
          </ThemedText>
        ) : null}
        {/* fade={false}: PrimaryButton renders a GlassView, which goes blank
            under an animated opacity. autoplay: this screen mounts after the
            splash, so the reveal must replay rather than skip. */}
        {Platform.OS === 'ios' ? (
          <IntroReveal order={0} fade={false} autoplay>
            <PrimaryButton
              title="Continue with Apple"
              icon={AppleIcon}
              disabled={busy}
              onPress={() => run('apple', startAppleAuthenticationFlow)}
            />
          </IntroReveal>
        ) : null}
        <IntroReveal order={1} fade={false} autoplay>
          <PrimaryButton
            title="Continue with Google"
            icon={GoogleIcon}
            disabled={busy}
            onPress={onGoogle}
          />
        </IntroReveal>
        {SIMULATOR_TEST_EMAIL || DEV_ACCOUNT ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={runDev}
            testID="dev-test-sign-in"
            style={({ pressed }) => [styles.textButton, { opacity: pressed || busy ? 0.6 : 1 }]}>
            <ThemedText variant="subhead" tone="tertiary">
              {SIMULATOR_TEST_EMAIL
                ? 'Sign in as dev test user'
                : 'Sign in as dev (development build only)'}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  failure: {
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  textButton: {
    alignSelf: 'center',
    padding: spacing.md,
  },
});
