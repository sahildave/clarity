import { useClerk, useUser } from '@clerk/expo';
import { useMutation } from 'convex/react';
import { CheckmarkCircle02Icon } from '@hugeicons-pro/core-solid-rounded';
import { HugeiconsIcon } from '@hugeicons/react-native';
import * as Haptics from 'expo-haptics';
import { Observe } from 'expo-observe';
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/ui';
import { ACCENTS, hasPhonemeDetail } from '@/constants/accents';
import { GOAL_OPTIONS } from '@/constants/goals';
import { SKILL_GOALS, SKILL_LABELS, SKILL_ORDER } from '@/constants/metrics';
import { radius, spacing, type } from '@/constants/theme';
import { useMarkInteractive } from '@/hooks/use-mark-interactive';
import { useSetting } from '@/hooks/use-settings';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/convex/_generated/api';
import { deleteAccount, signOutAndClear } from '@/services/account';
import type { SkillKey } from '@/types/history';

/** Fixed-size box the native toolbar needs around its one child. */
const TOOLBAR_TITLE_WIDTH = 200;
const TOOLBAR_TITLE_HEIGHT = 36;

const CHECK_SIZE = 22;
const MAX_NAME = 24;

/** Minimum row height, so a one-line row still reads as a tappable list row and
 * a two-line one grows past it. Not a spacing step: it is a control size, like
 * the icon tiles elsewhere. */
const ROW_MIN_HEIGHT = 56;

/** Grouped rows on one card, matching the flat-card convention the passage
 * editor uses: glass is chrome, solid cards are content. */
function SettingsCard({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <View style={[styles.card, { backgroundColor: colors.card }]}>{children}</View>;
}

/** A hairline between rows inside a card, inset past the row's padding. */
function RowDivider() {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.divider }]} />;
}

/** One radio-style row in a single-select list: accent, goal, or priority. */
function ChoiceListRow({
  title,
  caption,
  selected,
  onSelect,
}: {
  title: string;
  caption?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={caption ? `${title}, ${caption}` : title}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
      <View style={styles.rowText}>
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
      ) : null}
    </Pressable>
  );
}

function Eyebrow({ children }: { children: string }) {
  return (
    <ThemedText variant="eyebrow" tone="tertiary" style={styles.eyebrow}>
      {children}
    </ThemedText>
  );
}

function Blurb({ children }: { children: string }) {
  return (
    <ThemedText variant="footnoteProse" tone="secondary" style={styles.sectionBlurb}>
      {children}
    </ThemedText>
  );
}

/**
 * Settings: the account, every onboarding answer (so nothing asked once is
 * locked in), and the data preference.
 *
 * The accent is the consequential one. Azure scores a reading against a
 * reference accent, and the wrong reference is counted as mispronunciation: the
 * same British reading measured 80 accuracy against `en-US` and 100 against
 * `en-GB`. Until this screen existed every user was graded as American.
 */
