import { Stack } from 'expo-router/stack';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { SessionResult } from '@/types/session';

type SessionContextValue = {
  result: SessionResult | null;
  /**
   * Id of the record this session persisted as, or null when it wasn't persisted
   * (nothing spoken, or the write failed).
   *
   * The results screen excludes the current session from its "vs your average"
   * baseline BY ID. It used to do `records.slice(0, -1)`, which is wrong whenever
   * the attempt wasn't saved: the slice then dropped the user's previous real
   * session from the baseline instead.
   */
  recordId: string | null;
  setResult: (result: SessionResult | null, recordId?: string | null) => void;
  /** Bumped by the results screen's Retry; the practice screen restarts on change. */
  retryToken: number;
  bumpRetry: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSessionContext(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSessionContext must be used inside /session routes');
  return value;
}

export default function SessionLayout() {
  const [result, setResultState] = useState<SessionResult | null>(null);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const bumpRetry = useCallback(() => setRetryToken((t) => t + 1), []);

  const setResult = useCallback((next: SessionResult | null, id: string | null = null) => {
    setResultState(next);
    setRecordId(id);
  }, []);

  const value = useMemo(
    () => ({ result, recordId, setResult, retryToken, bumpRetry }),
    [result, recordId, setResult, retryToken, bumpRetry],
  );

  return (
    <SessionContext.Provider value={value}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen
          name="word-detail"
          options={{
            presentation: 'formSheet',
            headerShown: false,
            sheetAllowedDetents: 'fitToContents',
            sheetGrabberVisible: true,
          }}
        />
      </Stack>
    </SessionContext.Provider>
  );
}
