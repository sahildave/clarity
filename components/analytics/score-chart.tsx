import { barY } from '@tanstack/charts/bar';
import { crosshair } from '@tanstack/charts/crosshair';
import { createChartCursor, cursorHost } from '@tanstack/charts/cursor';
import { decorative } from '@tanstack/charts/mark/decorative';
import { Chart } from '@tanstack/charts/react-native';
import { ruleY } from '@tanstack/charts/rule';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { defineChart } from '@tanstack/charts/scene';
import { text } from '@tanstack/charts/text';
import type { ChartPoint, ChartScene } from '@tanstack/charts/types';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

import { SKILL_ORDER } from '@/constants/metrics';
import { fonts, radius, spacing, type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Bar area plus the tick-label row the axis draws inside the chart box. */
const CHART_HEIGHT = 134;

/**
 * Floor, in score points on the 0–100 scale, so a very low score still renders
 * as a visible bar — and the height a day with no practice gets. Same optical
 * size as the old hand-rolled chart's 14pt-of-110pt minimum bar.
 */
const MIN_BAR_SCORE = 13;

/** One plotted bucket: a day on the week/month ranges, a week on all time. */
export type ScoreChartPoint = {
  /** Stable identity and band-scale category — a dayKey or a week's startKey. */
  key: string;
  /** Axis tick label: a weekday initial or a short date. */
  label: string;
  /** Scrub title: the full day ("Wed, Aug 19") or week span. */
  detail: string;
  /** null when nothing scorable happened in the bucket. */
  score: number | null;
  sessions: number;
  minutes: number;
  /** Skills the bucket was scored on; fewer than all five marks the bar as
   * partial, since a 3-skill score and a 5-skill score are not comparable. */
  skillCount: number;
  /** Today / the current week — drawn in the foreground ink like before. */
  isCurrent: boolean;
};

export type ScoreChartProps = {
  points: readonly ScoreChartPoint[];
  /** The window's rolling score; drawn as the dashed average line so the bars
   * and the number above them can never disagree. null hides the line. */
  avg: number | null;
  /**
   * Fires with the bucket under the finger while scrubbing, and with null when
   * the finger lifts. The card above the chart reads the value out in its own
   * header, so nothing is drawn under the finger where the hand covers it.
   */
  onScrub?: (point: ScoreChartPoint | null) => void;
};

/** Bars never render below the visibility floor; the header carries the exact
 * value. */
function barTop(point: ScoreChartPoint): number {
  return Math.max(point.score ?? 0, MIN_BAR_SCORE);
}

/** Which bucket a touch is over, or -1 before the plot has been measured. */
function bucketAt(
  x: number,
  width: number,
  plot: { start: number; step: number; count: number },
): number {
  'worklet';
  if (width <= 0 || plot.step <= 0 || plot.count === 0) return -1;
  const index = Math.floor((x / width - plot.start) / plot.step);
  return Math.min(Math.max(index, 0), plot.count - 1);
}

/**
 * The speaking-score bar chart, drawn with TanStack Charts' native SVG host.
 *
 * One bar mark over an explicit band domain, a dashed average rule, and a
 * cursor band that follows the finger. Scrubbing reports the focused bucket
 * through `onScrub` instead of painting a tooltip: the value belongs in the
 * card header, above the hand.
 *
 * Focus runs through a chart cursor rather than the host's local focus state,
 * for two reasons. The scrub can be cleared programmatically — the library
 * keeps the last focused point after a release, which would leave the band lit
 * under a bar the header no longer reads. And the gesture can be ours: the
 * host's touch responder claims a touch the instant it lands, so a finger that
 * came to scroll the page flashed a bucket and fired a tick before the scroll
 * view could take the touch back. `pointer: false` hands the chart's own
 * responder off, and the gesture below waits for horizontal travel or a hold
 * before it claims anything.
 */
export function ScoreChart({ points, avg, onScrub }: ScoreChartProps) {
  const { colors } = useTheme();

  // Stable across definition rebuilds: the Chart re-binds its cursor session
  // whenever the controller identity changes, which would drop a live scrub.
  const cursor = useMemo(() => createChartCursor<string, number>(), []);
  const scrubbedKey = useRef<string | null>(null);

  // Plot geometry as fractions of the scene width, so the worklet can map a
  // touch to a bucket without knowing the scene's own coordinate space.
  const plot = useSharedValue({ start: 0, step: 0, count: 0 });
  const chartWidth = useSharedValue(0);
  const panning = useSharedValue(false);
  const holding = useSharedValue(false);
  const lastIndex = useSharedValue(-1);

  const definition = useMemo(() => {
    const keys = points.map((p) => p.key);
    const labels = new Map(points.map((p) => [p.key, p.label]));

    // ONE bar mark for every bucket: the band domain is inferred from mark
    // data in first-seen order, so splitting empty/full/partial into separate
    // marks reordered the bars (all the empty ones jumped to the front).
    // Partial-coverage fading therefore rides on the fill color itself —
    // `bar`/`foreground` are 6-digit hex in both schemes, so a 45% alpha byte
    // is safe to append.
    const fill = (p: ScoreChartPoint): string => {
      if (p.score == null) return colors.barEmpty;
      const ink = p.isCurrent ? colors.foreground : colors.bar;
      return p.skillCount < SKILL_ORDER.length ? `${ink}73` : ink;
    };

    return defineChart({
      marks: [
        barY(points as ScoreChartPoint[], {
          x: 'key',
          y1: 0,
          y2: barTop,
          key: 'key',
          radius: radius.xs,
          fill,
        }),
        // Overlay, after the bars: the scrub band has to tint the bar it marks.
        // Behind them it would only show in the sliver above a bar's top edge,
        // since the bars paint opaque.
        crosshair<string, number>({
          x: {
            band: {
              inset: 0,
              radius: radius.xs,
              fill: colors.foreground,
              fillOpacity: 0.12,
            },
          },
          y: false,
        }),
        // Decorative: the average rule and its label carry data, so without
        // this they would be focus candidates competing with the bars.
        ...(avg != null
          ? [
              decorative(
                ruleY([avg], {
                  stroke: colors.foreground,
                  strokeOpacity: 0.15,
                  strokeWidth: 1.5,
                  strokeDasharray: '4 4',
                }),
              ),
              decorative(
                text([avg], {
                  x: () => keys[0],
                  y: (v: number) => v,
                  text: (v: number) => `avg ${Math.round(v)}`,
                  fill: colors.tertiary,
                  fontSize: type.micro.fontSize,
                  anchor: 'start',
                  dy: -spacing.sm,
                }),
              ),
            ]
          : []),
      ],
      x: {
        scale: () => scaleBand<string>().domain(keys).paddingInner(0.25).paddingOuter(0),
        axis: {
          line: false,
          ticks: {
            values: keys,
            size: 0,
            format: (key: string) => labels.get(key) ?? '',
          },
          tickLabels: { fontSize: type.caption.fontSize },
        },
      },
      y: {
        scale: () => scaleLinear().domain([0, 100]),
        grid: false,
        axis: false,
      },
      focus: 'nearest-x',
      // The pan below owns the scrub, so the host must not claim touches. It
      // keeps its keyboard and accessibility navigation either way.
      pointer: false,
      // The cursor band is the focus indicator, so the host ring would double it.
      focusRing: false,
      cursor: { use: cursorHost, controller: cursor, mode: 'focus', match: 'x' },
      theme: {
        foreground: colors.foreground,
        muted: colors.tertiary,
        grid: colors.barEmpty,
        background: 'transparent',
      },
    });
  }, [points, avg, colors, cursor]);

  const handleFocus = useCallback(
    (focused: ChartPoint<ScoreChartPoint, string, number> | null) => {
      const point = focused?.datum ?? null;
      const key = point?.key ?? null;
      if (key === scrubbedKey.current) return;
      scrubbedKey.current = key;
      // One tick per bucket crossed — the same feedback a segmented control or
      // a picker gives, since this is the same kind of discrete selection.
      if (key != null) Haptics.selectionAsync();
      onScrub?.(point);
    },
    [onScrub],
  );

  const focusIndex = useCallback(
    (index: number) => {
      const point = points[index];
      if (!point) return;
      // A semantic value, not a coordinate: the host maps the bucket key back
      // through its own scales to a point, a focus group, and the band.
      cursor.setState({
        anchor: 'value',
        value: { x: point.key },
        source: 'pointer',
        pinned: false,
      });
    },
    [cursor, points],
  );

  const endScrub = useCallback(() => {
    cursor.setState(null);
    if (scrubbedKey.current == null) return;
    scrubbedKey.current = null;
    onScrub?.(null);
  }, [cursor, onScrub]);

  // A range switch replaces every bucket; a scrub held across it would report
  // a bar that no longer exists.
  useEffect(() => endScrub(), [points, endScrub]);

  // Records the plot box the axis leaves for the bars. Buckets are evenly
  // spaced with no outer padding, so a bucket is one step of it.
  const handleRender = useCallback(
    ({ scene }: { scene: ChartScene<ScoreChartPoint, string, number> }) => {
      const count = points.length;
      plot.value =
        scene.width > 0 && count > 0
          ? {
              start: scene.chart.x / scene.width,
              step: scene.chart.width / scene.width / count,
              count,
            }
          : { start: 0, step: 0, count: 0 };
    },
    [plot, points.length],
  );

  /**
   * Two ways into a scrub, because only time can tell one apart from a page
   * scroll: 6pt of horizontal travel, or a 200ms hold in place. A scroll flick
   * has moved well past 12pt before either fires, so it reaches the scroll view
   * untouched.
   *
   * The pan's offsets are the tab bar's, so the app's two scrubbable surfaces
   * give way to a vertical scroll at the same point.
   */
  const gesture = useMemo(() => {
    const scrubTo = (x: number) => {
      'worklet';
      const index = bucketAt(x, chartWidth.value, plot.value);
      if (index < 0 || index === lastIndex.value) return;
      lastIndex.value = index;
      runOnJS(focusIndex)(index);
    };

    // Either recognizer may end first, so whichever ends last clears.
    const release = () => {
      'worklet';
      if (panning.value || holding.value) return;
      lastIndex.value = -1;
      runOnJS(endScrub)();
    };

    const pan = Gesture.Pan()
      .activeOffsetX([-6, 6])
      .failOffsetY([-14, 14])
      .onStart((event) => {
        panning.value = true;
        scrubTo(event.x);
      })
      .onUpdate((event) => scrubTo(event.x))
      // Fires on failure too — only release a pan that actually activated.
      .onFinalize(() => {
        if (!panning.value) return;
        panning.value = false;
        release();
      });

    // Cancels itself past 12pt of travel, by which point the pan — 6pt — has
    // taken the scrub over.
    const hold = Gesture.LongPress()
      .minDuration(200)
      .maxDistance(12)
      .onStart((event) => {
        holding.value = true;
        scrubTo(event.x);
      })
      .onFinalize(() => {
        if (!holding.value) return;
        holding.value = false;
        release();
      });

    return Gesture.Simultaneous(pan, hold);
  }, [chartWidth, endScrub, focusIndex, holding, lastIndex, panning, plot]);

  if (points.length === 0) return null;

  return (
    <GestureDetector gesture={gesture}>
      <View
        onLayout={(event) => {
          chartWidth.value = event.nativeEvent.layout.width;
        }}>
        <Chart
          definition={definition}
          height={CHART_HEIGHT}
          color={colors.foreground}
          fontFamily={fonts.medium}
          accessibilityLabel="Speaking score by day"
          accessibilityHint="Swipe up or down to inspect a bar. Its details read out above the chart."
          testID="speaking-score-chart"
          onFocusChange={handleFocus}
          onRender={handleRender}
        />
      </View>
    </GestureDetector>
  );
}
