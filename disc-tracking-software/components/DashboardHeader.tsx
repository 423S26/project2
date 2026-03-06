// components/DashboardHeader.tsx
'use client';

import { useState } from 'react';
import { LogOut, Settings as SettingsIcon, X } from 'lucide-react';
import { signOut } from 'next-auth/react';
import Link from 'next/link';
import { useSettings, MetricKey } from '@/contexts/SettingsContext';

export default function DashboardHeader() {
  const { settings, updateSettings } = useSettings();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const toggleSettings = () => setIsSettingsOpen(!isSettingsOpen);
  const closeSettings = () => setIsSettingsOpen(false);

  const handleSave = () => {
    closeSettings();
  };

  const toggleMetric = (key: MetricKey) => {
    const current = settings.selectedMetrics ?? [];
    const updated = current.includes(key)
      ? current.filter((m) => m !== key)
      : [...current, key];
    updateSettings({ selectedMetrics: updated });
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#190f2A]/80 backdrop-blur-md border-b border-[#223066]/50">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 md:px-12 lg:px-20 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center">
            <img
              src="/flight-iq-logo.svg"
              alt="Flight IQ logo"
              className="h-9 md:h-10 w-auto transition-transform hover:scale-105"
            />
          </Link>

          <div className="flex items-center gap-4 md:gap-6">
            <button
              onClick={async () => await signOut({ callbackUrl: '/sign-in' })}
              className="px-4 py-2 text-white/90 text-sm md:text-base font-medium bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[#54c4c3]/30 rounded-xl transition-all duration-200 hover:text-[#54c4c3] hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-[#54c4c3]/40 cursor-pointer flex items-center"
            >
              <LogOut className="w-5 h-5 inline-block mr-1 -mt-0.5" />
              Logout
            </button>

            <button
              onClick={toggleSettings}
              className="text-white/80 hover:text-[#54c4c3] transition-colors p-2 rounded-full hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-[#54c4c3]/40"
              aria-label="Open Settings"
            >
              <SettingsIcon className="w-7 h-7" />
            </button>
          </div>
        </div>
      </header>

      {isSettingsOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 transition-opacity duration-300"
            onClick={closeSettings}
          />

          <div
            className={`
              fixed top-0 right-0 h-full w-full sm:w-96 lg:w-105
              bg-[#190f2A]/95 backdrop-blur-lg border-l border-[#223066]/60
              shadow-2xl z-60
              transform transition-transform duration-300 ease-out
              ${isSettingsOpen ? 'translate-x-0' : 'translate-x-full'}
            `}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-[#223066]/60 bg-[#223066]/40">
              <h2 className="text-2xl font-semibold text-[#54c4c3] tracking-tight">
                Settings
              </h2>
              <button
                onClick={closeSettings}
                className="text-white/70 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors"
                aria-label="Close Settings"
              >
                <X className="w-7 h-7" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-10 overflow-y-auto h-[calc(100vh-80px)]">
              {/* Distance Unit */}
              <div className="bg-[#223066]/40 backdrop-blur-sm border border-[#456fb6]/40 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Distance Unit</h3>
                <div className="flex gap-8">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="distanceUnit"
                      value="feet"
                      checked={settings.distanceUnit === 'feet'}
                      onChange={() => updateSettings({ distanceUnit: 'feet' })}
                      className="radio radio-primary radio-sm"
                    />
                    <span className="text-white/90">Feet (ft)</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="distanceUnit"
                      value="meters"
                      checked={settings.distanceUnit === 'meters'}
                      onChange={() => updateSettings({ distanceUnit: 'meters' })}
                      className="radio radio-primary radio-sm"
                    />
                    <span className="text-white/90">Meters (m)</span>
                  </label>
                </div>
              </div>

              {/* Throw Mode */}
              <div className="bg-[#223066]/40 backdrop-blur-sm border border-[#456fb6]/40 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Throw Timing Mode</h3>
                <div className="flex flex-col sm:flex-row gap-6">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="throwMode"
                      value="manual"
                      checked={settings.throwMode === 'manual'}
                      onChange={() => updateSettings({ throwMode: 'manual' })}
                      className="radio radio-primary radio-sm"
                    />
                    <span className="text-white/90">Manual (Stopwatch)</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="throwMode"
                      value="accelerometer"
                      checked={settings.throwMode === 'accelerometer'}
                      onChange={() => updateSettings({ throwMode: 'accelerometer' })}
                      className="radio radio-primary radio-sm"
                    />
                    <span className="text-white/90">Auto (Accelerometer)</span>
                  </label>
                </div>
              </div>

              {/* Auto-Save */}
              <div className="bg-[#223066]/40 backdrop-blur-sm border border-[#456fb6]/40 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Auto-Save Throws</h3>
                <label className="flex items-center gap-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.autoSaveThrows}
                    onChange={(e) => updateSettings({ autoSaveThrows: e.target.checked })}
                    className="toggle toggle-primary toggle-lg"
                  />
                  <div>
                    <span className="text-white/90 font-medium">Automatically save after stopping timer</span>
                    <p className="text-xs text-white/50 mt-1">
                      No need to click "Add to Records" manually.
                    </p>
                  </div>
                </label>
              </div>

              {/* Throw Results Metrics */}
              <div className="bg-[#223066]/40 backdrop-blur-sm border border-[#456fb6]/40 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Throw Results Metrics</h3>
                <p className="text-sm text-white/70 mb-5">
                  Select which stats to show below the flight path graph.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { key: 'time', label: 'Time (s)' },
                    { key: 'distance', label: 'Distance' },
                    { key: 'velocity', label: 'Average Velocity' },
                    { key: 'rpm', label: 'Average RPM' },
                    { key: 'height', label: 'Average Height' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-3 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={(settings.selectedMetrics ?? []).includes(key as MetricKey)}
                        onChange={() => toggleMetric(key as MetricKey)}
                        className="checkbox checkbox-primary checkbox-md"
                      />
                      <span className="text-white/90 group-hover:text-[#54c4c3] transition-colors">
                        {label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Save button – increased bottom margin */}
              <div className="pt-8 pb-12"> {/* ← Added pb-12 for bottom spacing */}
                <button
                  onClick={handleSave}
                  className="
                    w-full py-4 px-6
                    bg-linear-to-r from-[#54c4c3] to-[#3daaa9]
                    hover:from-[#3daaa9] hover:to-[#54c4c3]
                    text-black font-medium text-lg
                    rounded-xl shadow-lg hover:shadow-xl
                    transition-all duration-300 transform hover:scale-[1.02]
                    focus:outline-none focus:ring-2 focus:ring-[#54c4c3]/50
                  "
                >
                  Save & Close
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}