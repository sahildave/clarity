import {
  AnalyticsUpIcon,
  CheckmarkBadge01Icon,
  Clock01Icon,
  FireIcon,
  Mic01Icon,
  StarIcon,
} from '@hugeicons-pro/core-stroke-rounded';
import { GlassContainer } from 'expo-glass-effect';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RecordsCard, type RecordRow } from '@/components/analytics/records-card';
import { SpeakingScoreCard } from '@/components/analytics/speaking-score-card';
import { EmptyStateCard } from '@/components/empty-state-card';
import { useMinimizeOnScroll } from '@/components/glass-tabs';
import { HeaderActions } from '@/components/header-actions';
import { CounterCard, SkillCard } from '@/components/metrics';
import { SegmentedControl } from '@/components/segmented-control';
import { IntroReveal } from '@/components/splash';
import { SectionHeader, ThemedText } from '@/components/ui';
import { spacing, TAB_BAR_SCROLL_INSET } from '@/constants/theme';
import { useMarkInteractive } from '@/hooks/use-mark-interactive';
import { useSessionRecords, useWords } from '@/hooks/use-session-history';
import { useNow } from '@/hooks/use-now';
import { useSpeakingSummary } from '@/hooks/use-speaking-summary';
import { formatDayRange, timeAgo } from '@/lib/format';
import { speakingScore } from '@/lib/score';
import { bestSession, longestStreakRange, startOfLocalDay, totals } from '@/lib/stats';

const MODE_LABELS = { passage: 'Passage', drill: 'Drill', freestyle: 'Freestyle' } as const;

const RANGES = ['Week', 'Month', 'All time'] as const;
/** Days each range scores over. All time is resolved from the first record. */
const RANGE_DAYS = [7, 30, null] as const;
/** Hundreds of daily bars are unreadable, so the all-time chart shows the most
 * recent stretch while the score above it covers everything. The section
 * subtitle says so. */
const MAX_CHART_DAYS = 30;

