// components/disc-actions/TrackerDisplay.tsx
'use client';

import { DistanceUnit } from './types';

// ──────────────────────────────────────────────────────────────
// TrackerDisplay – shows current live distance from synced disc tracker
// Currently displays static/fake distance passed from parent
// Backend/Hardware integration: replace static distance with real-time data
// ──────────────────────────────────────────────────────────────

type Props = {
  distance: number;       // always in feet (from parent sync)
  unit?: DistanceUnit;    // user preference ('feet' | 'meters')
};

export default function TrackerDisplay({ distance, unit = 'feet' }: Props) {
  // Convert feet to meters if user prefers metric
  const displayedDistance = unit === 'meters' ? (distance * 0.3048).toFixed(1) : distance.toFixed(0);
  const label = unit === 'meters' ? 'm' : 'ft';

  return (
    <div className="mt-10 mb-12 flex flex-col items-center">
      <div className="relative w-[75%] aspect-square max-w-45 rounded-full bg-[#764d9f] flex items-center justify-center shadow-2xl ring-2 ring-[#764d9f]/30">
        <span className="text-5xl md:text-6xl font-extrabold text-white tracking-tight">
          {displayedDistance}
        </span>
      </div>
      <p className="mt-3 text-white/90 text-base md:text-lg font-medium">
        {label}
      </p>

      {/* TODO (Backend/Hardware): Real-time distance integration */}
      {/* 
        Current flow:
        - Parent (DiscActionsDropdown) calls handleSync() → fake 285 ft
        - Pass distance to this component
        
        Replace with: - take suggestions with a grain of salt as your approach may be different based on your backend/hardware setup, but here are some general ideas for real-time integration:
        1. Web Bluetooth / WebSocket / native plugin listener
           - Connect using selectedDisc.connectionNumber
           - Listen for distance updates from hardware
           - Update parent state: setTrackerDistance(realDistanceFeet)
        
        2. API polling (less ideal):
           - setInterval(() => fetch(`/api/trackers/${selectedDisc.id}/distance`), 2000)
           - Update parent state on new value
        
        3. WebSocket (best for live):
           - Connect ws://your-server/ws/trackers/{discId}
           - Server pushes { distance: number } messages
        
        4. Error handling:
           - Show "Not synced" / "Disconnected" state
           - Add loading spinner or last-updated timestamp
        
        5. Unit conversion:
           - Always store/send in feet (imperial base)
           - Convert only for display (here or in parent)
        
        Example WebSocket listener (pseudo):
        useEffect(() => {
          if (!selectedDisc) return;
          const ws = new WebSocket(`ws://your-server/ws/trackers/${selectedDisc.id}`);
          ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            setTrackerDistance(data.distance); // in feet
          };
          return () => ws.close();
        }, [selectedDisc]);
      */}
    </div>
  );
}