/** The onboarding routes in order. The layout derives the progress dots from
 * the current segment's position here, and each step pushes the next. */
export const ONBOARDING_STEPS = ['name', 'accent', 'goal', 'priority', 'microphone'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
