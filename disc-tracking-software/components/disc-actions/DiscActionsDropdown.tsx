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
import { phoneSensors, type PhoneSensorSnapshot } from '@/lib/phone-sensors';
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

// User-supplied throw-capture trigger: a real throw must put the disc more
// than ~2 ft (0.6 m) from the operator's phone.  Anything closer is noise
// (the device sitting on the bag, power-on jitter, GPS wander, etc.).
const THROW_TRIGGER_FEET = 2;
// We require the distance to be both > 2 ft AND increasing for a brief
// window before we commit to starting the throw timer, otherwise a single
// noisy GPS jump would spuriously start a throw.
const THROW_RISING_SAMPLES = 2;
// Minimum frame-over-frame increase (feet) for a sample to count as 'rising'.
const RISING_DELTA_FEET = 0.5;
// EMA weight applied to fresh raw distance when calibrating the resting baseline.
const BASELINE_EMA_ALPHA = 0.1;
// Throws shorter than this are treated as accidental taps and never shown.
const MIN_THROW_SECONDS = 0.1;
// UI elapsed-timer tick interval.
const TIMER_TICK_MS = 100;
// Device-side gyro RPM noise floor (deg/s ÷ 6 = RPM).
const DEVICE_RPM_NOISE_FLOOR_DEGPS = 5;
// Phone-IMU rotation magnitude required before we trust it as an RPM fallback
// (deg/s).  Below this, the phone is just being held — not spinning the disc.
const PHONE_RPM_FALLBACK_GATE_DEGPS = 30;
// Conversion: deg/s -> RPM.
const DEGPS_PER_RPM = 6;
// Hard reject any GPS fix whose HDOP exceeds MAX_HDOP_FOR_FIX by this multiple.
const HDOP_HARD_REJECT_MULTIPLIER = 4;
// Form defaults for AddDiscPopup.
const DEFAULT_DISC_WEIGHT_GRAMS = 175;
const DEFAULT_DISC_COLOR = '#000000';

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
  const [weight, setWeight] = useState(DEFAULT_DISC_WEIGHT_GRAMS);
  const [color, setColor] = useState(DEFAULT_DISC_COLOR);
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

  // ── Phone-sensor (compensates for the demo unit's missing IMU) ──
  // The demo device's onboard IMU is unrecoverable, so spin / impulse must
  // be derived from the operator's phone.  We mirror the live snapshot
  // into refs so the BLE-ping handler can read the freshest values
  // without re-subscribing.  We also capture peak rotation-rate during
  // the throw window as a proxy for RPM.
  const phoneMotionRef = useRef<PhoneSensorSnapshot['motion']>(null);
  const phoneOrientationRef = useRef<PhoneSensorSnapshot['orientation']>(null);
  const peakPhoneRotMagRef = useRef<number>(0);
  const peakPhoneImpulseRef = useRef<number>(0);
  // Number of consecutive samples with calibratedFeet > THROW_TRIGGER_FEET
  // and increasing.  Once >= THROW_RISING_SAMPLES we commit to the throw.
  const risingStreakRef = useRef<number>(0);
  const lastCalibratedFeetRef = useRef<number>(0);

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

  // Subscribe once to the singleton phone-sensor manager.  This kicks off
  // GPS watchPosition + DeviceMotion + DeviceOrientation listeners (shared
  // with TelemetryLiveTracker / DirectionalTrackingOverlay).  All we do
  // here is mirror the snapshot into refs the BLE handler reads.
  useEffect(() => {
    return phoneSensors.subscribe((snap) => {
      phoneMotionRef.current = snap.motion;
      phoneOrientationRef.current = snap.orientation;
      if (snap.gps) {
        phonePosRef.current = { lat: snap.gps.lat, lon: snap.gps.lon };
      }
      // Track peak motion magnitudes during an active throw so we can use
      // them when the timer stops.  Reset is handled by startTiming().
      if (isRunningRef.current && snap.motion) {
        if (snap.motion.rotMagnitude > peakPhoneRotMagRef.current) {
          peakPhoneRotMagRef.current = snap.motion.rotMagnitude;
        }
        if (snap.motion.impulseG > peakPhoneImpulseRef.current) {
          peakPhoneImpulseRef.current = snap.motion.impulseG;
        }
      }
    });
  }, []);

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

      // Calculate RPM from gyroZ (firmware sends deg/s; 1 RPM = 6 deg/s).
      // The demo device's IMU is dead so this is almost always 0; the
      // phone-IMU peak captured during the throw is used as a fallback
      // when stopTiming() runs.
      const rpm = Math.abs(ping.gyroZ) / DEGPS_PER_RPM;
      if (rpm >= DEVICE_RPM_NOISE_FLOOR_DEGPS / DEGPS_PER_RPM) setLastRpm(rpm);

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
              : distanceBaselineRef.current * (1 - BASELINE_EMA_ALPHA) + rawDistFeet * BASELINE_EMA_ALPHA;
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

          // ── 2-ft throw-trigger gate ──
          // Per product requirement: "a throw should be captured if the
          // gps data in relation to the phone is within a range where a
          // real throw might happen, i.e distance from device is greater
          // than say 2ft."  We arm the timer only when calibrated
          // distance crosses the threshold AND is rising (so a stationary
          // device sitting 3 ft away on the bag does not trip it).
          const prevCalibrated = lastCalibratedFeetRef.current;
          const isRising = smoothedFeet > prevCalibrated + RISING_DELTA_FEET;
          lastCalibratedFeetRef.current = smoothedFeet;

          if (!isRunningRef.current) {
            if (smoothedFeet > THROW_TRIGGER_FEET && isRising) {
              risingStreakRef.current += 1;
              if (risingStreakRef.current >= THROW_RISING_SAMPLES) {
                startTimingRef.current();
              }
            } else {
              risingStreakRef.current = 0;
            }
          }
        }
      }

      // Stream-idle stop: once a throw is in flight, end it when the
      // pings stop arriving (disc has landed, BLE link broke, etc.).
      // We intentionally only arm this timer while a throw is active;
      // pre-throw gaps must NOT auto-stop the (non-existent) throw.
      if (isRunningRef.current) {
        if (streamIdleTimerRef.current) {
          clearTimeout(streamIdleTimerRef.current);
        }
        streamIdleTimerRef.current = setTimeout(() => {
          void stopTimingRef.current(true);
        }, STREAM_IDLE_STOP_MS);
      }
    });

    // Listen for RSSI updates from BLE connection
    const unsubscribeRssi = bleManager.onRssi((rssiValue: number) => {
      setRssi(rssiValue);
    });

    // Phone GPS is now provided by the singleton phone-sensor manager
    // (subscribed in the effect above), so no per-component watchPosition
    // is needed here.

    return () => {
      unsubscribePing();
      unsubscribeRssi();
      if (streamIdleTimerRef.current) {
        clearTimeout(streamIdleTimerRef.current);
        streamIdleTimerRef.current = null;
      }
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
      // 1) Web Bluetooth FIRST — must be called inside the click handler's
      //    transient-activation window. Awaiting any HTTP request before this
      //    makes Chrome treat the chooser as non-user-initiated, which on
      //    Windows opens a stale GATT link that gets idle-killed (reason 0x15).
      await bleManager.connect(selectedDisc.connectionNumber || selectedDisc.id);

      // 2) Track active hardware device in shared context.
      connectDevice(selectedDisc.connectionNumber || selectedDisc.id, selectedDisc.name);

      setSyncStatus('success');
      setTrackerDistance(0); // Will be updated from live BLE telemetry pings
      closeDropdown();
      toast.success(`Connected to ${selectedDisc.name}. Telemetry batching is active.`);

      // 3) Kick the local Go backend awake in the background. The BLE link
      //    is already active; uploads will retry once the backend is up, so
      //    a failure here must NOT tear down the connection.
      void fetch('/api/go/ensure-running', {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {
        /* swallowed — uploads will surface their own errors */
      });
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
    setWeight(DEFAULT_DISC_WEIGHT_GRAMS);
    setColor(DEFAULT_DISC_COLOR);
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
    // NB: do NOT reset distanceBaselineRef here — the baseline was
    // calibrated while the disc sat at rest near the operator and is what
    // makes the 2-ft trigger meaningful.  Wiping it would force the next
    // throw to recalibrate from scratch mid-flight.
    setActiveTrajectory([]);

    // Reset peak phone-IMU captures for this throw.
    peakPhoneRotMagRef.current = 0;
    peakPhoneImpulseRef.current = 0;
    risingStreakRef.current = 0;

    setIsRunning(true);
    setJustStopped(false);
    const start = Date.now() - elapsedTime * 1000;
    timerRef.current = setInterval(() => {
      setElapsedTime((Date.now() - start) / 1000);
    }, TIMER_TICK_MS);
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

    // Phone-IMU fallback for RPM: if the device IMU never produced a real
    // gyro reading during the throw (lastRpm still 0 because the demo
    // unit's IMU is dead), use the peak phone rotation-rate magnitude
    // captured during the flight window.  1 RPM = 6 deg/s.
    if (lastRpm === 0 && peakPhoneRotMagRef.current > PHONE_RPM_FALLBACK_GATE_DEGPS) {
      const phoneRpm = peakPhoneRotMagRef.current / DEGPS_PER_RPM;
      setLastRpm(phoneRpm);
    }

    if (finalElapsed > MIN_THROW_SECONDS) {
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
      // Reset the timer back to 0 every time a throw is successfully recorded
      // so the next throw starts from a clean slate.
      setElapsedTime(0);
      elapsedRef.current = 0;
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
              setElapsedTimeAction={setElapsedTime}
              onStartAction={startTiming}
              onStopAction={stopTiming}
              onResetAction={resetTiming}
            />
          ) : (
            <Accelerometer
              isRunning={isRunning}
              elapsedTime={elapsedTime}
              onStartAction={startTiming}
              onStopAction={stopTiming}
              onResetAction={resetTiming}
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
          onConfirmAction={confirmRemove}
          onCancelAction={cancelRemove}
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
  // Trust valid coordinates over auxiliary metadata.  The firmware
  // doesn't always emit sats/hdop, but when lat/lon are non-zero and
  // within Earth bounds we have a usable fix and the throw-trigger
  // distance gate can run.
  if (ping.lat === 0 && ping.lon === 0) return false;
  if (Math.abs(ping.lat) > 90 || Math.abs(ping.lon) > 180) return false;
  if (ping.hdop > MAX_HDOP_FOR_FIX * HDOP_HARD_REJECT_MULTIPLIER) return false; // wildly bad
  return true;
}
