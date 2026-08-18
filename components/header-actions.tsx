import { FireIcon, User03Icon } from '@hugeicons-pro/core-solid-rounded';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { GlassContainer, GlassView } from 'expo-glass-effect';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/ui';
import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** The streak flame. Not a palette token: it is an illustrative glyph color,
 * fixed in both schemes, and nothing else in the app uses it. */
const STREAK_FLAME = '#FF9500';

/** The screen-header trailing capsules shared by Home and Practice: streak
 * flame + count, and the profile avatar. GlassContainer lets the capsules
 * merge fluidly when they get close. */
export function HeaderActions({ streak }: { streak: number }) {
  const { colors } = useTheme();

  return (
    <GlassContainer spacing={spacing.sm} style={styles.row}>
      <GlassView isInteractive style={styles.streak}>
        <HugeiconsIcon icon={FireIcon} size={24} color={STREAK_FLAME} />
        <ThemedText variant="callout" weight="medium">
          {streak}
        </ThemedText>
      </GlassView>
      <GlassView isInteractive style={styles.avatar}>
        <HugeiconsIcon icon={User03Icon} size={24} color={colors.tertiary} />
      </GlassView>
    </GlassContainer>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.sm,
    paddingRight: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  avatar: {
    padding: spacing.sm,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
