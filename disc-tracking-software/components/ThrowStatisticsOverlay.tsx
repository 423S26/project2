// components/ThrowStatisticsOverlay.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import ThrowResults from '@/components/disc-actions/ThrowResults';
import { Trash2 } from 'lucide-react'; // ← Added for trash icon
import { sessionAPI, throwAPI } from '@/lib/api-client';

type ThrowData = {
  id: string;
  sessionId: string;
  sessionName: string;
  discName: string;
  discType: string;
  distance: number;
  time: number;
  velocity: number;
  rpm: number;
  timestamp: string;
};

type SessionOption = {
  id: string;
  label: string;
};

type Props = {
  isOpen: boolean;
  onCloseAction: () => void;
  activeSession: string | null;
};

export default function ThrowStatisticsOverlay({ isOpen, onCloseAction, activeSession }: Props) {
  const [selectedSession, setSelectedSession] = useState<string | null>(activeSession);
  const [throws, setThrows] = useState<ThrowData[]>([]);
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [throwToDelete, setThrowToDelete] = useState<string | null>(null);

  useEffect(() => {
    setSelectedSession(activeSession);
  }, [activeSession]);

  const loadThrows = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const throwItems = (await throwAPI.getThrows()).map((item: any) => ({
        id: item.id,
        sessionId: item.session_id,
        sessionName: item.session_label,
        discName: item.disc_name,
        discType: item.disc_type,
        distance: Number(item.distance || 0),
        time: Number(item.flight_time || 0),
        velocity: Number(item.exit_velocity || 0),
        rpm: Number(item.max_rpm || 0), // Use max_rpm from API, may need to adjust if API field name is different
        timestamp: item.timestamp,
      }));

      setThrows(throwItems);

      const activeSessions = await sessionAPI.getActiveSessions();
      const sessionMap = new Map<string, string>();
      activeSessions.forEach((session) => {
        sessionMap.set(session.id, `Active Session ${session.id.slice(0, 8)}`);
      });
      throwItems.forEach((item) => {
        if (item.sessionId) {
          sessionMap.set(item.sessionId, item.sessionName || `Session ${item.sessionId.slice(0, 8)}`);
        }
      });

      setSessions(
        Array.from(sessionMap.entries()).map(([id, label]) => ({
          id,
          label,
        }))
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load throw statistics.';
      setErrorMessage(message);
      setThrows([]);
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    void loadThrows();
  }, [isOpen]);

  const filteredThrows = useMemo(() => {
    if (!selectedSession) {
      return throws;
    }
    return throws.filter((throwItem) => throwItem.sessionId === selectedSession);
  }, [throws, selectedSession]);

  const handleDeleteThrow = (throwId: string) => {
    setThrowToDelete(throwId);
    setShowDeleteConfirm(true);
  };

  const confirmDeleteThrow = async () => {
    if (throwToDelete) {
      try {
        await throwAPI.deleteThrow(throwToDelete);

        setThrows((previous) => previous.filter((t) => t.id !== throwToDelete));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to delete throw.';
        setErrorMessage(message);
      }
    }
    setShowDeleteConfirm(false);
    setThrowToDelete(null);
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50" onClick={onCloseAction} />

      <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
        <div className="bg-[#190f2A] w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl border border-[#456fb6]/50 shadow-2xl flex flex-col">
          {/* Header */}
          <div className="p-6 border-b border-[#223066] flex items-center justify-between bg-[#223066]/50">
            <h2 className="text-2xl font-semibold text-[#54c4c3]">Throw Statistics</h2>
            <button
              onClick={onCloseAction}
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
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.label}
                </option>
              ))}
            </select>
          </div>

          {/* Throws List */}
          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            {isLoading ? (
              <div className="text-center py-20 text-white/60">Loading throw statistics...</div>
            ) : errorMessage ? (
              <div className="text-center py-20 text-red-300">{errorMessage}</div>
            ) : filteredThrows.length > 0 ? (
              filteredThrows.map((throwData, index) => (
                <div key={throwData.id} className="bg-[#223066]/40 border border-[#456fb6]/40 rounded-xl p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h4 className="text-lg font-semibold text-white">
                        {throwData.discName}
                      </h4>
                      <p className="text-[#54c4c3] text-base mt-1">Throw #{index + 1}</p>
                      <p className="text-sm text-white/60 mt-1">{throwData.discType}</p>
                      <p className="text-xs text-white/50 mt-1">{new Date(throwData.timestamp).toLocaleString()}</p>
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
                    rpm={throwData.rpm}
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