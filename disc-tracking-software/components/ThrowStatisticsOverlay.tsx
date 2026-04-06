// components/ThrowStatisticsOverlay.tsx
'use client';

import { useState } from 'react';
import ThrowResults from '@/components/disc-actions/ThrowResults';
import { Trash2 } from 'lucide-react'; // ← Added for trash icon

type ThrowData = {
  id: string;
  discName: string;
  discType: string;
  distance: number;
  time: number;
  velocity: number;
  timestamp: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  activeSession: string | null;
};

export default function ThrowStatisticsOverlay({ isOpen, onClose, activeSession }: Props) {
  const [selectedSession, setSelectedSession] = useState<string | null>(activeSession);
  
  // TODO (Backend): Replace mock data with real throws fetched from server
  // GET /api/throws?sessionId={selectedSession} or GET /api/sessions/{sessionId}/throws
  // Include disc information, metrics, and timestamp for each throw
  const [throws, setThrows] = useState<ThrowData[]>([
    { id: 't1', discName: 'Star Destroyer', discType: 'Distance Driver', distance: 285, time: 4.2, velocity: 67.9, timestamp: '2026-04-02T14:30:00' },
    { id: 't2', discName: 'Buzz', discType: 'Midrange', distance: 180, time: 3.1, velocity: 58.1, timestamp: '2026-04-02T14:35:00' },
  ]);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [throwToDelete, setThrowToDelete] = useState<string | null>(null);

  const handleDeleteThrow = (throwId: string) => {
    setThrowToDelete(throwId);
    setShowDeleteConfirm(true);
  };

  // ──────────────────────────────────────────────────────────────
  // Confirm Delete Handler
  // TODO (Backend): DELETE /api/throws/{throwId}
  // Should remove the throw from the database and from the current session
  // After success, refresh the throws list for the selected session
  // ──────────────────────────────────────────────────────────────
  const confirmDeleteThrow = () => {
    if (throwToDelete) {
      setThrows(throws.filter(t => t.id !== throwToDelete));
      // TODO (Backend): Call DELETE/update endpoint here and handle response
    }
    setShowDeleteConfirm(false);
    setThrowToDelete(null);
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50" onClick={onClose} />

      <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
        <div className="bg-[#190f2A] w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl border border-[#456fb6]/50 shadow-2xl flex flex-col">
          {/* Header */}
          <div className="p-6 border-b border-[#223066] flex items-center justify-between bg-[#223066]/50">
            <h2 className="text-2xl font-semibold text-[#54c4c3]">Throw Statistics</h2>
            <button
              onClick={onClose}
              className="text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition"
            >
              ✕
            </button>
          </div>

          {/* Session Selector */}
          <div className="p-6 border-b border-[#223066]">
            <label className="block text-sm text-white/70 mb-2">Select Session</label>
            <select
              value={selectedSession || ''}
              onChange={(e) => setSelectedSession(e.target.value)}
              className="w-full bg-[#223066] border border-[#456fb6]/60 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[#54c4c3]"
            >
              <option value="">All Sessions</option>
              {['Rose Park front 9', 'Riverside Round 1', 'Practice Session'].map((session) => (
                <option key={session} value={session}>
                  {session}
                </option>
              ))}
            </select>
            {/* TODO (Backend): Replace hardcoded sessions with real data from GET /api/sessions */}
          </div>

          {/* Throws List */}
          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            {throws.length > 0 ? (
              throws.map((throwData, index) => (
                <div key={throwData.id} className="bg-[#223066]/40 border border-[#456fb6]/40 rounded-xl p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h4 className="text-lg font-semibold text-white">
                        {throwData.discName}
                      </h4>
                      <p className="text-[#54c4c3] text-base mt-1">Throw #{index + 1}</p>
                      <p className="text-sm text-white/60 mt-1">{throwData.discType}</p>
                    </div>

                    {/* Trash Icon Button */}
                    <button
                      onClick={() => handleDeleteThrow(throwData.id)}
                      className="text-red-400 hover:text-red-500 p-2 rounded-lg hover:bg-red-900/20 transition"
                      title="Delete Throw"
                    >
                      <Trash2 size={22} />
                    </button>
                  </div>

                  <ThrowResults
                    distance={throwData.distance}
                    time={throwData.time}
                    unit="feet"
                  />
                </div>
              ))
            ) : (
              <div className="text-center py-20 text-white/60">
                No throws recorded in this session yet.
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Delete Confirmation Popup */}
      {showDeleteConfirm && (
        <>
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-70" onClick={() => setShowDeleteConfirm(false)} />
          <div className="fixed inset-0 z-80 flex items-center justify-center p-4">
            <div className="bg-[#223066] rounded-xl p-8 w-full max-w-sm border border-[#764d9f]/50 shadow-2xl">
              <h3 className="text-xl font-semibold text-white mb-6 text-center">Delete This Throw?</h3>
              <p className="text-white/80 mb-8 text-center">
                This action cannot be undone.
              </p>
              <div className="flex gap-4">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 bg-gray-700 text-white py-3 rounded-lg hover:bg-gray-600 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteThrow}
                  className="flex-1 bg-red-600 text-white py-3 rounded-lg hover:bg-red-700 transition font-medium"
                >
                  Delete Throw
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}