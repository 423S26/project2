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
import { PingData } from '@/lib/pb/codec';
import { toast } from 'sonner';

type DiscActionsDropdownProps = {
  currentDiscs?: Disc[];
  sessionId?: string;
};

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

export default function DiscActionsDropdown({
  currentDiscs = [],
  sessionId = '',
}: DiscActionsDropdownProps) {
  const { settings } = useSettings();
  const { connectDevice, disconnectDevice, connectedDevice } = useDevice();

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
  const [discLat, setDiscLat] = useState<number>(0);
  const [discLon, setDiscLon] = useState<number>(0);
  const [lastRpm, setLastRpm] = useState<number>(0);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const phonePosRef = useRef<{ lat: number; lon: number } | null>(null);

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
    bleManager.onSyncStatus((status) => {
      if (status === 'error') {
        toast.error('Failed to sync telemetry batch. It will retry on your next throw.');
      }
      if (status === 'success') {
        toast.success('Telemetry batch synced.');
      }
    });

    // Listen for real-time BLE pings from the disc tracker
    const unsubscribePing = bleManager.onPing((ping: PingData) => {
      // Only trust GPS data when the firmware has a real fix
      const hasGpsFix = ping.sats >= 4 && ping.lat !== 0 && ping.lon !== 0;

      // Update disc GPS position
      if (hasGpsFix) {
        setDiscLat(ping.lat);
        setDiscLon(ping.lon);
      }

      // Calculate RPM from gyro_z (firmware sends deg/s; 1 RPM = 6 deg/s)
      const rpm = Math.abs(ping.gyro_z) / 6;
      if (rpm >= 5) setLastRpm(rpm); // noise floor

      // Update battery level from firmware
      if (ping.batt_pct > 0) {
        setBatteryLevel(ping.batt_pct);
      }

      // Update tracker distance from phone position to disc position
      if (phonePosRef.current && hasGpsFix) {
        const distFeet = haversineDistanceFeet(
          phonePosRef.current.lat,
          phonePosRef.current.lon,
          ping.lat,
          ping.lon,
        );
        setTrackerDistance(distFeet);
      }
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

    setIsRunning(true);
    setJustStopped(false);
    const start = Date.now() - elapsedTime * 1000;
    timerRef.current = setInterval(() => {
      setElapsedTime((Date.now() - start) / 1000);
    }, 100);
  };

  const stopTiming = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRunning(false);
    void bleManager.markThrowLanded();

    if (trackerDistance && trackerDistance > 0 && elapsedTime > 0.5) {
      setShowThrowResults(true);

      // Auto-save only once per stop (if enabled)
      if (settings.autoSaveThrows && !justStopped) {
        handleSaveThrow();
        setJustStopped(true);
      }
    }
  };

  const resetTiming = () => {
    stopTiming();
    setElapsedTime(0);
    setShowThrowResults(false);
    setJustStopped(false);
    setLastRpm(0);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const buttonText = selectedDisc
    ? `${selectedDisc.name} - ${selectedDisc.type}`
    : 'Disc Actions';

  const handleSaveThrow = async () => {
    if (!trackerDistance || !elapsedTime || !selectedDisc) return;

    try {
      await throwAPI.saveThrow({
        sessionId: sessionId,
        discId: selectedDisc.id,
        teeLat: phonePosRef.current?.lat ?? 0,
        teeLon: phonePosRef.current?.lon ?? 0,
        foundLat: discLat,
        foundLon: discLon,
        distance: trackerDistance,
        maxRpm: lastRpm,
        exitVelocity: trackerDistance / elapsedTime,
        flightTime: elapsedTime,
        state: 'landed',
      });
      toast.success(`Throw saved: ${trackerDistance} ft in ${elapsedTime.toFixed(2)}s.`);
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
              distance={trackerDistance}
              time={elapsedTime}
              unit={settings.distanceUnit}
              onSaveThrow={handleSaveThrow}
              rpm={lastRpm}
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