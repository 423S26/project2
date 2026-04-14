// components/disc-actions/TrackerDisplay.tsx
'use client';

import { useState } from 'react';
import { Battery, ArrowRight } from 'lucide-react';
import DirectionalTrackingOverlay from './DirectionalTrackingOverlay';
import { DistanceUnit } from './types';

type Props = {
  distance: number;       // always in feet from parent
  unit?: DistanceUnit;    // 'feet' | 'meters'
};

export default function TrackerDisplay({ distance, unit = 'feet' }: Props) {
  const displayedDistance = unit === 'meters' 
    ? (distance * 0.3048).toFixed(1) 
    : distance.toFixed(0);
  
  const label = unit === 'meters' ? 'm' : 'ft';

  // ──────────────────────────────────────────────────────────────
  // Battery Level
  // TODO (Backend/Hardware): Replace static batteryLevel with real data from disc tracker
  // Integration points:
  // - Telemetry upload response: { battery_level: 87 }
  // - Capacitor plugin (for native iOS/Android) listening to device events
  // - Update frequency: every 10-30 seconds or on change
  // ──────────────────────────────────────────────────────────────
  const batteryLevel = 87;

  const [showDirectionalOverlay, setShowDirectionalOverlay] = useState(false);

  return (
    <>
      <div className="mt-10 mb-12 flex flex-col items-center">
        {/* Main Distance Circle */}
        <div className="relative w-[75%] aspect-square max-w-70 rounded-full bg-[#764d9f] flex flex-col items-center justify-center shadow-2xl ring-2 ring-[#764d9f]/30">
          
          {/* Large Distance Number */}
          <span className="text-5xl md:text-6xl font-extrabold text-white tracking-tight">
            {displayedDistance}
          </span>

          {/* Unit (ft / m) - now INSIDE the circle, directly below distance */}
          <span className="text-2xl font-medium text-white/90 mt-1">
            {label}
          </span>

          {/* Battery Indicator - inside circle, bottom */}
          <div className="absolute bottom-8 flex items-center gap-2 text-white/90">
            <Battery size={22} className="text-[#54c4c3]" />
            <span className="text-lg font-medium">{batteryLevel}%</span>
          </div>
        </div>

        {/* Directional Tracking Button - below the circle */}
        <button
          onClick={() => setShowDirectionalOverlay(true)}
          className="mt-8 flex items-center gap-3 bg-[#223066] hover:bg-[#2a3b7a] border border-[#456fb6]/60 text-white px-8 py-4 rounded-2xl transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg"
        >
          <ArrowRight size={24} className="text-[#54c4c3]" />
          <span className="font-medium text-lg">Directional Tracking</span>
        </button>
      </div>

      {/* Directional Tracking Overlay */}
      <DirectionalTrackingOverlay
        isOpen={showDirectionalOverlay}
        onClose={() => setShowDirectionalOverlay(false)}
        distance={distance}
        unit={unit}
        // TODO (Backend/Hardware): Pass real-time heading or direction data if available
        // For true directional tracking, send current compass bearing or relative disc direction
        // Example: x,y quartant data (NE, NW, SE, SW) or degree heading (0-360°) to rotate the arrow accordingly
      />
    </>
  );
}