/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LiveTracker from '../GoSocket';

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

function encodeTelemetryUpdate(input: {
  device_id: string;
  lat: number;
  lon: number;
  rpm: number;
  wobble: number;
}): ArrayBuffer {
  const bytes = concatBytes([
    encodeFieldString(1, input.device_id),
    encodeFieldDouble(2, input.lat),
    encodeFieldDouble(3, input.lon),
    encodeFieldDouble(4, input.rpm),
    encodeFieldDouble(5, input.wobble),
  ]);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];

  readyState = 0;
  binaryType = 'blob';
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.(new CloseEvent('close', { code: 1000, reason: 'test close', wasClean: true }));
  }

  emitOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  emitMessage(data: ArrayBuffer): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}

describe('GoSocket telemetry wiring', () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.WebSocket = originalWebSocket;
  });

  it('renders live telemetry values from backend TelemetryUpdate payload', async () => {
    render(<LiveTracker />);

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeDefined();
    expect(ws.binaryType).toBe('arraybuffer');

    act(() => {
      ws.emitOpen();
    });

    const payload = encodeTelemetryUpdate({
      device_id: 'disc-42',
      lat: 37.7749,
      lon: -122.4194,
      rpm: 812.4,
      wobble: 0.12345,
    });

    act(() => {
      ws.emitMessage(payload);
    });

    await waitFor(() => {
      expect(screen.getByText('Device: disc-42')).toBeTruthy();
      expect(screen.getByText('Latitude: 37.774900')).toBeTruthy();
      expect(screen.getByText('Longitude: -122.419400')).toBeTruthy();
      expect(screen.getByText('RPM: 812')).toBeTruthy();
      expect(screen.getByText('Wobble: 0.123 g')).toBeTruthy();
      expect(screen.getByText('Connected')).toBeTruthy();
    });
  });

  it('shows disconnected/error state when payload schema is invalid', async () => {
    render(<LiveTracker />);

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeDefined();

    act(() => {
      ws.emitOpen();
    });

    // Malformed payload: includes only field #2 (lat), missing required device_id field #1
    const malformed = concatBytes([
      encodeFieldDouble(2, 37.1),
    ]);

    act(() => {
      ws.emitMessage(malformed.buffer.slice(
        malformed.byteOffset,
        malformed.byteOffset + malformed.byteLength
      ) as ArrayBuffer);
    });

    await waitFor(() => {
      expect(screen.getByText('Disconnected')).toBeTruthy();
      expect(screen.getByText(/TelemetryUpdate missing required device_id/)).toBeTruthy();
    });
  });
});
