import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { DeltaLabel, ScoreValue } from '@/components/metrics';
import { GlassSurface, ThemedText } from '@/components/ui';
import { SKILL_ORDER } from '@/constants/metrics';
import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { scoreBand } from '@/lib/score';
import { dayKeyToMs, type DayScore } from '@/lib/stats';

const CHART_HEIGHT = 110;
/** Floor so a very low score still renders as a visible bar, and the height a
 * day with no practice gets. */
const MIN_BAR = 14;
const BAR_GAP = spacing.sm;

/** Radius on a chart bar. Small enough that a 14pt minimum bar still reads as a
 * bar rather than a lozenge. */
const BAR_RADIUS = radius.xs;

/** Height of the avg label, used to sit it just clear of the dashed line. */
const AVG_LABEL_HEIGHT = 14;

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/** Bar height for a score. Proportional over the full 0–100 range from a zero
 * baseline — a truncated axis would exaggerate small week-to-week differences,
 * which is exactly the kind of flattery this app's metrics are meant to avoid.
 * The dashed average line uses the same mapping, so it always lands on the
 * height an average day would have. */
function barHeight(score: number): number {
  return Math.max(MIN_BAR, (Math.max(0, Math.min(score, 100)) / 100) * CHART_HEIGHT);
}

export type SpeakingScoreCardProps = {
  /** Rolling score over the plotted window; null when nothing was measured. */
  score: number | null;
  /** Change vs the previous window. Omit when there's no prior data. */
  delta?: number;
  /** Oldest first, today last. `score: null` on days with no practice. */
  days: readonly DayScore[];
  /** Set when the window scores over more days than are plotted (the all-time
   * range), so the caption can say the chart shows a shorter span. */
  chartNote?: string;
};

/**
 * The hero: one speaking score, its band, its weekly change, and the daily
 * scores behind it.
 *
 * The chart plots the same trailing-7-day window the score is computed from, so
 * the number, the dashed average line, and the bars can never disagree — and
 * it's the same window Home's card reads, so the two screens always show the
 * same figure.
 */
export function SpeakingScoreCard({ score, delta, days, chartNote }: SpeakingScoreCardProps) {
  const { colors } = useTheme();
  // Measured rather than a percentage width: react-native-svg needs a concrete
  // width to stroke a dash pattern across the chart.
  const [chartWidth, setChartWidth] = useState(0);

  const avgTop = score != null ? CHART_HEIGHT - barHeight(score) : null;
  // A near-perfect score puts the line at the very top, where a label above it
  // would clip out of the card — drop the label below the line instead.
  const labelBelow = avgTop != null && avgTop < 14;

  return (
    <GlassSurface radius="xl" style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headLeft}>
          <ThemedText variant="eyebrow" tone="secondary">
            SPEAKING SCORE
          </ThemedText>
          <ScoreValue value={score} size={52} maxSize={19} />
        </View>
        <View style={styles.headRight}>
          {delta != null && delta !== 0 && (
            <View
              style={[
                styles.deltaPill,
                { backgroundColor: delta > 0 ? colors.positiveBg : 'transparent' },
              ]}>
              <DeltaLabel delta={delta} suffix="this week" />
            </View>
          )}
          {score != null && (
            <ThemedText variant="footnote" weight="semibold" tone="secondary">
              {scoreBand(score)}
            </ThemedText>
          )}
        </View>
      </View>

      <View style={styles.chart}>
        <View
          style={styles.bars}
          onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)}>
          {days.map((day, i) => {
            const measured = day.score != null;
            const isToday = i === days.length - 1;
            // A freestyle-only day is scored on 3 skills, a passage+Azure day on
            // 5, so the two bars are not directly comparable. Rather than imputing
            // a missing measurement, mark the partial ones and say so below.
            const partial = measured && day.skillCount < SKILL_ORDER.length;
            return (
              <View
                key={day.dayKey}
                style={{
                  flex: 1,
                  height: measured ? barHeight(day.score!) : MIN_BAR,
                  borderRadius: BAR_RADIUS,
                  borderCurve: 'continuous',
                  backgroundColor: !measured
                    ? colors.barEmpty
                    : isToday
                      ? colors.foreground
                      : colors.bar,
                  opacity: partial ? 0.45 : 1,
                }}
              />
            );
          })}

          {avgTop != null && chartWidth > 0 && (
            <>
              <Svg
                width={chartWidth}
                height={1.5}
                style={[styles.avgLine, { top: avgTop }]}
                pointerEvents="none">
                <Line
                  x1={0}
                  y1={0.75}
                  x2={chartWidth}
                  y2={0.75}
                  stroke={colors.foreground}
                  strokeOpacity={0.15}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                />
              </Svg>
              <ThemedText
                variant="micro"
                tone="tertiary"
                style={[
                  styles.avgLabel,
                  { top: labelBelow ? avgTop + spacing.xs : avgTop - AVG_LABEL_HEIGHT },
                ]}>
                avg {Math.round(score!)}
              </ThemedText>
            </>
          )}
        </View>

        <View style={styles.dayRow}>
          {days.map((day, i) => {
            const isToday = i === days.length - 1;
            const initial = WEEKDAY_INITIALS[new Date(dayKeyToMs(day.dayKey)).getDay()];
            return (
              <ThemedText
                key={day.dayKey}
                variant="caption"
                weight={isToday ? 'bold' : 'medium'}
                tone={isToday ? 'primary' : 'tertiary'}
                style={styles.dayLabel}>
                {initial}
              </ThemedText>
            );
          })}
        </View>

        {(days.some((d) => d.score != null && d.skillCount < SKILL_ORDER.length) ||
          chartNote != null) && (
          <ThemedText variant="caption" weight="regular" tone="tertiary" style={styles.footnote}>
            {[
              days.some((d) => d.score != null && d.skillCount < SKILL_ORDER.length)
                ? 'Lighter bars were scored on fewer skills.'
                : null,
              chartNote,
            ]
              .filter(Boolean)
              .join(' ')}
          </ThemedText>
        )}
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  footnote: {
    marginTop: spacing.md,
  },
  card: {
    padding: spacing.xxl,
    gap: spacing.xl,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headLeft: {
    gap: spacing.sm,
  },
  headRight: {
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  deltaPill: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
  },
  chart: {
    gap: spacing.sm,
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: CHART_HEIGHT,
    gap: BAR_GAP,
  },
  avgLine: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  avgLabel: {
    position: 'absolute',
    left: 0,
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: BAR_GAP,
  },
  dayLabel: {
    flex: 1,
    textAlign: 'center',
    lineHeight: 16,
  },
});
