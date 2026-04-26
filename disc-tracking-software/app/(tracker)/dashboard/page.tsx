'use client';

import { useState, useEffect } from 'react';
import DashboardHeader from '@/components/DashboardHeader';
import DiscActionsDropdown from '@/components/disc-actions/DiscActionsDropdown';
import ThrowStatisticsOverlay from '@/components/ThrowStatisticsOverlay';
import LiveTracker from '@/components/TelemetryLiveTracker';
import { getUserNameAction } from '@/lib/actions/auth-actions';
import { sessionAPI, discAPI, type Session } from '@/lib/api-client';
import { toast } from 'sonner';
import { useDevice } from '@/contexts/DeviceContext';

interface Disc {
  id: string;
  name: string;
  type: string;
  color?: string;
  weight?: number;
  connectionNumber?: string;
}

export default function DashboardHome() {
  // Session State - fetched from backend
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [sessionNameInput, setSessionNameInput] = useState('');
  const [showStartPopup, setShowStartPopup] = useState(false);
  const [showEndPopup, setShowEndPopup] = useState(false);
  const [userName, setUserName] = useState<string>('');
  const [showStatisticsOverlay, setShowStatisticsOverlay] = useState(false);
  const [userDiscs, setUserDiscs] = useState<Disc[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [backendStatus, setBackendStatus] = useState<'starting' | 'ready' | 'failed'>('starting');
  const { disconnectDevice, connectedDevice } = useDevice();

  const getErrorMessage = (error: unknown, fallback: string): string => {
    if (error instanceof Error && error.message) {
      const message = error.message.replace(/^\[[^\]]+\]\s*/, '');
      if (message.includes('Unable to reach API server') || message.includes('Failed to fetch')) {
        return 'Unable to reach backend service. Please verify the API server is running.';
      }
      if (message.includes('Request timeout after')) {
        return 'The request timed out. Please try again or check your network connection.';
      }
      return message;
    }
    return fallback;
  };

  useEffect(() => {
    // Fetch user name (no backend required)
    getUserNameAction().then((name) => {
      if (name) setUserName(name);
    });

    // Ensure Go backend is running before attempting any API calls
    const initBackend = async () => {
      try {
        const res = await fetch('/api/go/ensure-running', {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          const detail = payload?.error ?? 'Unknown error starting backend service.';
          toast.error(`Backend service unavailable: ${detail}`);
          setBackendStatus('failed');
          return;
        }
        setBackendStatus('ready');
        // Now safe to load data that requires the Go backend
        await Promise.all([loadActiveSessions(), loadUserDiscs()]);
      } catch {
        toast.error('Could not reach the backend service. Please check server configuration.');
        setBackendStatus('failed');
      }
    };

    initBackend();
  }, []);

  const loadActiveSessions = async () => {
    try {
      const sessions = await sessionAPI.getActiveSessions();
      if (Array.isArray(sessions) && sessions.length > 0) {
        setActiveSession(sessions[0]); // Use first active session
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to load active sessions.'));
    }
  };

  const loadUserDiscs = async () => {
    try {
      const discs = await discAPI.getUserDiscs();
      setUserDiscs(discs || []);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to load your discs.'));
    }
  };

  // Start Session - POST /api/sessions
  const handleStartSession = async () => {
    if (!sessionNameInput.trim()) {
      toast.error('Please enter a session name');
      return;
    }
    if (!connectedDevice?.deviceId) {
      toast.error('Connect a disc before starting a tracking session.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await sessionAPI.createSession(
        connectedDevice.deviceId,
        sessionNameInput.trim()
      );
      setActiveSession(response);
      setSessionNameInput('');
      setShowStartPopup(false);
      toast.success('Tracking session started!');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to start session.'));
    } finally {
      setIsLoading(false);
    }
  };

  // End Session - PATCH /api/sessions/:id/end
  const handleEndSession = async () => {
    if (!activeSession?.id) return;

    setIsLoading(true);
    try {
      await sessionAPI.endSession(activeSession.id);
      setActiveSession(null);
      disconnectDevice(); // Disconnect device when session ends
      setShowEndPopup(false);
      toast.success('Tracking session ended');
    } catch (error) {
      console.error('[Dashboard] Failed to end session', {
        sessionId: activeSession?.id,
        error: error instanceof Error ? error.message : String(error),
      });
      toast.error(getErrorMessage(error, 'Unable to end session.'));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <DashboardHeader />

      <div className="pt-20 md:pt-24 min-h-screen bg-[#190f2A] text-white">
        <section className="py-12 md:py-16 px-5 sm:px-8 md:px-12 lg:px-20">
          <div className="max-w-5xl mx-auto text-center">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-6">
              Welcome back, <span className="text-[#54c4c3]">{userName}</span>
            </h1>

            <p className="text-lg md:text-xl text-white/70 max-w-3xl mx-auto mb-10">
              Select and sync your disc(s) to start tracking.
            </p>

            {/* Backend service status indicator */}
            {backendStatus === 'starting' && (
              <div className="inline-flex items-center gap-2 text-sm text-yellow-300/80 bg-yellow-900/20 border border-yellow-500/30 rounded-lg px-4 py-2 mb-8">
                <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                Starting backend service&hellip;
              </div>
            )}
            {backendStatus === 'failed' && (
              <div className="inline-flex items-center gap-2 text-sm text-red-300/80 bg-red-900/20 border border-red-500/30 rounded-lg px-4 py-2 mb-8">
                <span className="inline-block w-2 h-2 rounded-full bg-red-400" />
                Backend service unavailable &mdash; some features may not work
              </div>
            )}

            {/* Disc selector and sync controls */}
            <div className="flex justify-center mb-10">
              <DiscActionsDropdown
                currentDiscs={userDiscs}
                sessionId={activeSession?.id}
              />
            </div>

            {/* Live hardware telemetry card */}
            <div className="max-w-2xl mx-auto mb-10">
              <LiveTracker
                deviceId={activeSession?.device_id}
                activeSessionId={activeSession?.id}
              />
            </div>

            {/* Session button + Stats button – always together at bottom */}
            <div className="flex flex-col items-center gap-6 mt-12">
              {activeSession ? (
                <button
                  onClick={() => setShowEndPopup(true)}
                  className="
                    w-full max-w-md px-10 py-4 text-lg font-medium
                    bg-red-600/80 hover:bg-red-700 text-white
                    rounded-xl transition-all duration-300 shadow-lg
                    hover:shadow-xl hover:scale-105 focus:outline-none
                    focus:ring-2 focus:ring-red-500/50 text-center
                  "
                >
                  End Session
                </button>
              ) : (
                <button
                  onClick={() => setShowStartPopup(true)}
                  className="
                    w-full max-w-md px-10 py-4 text-lg font-medium
                    bg-[#54c4c3] hover:bg-[#3daaa9] text-black
                    rounded-xl transition-all duration-300 shadow-lg
                    hover:shadow-xl hover:scale-105 focus:outline-none
                    focus:ring-2 focus:ring-[#54c4c3]/50 text-center cursor-pointer
                  "
                >
                  Start Tracking Session
                </button>
              )}

              {/* User Throw Statistics button – always visible */}
              <button
                onClick={() => setShowStatisticsOverlay(true)}
                className="
                  w-full max-w-md inline-flex items-center justify-center
                  px-10 py-4 text-lg font-medium text-white
                  bg-linear-to-r from-[#456fb6] to-[#764d9f]
                  rounded-xl hover:from-[#54c4c3] hover:to-[#456fb6]
                  transition-all duration-300 shadow-lg hover:shadow-xl
                  hover:scale-105 focus:outline-none focus:ring-2
                  focus:ring-[#54c4c3]/50 text-center cursor-pointer
                "
              >
                User Throw Statistics
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Throw Statistics Overlay */}
      {showStatisticsOverlay && (
        <ThrowStatisticsOverlay
          isOpen={showStatisticsOverlay}
          activeSession={activeSession?.id || null}
          onCloseAction={() => setShowStatisticsOverlay(false)}
        />
      )}

      {/* Start Session Popup */}
      {showStartPopup && (
        <>
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
            onClick={() => setShowStartPopup(false)}
          />
          <div className="fixed inset-0 flex items-center justify-center z-60 px-4">
            <div className="bg-[#223066] rounded-xl p-8 w-full max-w-md border border-[#764d9f]/50 shadow-2xl">
              <h3 className="text-2xl font-semibold text-[#54c4c3] mb-6 text-center">
                Start New Tracking Session
              </h3>

              <label className="block text-white/80 mb-2 font-medium">
                Session Name (e.g. "Rose Park front 9")
              </label>
              <input
                type="text"
                value={sessionNameInput}
                onChange={(e) => setSessionNameInput(e.target.value)}
                placeholder="Enter session name..."
                className="w-full px-4 py-3 bg-[#190f2A] border border-[#456fb6]/60 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-[#54c4c3] focus:ring-2 focus:ring-[#54c4c3]/40 mb-2"
              />
              {!connectedDevice ? (
                <div className="text-sm text-yellow-300 mb-4">
                </div>
              ) : (
                <div className="text-sm text-green-300 mb-4">
                  Connected device: {connectedDevice.discName}
                </div>
              )}

              <div className="flex gap-4">
                <button
                  onClick={() => setShowStartPopup(false)}
                  className="flex-1 bg-gray-700 text-white py-3 rounded-lg hover:bg-gray-600 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStartSession}
                  className="flex-1 bg-[#54c4c3] text-black py-3 rounded-lg hover:bg-[#3daaa9] transition font-medium"
                  disabled={isLoading}
                >
                  Confirm & Start
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* End Session Popup */}
      {showEndPopup && (
        <>
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
            onClick={() => setShowEndPopup(false)}
          />
          <div className="fixed inset-0 flex items-center justify-center z-60 px-4">
            <div className="bg-[#223066] rounded-xl p-8 w-full max-w-md border border-[#764d9f]/50 shadow-2xl">
              <h3 className="text-2xl font-semibold text-red-400 mb-6 text-center">
                End Tracking Session
              </h3>

              <p className="text-white/80 mb-6 text-center">
                Are you sure you want to end the current tracking session? This will stop all telemetry streaming.
              </p>

              <div className="flex gap-4">
                <button
                  onClick={() => setShowEndPopup(false)}
                  className="flex-1 bg-gray-700 text-white py-3 rounded-lg hover:bg-gray-600 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEndSession}
                  className="flex-1 bg-red-600 text-white py-3 rounded-lg hover:bg-red-700 transition font-medium"
                >
                  End Session
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}