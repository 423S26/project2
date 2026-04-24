import { describe, expect, it } from 'vitest';

import { decodePing, encodeHardwarePing, splitPingFrames, type PingData } from '@/lib/pb/codec';

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

function makePing(overrides: Partial<PingData>): PingData {
  return {
    device_id: 'disc-001',
    lat: 32.7767,
    lon: -96.797,
    alt: 154.25,
    speed_mps: 18.5,
    heading: 270.25,
    hdop: 0.9,
    sats: 8,
    temp_c: 24.5,
    accel_x: 0.15,
    accel_y: 0.25,
    accel_z: 1.1,
    gyro_x: 120.5,
    gyro_y: 240.25,
    gyro_z: 1020,
    timestamp: 1713654321000,
    batt_pct: 92,
    ...overrides,
  };
}

describe('splitPingFrames', () => {
  it('holds incomplete 20-byte BLE fragments until a full frame is present', () => {
    const encoded = encodeHardwarePing(makePing({}));
    const firstChunk = encoded.slice(0, 20);

    const initial = splitPingFrames(firstChunk);
    expect(initial.frames).toHaveLength(0);
    expect(initial.remainder).toEqual(firstChunk);

    const completed = splitPingFrames(concatBytes(firstChunk, encoded.slice(20)));
    expect(completed.frames).toHaveLength(1);
    expect(completed.remainder).toHaveLength(0);

    const decoded = decodePing(completed.frames[0]);
    expect(decoded.timestamp).toBe(1713654321000);
    expect(decoded.device_id).toBe('disc-001');
    expect(decoded.gyro_z).toBeCloseTo(1020, 3);
  });

  it('splits two complete back-to-back Ping frames from one byte stream', () => {
    const firstPing = encodeHardwarePing(makePing({ device_id: 'disc-a', timestamp: 1713654321001 }));
    const secondPing = encodeHardwarePing(makePing({ device_id: 'disc-b', timestamp: 1713654321002, gyro_z: 980 }));

    const result = splitPingFrames(concatBytes(firstPing, secondPing));
    expect(result.frames).toHaveLength(2);
    expect(result.remainder).toHaveLength(0);

    const decodedFirst = decodePing(result.frames[0]);
    const decodedSecond = decodePing(result.frames[1]);

    expect(decodedFirst.device_id).toBe('disc-a');
    expect(decodedFirst.timestamp).toBe(1713654321001);
    expect(decodedSecond.device_id).toBe('disc-b');
    expect(decodedSecond.timestamp).toBe(1713654321002);
    expect(decodedSecond.gyro_z).toBeCloseTo(980, 3);
  });

  it('returns a partial trailing frame as remainder while emitting complete leading frames', () => {
    const firstPing = encodeHardwarePing(makePing({ device_id: 'disc-a', timestamp: 1713654322001 }));
    const secondPing = encodeHardwarePing(makePing({ device_id: 'disc-b', timestamp: 1713654322002 }));
    const partialSecond = secondPing.slice(0, 20);

    const result = splitPingFrames(concatBytes(firstPing, partialSecond));
    expect(result.frames).toHaveLength(1);
    expect(result.remainder).toEqual(partialSecond);

    const decoded = decodePing(result.frames[0]);
    expect(decoded.device_id).toBe('disc-a');
    expect(decoded.timestamp).toBe(1713654322001);
  });
});