export default function AnalyticsScreen() {
  useMarkInteractive();

  const onScroll = useMinimizeOnScroll();
  const insets = useSafeAreaInsets();

  const [range, setRange] = useState(0);
  const records = useSessionRecords();
  const now = useNow();

  // All time spans from the first session to today; the other ranges are fixed.
  const windowDays = useMemo(() => {
    const fixed = RANGE_DAYS[range];
    if (fixed != null) return fixed;
    if (records.length === 0) return 7;
    const first = startOfLocalDay(records[0].completedAt);
    return Math.max(1, Math.round((startOfLocalDay(now) - first) / 86_400_000) + 1);
  }, [range, records, now]);

  const summary = useSpeakingSummary(windowDays, Math.min(windowDays, MAX_CHART_DAYS));
  const { mastered } = useWords();

  // All-time bests. Every value derives from the stored skills, so records
  // written before the score definition changed still rank correctly.
  const recordRows = useMemo<RecordRow[]>(() => {
    if (records.length === 0) return [];
    const t = totals(records);
    const longest = longestStreakRange(records);
    const best = bestSession(records);
    const bestScore = best ? speakingScore(best) : null;
    const rows: RecordRow[] = [];
    // Effort rows come first and stand alone: a history of only unscorable
    // sessions still practiced, and previously an absent best hid the total
    // practice row along with it.
    if (best && bestScore != null) {
      rows.push({
        icon: StarIcon,
        title: 'Best score',
        // `contentTitle` is snapshotted on the record, so this survives deleting
        // a custom passage and is right for drills too, which the built-ins-only
        // `getPassage` lookup got wrong.
        caption: `${best.contentTitle ?? MODE_LABELS[best.mode]} · ${timeAgo(
          best.completedAt,
          now,
        )}`,
        isScore: true,
        value: bestScore,
      });
    }
    if (longest) {
      rows.push({
        icon: FireIcon,
        title: 'Longest streak',
        caption: formatDayRange(longest.startMs, longest.endMs),
        value: longest.length,
        unit: longest.length === 1 ? 'day' : 'days',
      });
    }
    rows.push({
      icon: Clock01Icon,
      title: 'Total practice',
      caption: `across ${t.sessions} ${t.sessions === 1 ? 'session' : 'sessions'}`,
      value: t.minutes >= 60 ? Math.round(t.minutes / 60) : Math.round(t.minutes),
      unit: t.minutes >= 60 ? 'h' : 'min',
    });
    return rows;
  }, [records, now]);

  const header = (
    <>
      <View style={styles.header}>
        <IntroReveal order={0}>
          <ThemedText variant="largeTitle">Analytics</ThemedText>
        </IntroReveal>
        <IntroReveal order={0} fade={false}>
          <HeaderActions streak={summary.streak} />
        </IntroReveal>
      </View>
      <IntroReveal order={1} style={styles.control}>
        <SegmentedControl segments={RANGES} selectedIndex={range} onChange={setRange} />
      </IntroReveal>
    </>
  );

  const scroll = {
    onScroll,
    scrollEventThrottle: 16,
    style: { flex: 1 },
    contentContainerStyle: {
      paddingTop: insets.top + spacing.xxl,
      paddingHorizontal: spacing.xl,
      paddingBottom: TAB_BAR_SCROLL_INSET,
    },
  } as const;

  if (summary.empty) {
    return (
      <Animated.ScrollView {...scroll}>
        {header}
        <IntroReveal order={2} fade={false} style={styles.sectionCard}>
          <EmptyStateCard
            icon={AnalyticsUpIcon}
            title="No analytics yet"
            subtitle="Finish a practice session and your speaking score, skills, and records will show up here."
          />
        </IntroReveal>
      </Animated.ScrollView>
    );
  }

  const chartTruncated = windowDays > summary.days.length;
  const rangeLabel = RANGES[range].toLowerCase();

  return (
    <Animated.ScrollView {...scroll}>
      {header}

      <IntroReveal order={2} fade={false} style={styles.sectionCard}>
        <SpeakingScoreCard
          score={summary.score}
          delta={summary.scoreDelta ?? undefined}
          days={summary.days}
          chartNote={
            chartTruncated
              ? `Score covers all ${windowDays} days; the chart shows the last ${summary.days.length}.`
              : undefined
          }
        />
      </IntroReveal>

      <IntroReveal order={3}>
        <SectionHeader title="Skills" subtitle="How each part of your speaking is trending" />
      </IntroReveal>
      <IntroReveal order={4} fade={false} style={styles.sectionCard}>
        <SkillCard
          skills={summary.skills}
          captions={summary.captions}
          deltas={summary.skillDeltas}
        />
      </IntroReveal>

      <IntroReveal order={5}>
        <SectionHeader
          title={range === 0 ? 'This week' : range === 1 ? 'This month' : 'All time'}
          subtitle={
            range === 2
              ? `Your effort across ${windowDays} days of practice`
              : `Your effort over the last ${windowDays} days`
          }
        />
      </IntroReveal>
      <IntroReveal order={6} fade={false} style={styles.sectionCard}>
        {/* Three counters, so the second row carries one full-width card rather
            than a half-width card beside a gap. GlassContainer groups all three
            so their glass composites as one set; `spacing` is left unset on
            purpose — raising it past the grid's gaps would fuse the cards into a
            single blob instead of keeping them a legible grid. */}
        <GlassContainer style={styles.counterGroup}>
          <View style={styles.counterRow}>
            <CounterCard
              icon={Clock01Icon}
              label="Practice time"
              value={summary.minutes}
              unit="min"
              delta={summary.minutesDelta ?? undefined}
              deltaSuffix="min"
            />
            <CounterCard
              icon={Mic01Icon}
              label="Sessions"
              value={summary.sessions}
              unit={summary.sessions === 1 ? 'run' : 'runs'}
              delta={summary.sessionsDelta ?? undefined}
            />
          </View>
          <View style={styles.counterRow}>
            <CounterCard
              icon={FireIcon}
              label="Day streak"
              value={summary.streak}
              unit={summary.streak === 1 ? 'day' : 'days'}
              delta={summary.streakDelta ?? undefined}
              deltaSuffix={Math.abs(summary.streakDelta ?? 0) === 1 ? 'day' : 'days'}
            />
            {/* All-time by nature: a word is mastered or it isn't, so this one
                carries no window delta. */}
            <CounterCard
              icon={CheckmarkBadge01Icon}
              label="Words mastered"
              value={mastered}
              unit={mastered === 1 ? 'word' : 'words'}
            />
          </View>
        </GlassContainer>
      </IntroReveal>

      {recordRows.length > 0 && (
        <>
          <IntroReveal order={7}>
            <SectionHeader title="Records" subtitle="Your all-time bests" />
          </IntroReveal>
          <IntroReveal order={8} fade={false} style={styles.sectionCard}>
            <RecordsCard rows={recordRows} />
          </IntroReveal>
        </>
      )}
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  control: {
    marginTop: spacing.xl,
  },
  sectionCard: {
    marginTop: spacing.md,
  },
  counterGroup: {
    gap: spacing.md,
  },
  counterRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
});
