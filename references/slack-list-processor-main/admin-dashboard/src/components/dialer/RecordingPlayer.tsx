/**
 * RecordingPlayer Component (T072 - Recording Library Audio Player)
 *
 * HTML5 audio player with play/pause, seek bar, speed controls,
 * and transcript-synchronized highlighting.
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, FastForward } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TranscriptLine } from '@/services/recordings-api';

interface RecordingPlayerProps {
  /** Pre-signed URL for the audio file. */
  audioUrl: string;
  /** Optional transcript lines for synchronized highlighting. */
  transcript?: TranscriptLine[];
  /** Callback fired on every timeupdate event with the current playback time. */
  onTimeUpdate?: (currentTime: number) => void;
}

const SPEED_OPTIONS = [0.5, 1, 1.5, 2] as const;

/**
 * Format seconds into MM:SS display string.
 */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function RecordingPlayer({ audioUrl, transcript, onTimeUpdate }: RecordingPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  // ── Audio element event listeners ─────────────────────────────────────

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      onTimeUpdate?.(audio.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [onTimeUpdate]);

  // ── Sync playback rate with audio element ─────────────────────────────

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // ── Controls ──────────────────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const time = Number(e.target.value);
    audio.currentTime = time;
    setCurrentTime(time);
  }, []);

  const jumpToTime = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setCurrentTime(seconds);
    if (audio.paused) {
      audio.play();
    }
  }, []);

  // ── Find the currently-active transcript line ─────────────────────────

  const activeLineIndex = transcript?.findIndex(
    (line) => currentTime >= line.startSeconds && currentTime < line.endSeconds,
  ) ?? -1;

  // Scroll the active transcript line into view
  useEffect(() => {
    if (activeLineIndex < 0 || !transcriptContainerRef.current) return;
    const lineEl = transcriptContainerRef.current.children[activeLineIndex] as HTMLElement | undefined;
    lineEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeLineIndex]);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Hidden audio element */}
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      {/* Player controls */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          {/* Play / Pause */}
          <button
            onClick={togglePlay}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
          </button>

          {/* Time + Seek bar */}
          <div className="flex flex-1 flex-col gap-1">
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              className="w-full h-1.5 cursor-pointer accent-blue-600"
            />
            <div className="flex items-center justify-between text-xs text-gray-500 font-mono tabular-nums">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Volume icon (decorative indicator) */}
          <Volume2 className="h-4 w-4 shrink-0 text-gray-400" />
        </div>

        {/* Speed controls */}
        <div className="mt-3 flex items-center gap-2">
          <FastForward className="h-4 w-4 text-gray-400" />
          <span className="text-xs text-gray-500">Speed:</span>
          <div className="flex gap-1">
            {SPEED_OPTIONS.map((speed) => (
              <button
                key={speed}
                onClick={() => setPlaybackRate(speed)}
                className={cn(
                  'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                  playbackRate === speed
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                )}
              >
                {speed}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Transcript (when available) */}
      {transcript && transcript.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-2">
            <h3 className="text-sm font-medium text-gray-700">Transcript</h3>
          </div>
          <div
            ref={transcriptContainerRef}
            className="max-h-64 overflow-y-auto divide-y divide-gray-50"
          >
            {transcript.map((line, idx) => (
              <button
                key={`${line.startSeconds}-${idx}`}
                onClick={() => jumpToTime(line.startSeconds)}
                className={cn(
                  'flex w-full gap-3 px-4 py-2 text-left transition-colors hover:bg-blue-50',
                  idx === activeLineIndex && 'bg-blue-50 ring-1 ring-inset ring-blue-200',
                )}
              >
                <span className="shrink-0 text-xs font-mono text-gray-400 tabular-nums pt-0.5">
                  {formatTime(line.startSeconds)}
                </span>
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-gray-600">{line.speaker}: </span>
                  <span
                    className={cn(
                      'text-sm',
                      idx === activeLineIndex ? 'text-gray-900 font-medium' : 'text-gray-700',
                    )}
                  >
                    {line.text}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
