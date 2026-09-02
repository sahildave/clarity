import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton, ThemedText } from '@/components/ui';
import { spacing } from '@/constants/theme';

export type OnboardingScreenProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  ctaTitle: string;
  onContinue: () => void;
  ctaDisabled?: boolean;
  /** Tertiary footnote under the content, for the honest caveats. */
  note?: string | null;
  /** Rendered under the CTA: a "Not now" text button, typically. */
  footer?: ReactNode;
};

/**
 * The shape every onboarding step shares: a scroll view for the question and
 * its choices, and a CTA pinned to the bottom edge. The CTA lives outside the
 * scroll view in a `KeyboardStickyView`, so on the name step it rides up with
 * the keyboard frame-for-frame instead of hiding behind it. The `opened` offset
 * cancels the safe-area padding, which the keyboard already covers.
 *
 * Nothing here animates in. The steps are tapped through quickly, and a
 * staggered reveal on every push read as lag.
 */
export function OnboardingScreen({
  title,
  subtitle,
  children,
  ctaTitle,
  onContinue,
  ctaDisabled = false,
  note,
  footer,
}: OnboardingScreenProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, spacing.lg);
  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}>
        <ThemedText variant="largeTitle" style={styles.title}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText variant="subheadProse" tone="secondary" style={styles.subtitle}>
            {subtitle}
          </ThemedText>
        ) : null}
        {children}
        {note ? (
          <ThemedText variant="footnoteProse" tone="tertiary" style={styles.note}>
            {note}
          </ThemedText>
        ) : null}
      </ScrollView>
      <KeyboardStickyView offset={{ closed: 0, opened: bottomPad }}>
        <View style={[styles.cta, { paddingBottom: bottomPad }]}>
          <PrimaryButton title={ctaTitle} onPress={onContinue} disabled={ctaDisabled} />
          {footer}
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: {
    marginTop: spacing.xxl,
  },
  subtitle: {
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  note: {
    marginTop: spacing.md,
  },
  cta: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
});
