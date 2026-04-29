// components/disc-actions/DirectionalTrackingOverlay.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { DistanceUnit } from './types';
import { Ping } from '@/lib/pb/hardware';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  distance: number;
  unit?: DistanceUnit;
  discLat?: number;
  discLon?: number;
  currentPing?: Ping | null;
  rssi?: number | null;
};

/** Calculate bearing in degrees from point A to point B */
function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export default function DirectionalTrackingOverlay({ 
  isOpen, 
  onClose, 
  distance, 
  unit = 'feet',
  discLat,
  discLon,
  currentPing,
  rssi,
}: Props) {
  const [rotation, setRotation] = useState(0);
  const [hasRealData, setHasRealData] = useState(false);
  const [filteredRssi, setFilteredRssi] = useState<number | null>(null);

  const phonePosRef = useRef<{ lat: number; lon: number } | null>(null);
  const compassRef = useRef<number>(0);
  const watchIdRef = useRef<number | null>(null);
  const rssiDataQueueRef = useRef<number[]>([]);

  useEffect(() => {
    if (!isOpen || rssi === null || rssi === undefined) return;

    // Moving Average Filter if stationary
    const speed = currentPing ? currentPing.speedMps : 0;
    const isStationary = speed <= 1.0;

    if (isStationary) {
      rssiDataQueueRef.current.push(rssi);
      if (rssiDataQueueRef.current.length > 5) {
        rssiDataQueueRef.current.shift();
      }
      
      const sum = rssiDataQueueRef.current.reduce((a, b) => a + b, 0);
      setFilteredRssi(sum / rssiDataQueueRef.current.length);
    } else {
      // Direct pass-through
      setFilteredRssi(rssi);
      rssiDataQueueRef.current = [];
    }
  }, [rssi, currentPing, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const hasDiscPosition = discLat != null && discLon != null && (discLat !== 0 || discLon !== 0);

    // Listen for phone compass heading via DeviceOrientation API. On devices
    // without a compass (e.g. desktop Chrome) these events simply never fire
    // and `compassRef.current` stays 0, which means the arrow points to true
    // north — the geographic bearing toward the disc.
    const handleOrientation = (event: DeviceOrientationEvent) => {
      const webkitHeading = (event as unknown as Record<string, unknown>).webkitCompassHeading;
      let heading: number;
      if (typeof webkitHeading === 'number') {
        heading = webkitHeading;
      } else if (event.alpha != null) {
        heading = (360 - event.alpha + 360) % 360;
      } else {
        return;
      }
      compassRef.current = heading;
    };

    window.addEventListener('deviceorientationabsolute', handleOrientation as EventListener);
    window.addEventListener('deviceorientation', handleOrientation as EventListener);

    // Always track the phone / computer geolocation while the overlay is open.
    // This works on desktop Chrome (IP-based or Wi-Fi-based fix) and on mobile.
    if ('geolocation' in navigator) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          phonePosRef.current = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        },
        (err) => console.warn('[DirectionalTracking] geolocation error:', err.message),
        { enableHighAccuracy: true, maximumAge: 2000 },
      );
    }

    // Recompute the arrow rotation at a steady cadence, decoupled from
    // orientation events. As soon as both phone and disc have a fix, the
    // arrow latches onto the real bearing — even with no compass.
    const tickInterval = setInterval(() => {
      if (hasDiscPosition && phonePosRef.current) {
        const bearing = calculateBearing(
          phonePosRef.current.lat,
          phonePosRef.current.lon,
          discLat!,
          discLon!,
        );
        setRotation((bearing - compassRef.current + 360) % 360);
        setHasRealData(true);
      } else {
        // No fix yet — gentle spin so the user knows we're still looking.
        setRotation((prev) => (prev + 5) % 360);
      }
    }, 100);

    return () => {
      window.removeEventListener('deviceorientationabsolute', handleOrientation as EventListener);
      window.removeEventListener('deviceorientation', handleOrientation as EventListener);
      clearInterval(tickInterval);
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [isOpen, discLat, discLon]);

  const displayedDistance = unit === 'meters' 
    ? (distance * 0.3048).toFixed(1) 
    : distance.toFixed(0);
  
  const label = unit === 'meters' ? 'm' : 'ft';

  // Calculate RSSI mapping: e.g. -40 (close) -> scale 1.0, -100 (far) -> scale 2.5
  // Used to visualize uncertainty/probability circle
  const rssiScale = filteredRssi !== null ? Math.min(2.5, Math.max(1.0, (-filteredRssi - 40) * 0.03 + 1)) : 1;

  // IMU Rotation Logic
  const rpm = currentPing ? Math.abs(currentPing.gyroZ) / 6 : 0;
  const isSpinning = rpm > 5;
  const discTiltClass = isSpinning ? "animate-spin-fast scale-105" : "";

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
              
              {/* Variable size Probability Circle generated by RSSI */}
              {filteredRssi !== null && (
                <div 
                  className="absolute w-75 h-75 rounded-full border-2 border-dashed border-[#ff4e50]/40 transition-all duration-300 ease-in-out" 
                  style={{ transform: `scale(${rssiScale})` }} 
                />
              )}

              {/* Orbit path ring */}
              <div className="absolute w-75 h-75 rounded-full border border-[#54c4c3]/30" />

              {/* Rotating Arrow Container */}
              <div 
                className="absolute w-full h-full transition-transform duration-75 ease-linear"
                style={{ transform: `rotate(${rotation}deg)` }}
              >
                {/* Arrow / Disc positional UI */}
                <div 
                  className={`absolute left-1/2 -top-5.5 -translate-x-1/2 transition-transform duration-200 ${discTiltClass}`}
                  style={{ transform: 'rotate(90deg)' }}
                >
                  <svg 
                    width={isSpinning ? "64" : "58"} 
                    height={isSpinning ? "64" : "58"} 
                    viewBox="0 0 24 24" 
                    fill={isSpinning ? "#764d9f" : "none"} 
                    stroke={isSpinning ? "rgba(255,255,255,0.8)" : "#54c4c3"} 
                    strokeWidth={isSpinning ? "1.5" : "3"} 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                    className="drop-shadow-2xl"
                  >
                    <path d={isSpinning ? "M12 2a10 10 0 1 0 10 10A10.01 10.01 0 0 0 12 2Z M12 6a6 6 0 1 0 6 6A6.006 6.006 0 0 0 12 6Z" : "M12 19l-7-7 7-7 M19 12H5"} />
                  </svg>
                </div>
              </div>
            </div>

            <p className="text-center text-white/70 mt-20 text-lg font-medium">
              {isSpinning ? `Spinning at ${Math.round(rpm)} RPM` : "Arrow leads to disc"}
            </p>
            {filteredRssi !== null && (
              <p className="text-center text-[#ff4e50]/80 mt-1 text-sm">
                Uncertainty Radius (RSSI: {Math.round(filteredRssi)})
              </p>
            )}
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