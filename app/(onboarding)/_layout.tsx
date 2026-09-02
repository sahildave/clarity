import { ArrowLeft01Icon } from '@hugeicons-pro/core-stroke-rounded';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { GlassView } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { router, useSegments } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TickBar } from '@/components/metrics';
import { ONBOARDING_STEPS } from '@/components/onboarding';
import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** The first step. Set here, inside the group, rather than as a root anchor:
 * the root's guards filter after anchors resolve, and an anchor naming a
 * removed group would point the navigator at a screen that is not there. */
export const unstable_settings = { initialRouteName: 'name' };

/** Control sizes, not spacing steps. The back circle matches the paywall's
 * close button; the dot row is a fixed box so `space-between` reads as evenly
 * spread dots rather than a bar stretched to the screen. */
const BACK_SIZE = 36;
const DOTS_WIDTH = 96;
const DOT_SIZE = 6;

/**
 * Chrome shared by every onboarding step: a back button on the left, progress
 * dots in the middle, and a spacer on the right so the dots stay optically
 * centered (the same trick `session-top-bar.tsx` uses). It lives here so it
 * does not remount between steps; the steps themselves replay their reveal.
 */
export default function OnboardingLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const current = segments[segments.length - 1];
  const index = Math.max(0, ONBOARDING_STEPS.indexOf(current as never));
  const canGoBack = index > 0;

  const back = () => {
    Haptics.selectionAsync();
    if (router.canGoBack()) router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        {canGoBack ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back}>
            <GlassView isInteractive style={styles.backCircle}>
              <HugeiconsIcon icon={ArrowLeft01Icon} size={18} color={colors.secondary} strokeWidth={2} />
            </GlassView>
          </Pressable>
        ) : (
          <View style={styles.spacer} />
        )}
        <TickBar
          fill={(index + 1) / ONBOARDING_STEPS.length}
          tickCount={ONBOARDING_STEPS.length}
          height={DOT_SIZE}
          tickWidth={DOT_SIZE}
          style={styles.dots}
        />
        <View style={styles.spacer} />
      </View>
      <Stack screenOptions={{ headerShown: false }} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  backCircle: {
    width: BACK_SIZE,
    height: BACK_SIZE,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacer: {
    width: BACK_SIZE,
    height: BACK_SIZE,
  },
  dots: {
    width: DOTS_WIDTH,
  },
});
