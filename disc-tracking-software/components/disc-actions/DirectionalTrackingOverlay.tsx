// components/disc-actions/DirectionalTrackingOverlay.tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { DistanceUnit } from './types';
import { Ping } from '@/lib/pb/hardware';
import {
  usePhoneSensors,
  haversineMeters,
  bearingDegrees,
} from '@/lib/phone-sensors';

// ──────────────────────────────────────────────────────────────
// Tuning constants
// ──────────────────────────────────────────────────────────────
const ARROW_TICK_MS              = 100;   // arrow refresh cadence
const RSSI_STATIONARY_SPEED_MPS  = 1.0;   // below this we MA-filter RSSI
const RSSI_MA_WINDOW             = 5;
const RSSI_NEAR_DBM              = -40;   // close-range anchor for circle scale
const RSSI_SCALE_PER_DBM         = 0.03;  // px-of-radius per dBm past anchor
const RSSI_MIN_SCALE             = 1.0;
const RSSI_MAX_SCALE             = 2.5;
const DEGPS_PER_RPM              = 6;
const RPM_NOISE_FLOOR            = 5;     // both device + phone share this gate
const FEET_TO_METERS             = 0.3048;

type Props = {
  isOpen: boolean;
  onCloseAction: () => void;
  distance: number;
  unit?: DistanceUnit;
  discLat?: number;
  discLon?: number;
  currentPing?: Ping | null;
  rssi?: number | null;
};

