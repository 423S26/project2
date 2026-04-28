'use client';

import { useState, useEffect, useRef } from 'react';
import { useSettings } from '@/contexts/SettingsContext';
import { useDevice } from '@/contexts/DeviceContext';
import DiscSelectorMenu from './DiscSelectorMenu';
import TrackerDisplay from './TrackerDisplay';
import Stopwatch from './Stopwatch';
import Accelerometer from './Accelerometer';
import ThrowResults from './ThrowResults';
import RemoveConfirmPopup from './RemoveConfirmPopup';
import AddDiscPopup from './AddDiscPopup';
import { Disc } from './types';
import { discAPI, throwAPI } from '@/lib/api-client';
import { bleManager } from '@/lib/ble';
import { Ping } from '@/lib/pb/hardware';
import { toast } from 'sonner';

type DiscActionsDropdownProps = {
  currentDiscs?: Disc[];
  sessionId?: string;
};

type TrajectoryPoint = {
  distance: number;
  deviation: number;
  height: number;
};

type RawTrajectorySample = {
  lat: number;
  lon: number;
  alt: number;
  ts: number;
};

const STREAM_IDLE_STOP_MS = 900;
const TRAJECTORY_STORAGE_KEY = 'throwTrajectoryByIdV1';
const MIN_SATS_FOR_FIX = 5;
const MAX_HDOP_FOR_FIX = 2.5;
const STATIONARY_SPEED_MPS = 0.8;
const DISTANCE_NOISE_FLOOR_FEET = 10;
const DISTANCE_SMOOTHING_ALPHA = 0.2;

