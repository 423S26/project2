// contexts/SettingsContext.tsx
'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// ──────────────────────────────────────────────────────────────
// TYPE DEFINITIONS – used across frontend for user preferences
// Backend should mirror these types in Go structs/models
// ──────────────────────────────────────────────────────────────
export type DistanceUnit = 'feet' | 'meters';
export type ThrowMode = 'manual' | 'accelerometer';

export type MetricKey = 'time' | 'distance' | 'velocity' | 'rpm' | 'height';

export type Settings = {
  distanceUnit: DistanceUnit;
  throwMode: ThrowMode;
  autoSaveThrows: boolean;
  selectedMetrics: MetricKey[]; // which metrics to show in ThrowResults
  showDebugConsole: boolean;
};

// Context shape – exposes current settings and update function
type SettingsContextType = {
  settings: Settings;
  updateSettings: (newSettings: Partial<Settings>) => void;
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const STORAGE_KEY = 'disc-tracking-settings'; // localStorage key (temporary)

// ──────────────────────────────────────────────────────────────
// SettingsProvider – root wrapper for settings state
// TODO (Backend): Replace localStorage persistence with API calls
// ──────────────────────────────────────────────────────────────
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => {
    // Load from localStorage on mount (temporary – will be replaced)
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          return JSON.parse(saved) as Settings;
        } catch (e) {
          console.error('Failed to parse settings from localStorage:', e);
        }
      }
    }

    // Default settings if no saved data
    return {
      distanceUnit: 'feet',
      throwMode: 'manual',
      autoSaveThrows: false,
      selectedMetrics: ['time', 'distance', 'velocity', 'rpm', 'height'] as MetricKey[],
      showDebugConsole: false,
    };
  });

  // Save to localStorage whenever settings change (temporary)
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  // ──────────────────────────────────────────────────────────────
  // updateSettings – called whenever user changes any preference
  // TODO (Backend): Replace or augment with API call to persist changes
  // Example:
  //   await fetch('/api/user/settings', {
  //     method: 'PATCH',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify(newSettings)
  //   });
  // ──────────────────────────────────────────────────────────────
  const updateSettings = (newSettings: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}

// ──────────────────────────────────────────────────────────────
// Backend Integration Checklist for SettingsContext if unsure what to tackle first:
//
// 1. On app load / login:
//    - Fetch current user settings from server (e.g. GET /api/user/settings)
//    - Replace initial state with server data (override localStorage)
//    - Example: useEffect(() => { fetchSettingsFromServer(); }, []);
//
// 2. On any settings change (updateSettings):
//    - Send PATCH /api/user/settings with partial update
//    - Optimistic update (already done via setSettings)
//    - Rollback on error if needed
//
// 3. Settings fields to persist:
//    - distanceUnit: string ('feet' | 'meters')
//    - throwMode: string ('manual' | 'accelerometer')
//    - autoSaveThrows: boolean
//    - selectedMetrics: array of strings (MetricKey values)
//
// 4. Future: Real-time sync
//    - Use polling or upload acknowledgements to reflect settings changes from server
//    - Useful if user changes settings from another device
//
// 5. Authentication
//    - All settings endpoints must be protected (page data, session, etc.)
//    - Associate settings with user ID
//
// 6. Default values on new user
//    - Server should return defaults if no settings exist yet
// ──────────────────────────────────────────────────────────────