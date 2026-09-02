import { useEffect, useMemo, useRef, useState } from 'react';
import { useSharedValue } from 'react-native-reanimated';

import { countDiscourseMarkers, countFillers } from '@/lib/fillers';
import { tokenizeTranscript } from '@/services/alignment';
import { buildFreestyleResult } from '@/services/scoring';
import type {
  FreestyleSession,
  PracticeStatus,
  SessionResult,
} from '@/types/session';

/** A deterministic impromptu answer that exercises transcript and result UI. */
const MOCK_TRANSCRIPT =
  'Clear communication starts with a simple idea. Um, when we slow down and choose our words, people can follow the story and respond with confidence.';
const MOCK_WORDS = MOCK_TRANSCRIPT.split(/\s+/);
const MOCK_NORMALIZED_WORDS = tokenizeTranscript(MOCK_TRANSCRIPT).map((token) => token.norm);
const MOCK_FILLER_COUNT = countFillers(MOCK_NORMALIZED_WORDS);
const MOCK_DISCOURSE_MARKER_COUNT = countDiscourseMarkers(MOCK_NORMALIZED_WORDS);
const MOCK_PACE_WPM = 154;
const TICK_MS = 100;
const WORD_MS = 240;

function buildMockResult(elapsedMs: number): SessionResult {
  const naturalDurationMs = Math.round((MOCK_WORDS.length / MOCK_PACE_WPM) * 60_000);
  return buildFreestyleResult({
    transcript: MOCK_TRANSCRIPT,
    paceWpm: MOCK_PACE_WPM,
    fillerCount: MOCK_FILLER_COUNT,
    discourseMarkerCount: MOCK_DISCOURSE_MARKER_COUNT,
    durationMs: Math.max(elapsedMs, naturalDurationMs),
    audioUri: null,
    waveform: Array.from({ length: 30 }, (_, index) => {
      const wave = Math.abs(Math.sin(index * 1.7) * Math.cos(index * 0.43));
      return 0.18 + wave * 0.82;
    }),
  });
}

/**
 * Scripted freestyle engine for simulator QA. It behaves like a live session
 * but never asks for microphone or speech-recognition permission.
 */
export function useFreestyleSession(): FreestyleSession {
  const [status, setStatus] = useState<PracticeStatus>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [liveWpm, setLiveWpm] = useState(0);
  const [fillerCount, setFillerCount] = useState(0);
  const [finalTranscript, setFinalTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [result, setResult] = useState<SessionResult | null>(null);
  const meterLevel = useSharedValue(0);
  const stateRef = useRef({ status: 'idle' as PracticeStatus, elapsedMs: 0 });
  stateRef.current.status = status;

  useEffect(() => {
    const interval = setInterval(() => {
      const current = stateRef.current;
      if (current.status !== 'listening') {
        meterLevel.value *= 0.8;
        return;
      }

      current.elapsedMs += TICK_MS;
      const visibleCount = Math.min(
        MOCK_WORDS.length,
        Math.floor(current.elapsedMs / WORD_MS),
      );
      const visibleWords = MOCK_WORDS.slice(0, visibleCount);
      const normalizedVisible = tokenizeTranscript(visibleWords.join(' ')).map(
        (token) => token.norm,
      );
      const seconds = current.elapsedMs / 1000;

      setElapsedMs(current.elapsedMs);
      setFinalTranscript(visibleWords.join(' '));
      setInterimTranscript(MOCK_WORDS[visibleCount] ?? '');
      setFillerCount(countFillers(normalizedVisible));
      setLiveWpm(seconds >= 2 ? MOCK_PACE_WPM : 0);
      meterLevel.value = 0.16 + 0.64 * Math.abs(Math.sin(seconds * 6.4));
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [meterLevel]);

  const api = useMemo(() => {
    const reset = () => {
      stateRef.current.elapsedMs = 0;
      setElapsedMs(0);
      setLiveWpm(0);
      setFillerCount(0);
      setFinalTranscript('');
      setInterimTranscript('');
      setResult(null);
      meterLevel.value = 0;
    };

    return {
      async start() {
        reset();
        setStatus('listening');
      },
      pause() {
        setStatus('paused');
      },
      resume() {
        setStatus('listening');
      },
      restart() {
        reset();
        setStatus('listening');
      },
      cancel() {
        setStatus('idle');
        meterLevel.value = 0;
      },
      async stop(): Promise<SessionResult> {
        setStatus('processing');
        await new Promise((resolve) => setTimeout(resolve, 600));
        const mockResult = buildMockResult(stateRef.current.elapsedMs);
        setFinalTranscript(MOCK_TRANSCRIPT);
        setInterimTranscript('');
        setFillerCount(MOCK_FILLER_COUNT);
        setLiveWpm(MOCK_PACE_WPM);
        setResult(mockResult);
        setStatus('done');
        meterLevel.value = 0;
        return mockResult;
      },
    };
  }, [meterLevel]);

  return {
    status,
    error: null,
    elapsedMs,
    liveWpm,
    fillerCount,
    finalTranscript,
    interimTranscript,
    meterLevel,
    result,
    ...api,
  };
}
