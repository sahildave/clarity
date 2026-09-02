import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ChoiceRow, OnboardingScreen } from '@/components/onboarding';
import { OptionCard } from '@/components/ui';
import { ACCENTS, hasPhonemeDetail } from '@/constants/accents';
import { spacing } from '@/constants/theme';
import { useMarkInteractive } from '@/hooks/use-mark-interactive';
import { useSetting } from '@/hooks/use-settings';

/**
 * Step 2: the accent Azure grades against. The consequential question: the
 * same British reading scored 80 against en-US and 100 against en-GB
 * (`constants/accents.ts`). Asked before the first session so the first score
 * is a fair one.
 */
export default function AccentStep() {
  useMarkInteractive();
  const [accentLocale, setAccentLocale] = useSetting('accentLocale');
  const [writeFailed, setWriteFailed] = useState(false);

  return (
    <OnboardingScreen
      title="Which accent do you speak?"
      subtitle="Your reading is scored against this accent. Picking the one you actually speak stops your own vowels being counted as mistakes."
      ctaTitle="Continue"
      onContinue={() => {
        // Continue confirms the accent, including the preselected one nobody
        // tapped. `set` stamps an unchanged value for exactly this reason: an
        // unstamped field reads as "never answered on this device" and the
        // sync layer hands the account's older value back
        // (`lib/settings-store.ts`). A lost write still does not trap anyone
        // here; the note is for the tap path.
        setWriteFailed(!setAccentLocale(accentLocale));
        router.push('/(onboarding)/goal');
      }}
      note={
        writeFailed
          ? 'That choice could not be saved. Your device may be out of storage.'
          : !hasPhonemeDetail(accentLocale)
            ? 'Per-sound feedback, the tips that name a sound like /θ/, is available for American English only. You still get word and syllable scores.'
            : null
      }>
      <View style={styles.list}>
        {ACCENTS.map((accent) => (
          <OptionCard
            key={accent.locale}
            selected={accent.locale === accentLocale}
            accessibilityLabel={`${accent.label}, ${accent.region}`}
            onSelect={() => {
              if (accent.locale === accentLocale) return;
              setWriteFailed(!setAccentLocale(accent.locale));
            }}>
            <ChoiceRow title={accent.label} caption={accent.region} selected={accent.locale === accentLocale} />
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
