// components/disc-actions/Accelerometer.tsx
'use client';

import { useState, useEffect, useRef } from 'react';

type Props = {
  isRunning: boolean;
  elapsedTime: number;
  onStartAction: () => void;
  onStopAction: () => void;
  onResetAction: () => void;
};

export default function Accelerometer({
  isRunning,
  elapsedTime,
  onStartAction,
  onStopAction,
  onResetAction: _onResetAction,
}: Props) {
  const [speed, setSpeed] = useState<number>(0);
  const velocityRef = useRef<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });
  const lastTimestampRef = useRef<number | null>(null);

  // Use DeviceMotion API to detect real acceleration and derive speed
  useEffect(() => {
    const handler = (event: DeviceMotionEvent) => {
      const accel = event.accelerationIncludingGravity ?? event.acceleration;
      if (!accel || accel.x == null || accel.y == null || accel.z == null) return;

      const now = event.timeStamp ?? performance.now();
      if (lastTimestampRef.current !== null) {
        const dt = (now - lastTimestampRef.current) / 1000; // seconds
        if (dt > 0 && dt < 1) {
          // Subtract ~gravity (9.81 m/s²) from z-axis assuming phone is upright
          const ax = accel.x;
          const ay = accel.y;
          const az = (accel.z ?? 0) - 9.81;

          velocityRef.current.x += ax * dt;
          velocityRef.current.y += ay * dt;
          velocityRef.current.z += az * dt;

          const totalSpeedMs = Math.sqrt(
            velocityRef.current.x ** 2 +
            velocityRef.current.y ** 2 +
            velocityRef.current.z ** 2,
          );
          const mph = totalSpeedMs * 2.23694;
          setSpeed(mph);

          // Apply friction/damping to prevent drift when device is stationary
          const damping = 0.95;
          velocityRef.current.x *= damping;
          velocityRef.current.y *= damping;
          velocityRef.current.z *= damping;
        }
      }
      lastTimestampRef.current = now;
    };

    window.addEventListener('devicemotion', handler);
    return () => {
      window.removeEventListener('devicemotion', handler);
    };
  }, []);

  // Auto-start timer when speed exceeds 10 mph (placeholder – real data will trigger this)
  useEffect(() => {
    if (speed > 10 && !isRunning) {
      onStartAction();
    }
  }, [speed, isRunning, onStartAction]);

  return (
    <div className="bg-[#190f2A]/80 backdrop-blur border border-[#456fb6]/40 rounded-xl p-5 shadow-lg">
      <div className="text-center mb-4">
        <div className="text-4xl md:text-5xl font-mono font-bold text-[#54c4c3] tracking-tight tabular-nums">
          {elapsedTime.toFixed(2)} <span className="text-xl text-white/70">s</span>
        </div>
        <p className="text-sm text-white/60 mt-1">Time of Flight (Auto)</p>
      </div>

      {/* Status message */}
      <div className="text-center mb-6">
        {!isRunning ? (
          <p className="text-base text-white/70 font-medium">
            Awaiting throw to exceed 10 mph...
          </p>
        ) : (
          <p className="text-base text-[#54c4c3] font-medium">
            Throw in progress • Current speed: <span className="tabular-nums">{speed.toFixed(1)}</span> mph
          </p>
        )}
      </div>

      {/* Controls – only Stop button remains (manual override) */}
      <div className="flex justify-center gap-4">
        {isRunning && (
          <button
            onClick={onStopAction}
            className="flex-1 bg-red-600 text-white font-medium py-3 px-6 rounded-lg hover:bg-red-700 transition touch-manipulation"
          >
            Stop
          </button>
        )}

        {/* Reset button removed as requested – can be re-added later if needed */}
      </div>
    </div>
  );
}