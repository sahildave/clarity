import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';

import { GlassSurface } from './glass-surface';

export type OptionCardProps = {
  selected: boolean;
  onSelect: () => void;
  /** The row content. The card draws no indicator of its own: the paywall wants
   * it on the left, onboarding on the right, and a `variant` for that is the
   * creep `PrimaryButton` refuses. */
  children: ReactNode;
  accessibilityLabel?: string;
  /** Merged onto the outer Pressable, for margins and min heights. */
  style?: StyleProp<ViewStyle>;
};

/**
 * One choice in a single-select group: the paywall plans, the onboarding accent,
 * goal, and priority pickers.
 *
 * The content renders INSIDE the interactive glass, the same way `PrimaryButton`
 * does: the native press response scales the material, and the content has to
 * ride along with it. That means children must not hold their own glass
 * (nested glass does not render on iOS 26); today none do. Selection is the
 * child's job (the checkmark), never a border on the surface. The `Pressable`
 * wraps the glass because the material is a native view and the touch target
 * must sit above it.
 */
export function OptionCard({
  selected,
  onSelect,
  children,
  accessibilityLabel,
  style,
}: OptionCardProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        Haptics.selectionAsync();
        onSelect();
      }}
      style={({ pressed }) => [pressed && styles.pressed, style]}>
      <GlassSurface radius="lg" interactive style={styles.card}>
        {children}
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.85,
  },
});
