/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LiveTracker from '../TelemetryLiveTracker';
import { DeviceProvider, useDevice } from '../../contexts/DeviceContext';
import { SettingsProvider } from '../../contexts/SettingsContext';
import { useEffect } from 'react';

function encodeVarint(value: number): number[] {
  const out: number[] = [];
  let v = value >>> 0;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return out;
}

function encodeFieldString(fieldNumber: number, value: string): Uint8Array {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);
  const tag = (fieldNumber << 3) | 2;
  return new Uint8Array([...encodeVarint(tag), ...encodeVarint(bytes.length), ...bytes]);
}

function encodeFieldDouble(fieldNumber: number, value: number): Uint8Array {
  const tag = (fieldNumber << 3) | 1;
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, true);
  return new Uint8Array([...encodeVarint(tag), ...bytes]);
}

function encodeFieldInt64(fieldNumber: number, value: number): Uint8Array {
  const tag = (fieldNumber << 3) | 0;
  return new Uint8Array([...encodeVarint(tag), ...encodeVarint(value)]);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function encodeGetTelemetryResponse(input: {
  device_id: string;
  lat: number;
  lon: number;
  rpm: number;
  wobble: number;
  timestamp: number;
}): ArrayBuffer {
  const telemetryUpdateMessage = concatBytes([
    encodeFieldString(1, input.device_id),
    encodeFieldDouble(2, input.lat),
    encodeFieldDouble(3, input.lon),
    encodeFieldDouble(5, input.rpm),
    encodeFieldDouble(6, input.wobble),
    encodeFieldInt64(7, input.timestamp),
  ]);

  const outer = concatBytes([
    new Uint8Array([0x0a]), // GetTelemetryResponse.telemetry (field 1, wire type 2)
    new Uint8Array(encodeVarint(telemetryUpdateMessage.length)),
    telemetryUpdateMessage,
  ]);

  return outer.buffer.slice(outer.byteOffset, outer.byteOffset + outer.byteLength) as ArrayBuffer;
}

function ConnectedTracker({ activeSessionDeviceId = 'disc-42' }: { activeSessionDeviceId?: string }) {
  const { connectDevice } = useDevice();

  useEffect(() => {
    connectDevice('disc-42', 'Driver');
  }, [connectDevice]);

  return <LiveTracker activeSessionId="session-1" activeSessionDeviceId={activeSessionDeviceId} />;
}

describe('TelemetryLiveTracker polling telemetry', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () =>
        encodeGetTelemetryResponse({
          device_id: 'disc-42',
          lat: 37.7749,
          lon: -122.4194,
          rpm: 812.4,
          wobble: 0.12345,
          timestamp: 1710000000000,
        }),
      status: 200,
      statusText: 'OK',
    } as unknown as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders live telemetry values from protobuf polling response', async () => {
    render(
      <SettingsProvider>
        <DeviceProvider>
          <ConnectedTracker />
        </DeviceProvider>
      </SettingsProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Driver Telemetry')).toBeTruthy();
      expect(screen.getByText('Latitude: 37.774900')).toBeTruthy();
      expect(screen.getByText('Longitude: -122.419400')).toBeTruthy();
      expect(screen.getByText('RPM: 812')).toBeTruthy();
      expect(screen.getByText('Wobble: 0.123 g')).toBeTruthy();
      expect(screen.getByText('Active')).toBeTruthy();
    });

    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it('does not poll telemetry when the active session targets a different device', async () => {
    render(
      <SettingsProvider>
        <DeviceProvider>
          <ConnectedTracker activeSessionDeviceId="device-001" />
        </DeviceProvider>
      </SettingsProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Driver Telemetry')).toBeTruthy();
      expect(screen.getByText('Session/device mismatch')).toBeTruthy();
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