export default function DirectionalTrackingOverlay({
  isOpen,
  onCloseAction,
  distance,
  unit = 'feet',
  discLat,
  discLon,
  currentPing,
  rssi,
}: Props) {
  const [rotation, setRotation] = useState(0);
  const [hasRealData, setHasRealData] = useState(false);
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [filteredRssi, setFilteredRssi] = useState<number | null>(null);

  // The singleton phone-sensor manager already publishes GPS + compass +
  // motion at ~30 Hz, so we just consume it here instead of registering
  // overlay-local listeners.  This also gives us the live drift indicator
  // without any extra plumbing.
  const phoneSnap = usePhoneSensors();
  const rssiDataQueueRef = useRef<number[]>([]);

  // ── Calibration anchor ───────────────────────────────────────
  // The user opens this overlay with the disc in front of them, so the
  // first valid (phone GPS + disc GPS + compass) sample defines the
  // "forward / 0°" reference.  Every subsequent rotation is rendered
  // relative to that anchor, which means the arrow starts at the top
  // and tracks accurately even when the phone's compass is uncalibrated
  // (a common Web Bluetooth pain point).
  const calibrationOffsetRef = useRef<number | null>(null);

  // Latest inputs mirrored into refs so the steady-cadence ticker reads
  // fresh values without re-binding the interval every frame.
  const phoneGpsRef = useRef(phoneSnap.gps);
  const compassRef = useRef(phoneSnap.orientation?.compass ?? null);
  const discPosRef = useRef<{ lat: number; lon: number } | null>(null);
  useEffect(() => { phoneGpsRef.current = phoneSnap.gps; }, [phoneSnap.gps]);
  useEffect(() => { compassRef.current = phoneSnap.orientation?.compass ?? null; }, [phoneSnap.orientation]);
  useEffect(() => {
    discPosRef.current = (discLat != null && discLon != null && (discLat !== 0 || discLon !== 0))
      ? { lat: discLat, lon: discLon }
      : null;
  }, [discLat, discLon]);

  /**
   * Returns the current absolute relative bearing (phone→disc minus phone
   * compass), or null if any input is missing.  Compass falls back to 0
   * when the device hasn't granted DeviceOrientation permission — in
   * that case the calibration anchor still produces a stable forward
   * direction as long as the phone doesn't rotate.
   */
  const computeRawRelative = useCallback((): number | null => {
    const phoneGps = phoneGpsRef.current;
    const discPos = discPosRef.current;
    if (!phoneGps || !discPos) return null;
    const bearing = bearingDegrees(phoneGps.lat, phoneGps.lon, discPos.lat, discPos.lon);
    const compass = compassRef.current ?? 0;
    return (bearing - compass + 360) % 360;
  }, []);

  /** User-driven recalibrate: lock the current relative bearing as zero. */
  const recalibrate = useCallback(() => {
    const rel = computeRawRelative();
    if (rel !== null) {
      calibrationOffsetRef.current = rel;
      setIsCalibrated(true);
      setRotation(0);
    } else {
      // No valid sample yet — clear so the next valid one becomes zero.
      calibrationOffsetRef.current = null;
      setIsCalibrated(false);
      setRotation(0);
    }
  }, [computeRawRelative]);

  // Reset calibration whenever the overlay is closed so a fresh open
  // re-anchors on the new device-in-front pose.
  useEffect(() => {
    if (!isOpen) {
      calibrationOffsetRef.current = null;
      setIsCalibrated(false);
      setHasRealData(false);
      setRotation(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || rssi === null || rssi === undefined) return;

    // Moving Average Filter if stationary
    const speed = currentPing ? currentPing.speedMps : 0;
    const isStationary = speed <= RSSI_STATIONARY_SPEED_MPS;

    if (isStationary) {
      rssiDataQueueRef.current.push(rssi);
      if (rssiDataQueueRef.current.length > RSSI_MA_WINDOW) {
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

    const tickInterval = setInterval(() => {
      const rel = computeRawRelative();
      if (rel === null) {
        // No valid fix yet — keep the arrow pinned forward (top) instead
        // of spinning, so the visual matches the "device assumed in
        // front" calibration contract.
        return;
      }
      // First valid sample becomes the zero anchor.
      if (calibrationOffsetRef.current === null) {
        calibrationOffsetRef.current = rel;
        setIsCalibrated(true);
      }
      const offset = calibrationOffsetRef.current;
      const display = ((rel - offset) + 360) % 360;
      setRotation(display);
      setHasRealData(true);
    }, ARROW_TICK_MS);

    return () => clearInterval(tickInterval);
  }, [isOpen, computeRawRelative]);

  const displayedDistance = unit === 'feet'
    ? (distance * (1 / FEET_TO_METERS)).toFixed(0)
    : distance.toFixed(1);

  const label = unit === 'feet' ? 'ft' : 'm';

  // Calculate RSSI mapping: at RSSI_NEAR_DBM (close) -> RSSI_MIN_SCALE,
  // weaker signal -> larger uncertainty radius up to RSSI_MAX_SCALE.
  const rssiScale = filteredRssi !== null
    ? Math.min(
        RSSI_MAX_SCALE,
        Math.max(
          RSSI_MIN_SCALE,
          (-filteredRssi - -RSSI_NEAR_DBM) * RSSI_SCALE_PER_DBM + RSSI_MIN_SCALE,
        ),
      )
    : 1;

  // IMU Rotation Logic.  The demo device's onboard IMU is dead, so the
  // BLE gyroZ is essentially zero — fall back to the phone's rotation
  // rate magnitude as a "how violently is the rig moving" proxy.
  const deviceRpm = currentPing ? Math.abs(currentPing.gyroZ) / DEGPS_PER_RPM : 0;
  const phoneRpm = phoneSnap.motion ? phoneSnap.motion.rotMagnitude / DEGPS_PER_RPM : 0;
  const rpm = deviceRpm > RPM_NOISE_FLOOR ? deviceRpm : phoneRpm;
  const isSpinning = rpm > RPM_NOISE_FLOOR;
  const discTiltClass = isSpinning ? "animate-spin-fast scale-105" : "";

  // Live drift indicator: distance between the phone and the disc, plus
  // the bearing from phone → disc.  Used both for the Δ badge and the
  // tiny mini-map below the rotating arrow.
  const hasDiscPosition =
    discLat != null && discLon != null && (discLat !== 0 || discLon !== 0);
  const driftMeters =
    phoneSnap.gps && hasDiscPosition
      ? haversineMeters(phoneSnap.gps.lat, phoneSnap.gps.lon, discLat!, discLon!)
      : null;

  if (!isOpen) return null;

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/90 backdrop-blur-xl z-70" 
        onClick={onCloseAction} 
      />

      <div className="fixed inset-0 z-80 flex items-center justify-center p-4">
        <div className="bg-[#190f2A] w-full max-w-md rounded-3xl border border-[#456fb6]/40 shadow-2xl overflow-hidden">
          
          {/* Header - Centered Text, No X Button */}
          <div className="p-6 border-b border-[#223066] flex items-center justify-center relative">
            <h2 className="text-2xl font-semibold text-[#54c4c3]">
              Directional Tracking
            </h2>
            {/* ∆-distance badge — phone-to-disc separation in meters. Shows */}
            {/* live so the operator can sanity-check the GPS fix before they */}
            {/* throw.  Hidden when either fix is missing.                      */}
            {driftMeters !== null && (
              <div
                className="absolute right-4 top-1/2 -translate-y-1/2 px-3 py-1 rounded-full bg-[#223066]/80 border border-[#456fb6]/60 text-xs font-mono text-[#54c4c3]"
                title="Phone↔Disc GPS separation"
              >
                Δ {driftMeters < 1 ? driftMeters.toFixed(2) : driftMeters.toFixed(1)} m
              </div>
            )}
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
              {isSpinning
                ? `Spinning at ${Math.round(rpm)} RPM`
                : hasRealData
                  ? (isCalibrated ? 'Arrow leads to disc' : 'Calibrating…')
                  : 'Searching for disc fix…'}
            </p>
            {filteredRssi !== null && (
              <p className="text-center text-[#ff4e50]/80 mt-1 text-sm">
                Uncertainty Radius (RSSI: {Math.round(filteredRssi)})
              </p>
            )}

            {/* ── Drift mini-map ──                                            */}
            {/* Two markers (phone = orange, disc = cyan) connected by a       */}
            {/* dashed line whose length is proportional to the phone↔disc    */}
            {/* GPS separation.  This is the Tier-B "are the two fixes        */}
            {/* drifting?" indicator the user requested.  Pure SVG, no map     */}
            {/* tiles, no Leaflet — stays cheap on the demo phone.            */}
            {phoneSnap.gps && hasDiscPosition && driftMeters !== null && (
              <DriftMiniMap
                phoneLat={phoneSnap.gps.lat}
                phoneLon={phoneSnap.gps.lon}
                discLat={discLat!}
                discLon={discLon!}
                meters={driftMeters}
              />
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-[#223066] flex flex-col gap-3">
            <button
              onClick={recalibrate}
              className="w-full py-3 bg-[#223066] hover:bg-[#2c3f7a] text-[#54c4c3] rounded-2xl transition font-medium border border-[#456fb6]/40"
              title="Lock the current direction as 'forward' (device in front of phone)."
            >
              Recalibrate Forward
            </button>
            <button
              onClick={onCloseAction}
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

// ──────────────────────────── Drift mini-map ────────────────────────────
//
// Renders the phone (orange) and the disc (cyan) on a small relative
// canvas with the phone always centred.  The disc dot moves around the
// phone according to the bearing + distance, so the user can eyeball
// whether the two GPS fixes are tracking each other or drifting apart.
//
// Distances scale logarithmically so a 0.5 m drift is still visible when
// the disc is 60 m away.

type DriftMiniMapProps = {
  phoneLat: number;
  phoneLon: number;
  discLat: number;
  discLon: number;
  meters: number;
};

function DriftMiniMap({ phoneLat, phoneLon, discLat, discLon, meters }: DriftMiniMapProps) {
  const SIZE = 120;
  const CENTER = SIZE / 2;
  const MAX_RADIUS = SIZE / 2 - 12;

  // Bearing phone → disc, then convert to SVG coords (north = up, +y down).
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLon = toRad(discLon - phoneLon);
  const y = Math.sin(dLon) * Math.cos(toRad(discLat));
  const x =
    Math.cos(toRad(phoneLat)) * Math.sin(toRad(discLat)) -
    Math.sin(toRad(phoneLat)) * Math.cos(toRad(discLat)) * Math.cos(dLon);
  const bearingRad = Math.atan2(y, x); // [-π, π], 0 = north

  // Log scale: 0 m → 0 px, 1 m → ~⅓ radius, 30 m → full radius.
  const r = meters <= 0
    ? 0
    : Math.min(MAX_RADIUS, (Math.log10(meters + 1) / Math.log10(31)) * MAX_RADIUS);

  const discX = CENTER + r * Math.sin(bearingRad);
  const discY = CENTER - r * Math.cos(bearingRad);

  return (
    <div className="mt-4 flex flex-col items-center">
      <svg width={SIZE} height={SIZE} className="rounded-full bg-[#0d0820]/60 border border-[#456fb6]/30">
        {/* concentric range rings (1 m, 10 m, full) */}
        <circle cx={CENTER} cy={CENTER} r={MAX_RADIUS} fill="none" stroke="#456fb6" strokeOpacity={0.25} strokeWidth={1} />
        <circle cx={CENTER} cy={CENTER} r={MAX_RADIUS * (Math.log10(11) / Math.log10(31))} fill="none" stroke="#456fb6" strokeOpacity={0.15} strokeWidth={1} strokeDasharray="2 3" />
        <circle cx={CENTER} cy={CENTER} r={MAX_RADIUS * (Math.log10(2) / Math.log10(31))} fill="none" stroke="#456fb6" strokeOpacity={0.1} strokeWidth={1} strokeDasharray="2 3" />
        {/* north tick */}
        <line x1={CENTER} y1={4} x2={CENTER} y2={10} stroke="#54c4c3" strokeOpacity={0.5} strokeWidth={1} />
        <text x={CENTER} y={3} textAnchor="middle" fontSize="8" fill="#54c4c3" fillOpacity={0.7}>N</text>
        {/* drift line */}
        <line
          x1={CENTER}
          y1={CENTER}
          x2={discX}
          y2={discY}
          stroke="#54c4c3"
          strokeOpacity={0.5}
          strokeWidth={1.5}
          strokeDasharray="3 3"
        />
        {/* phone marker (centre) */}
        <circle cx={CENTER} cy={CENTER} r={5} fill="#ff8a3d" stroke="#fff" strokeWidth={1} />
        {/* disc marker */}
        <circle cx={discX} cy={discY} r={5} fill="#54c4c3" stroke="#fff" strokeWidth={1} />
      </svg>
      <div className="mt-1 flex items-center gap-3 text-[10px] font-mono text-white/60">
        <span><span className="inline-block w-2 h-2 rounded-full bg-[#ff8a3d] mr-1" />phone</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-[#54c4c3] mr-1" />disc</span>
      </div>
    </div>
  );
}