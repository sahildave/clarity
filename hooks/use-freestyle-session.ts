import { useFreestyleSession as useFreestyleSessionMock } from './use-freestyle-session.mock';
import { useFreestyleSession as useFreestyleSessionReal } from './use-freestyle-session.real';

import type { FreestyleSession } from '@/types/session';

/**
 * Freestyle uses the same build-time speech-engine switch as passage practice.
 * The simulator profile turns it on so every session and results surface is
 * reachable without native audio input. Production keeps the real engine.
 */
const USE_MOCK = process.env.EXPO_PUBLIC_MOCK_PRACTICE === '1';

export const useFreestyleSession: () => FreestyleSession = USE_MOCK
  ? useFreestyleSessionMock
  : useFreestyleSessionReal;

export { USE_MOCK };
