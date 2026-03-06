'use client';

import { useState, useEffect, useRef } from 'react';
import { useSettings } from '@/contexts/SettingsContext';
import DiscSelectorMenu from './DiscSelectorMenu';
import TrackerDisplay from './TrackerDisplay';
import Stopwatch from './Stopwatch';
import Accelerometer from './Accelerometer';
import ThrowResults from './ThrowResults';
import RemoveConfirmPopup from './RemoveConfirmPopup';
import AddDiscPopup from './AddDiscPopup';
import { Disc } from './types';

type DiscActionsDropdownProps = {
  currentDiscs?: Disc[];
};

export default function DiscActionsDropdown({
  currentDiscs = [],
}: DiscActionsDropdownProps) {
  const { settings } = useSettings();

  const [isOpen, setIsOpen] = useState(false);
  const [selectedDisc, setSelectedDisc] = useState<Disc | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [trackerDistance, setTrackerDistance] = useState<number | null>(null);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [showAddPopup, setShowAddPopup] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [discName, setDiscName] = useState(''); // for AddDiscPopup
  const [showDiscList, setShowDiscList] = useState(false);

  // Timing state
  const [isRunning, setIsRunning] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showThrowResults, setShowThrowResults] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Flag to prevent duplicate auto-save on same throw
  const [justStopped, setJustStopped] = useState(false);

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

  const handleSync = () => {
    setSyncStatus('success');
    setTrackerDistance(285);
    closeDropdown();
  };

  const handleRemoveDisc = () => setShowRemoveConfirm(true);

  const confirmRemove = () => {
    setSelectedDisc(null);
    setSyncStatus('idle');
    setTrackerDistance(null);
    setShowRemoveConfirm(false);
    closeDropdown();
  };

  const cancelRemove = () => setShowRemoveConfirm(false);

  const openAddPopup = () => {
    setShowAddPopup(true);
    setTrackingNumber('');
    setDiscName('');
  };

  const handleAddDisc = () => {
    if (!trackingNumber.trim() || !discName.trim()) {
      alert("Please enter both disc name and connection number");
      return;
    }

    alert(`Adding disc "${discName}" with connection number: ${trackingNumber}`);
    setShowAddPopup(false);
    closeDropdown();
  };

  const cancelAdd = () => setShowAddPopup(false);

  // Timing Controls
  const startTiming = () => {
    if (isRunning) return;

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

    if (trackerDistance && trackerDistance > 0 && elapsedTime > 0.5) {
      setShowThrowResults(true);

      // Auto-save only once per stop (when enabled)
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

  const handleSaveThrow = () => {
    if (!trackerDistance || !elapsedTime) return;

    const throwData = {
      disc: selectedDisc ? `${selectedDisc.name} (${selectedDisc.type})` : 'Unknown disc',
      distance: trackerDistance,
      time: elapsedTime.toFixed(2),
      velocity: (trackerDistance / elapsedTime).toFixed(1),
      timestamp: new Date().toISOString(),
    };

    alert(
      `Throw saved!\n\n` +
      `Disc: ${throwData.disc}\n` +
      `Distance: ${throwData.distance} ft\n` +
      `Time: ${throwData.time} s\n` +
      `Avg Velocity: ${throwData.velocity} ft/s\n` +
      `Time: ${new Date(throwData.timestamp).toLocaleString()}`
    );
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
          currentDiscs={currentDiscs}
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
        <TrackerDisplay
          distance={trackerDistance}
          unit={settings.distanceUnit}
        />
      )}

      {syncStatus === 'success' && trackerDistance !== null && (
        <div className="mt-8 w-full max-w-md mx-auto space-y-6 px-4">
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

          {showThrowResults && (
            <ThrowResults
              distance={trackerDistance}
              time={elapsedTime}
              unit={settings.distanceUnit}
              onSaveThrow={handleSaveThrow}
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
          trackingNumber={trackingNumber}
          discName={discName}
          onChangeTrackingNumber={setTrackingNumber}
          onChangeDiscName={setDiscName}
          onAdd={handleAddDisc}
          onCancel={cancelAdd}
        />
      )}
    </div>
  );
}