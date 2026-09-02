/**
 * Durations and spring configs, so motion across the app feels related.
 *
 * Reanimated caveat: don't drive a token color through a Reanimated style —
 * animate opacity or transform and let the color stay static.
 */
export const motion = {
  /** State feedback: a press, a toggle, a value ticking over. */
  fast: 150,
  /** Element enter/exit. */
  base: 250,
  /** Large surfaces: sheets, screen-level fades. */
  slow: 400,
  /** Gap between semantic groups in a first-load entrance. */
  stagger: 100,
  /** Small rise used by entering content; large enough to read, not travel. */
  enterOffset: 12,
  /** Strong ease-out for anything entering or leaving the interface. */
  easeOut: [0.23, 1, 0.32, 1] as const,
} as const;

/**
 * Springs. Each has one job, so two surfaces sliding at once look like one
 * gesture rather than two animations that happen to overlap.
 */
export const springs = {
  /** Snappy and critically damped: a segmented-control thumb landing. */
  snap: { damping: 32, stiffness: 420, mass: 0.9 },
  /** Slightly under-damped, so a sliding pill gets a small settle at the end. */
  settle: { duration: 420, dampingRatio: 0.82 },
  /** No overshoot: chrome that minimizes or expands under a finger. */
  glide: { duration: 380, dampingRatio: 1 },
} as const;
