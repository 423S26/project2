// components/disc-actions/Stopwatch.tsx
'use client';

import { useState, useEffect, useRef } from 'react';

type Props = {
  isRunning: boolean;
  elapsedTime: number;
  setElapsedTime: React.Dispatch<React.SetStateAction<number>>;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
};

export default function Stopwatch({
  isRunning,
  elapsedTime,
  setElapsedTime,
  onStart,
  onStop,
  onReset,
}: Props) {
  const [delaySeconds, setDelaySeconds] = useState<number>(0);
  const [remainingDelay, setRemainingDelay] = useState<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);

  // Unified display time (negative during delay, positive during flight)
  const [displayTime, setDisplayTime] = useState<number>(0);

  // Track if the timer has ever been started (to hide Start after first use)
  const [hasBeenStarted, setHasBeenStarted] = useState(false);

  useEffect(() => {
    if (!isRunning) return;

    if (!startTimeRef.current) {
      startTimeRef.current = Date.now();
      if (delaySeconds > 0) {
        setRemainingDelay(delaySeconds);
        setDisplayTime(-delaySeconds);
      } else {
        setRemainingDelay(null);
        setDisplayTime(0);
      }
      setHasBeenStarted(true);
    }

    timerRef.current = setInterval(() => {
      const elapsedMs = Date.now() - (startTimeRef.current || Date.now());
      const timeInSeconds = elapsedMs / 1000;

      setDisplayTime(timeInSeconds - delaySeconds);

      if (timeInSeconds >= delaySeconds) {
        setElapsedTime(timeInSeconds - delaySeconds);
      }
    }, 100);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning, delaySeconds, setElapsedTime]);

  const handleStart = () => {
    if (isRunning) return;
    onStart();
  };

  const handleStop = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    startTimeRef.current = null;
    setRemainingDelay(null);
    setDisplayTime(0);
    onStop();
  };

  const handleClear = () => {
    handleStop();
    setElapsedTime(0);
    setDisplayTime(0);
    setHasBeenStarted(false); // Allow Start button to reappear
    onReset();
  };

  const isInDelayPhase = displayTime < 0;
  const formattedTime = Math.abs(displayTime).toFixed(2);

  return (
    <div className="bg-[#190f2A]/80 backdrop-blur border border-[#456fb6]/40 rounded-xl p-5 shadow-lg">
      {/* Timer Display */}
      <div className="text-center mb-4">
        {isInDelayPhase ? (
          <>
            <div className="text-4xl md:text-5xl font-mono font-bold text-yellow-400 tracking-tight">
              {formattedTime} <span className="text-xl text-white/70">s</span>
            </div>
            <p className="text-sm text-white/60 mt-1">Delay countdown...</p>
          </>
        ) : (
          <>
            <div className="text-4xl md:text-5xl font-mono font-bold text-[#54c4c3] tracking-tight">
              {formattedTime} <span className="text-xl text-white/70">s</span>
            </div>
            <p className="text-sm text-white/60 mt-1">Time of Flight</p>
          </>
        )}
      </div>

      {/* Delay Slider with 0 and 10 labels */}
      <div className="mb-6">
        <label className="block text-sm text-white/70 mb-2 text-center">
          Delay before start: {delaySeconds} seconds
        </label>
        <input
          type="range"
          min="0"
          max="10"
          step="1"
          value={delaySeconds}
          onChange={(e) => setDelaySeconds(Number(e.target.value))}
          disabled={isRunning}
          className="
            w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer
            accent-[#54c4c3]
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
            [&::-webkit-slider-thumb]:bg-[#54c4c3] [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md
            [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:bg-[#54c4c3]
            [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:cursor-pointer
          "
        />
        {/* Boundary labels: 0 and 10 */}
        <div className="flex justify-between text-xs text-white/60 mt-1 px-1">
          <span>0 s</span>
          <span>10 s</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex justify-center gap-4">
        {/* Show Start only if never started or after full reset */}
        {!isRunning && !hasBeenStarted && (
          <button
            onClick={handleStart}
            className="flex-1 bg-[#54c4c3] text-black font-medium py-3 px-6 rounded-lg hover:bg-[#3daaa9] transition touch-manipulation"
          >
            Start
          </button>
        )}

        {/* Show Stop while running (delay or timer) */}
        {isRunning && (
          <button
            onClick={handleStop}
            className="flex-1 bg-red-600 text-white font-medium py-3 px-6 rounded-lg hover:bg-red-700 transition touch-manipulation"
          >
            Stop
          </button>
        )}

        {/* Show Clear only after stop */}
        {hasBeenStarted && !isRunning && (
          <button
            onClick={handleClear}
            className="flex-1 bg-gray-700 text-white py-3 px-6 rounded-lg hover:bg-gray-600 transition touch-manipulation"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}