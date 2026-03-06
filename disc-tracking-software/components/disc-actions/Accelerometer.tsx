// components/disc-actions/Accelerometer.tsx
'use client';

import { useState, useEffect } from 'react';

type Props = {
  isRunning: boolean;
  elapsedTime: number;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
};

export default function Accelerometer({
  isRunning,
  elapsedTime,
  onStart,
  onStop,
  onReset,
}: Props) {
  // In real implementation, this would be the current speed from accelerometer/gyro data
  // For now it's static at 0 mph (no simulation)
  const [speed, setSpeed] = useState<number>(0);

  // Placeholder for real accelerometer logic (to be added later)
  useEffect(() => {
    // === FUTURE HARDWARE INTEGRATION POINT ===

    // Option 1: Web Sensors API (DeviceMotionEvent) - most browsers support this
    // const handleMotion = (event: DeviceMotionEvent) => {
    //   const acc = event.accelerationIncludingGravity;
    //   if (acc?.x && acc?.y && acc?.z) {
    //     const magnitude = Math.sqrt(acc.x**2 + acc.y**2 + acc.z**2);
    //     const speedMps = magnitude; // rough speed estimate (needs calibration/filtering)
    //     const speedMph = speedMps * 2.23694; // m/s → mph
    //     setSpeed(speedMph);
    //   }
    // };
    // window.addEventListener('devicemotion', handleMotion);
    // return () => window.removeEventListener('devicemotion', handleMotion);

    // Option 2: Web Bluetooth (for custom disc tracker hardware)
    // async function connectBluetooth() {
    //   try {
    //     const device = await navigator.bluetooth.requestDevice({
    //       filters: [{ services: ['your-custom-service-uuid'] }],
    //     });
    //     const server = await device.gatt?.connect();
    //     // ... get characteristic and listen for acceleration data ...
    //   } catch (err) {
    //     console.error('Bluetooth connection failed:', err);
    //   }
    // }

    // Option 3: Native bridge (Capacitor, React Native, etc.) for mobile apps
    // Capacitor.Plugins.Accelerometer.addListener((data) => {
    //   // process data.acceleration.x/y/z
    // });

    // For now: static 0 mph (no changes)
  }, []);

  // Auto-start timer when speed exceeds 10 mph (placeholder – real data will trigger this)
  useEffect(() => {
    if (speed > 10 && !isRunning) {
      onStart();
    }
  }, [speed, isRunning, onStart]);

  return (
    <div className="bg-[#190f2A]/80 backdrop-blur border border-[#456fb6]/40 rounded-xl p-5 shadow-lg">
      <div className="text-center mb-4">
        <div className="text-4xl md:text-5xl font-mono font-bold text-[#54c4c3] tracking-tight">
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
            Throw in progress • Current speed: {speed.toFixed(1)} mph
          </p>
        )}
      </div>

      {/* Controls – only Stop button remains (manual override) */}
      <div className="flex justify-center gap-4">
        {isRunning && (
          <button
            onClick={onStop}
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