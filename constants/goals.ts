/**
 * Daily practice goal choices. Minutes of active speaking per day.
 *
 * `DEFAULT_GOAL_MINUTES` is the value `lib/stats.ts` used as a hardcoded
 * constant before the goal became a setting, so a user who never picks one
 * keeps exactly the behaviour the app shipped with.
 *
 * PURE module: no React, no imports from `services/`. Safe under bun.
 */

export const DEFAULT_GOAL_MINUTES = 20;

export type GoalOption = {
  minutes: number;
  /** One line under the minutes, in the onboarding and Settings rows. */
  caption: string;
};

export const GOAL_OPTIONS: readonly GoalOption[] = [
  { minutes: 5, caption: 'A quick daily rep.' },
  { minutes: 10, caption: 'A steady habit.' },
  { minutes: 20, caption: 'Real practice time.' },
  { minutes: 30, caption: 'You are training for something.' },
] as const;

export function isGoalMinutes(value: unknown): value is number {
  return typeof value === 'number' && GOAL_OPTIONS.some((option) => option.minutes === value);
}
