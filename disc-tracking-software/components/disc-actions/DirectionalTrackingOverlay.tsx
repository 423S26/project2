// components/disc-actions/DirectionalTrackingOverlay.tsx

// TODO (Backend/Hardware): Replace simulated rotation with real GPS/compass data
// Integration options:
// 1. DeviceOrientation API (browser): window.addEventListener('deviceorientation', ...)
//    Use event.alpha or event.webkitCompassHeading for true north-based direction
// 2. Web Bluetooth from disc tracker: Receive heading updates via GATT characteristic
// 3. Capacitor plugin (native): Use @capacitor/geolocation or custom plugin for heading
// 4. WebSocket from server: Server can fuse GPS + IMU data and push { heading: 42 } (degrees)
// 
// Example real implementation sketch:
// useEffect(() => {
//   const handleOrientation = (event: DeviceOrientationEvent) => {
//     const heading = event.alpha ?? event.webkitCompassHeading ?? 0;
//     setRotation(heading); // or calculate relative to disc position
//   };
//   window.addEventListener('deviceorientation', handleOrientation);
//   return () => window.removeEventListener('deviceorientation', handleOrientation);
// }, []);
'use client';

import { useState, useEffect } from 'react';
import { DistanceUnit } from './types';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  distance: number;
  unit?: DistanceUnit;
};

export default function DirectionalTrackingOverlay({ 
  isOpen, 
  onClose, 
  distance, 
  unit = 'feet' 
}: Props) {
  const [rotation, setRotation] = useState(0);

  // Smooth continuous rotation
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      setRotation(prev => (prev + 5) % 360);
    }, 70);

    return () => clearInterval(interval);
  }, [isOpen]);

  const displayedDistance = unit === 'meters' 
    ? (distance * 0.3048).toFixed(1) 
    : distance.toFixed(0);
  
  const label = unit === 'meters' ? 'm' : 'ft';

  if (!isOpen) return null;

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/90 backdrop-blur-xl z-70" 
        onClick={onClose} 
      />

      <div className="fixed inset-0 z-80 flex items-center justify-center p-4">
        <div className="bg-[#190f2A] w-full max-w-md rounded-3xl border border-[#456fb6]/40 shadow-2xl overflow-hidden">
          
          {/* Header - Centered Text, No X Button */}
          <div className="p-6 border-b border-[#223066] flex items-center justify-center">
            <h2 className="text-2xl font-semibold text-[#54c4c3]">
              Directional Tracking
            </h2>
          </div>

          {/* Main Visual Area */}
          <div className="p-10 flex flex-col items-center relative">
            
            {/* Distance Circle - shifted down 5px */}
            <div className="relative w-65 aspect-square rounded-full bg-[#764d9f] flex flex-col items-center justify-center shadow-2xl ring-2 ring-[#764d9f]/40 translate-y-4 z-10">
              <span className="text-6xl font-extrabold text-white tracking-tight">
                {displayedDistance}
              </span>
              <span className="text-3xl font-medium text-white/90 mt-2">
                {label}
              </span>
            </div>

            {/* Rotating Orbit + Arrow - shifted down 30px, sits over distance circle */}
            <div className="absolute -mt-11.25 w-85 h-85 flex items-center justify-center z-20 pointer-events-none translate-y-5.25">
              
              {/* Orbit path ring */}
              <div className="absolute w-75 h-75 rounded-full border border-[#54c4c3]/30" />

              {/* Rotating Arrow Container */}
              <div 
                className="absolute w-full h-full transition-transform duration-75 ease-linear"
                style={{ transform: `rotate(${rotation}deg)` }}
              >
                {/* Arrow positioned at the edge, rotated 90° clockwise */}
                <div 
                  className="absolute left-1/2 -top-5.5 -translate-x-1/2"
                  style={{ transform: 'rotate(90deg)' }}
                >
                  <svg 
                    width="58" 
                    height="58" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="#54c4c3" 
                    strokeWidth="3" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                    className="drop-shadow-2xl"
                  >
                    <path d="M12 19l-7-7 7-7" />
                    <path d="M19 12H5" />
                  </svg>
                </div>
              </div>
            </div>

            <p className="text-center text-white/70 mt-20 text-lg font-medium">
              Arrow leads to disc
            </p>
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-[#223066]">
            <button
              onClick={onClose}
              className="w-full py-4 bg-gray-700 hover:bg-gray-600 text-white rounded-2xl transition font-medium"
            >
              Close Directional View
            </button>
          </div>
        </div>
      </div>
    </>
  );
}