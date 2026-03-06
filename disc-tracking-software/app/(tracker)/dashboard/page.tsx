'use client';

import { useState } from 'react';
import DashboardHeader from '@/components/DashboardHeader';
import DiscActionsDropdown from '@/components/disc-actions/DiscActionsDropdown';
import Link from 'next/link';

export default function DashboardHome() {
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [sessionNameInput, setSessionNameInput] = useState('');
  const [showStartPopup, setShowStartPopup] = useState(false);
  const [showEndPopup, setShowEndPopup] = useState(false);

  const handleStartSession = () => {
    if (!sessionNameInput.trim()) {
      alert('Please enter a session name');
      return;
    }
    setActiveSession(sessionNameInput.trim());
    setSessionNameInput('');
    setShowStartPopup(false);
  };

  const handleEndSession = () => {
    setActiveSession(null);
    setShowEndPopup(false);
    // Future: send session data to backend here
  };

  return (
    <>
      <DashboardHeader />

      <div className="pt-20 md:pt-24 min-h-screen bg-[#190f2A] text-white">
        <section className="py-12 md:py-16 px-5 sm:px-8 md:px-12 lg:px-20">
          <div className="max-w-5xl mx-auto text-center">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-6">
              Welcome back, <span className="text-[#54c4c3]">Nathan</span>
            </h1>
          {/* take auth info for username when signed in */}
            <p className="text-lg md:text-xl text-white/70 max-w-3xl mx-auto mb-10">
              Select and sync your disc(s) to start tracking.
            </p>

            {/* Disc Actions Dropdown – only shown during active session */}
            {activeSession && (
              <div className="flex justify-center mb-10">
                <DiscActionsDropdown
                  currentDiscs={[
                    { id: '1', name: 'Star Destroyer', type: 'Distance Driver' },
                    { id: '2', name: 'Buzz', type: 'Midrange' },
                    { id: '3', name: 'Aviar', type: 'Putter' },
                    { id: '4', name: 'Thunderbird', type: 'Fairway Driver' },
                  ]}
                />
              </div>
            )}

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
                    focus:ring-2 focus:ring-[#54c4c3]/50 text-center
                  "
                >
                  Start Tracking Session
                </button>
              )}

              {/* User Throw Statistics button – always below session button */}
              <Link
                href="/stats"
                className="
                  w-full max-w-md inline-flex items-center justify-center
                  px-10 py-4 text-lg font-medium text-white
                  bg-linear-to-r from-[#456fb6] to-[#764d9f]
                  rounded-xl hover:from-[#54c4c3] hover:to-[#456fb6]
                  transition-all duration-300 shadow-lg hover:shadow-xl
                  hover:scale-105 focus:outline-none focus:ring-2
                  focus:ring-[#54c4c3]/50 text-center
                "
              >
                User Throw Statistics
              </Link>
            </div>
          </div>
        </section>
      </div>

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
                className="w-full px-4 py-3 bg-[#190f2A] border border-[#456fb6]/60 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-[#54c4c3] focus:ring-2 focus:ring-[#54c4c3]/40 mb-6"
              />

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
                >
                  Confirm & Start
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* End Session Confirmation Popup */}
      {showEndPopup && (
        <>
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
            onClick={() => setShowEndPopup(false)}
          />
          <div className="fixed inset-0 flex items-center justify-center z-60 px-4">
            <div className="bg-[#223066] rounded-xl p-8 w-full max-w-md border border-[#764d9f]/50 shadow-2xl">
              <h3 className="text-2xl font-semibold text-white mb-6 text-center">
                End Current Session?
              </h3>
              <p className="text-white/80 mb-8 text-center">
                Session "<strong>{activeSession}</strong>" will be ended.
                <br />
                All tracked saved tracked throws will be available on your throw statistics.
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
                  Confirm & End Session
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}