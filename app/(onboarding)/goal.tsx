import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ChoiceRow, OnboardingScreen } from '@/components/onboarding';
import { OptionCard } from '@/components/ui';
import { GOAL_OPTIONS } from '@/constants/goals';
import { spacing } from '@/constants/theme';
import { useMarkInteractive } from '@/hooks/use-mark-interactive';
import { useSetting } from '@/hooks/use-settings';

/** Step 3: the daily goal the Home ring fills against. Preselected to the value
 * the app shipped with, so tapping straight through changes nothing. */
export default function GoalStep() {
  useMarkInteractive();
  const [goalMinutes, setGoalMinutes] = useSetting('goalMinutes');
  const [writeFailed, setWriteFailed] = useState(false);

  return (
    <OnboardingScreen
      title="How much do you want to practice?"
      subtitle="This sets your daily goal. You can change it any time in Settings."
      ctaTitle="Continue"
      onContinue={() => {
        // Confirms the preselected goal too. See the accent step for why an
        // unchanged value still has to be written.
        setWriteFailed(!setGoalMinutes(goalMinutes));
        router.push('/(onboarding)/priority');
      }}
      note={writeFailed ? 'That choice could not be saved. Your device may be out of storage.' : null}>
      <View style={styles.list}>
        {GOAL_OPTIONS.map((option) => (
          <OptionCard
            key={option.minutes}
            selected={option.minutes === goalMinutes}
            accessibilityLabel={`${option.minutes} minutes`}
            onSelect={() => {
              if (option.minutes === goalMinutes) return;
              setWriteFailed(!setGoalMinutes(option.minutes));
            }}>
            <ChoiceRow
              title={`${option.minutes} minutes`}
              caption={option.caption}
              selected={option.minutes === goalMinutes}
            />
          </OptionCard>
        ))}
      </View>
    </OnboardingScreen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.md,
  },
});