/** Calculate distance in feet between two GPS coordinates using haversine formula */
function haversineDistanceFeet(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 20902231; // Earth radius in feet
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function localOffsetFeet(originLat: number, originLon: number, lat: number, lon: number): { east: number; north: number } {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const latScale = 364000; // feet per degree latitude
  const lonScale = 364000 * Math.cos(toRad(originLat));
  return {
    east: (lon - originLon) * lonScale,
    north: (lat - originLat) * latScale,
  };
}

function buildTrajectory(samples: RawTrajectorySample[]): TrajectoryPoint[] {
  if (samples.length < 2) {
    return [];
  }

  const origin = samples[0];
  const offsets = samples.map((sample) => localOffsetFeet(origin.lat, origin.lon, sample.lat, sample.lon));
  const end = offsets[offsets.length - 1];
  const norm = Math.hypot(end.east, end.north);

  if (norm < 1) {
    return [];
  }

  const axisX = end.east / norm;
  const axisY = end.north / norm;
  const baseAlt = samples[0].alt;

  return offsets.map((offset, index) => {
    const along = offset.east * axisX + offset.north * axisY;
    const cross = offset.east * (-axisY) + offset.north * axisX;
    const height = Math.max(0, samples[index].alt - baseAlt);

    return {
      distance: Math.max(0, along),
      deviation: cross,
      height,
    };
  });
}

function persistThrowTrajectory(throwId: string, points: TrajectoryPoint[]): void {
  if (typeof window === 'undefined' || !throwId || points.length === 0) {
    return;
  }

  try {
    const current = localStorage.getItem(TRAJECTORY_STORAGE_KEY);
    const parsed = current ? JSON.parse(current) as Record<string, TrajectoryPoint[]> : {};
    parsed[throwId] = points;
    localStorage.setItem(TRAJECTORY_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Swallow localStorage serialization failures.
  }
}

export default function DiscActionsDropdown({
  currentDiscs = [],
  sessionId = '',
}: DiscActionsDropdownProps) {
  const { settings } = useSettings();
  const { connectDevice, connectedDevice } = useDevice();

  const getErrorMessage = (error: unknown, fallback: string): string => {
    if (error instanceof Error && error.message) {
      return error.message.replace(/^\[[^\]]+\]\s*/, '');
    }
    return fallback;
  };

  const [isOpen, setIsOpen] = useState(false);
  const [selectedDisc, setSelectedDisc] = useState<Disc | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [trackerDistance, setTrackerDistance] = useState<number | null>(null);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [showAddPopup, setShowAddPopup] = useState(false);
  const [discName, setDiscName] = useState('');
  const [discType, setDiscType] = useState('');
  const [weight, setWeight] = useState(175);
  const [color, setColor] = useState('#000000');
  const [showDiscList, setShowDiscList] = useState(false);
  const [discs, setDiscs] = useState<Disc[]>(currentDiscs);
  const [isLoading, setIsLoading] = useState(false);

  // Timing state
  const [isRunning, setIsRunning] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showThrowResults, setShowThrowResults] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [justStopped, setJustStopped] = useState(false);

  // Telemetry state from BLE pings
  const [currentPing, setCurrentPing] = useState<Ping | null>(null);
  const [rssi, setRssi] = useState<number | null>(null);
  const [discLat, setDiscLat] = useState<number>(0);
  const [discLon, setDiscLon] = useState<number>(0);
  const [lastRpm, setLastRpm] = useState<number>(0);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [activeTrajectory, setActiveTrajectory] = useState<TrajectoryPoint[]>([]);
  const phonePosRef = useRef<{ lat: number; lon: number } | null>(null);
  const rawTrajectoryRef = useRef<RawTrajectorySample[]>([]);
  const streamIdleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const distanceBaselineRef = useRef<number | null>(null);
  const smoothedDistanceRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);
  const elapsedRef = useRef(0);
  const startTimingRef = useRef<() => void>(() => undefined);
  const stopTimingRef = useRef<(forceSave?: boolean) => Promise<void>>(async () => undefined);

  useEffect(() => {
    setDiscs(currentDiscs);
  }, [currentDiscs]);

  // Handle BLE disconnection when device changes
  useEffect(() => {
    if (!connectedDevice) {
      bleManager.disconnect();
    }
  }, [connectedDevice]);

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    elapsedRef.current = elapsedTime;
  }, [elapsedTime]);

  useEffect(() => {
    bleManager.onSyncStatus((status) => {
      if (status === 'error') {
        toast.error('Failed to sync telemetry batch. It will retry on your next throw.');
      }
      if (status === 'success') {
        toast.success('Telemetry batch synced.');
      }
    });

    // Listen for real-time BLE pings from the disc tracker
    const unsubscribePing = bleManager.onPing((ping: Ping) => {
      setCurrentPing(ping);

      // Only trust GPS data when the firmware has a high-quality fix.
      const hasGpsFix = hasReliableGpsFix(ping);

      // Update disc GPS position
      if (hasGpsFix) {
        setDiscLat(ping.lat);
        setDiscLon(ping.lon);
        if (isRunningRef.current) {
          rawTrajectoryRef.current.push({
            lat: ping.lat,
            lon: ping.lon,
            alt: ping.alt,
            ts: ping.timestamp || Date.now(),
          });
        }
      }

      // Calculate RPM from gyroZ (firmware sends deg/s; 1 RPM = 6 deg/s)
      const rpm = Math.abs(ping.gyroZ) / 6;
      if (rpm >= 5) setLastRpm(rpm); // noise floor

      // Update battery level from firmware
      if (ping.battPct > 0) {
        setBatteryLevel(ping.battPct);
      }

      // Update tracker distance from phone position to disc position
      if (phonePosRef.current && hasGpsFix) {
        const rawDistFeet = haversineDistanceFeet(
          phonePosRef.current.lat,
          phonePosRef.current.lon,
          ping.lat,
          ping.lon,
        );

        if (Number.isFinite(rawDistFeet)) {
          const isLikelyStationary = ping.speedMps <= STATIONARY_SPEED_MPS;
          if (isLikelyStationary) {
            distanceBaselineRef.current = distanceBaselineRef.current === null
              ? rawDistFeet
              : distanceBaselineRef.current * 0.9 + rawDistFeet * 0.1;
          }

          const baselineFeet = distanceBaselineRef.current ?? 0;
          let calibratedFeet = Math.max(0, rawDistFeet - baselineFeet);
          if (calibratedFeet < DISTANCE_NOISE_FLOOR_FEET) {
            calibratedFeet = 0;
          }

          const prev = smoothedDistanceRef.current;
          const smoothedFeet = prev === null
            ? calibratedFeet
            : prev + DISTANCE_SMOOTHING_ALPHA * (calibratedFeet - prev);

          smoothedDistanceRef.current = smoothedFeet;
          setTrackerDistance(smoothedFeet);
        }
      }

      if (!isRunningRef.current) {
        startTimingRef.current();
      }

      if (streamIdleTimerRef.current) {
        clearTimeout(streamIdleTimerRef.current);
      }
      streamIdleTimerRef.current = setTimeout(() => {
        void stopTimingRef.current(true);
      }, STREAM_IDLE_STOP_MS);
    });

    // Listen for RSSI updates from BLE connection
    const unsubscribeRssi = bleManager.onRssi((rssiValue: number) => {
      setRssi(rssiValue);
    });

    // Watch phone GPS position for distance calculations
    let geoWatchId: number | undefined;
    if ('geolocation' in navigator) {
      geoWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          phonePosRef.current = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        },
        undefined,
        { enableHighAccuracy: true, maximumAge: 2000 },
      );
    }

    return () => {
      unsubscribePing();
      unsubscribeRssi();
      if (streamIdleTimerRef.current) {
        clearTimeout(streamIdleTimerRef.current);
        streamIdleTimerRef.current = null;
      }
      if (geoWatchId !== undefined) navigator.geolocation.clearWatch(geoWatchId);
    };
  }, []);

  const toggleDropdown = () => setIsOpen(!isOpen);
  const closeDropdown = () => {
    setIsOpen(false);
    setShowDiscList(false);
  };

  const toggleDiscList = () => setShowDiscList(!showDiscList);

  const handleSelectDisc = (disc: Disc) => {
    setSelectedDisc(disc);
    setSyncStatus('idle');
    setTrackerDistance(null);
    setShowDiscList(false);
  };

  const handleSync = async () => {
    if (!selectedDisc) return;

    setSyncStatus('idle');
    bleManager.disconnect();

    try {
      const ensureResponse = await fetch('/api/go/ensure-running', {
        method: 'POST',
        credentials: 'include',
      });
      if (!ensureResponse.ok) {
        let message = 'Unable to start backend service automatically.';
        try {
          const payload = await ensureResponse.json();
          if (payload?.error) {
            message = String(payload.error);
          }
        } catch {
          // Keep default message when response is not JSON.
        }
        throw new Error(message);
      }

      // Connect to hardware using Web Bluetooth
      await bleManager.connect(selectedDisc.connectionNumber || selectedDisc.id);
      
      // Track active hardware device in shared context
      connectDevice(selectedDisc.connectionNumber || selectedDisc.id, selectedDisc.name);

      setSyncStatus('success');
      setTrackerDistance(0); // Will be updated from live BLE telemetry pings
      closeDropdown();
      toast.success(`Connected to ${selectedDisc.name}. Telemetry batching is active.`);
    } catch (error) {
      setSyncStatus('error');
      toast.error(getErrorMessage(error, 'Unable to connect to device. Check Bluetooth and try again.'));
    }
  };

  const handleRemoveDisc = () => setShowRemoveConfirm(true);

  const confirmRemove = async () => {
    if (!selectedDisc?.id) return;

    setIsLoading(true);
    try {
      await discAPI.deleteDisc(selectedDisc.id);
      setDiscs(discs.filter(d => d.id !== selectedDisc.id));
      setSelectedDisc(null);
      setSyncStatus('idle');
      setTrackerDistance(null);
      setShowRemoveConfirm(false);
      closeDropdown();
      toast.success('Disc removed from your collection.');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to remove disc. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const cancelRemove = () => setShowRemoveConfirm(false);

  const openAddPopup = () => {
    setShowAddPopup(true);
    setDiscName('');
    setDiscType('');
    setWeight(175);
    setColor('#000000');
  };

  const handleAddDisc = async () => {
    if (!discName.trim() || !discType.trim() || !weight) {
      toast.error('Please provide disc name, type, and weight.');
      return;
    }

    setIsLoading(true);
    try {
      const newDisc = await discAPI.createDisc(
        discName.trim(),
        discType.trim(),
        weight,
        color,
      );
      setDiscs([...discs, newDisc]);
      setShowAddPopup(false);
      closeDropdown();
      toast.success(`Disc "${newDisc.name}" added successfully.`);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to add disc. Please check inputs and retry.'));
    } finally {
      setIsLoading(false);
    }
  };

  const cancelAdd = () => setShowAddPopup(false);

  // Timing Controls – shared by Stopwatch & Accelerometer
  const startTiming = () => {
    if (isRunning) return;

    bleManager.markThrowStarted();
    rawTrajectoryRef.current = [];
    distanceBaselineRef.current = null;
    smoothedDistanceRef.current = null;
    setActiveTrajectory([]);

    setIsRunning(true);
    setJustStopped(false);
    const start = Date.now() - elapsedTime * 1000;
    timerRef.current = setInterval(() => {
      setElapsedTime((Date.now() - start) / 1000);
    }, 100);
  };

  const stopTiming = async (forceSave = false) => {
    if (!isRunningRef.current) {
      return;
    }

    if (streamIdleTimerRef.current) {
      clearTimeout(streamIdleTimerRef.current);
      streamIdleTimerRef.current = null;
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRunning(false);
    void bleManager.markThrowLanded();

    const finalElapsed = Math.max(0, elapsedRef.current);
    const trajectory = buildTrajectory(rawTrajectoryRef.current);
    const trajectoryDistance = trajectory.length > 0
      ? Math.max(0, trajectory[trajectory.length - 1].distance)
      : 0;

    if (trajectoryDistance > 0) {
      setTrackerDistance(trajectoryDistance);
    }

    if (trajectory.length > 0) {
      setActiveTrajectory(trajectory);
    }

    if (finalElapsed > 0.1) {
      setShowThrowResults(true);

      // Auto-save at end-of-stream to guarantee throw bundling for statistics.
      if ((forceSave || settings.autoSaveThrows) && !justStopped) {
        await handleSaveThrow(finalElapsed, trajectory, trajectoryDistance);
        setJustStopped(true);
      }
    }
  };

  startTimingRef.current = startTiming;
  stopTimingRef.current = stopTiming;

  const resetTiming = () => {
    void stopTiming();
    setElapsedTime(0);
    setShowThrowResults(false);
    setJustStopped(false);
    setLastRpm(0);
    setActiveTrajectory([]);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (streamIdleTimerRef.current) {
        clearTimeout(streamIdleTimerRef.current);
        streamIdleTimerRef.current = null;
      }
    };
  }, []);

  const buttonText = selectedDisc
    ? `${selectedDisc.name} - ${selectedDisc.type}`
    : 'Disc Actions';

  const handleSaveThrow = async (
    flightTimeOverride?: number,
    trajectoryOverride?: TrajectoryPoint[],
    distanceOverride?: number,
  ) => {
    if (!selectedDisc || !sessionId) return;

    const flightTime = flightTimeOverride ?? elapsedRef.current;
    if (!Number.isFinite(flightTime) || flightTime <= 0) return;

    const distance = Number.isFinite(distanceOverride)
      ? (distanceOverride as number)
      : Number.isFinite(trackerDistance)
      ? (trackerDistance as number)
      : 0;
    const trajectory = trajectoryOverride ?? activeTrajectory;

    try {
      const response = await throwAPI.saveThrow({
        sessionId: sessionId,
        discId: selectedDisc.id,
        teeLat: phonePosRef.current?.lat ?? 0,
        teeLon: phonePosRef.current?.lon ?? 0,
        foundLat: discLat,
        foundLon: discLon,
        distance,
        maxRpm: lastRpm,
        exitVelocity: flightTime > 0 ? distance / flightTime : 0,
        flightTime,
        state: 'landed',
      });
      persistThrowTrajectory(response.id, trajectory);
      toast.success(`Throw saved: ${distance.toFixed(1)} ft in ${flightTime.toFixed(2)}s.`);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save throw. Please try again.'));
    }
  };

  return (
    <div className="relative w-full max-w-md mx-auto space-y-8">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-3 bg-[#54c4c3] text-black font-medium px-6 py-4 rounded-xl hover:bg-[#3daaa9] transition shadow-md focus:outline-none focus:ring-2 focus:ring-[#54c4c3]/50 text-base md:text-lg min-h-13 touch-manipulation"
        onClick={toggleDropdown}
      >
        <span className="truncate">{buttonText}</span>
        <svg
          className={`w-6 h-6 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <DiscSelectorMenu
          isOpen={isOpen}
          currentDiscs={discs}
          selectedDisc={selectedDisc}
          showDiscList={showDiscList}
          syncStatus={syncStatus}
          onClose={closeDropdown}
          onToggleDiscList={toggleDiscList}
          onSelectDisc={handleSelectDisc}
          onSync={handleSync}
          onOpenAddPopup={openAddPopup}
          onRemoveDisc={handleRemoveDisc}
        />
      )}

      {syncStatus === 'success' && trackerDistance !== null && (
        <>
          <TrackerDisplay
            distance={trackerDistance}
            unit={settings.distanceUnit}
            batteryLevel={batteryLevel ?? undefined}
            discLat={discLat}
            discLon={discLon}
            currentPing={currentPing}
            rssi={rssi}
          />
        </>
      )}

      {syncStatus === 'success' && trackerDistance !== null && (
        <div className="mt-8 w-full max-w-md mx-auto space-y-6 px-4">
          <div className="min-h-[200px]">
          {settings.throwMode === 'manual' ? (
            <Stopwatch
              isRunning={isRunning}
              elapsedTime={elapsedTime}
              setElapsedTime={setElapsedTime}
              onStart={startTiming}
              onStop={stopTiming}
              onReset={resetTiming}
            />
          ) : (
            <Accelerometer
              isRunning={isRunning}
              elapsedTime={elapsedTime}
              onStart={startTiming}
              onStop={stopTiming}
              onReset={resetTiming}
            />
          )}
          </div>

          {showThrowResults && (
            <ThrowResults
              distance={trackerDistance ?? 0}
              time={elapsedTime}
              unit={settings.distanceUnit}
              onSaveThrow={handleSaveThrow}
              rpm={lastRpm}
              trajectoryData={activeTrajectory}
            />
          )}
        </div>
      )}

      {showRemoveConfirm && (
        <RemoveConfirmPopup
          discName={selectedDisc?.name}
          onConfirm={confirmRemove}
          onCancel={cancelRemove}
        />
      )}

      {showAddPopup && (
        <AddDiscPopup
          discName={discName}
          discType={discType}
          weight={weight}
          color={color}
          onChangeDiscName={setDiscName}
          onChangeDiscType={setDiscType}
          onChangeWeight={setWeight}
          onChangeColor={setColor}
          onAdd={handleAddDisc}
          onCancel={cancelAdd}
          isLoading={isLoading}
        />
      )}
    </div>
  );
}

function hasReliableGpsFix(ping: Ping): boolean {
  return (
    ping.lat !== 0 &&
    ping.lon !== 0 &&
    ping.sats >= MIN_SATS_FOR_FIX &&
    ping.hdop > 0 &&
    ping.hdop <= MAX_HDOP_FOR_FIX
  );
}