export default function SettingsScreen() {
  useMarkInteractive();

  const { colors } = useTheme();
  const { user } = useUser();
  const { signOut } = useClerk();
  const deleteRemoteBatch = useMutation(api.account.deleteAll);
  const [displayName, setDisplayName] = useSetting('displayName');
  const [accentLocale, setAccentLocale] = useSetting('accentLocale');
  const [goalMinutes, setGoalMinutes] = useSetting('goalMinutes');
  const [prioritySkill, setPrioritySkill] = useSetting('prioritySkill');
  const [improveClarity, setImproveClarity] = useSetting('improveClarity');
  const [nameDraft, setNameDraft] = useState(displayName);
  const [editingName, setEditingName] = useState(false);
  const [writeFailed, setWriteFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleClose = () => {
    Haptics.selectionAsync();
    router.back();
  };

  /**
   * The draft follows the store whenever the field is not being edited.
   *
   * `displayName` is not settled when this screen mounts: the account's copy
   * arrives from Convex a moment later. Without this the draft stayed at the
   * mount-time value, and one focus-then-blur wrote that stale value (usually
   * empty) straight over the synced name and pushed it to every device.
   */
  useEffect(() => {
    if (!editingName) setNameDraft(displayName);
  }, [displayName, editingName]);

  const commitName = () => {
    const trimmed = nameDraft.trim();
    if (trimmed === displayName) {
      setEditingName(false);
      return;
    }
    const ok = setDisplayName(trimmed);
    setWriteFailed(!ok);
    // Editing stays open on a failure: the draft is the only copy of what they
    // typed, and letting the effect above replace it with the value still
    // stored would throw the text away under a note saying it was not saved.
    setEditingName(!ok);
  };

  const choose = <T,>(current: T, next: T, write: (value: T) => boolean) => {
    if (next === current) return;
    Haptics.selectionAsync();
    setWriteFailed(!write(next));
  };

  const toggleImprove = (value: boolean) => {
    Haptics.selectionAsync();
    setWriteFailed(!setImproveClarity(value));
  };

  const confirmSignOut = () => {
    Haptics.selectionAsync();
    Alert.alert('Sign out of Clarity?', 'Your practice history on this device is removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          try {
            // No navigation after this: the root guard flips and drops this modal.
            await signOutAndClear(() => signOut());
          } catch (error) {
            Observe.reportError(error);
            setBusy(false);
            Alert.alert('Sign out failed', 'Check your connection and try again.');
          }
        },
      },
    ]);
  };

  const confirmDelete = () => {
    Haptics.selectionAsync();
    Alert.alert(
      'Delete your account?',
      'This removes your account and everything Clarity has stored for it. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            if (!user) return;
            setBusy(true);
            try {
              await deleteAccount(
                // Runs first, and a failure aborts: once the Clerk user is
                // gone nothing can delete these rows. The mutation is bounded,
                // so loop until it reports the tables empty.
                async () => {
                  for (;;) {
                    const { done } = await deleteRemoteBatch({});
                    if (done) return;
                  }
                },
                () => user.delete(),
                () => signOut(),
              );
            } catch (error) {
              Observe.reportError(error);
              setBusy(false);
              Alert.alert('Could not delete your account', 'Check your connection and try again.');
            }
          },
        },
      ],
    );
  };

  const email = user?.primaryEmailAddress?.emailAddress;

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <Eyebrow>ACCOUNT</Eyebrow>
        <SettingsCard>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <ThemedText variant="footnote" tone="tertiary">
                Name
              </ThemedText>
              <TextInput
                value={nameDraft}
                onChangeText={setNameDraft}
                onFocus={() => setEditingName(true)}
                onBlur={commitName}
                onSubmitEditing={commitName}
                placeholder="Your first name"
                placeholderTextColor={colors.secondary}
                autoCapitalize="words"
                autoComplete="given-name"
                maxLength={MAX_NAME}
                returnKeyType="done"
                style={[styles.nameInput, { color: colors.foreground }]}
              />
            </View>
          </View>
          {email ? (
            <>
              <RowDivider />
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <ThemedText variant="footnote" tone="tertiary">
                    Signed in as
                  </ThemedText>
                  <ThemedText variant="headline" weight="regular">
                    {email}
                  </ThemedText>
                </View>
              </View>
            </>
          ) : null}
          <RowDivider />
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={confirmSignOut}
            style={({ pressed }) => [styles.row, { opacity: pressed || busy ? 0.6 : 1 }]}>
            <ThemedText variant="headline" weight="regular" style={{ color: colors.danger }}>
              Sign out
            </ThemedText>
          </Pressable>
          <RowDivider />
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={confirmDelete}
            style={({ pressed }) => [styles.row, { opacity: pressed || busy ? 0.6 : 1 }]}>
            <ThemedText variant="headline" weight="regular" style={{ color: colors.danger }}>
              Delete account
            </ThemedText>
          </Pressable>
        </SettingsCard>

        <Eyebrow>YOUR ACCENT</Eyebrow>
        <Blurb>
          Your reading is scored against this accent. Picking the one you actually speak stops
          your own vowels being counted as mistakes.
        </Blurb>
        <SettingsCard>
          {ACCENTS.map((accent, index) => (
            <View key={accent.locale}>
              {index > 0 ? <RowDivider /> : null}
              <ChoiceListRow
                title={accent.label}
                caption={accent.region}
                selected={accent.locale === accentLocale}
                onSelect={() => choose(accentLocale, accent.locale, setAccentLocale)}
              />
            </View>
          ))}
        </SettingsCard>
        {/* Measured, not assumed: only en-US returns phoneme symbols. Saying so
            is the difference between a user making an informed trade and one
            wondering why the per-sound tips stopped appearing. */}
        {!hasPhonemeDetail(accentLocale) ? (
          <ThemedText variant="footnoteProse" tone="tertiary" style={styles.note}>
            Per-sound feedback, the tips that name a sound like /θ/, is available for American
            English only. You still get word and syllable scores.
          </ThemedText>
        ) : null}

        <Eyebrow>DAILY GOAL</Eyebrow>
        <Blurb>Your goal ring on Home fills as you reach this each day.</Blurb>
        <SettingsCard>
          {GOAL_OPTIONS.map((option, index) => (
            <View key={option.minutes}>
              {index > 0 ? <RowDivider /> : null}
              <ChoiceListRow
                title={`${option.minutes} minutes`}
                caption={option.caption}
                selected={option.minutes === goalMinutes}
                onSelect={() => choose(goalMinutes, option.minutes, setGoalMinutes)}
              />
            </View>
          ))}
        </SettingsCard>

        <Eyebrow>WHAT YOU WANT TO WORK ON</Eyebrow>
        <Blurb>
          This picks your early suggestions. Once you have a few scored sessions, Clarity follows
          your measured results instead.
        </Blurb>
        <SettingsCard>
          {SKILL_ORDER.map((key, index) => (
            <View key={key}>
              {index > 0 ? <RowDivider /> : null}
              <ChoiceListRow
                title={SKILL_LABELS[key]}
                caption={SKILL_GOALS[key]}
                selected={prioritySkill === key}
                onSelect={() => choose<SkillKey | null>(prioritySkill, key, setPrioritySkill)}
              />
            </View>
          ))}
          <RowDivider />
          <ChoiceListRow
            title="Not sure yet"
            caption="Start with a mix and let Clarity work it out."
            selected={prioritySkill === null}
            onSelect={() => choose<SkillKey | null>(prioritySkill, null, setPrioritySkill)}
          />
        </SettingsCard>

        <Eyebrow>PRIVACY</Eyebrow>
        <SettingsCard>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <ThemedText variant="headline" weight="regular">
                Use my data to improve Clarity
              </ThemedText>
            </View>
            {/* The platform switch, unwrapped. It already carries the design
                language, and routing it through a themed shell would only make
                it look less native. */}
            <Switch value={improveClarity} onValueChange={toggleImprove} />
          </View>
        </SettingsCard>

        {writeFailed ? (
          <ThemedText variant="footnoteProse" tone="tertiary" style={styles.note}>
            That preference could not be saved. Your device may be out of storage.
          </ThemedText>
        ) : null}
      </ScrollView>

      <Stack.Toolbar placement="left">
        <Stack.Toolbar.View hidesSharedBackground>
          <View style={styles.headerTitleBox}>
            <ThemedText variant="title3" weight="semibold">
              Settings
            </ThemedText>
          </View>
        </Stack.Toolbar.View>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="xmark" onPress={handleClose} />
      </Stack.Toolbar>
    </>
  );
}

const styles = StyleSheet.create({
  // Toolbar views need one child with explicit width/height; centering
  // vertically inside it keeps the text on the bar's middle line.
  headerTitleBox: {
    width: TOOLBAR_TITLE_WIDTH,
    height: TOOLBAR_TITLE_HEIGHT,
    justifyContent: 'center',
  },
  content: {
    padding: spacing.xl,
    paddingBottom: spacing.xxxxl,
  },
  eyebrow: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionBlurb: {
    marginBottom: spacing.md,
  },
  card: {
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: ROW_MIN_HEIGHT,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  nameInput: {
    ...type.headline,
    paddingVertical: 0,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.lg,
  },
  note: {
    marginTop: spacing.md,
  },
});
