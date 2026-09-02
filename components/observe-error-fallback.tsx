/**
 * What the app shows when a render-phase error is caught.
 *
 * The boundary itself is `expo-observe`'s: `ObserveRoot` mounts one when it is
 * given an `errorBoundaryFallback`, and it records the error as a non-fatal
 * `exception` event with the React component stack. That stack is the reason to
 * have a boundary at all, since a minified release-build JS stack rarely places
 * the failure on its own. Errors thrown outside render need no boundary; the
 * `ErrorUtils` handler that the package installs on import already reports them.
 *
 * So all that is left here is the screen, which the library cannot supply
 * because it has to come from this app's theme.
 */

import type { ObserveErrorBoundaryFallbackProps } from 'expo-observe';
import { StyleSheet, View } from 'react-native';

import { PrimaryButton, ThemedText } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Acknowledge it, then re-mount the subtree.
 *
 * `resetError` clears the caught error and remounts the children from scratch,
 * which is a real recovery for the common case (one bad value in a screen's
 * state) and a no-op for a genuinely broken build. Deliberately says nothing
 * about the error itself: a message written for us reads as noise to the person
 * holding the phone, and it is already in Observe.
 */
export function ObserveErrorFallback({ resetError }: ObserveErrorBoundaryFallbackProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ThemedText variant="title" style={styles.centered}>
        Something went wrong
      </ThemedText>
      <ThemedText variant="body" tone="secondary" style={styles.centered}>
        Your practice history is saved. Try again to reload the app.
      </ThemedText>
      <PrimaryButton title="Try Again" onPress={resetError} style={styles.button} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxxl,
    gap: spacing.md,
  },
  centered: {
    textAlign: 'center',
  },
  button: {
    marginTop: spacing.lg,
  },
});
