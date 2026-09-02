import { CheckmarkCircle02Icon } from '@hugeicons-pro/core-solid-rounded';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react-native';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui';
import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Control sizes, not spacing steps: the row's floor and the leading icon bed. */
const ROW_MIN_HEIGHT = 72;
const ICON_BED = 40;
const CHECK_SIZE = 26;
const RADIO_SIZE = 24;

export type ChoiceRowProps = {
  title: string;
  caption?: string;
  selected: boolean;
  /** Optional leading glyph in a circular bed, for the skill picker. */
  icon?: IconSvgElement;
};

/**
 * The content of one onboarding choice, rendered inside an `OptionCard`. The
 * selection mark sits on the right, where the Settings rows already put it.
 */
export function ChoiceRow({ title, caption, selected, icon }: ChoiceRowProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      {icon ? (
        <View
          style={[
            styles.iconBed,
            { backgroundColor: selected ? colors.accentBg : colors.fill },
          ]}>
          <HugeiconsIcon icon={icon} size={22} color={selected ? colors.accent : colors.secondary} />
        </View>
      ) : null}
      <View style={styles.text}>
        <ThemedText variant="headline">
          {title}
        </ThemedText>
        {caption ? (
          <ThemedText variant="footnote" tone="tertiary">
            {caption}
          </ThemedText>
        ) : null}
      </View>
      {selected ? (
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={CHECK_SIZE} color={colors.accent} />
      ) : (
        <View style={[styles.radio, { borderColor: colors.track }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    minHeight: ROW_MIN_HEIGHT,
  },
  iconBed: {
    width: ICON_BED,
    height: ICON_BED,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  radio: {
    width: RADIO_SIZE,
    height: RADIO_SIZE,
    borderRadius: radius.full,
    borderWidth: 2,
  },
});
