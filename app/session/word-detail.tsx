import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect } from 'react';

import { WordDetail } from '@/components/session/word-detail';
import { useMarkInteractive } from '@/hooks/use-mark-interactive';

import { useSessionContext } from './_layout';

function parseWordIndex(value: string | string[] | undefined): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const index = Number(value);
  return Number.isSafeInteger(index) ? index : null;
}

export default function WordDetailScreen() {
  const { result } = useSessionContext();
  const { wordIndex } = useLocalSearchParams<{ wordIndex?: string | string[] }>();
  const index = parseWordIndex(wordIndex);
  const word =
    result?.mode !== 'freestyle' && index != null ? (result?.words[index] ?? null) : null;

  // The one route that never marked itself, so it was the one route with a
  // nav_cold_ttr and no nav_tti to read it against. Gated on the word for the
  // same reason Results is gated on its result: an unresolvable index renders
  // nothing and pops straight back out.
  useMarkInteractive(word != null);

  const dismiss = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }, []);

  useEffect(() => {
    if (!result || !word) dismiss();
  }, [dismiss, result, word]);

  if (!result || !word) return null;

  return <WordDetail word={word} audioUri={result.audioUri} onDismiss={dismiss} />;
}
