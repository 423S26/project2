// contexts/DeviceContext.tsx
'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

export type ConnectedDevice = {
  deviceId: string;
  discName: string;
  connectedAt: Date;
} | null;

type DeviceContextType = {
  connectedDevice: ConnectedDevice;
  connectDevice: (deviceId: string, discName: string) => void;
  disconnectDevice: () => void;
};

const DeviceContext = createContext<DeviceContextType | undefined>(undefined);

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [connectedDevice, setConnectedDevice] = useState<ConnectedDevice>(null);

  const connectDevice = (deviceId: string, discName: string) => {
    setConnectedDevice({
      deviceId,
      discName,
      connectedAt: new Date(),
    });
  };

  const disconnectDevice = () => {
    setConnectedDevice(null);
  };

  return (
    <DeviceContext.Provider value={{ connectedDevice, connectDevice, disconnectDevice }}>
      {children}
    </DeviceContext.Provider>
  );
}

export function useDevice() {
  const context = useContext(DeviceContext);
  if (context === undefined) {
    throw new Error('useDevice must be used within a DeviceProvider');
  }
  return context;
}