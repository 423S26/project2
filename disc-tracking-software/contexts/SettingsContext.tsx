// contexts/SettingsContext.tsx
'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type DistanceUnit = 'feet' | 'meters';
export type ThrowMode = 'manual' | 'accelerometer';

export type MetricKey = 'time' | 'distance' | 'velocity' | 'rpm' | 'height';

type Settings = {
  distanceUnit: DistanceUnit;
  throwMode: ThrowMode;
  autoSaveThrows: boolean;
  selectedMetrics: MetricKey[]; // NEW: which metrics to show in ThrowResults
};

type SettingsContextType = {
  settings: Settings;
  updateSettings: (newSettings: Partial<Settings>) => void;
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const STORAGE_KEY = 'disc-tracking-settings';

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          return JSON.parse(saved) as Settings;
        } catch (e) {
          console.error('Failed to parse settings:', e);
        }
      }
    }
    return {
      distanceUnit: 'feet',
      throwMode: 'manual',
      autoSaveThrows: false,
      selectedMetrics: ['time', 'distance', 'velocity', 'rpm', 'height'], // default: all shown
    };
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

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