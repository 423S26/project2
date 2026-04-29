import { Ping, PingBatch } from './pb/hardware';
import { splitPingFrames } from './pb/framing';
import { getClientAuthHeaders } from './auth-headers';
import { FirmwareConnectionError, logError } from './errors';

// ──────────────────────────────────────────────────────────────
// TUI Pipeline — full-stack end-to-end telemetry logging
// Bottom → Top:  BLE → DECODE → ENCODE → API → GIN → AUTH
// ──────────────────────────────────────────────────────────────

export type PipelineStage =
  | 'BLE:CONN' | 'BLE:RX'
  | 'DECODE:PROTO'
  | 'ENCODE:HW'
  | 'SYNC:UPLOAD'
  | 'API:REQ' | 'API:RES' | 'API:DECODE'
  | 'GIN:HTTP' | 'GIN:DB'
  | 'AUTH:SESSION';
export type PipelineLevel = 'info' | 'warn' | 'error';

export interface PipelineLogEntry {
  stage: PipelineStage;
  level: PipelineLevel;
  message: string;
  timestamp: number;
  hex?: string;
  /** Decoded field values for telemetry detail views */
  data?: Record<string, string | number | boolean>;
}

export interface PipelineStats {
  rxCount: number;
  decodeCount: number;
  encodeCount: number;
  uploadCount: number;
  errorCount: number;
  apiReqCount: number;
  apiResCount: number;
  ginCount: number;
  authCount: number;
  bleConnected: boolean;
  lastRxAt: number | null;
  lastUploadAt: number | null;
  lastApiAt: number | null;
}

const MAX_PIPELINE_LOGS = 200;

let pipelineLogs: PipelineLogEntry[] = [];
let pipelineStats: PipelineStats = {
  rxCount: 0,
  decodeCount: 0,
  encodeCount: 0,
  uploadCount: 0,
  errorCount: 0,
  apiReqCount: 0,
  apiResCount: 0,
  ginCount: 0,
  authCount: 0,
  bleConnected: false,
  lastRxAt: null,
  lastUploadAt: null,
  lastApiAt: null,
};

type PipelineListener = (entry: PipelineLogEntry, stats: PipelineStats) => void;
let pipelineListeners: PipelineListener[] = [];

// Map PipelineLevel → server-side status tags used by /api/pipeline-log
const LEVEL_TO_STATUS: Record<PipelineLevel, string> = {
  info: 'ok',
  warn: 'warn',
  error: 'fail',
};

// Flush queued pipeline entries to the server-side TUI via /api/pipeline-log
let serverLogQueue: Array<{ stage: string; status: string; message: string; hex?: string; data?: Record<string, string | number | boolean> }> = [];
let serverLogTimer: ReturnType<typeof setTimeout> | null = null;

function flushServerLog(): void {
  if (serverLogQueue.length === 0) return;
  const batch = serverLogQueue;
  serverLogQueue = [];
  serverLogTimer = null;

  fetch('/api/pipeline-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines: batch }),
  }).catch(() => {
    // Swallow — server may not be ready yet
  });
}

function enqueueServerLog(stage: string, level: PipelineLevel, message: string, hex?: string, data?: Record<string, string | number | boolean>): void {
  serverLogQueue.push({ stage, status: LEVEL_TO_STATUS[level], message, hex, data });
  if (!serverLogTimer) {
    serverLogTimer = setTimeout(flushServerLog, 50);
  }
}

export function pipelineLog(
  stage: PipelineStage,
  level: PipelineLevel,
  message: string,
  hex?: string,
  data?: Record<string, string | number | boolean>,
): void {
  const entry: PipelineLogEntry = { stage, level, message, timestamp: Date.now(), hex, data };

  // Browser console output (plain log to avoid stack traces)
  const tag = `[${stage}]`;
  if (level === 'error') console.log(`%c${tag} FAIL`, 'color:#f87171', message);
  else if (level === 'warn') console.log(`%c${tag} WARN`, 'color:#facc15', message);
  else console.log(tag, message);

  // Forward to server-side TUI (Gin-style colored terminal output)
  enqueueServerLog(stage, level, message, hex, data);

  pipelineLogs.push(entry);
  if (pipelineLogs.length > MAX_PIPELINE_LOGS) {
    pipelineLogs = pipelineLogs.slice(-MAX_PIPELINE_LOGS);
  }

  // Update stats counters
  if (level === 'error') pipelineStats.errorCount++;
  switch (stage) {
    case 'BLE:CONN':
      pipelineStats.bleConnected = level !== 'error' && !message.toLowerCase().includes('disconnect');
      break;
    case 'BLE:RX':
      pipelineStats.rxCount++;
      pipelineStats.lastRxAt = entry.timestamp;
      break;
    case 'DECODE:PROTO':
      pipelineStats.decodeCount++;
      break;
    case 'ENCODE:HW':
      pipelineStats.encodeCount++;
      break;
    case 'SYNC:UPLOAD':
      if (level !== 'error') {
        pipelineStats.uploadCount++;
        pipelineStats.lastUploadAt = entry.timestamp;
      }
      break;
    case 'API:REQ':
      pipelineStats.apiReqCount++;
      pipelineStats.lastApiAt = entry.timestamp;
      break;
    case 'API:RES':
      pipelineStats.apiResCount++;
      break;
    case 'GIN:HTTP':
    case 'GIN:DB':
      pipelineStats.ginCount++;
      break;
    case 'AUTH:SESSION':
      pipelineStats.authCount++;
      break;
  }

  for (const listener of pipelineListeners) {
    listener(entry, pipelineStats);
  }
}

export function onPipelineLog(listener: PipelineListener): () => void {
  pipelineListeners.push(listener);
  return () => {
    pipelineListeners = pipelineListeners.filter((l) => l !== listener);
  };
}

export function getPipelineStats(): PipelineStats {
  return { ...pipelineStats };
}

export function getPipelineLogs(): PipelineLogEntry[] {
  return [...pipelineLogs];
}

export function clearPipelineLogs(): void {
  pipelineLogs = [];
  pipelineStats = {
    rxCount: 0,
    decodeCount: 0,
    encodeCount: 0,
    uploadCount: 0,
    errorCount: 0,
    apiReqCount: 0,
    apiResCount: 0,
    ginCount: 0,
    authCount: 0,
    bleConnected: pipelineStats.bleConnected,
    lastRxAt: null,
    lastUploadAt: null,
    lastApiAt: null,
  };
  for (const listener of pipelineListeners) {
    listener(
      { stage: 'BLE:CONN', level: 'info', message: 'Pipeline logs cleared', timestamp: Date.now() },
      pipelineStats,
    );
  }
}

// Firmware advertises 16-bit UUIDs (service 0xB120, char 0xB11A). Web Bluetooth
// requires the full 128-bit form for non-standard UUIDs:
//   0000XXXX-0000-1000-8000-00805f9b34fb  (Bluetooth SIG base UUID)
const TRACKER_SERVICE_UUID = '0000b120-0000-1000-8000-00805f9b34fb';
const PING_CHARACTERISTIC_UUID = '0000b11a-0000-1000-8000-00805f9b34fb';

type BLEDevice = {
  gatt?: BLERemoteGATTServer | null;
  watchAdvertisements?: () => Promise<void>;
  addEventListener?: (type: string, listener: (e: any) => void) => void;
  removeEventListener?: (type: string, listener: (e: any) => void) => void;
};

type BLERemoteGATTServer = {
  connected: boolean;
  connect(): Promise<BLERemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BLERemoteGATTService>;
};

type BLERemoteGATTService = {
  getCharacteristic(uuid: string): Promise<BLERemoteGATTCharacteristic>;
};

type BLERemoteGATTCharacteristic = {
  value?: DataView;
  startNotifications(): Promise<void>;
  addEventListener(type: 'characteristicvaluechanged', listener: (event: Event) => void): void;
};

type BLENavigator = Navigator & {
  bluetooth?: {
    requestDevice(options: { filters: Array<{ services: string[] }>; optionalServices?: string[] }): Promise<BLEDevice>;
  };
};

export interface BLEConnection {
  device: BLEDevice;
  server: BLERemoteGATTServer;
  service: BLERemoteGATTService;
  characteristic: BLERemoteGATTCharacteristic;
  disconnect: () => void;
}

export class BLEManager {
  private connection: BLEConnection | null = null;
  private connectedDeviceId = '';
  private pingBuffer: Ping[] = [];
  private pendingBatches: Ping[][] = [];
  private throwActive = false;
  private pingListeners: Array<(ping: Ping) => void> = [];
  private rssiListeners: Array<(rssi: number) => void> = [];
  private onSyncStatusCallback?: (status: 'idle' | 'success' | 'error') => void;
  private readonly BLE_CHUNK_SIZE = 20;
  private readonly FRAME_IDLE_FLUSH_MS = 40;
  private readonly FRAGMENT_STALE_RESET_MS = 5000;
  private readonly MAX_FRAME_BYTES = 16384;
  private rxFrameBuffer: number[] = [];
  private frameFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private fragmentStaleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHoldLogAt = 0;
  private lastHoldLogSize = -1;

  private readonly API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080')
    .replace(/\/+$/, '')
    .replace(/\/api\/v1$/, '');
  private readonly PENDING_BATCHES_KEY = 'pendingTelemetryBatchesV1';

  constructor() {
    this.pendingBatches = this.loadPendingBatches();
  }

  async connect(deviceId: string): Promise<void> {
    try {
      pipelineLog('BLE:CONN', 'info', `Scanning for device ${deviceId}…`);
      const navigatorWithBluetooth = navigator as unknown as BLENavigator;
      if (!navigatorWithBluetooth.bluetooth) {
        throw new FirmwareConnectionError('Web Bluetooth API not supported in this browser', undefined, {
          userAgent: navigator.userAgent,
        });
      }

      // Request device with the tracker service
      const device = await navigatorWithBluetooth.bluetooth.requestDevice({
        filters: [{ services: [TRACKER_SERVICE_UUID] }],
        optionalServices: [],
      });

      if (!device) {
        throw new FirmwareConnectionError('No device selected', undefined);
      }

      // Surface OS-side disconnects (Windows idle-kill, supervision timeout,
      // user toggling Bluetooth, etc). Register this BEFORE the first connect
      // so we never miss an early disconnect during discovery.
      if (device.addEventListener) {
        device.addEventListener('gattserverdisconnected', () => {
          pipelineLog('BLE:CONN', 'warn', 'GATT server disconnected (OS or peer)');
          this.resetRxAssembler();
          this.connection = null;
        });
      }

      // Connect + discover with retry. On Windows, the firmware's Service
      // Changed indication can drop the link mid-discovery the first time
      // a host connects. Retry the whole connect→getService→getChar flow
      // until it survives long enough for notifications to be enabled.
      let server!: BLERemoteGATTServer;
      let service!: BLERemoteGATTService;
      let characteristic!: BLERemoteGATTCharacteristic;
      let lastErr: unknown;
      let connected = false;
      for (let attempt = 1; attempt <= 5 && !connected; attempt++) {
        try {
          server = await device.gatt!.connect();
          service = await server.getPrimaryService(TRACKER_SERVICE_UUID);
          characteristic = await service.getCharacteristic(PING_CHARACTERISTIC_UUID);
          connected = true;
        } catch (e) {
          lastErr = e;
          pipelineLog('BLE:CONN', 'warn', `Connect attempt ${attempt} failed: ${(e as Error).message}`);
          await new Promise(r => setTimeout(r, 600));
        }
      }
      if (!connected) {
        throw new FirmwareConnectionError(
          'GATT link kept dropping during discovery — reboot tracker and forget device in Windows Bluetooth settings',
          undefined,
          { cause: (lastErr as Error)?.message },
        );
      }

      // Retrieve RSSI if supported (Directional Tracking Fallback)
      if (device.watchAdvertisements && device.addEventListener) {
        try {
          await device.watchAdvertisements();
          device.addEventListener('advertisementreceived', (event: any) => {
            if (event.rssi != null && this.rssiListeners.length > 0) {
              this.rssiListeners.forEach(cb => cb(event.rssi));
            }
          });
          pipelineLog('BLE:CONN', 'info', `Monitoring BLE RSSI for distance fallback`);
        } catch (e) {
          pipelineLog('BLE:CONN', 'info', `watchAdvertisements not supported`);
        }
      }

      this.connection = {
        device,
        server,
        service,
        characteristic,
        disconnect: () => {
          if (server.connected) {
            server.disconnect();
          }
          this.enqueueCurrentThrow();
          this.connection = null;
        },
      };

      // Store the synced device ID so pings are stamped with it
      this.connectedDeviceId = deviceId;

      // Set up notification handler
      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', this.handlePingNotification.bind(this));

      pipelineLog('BLE:CONN', 'info', `Connected to ${deviceId} — notifications active`);

      // Attempt to flush previously failed batches after reconnect.
      void this.flushPendingBatches();

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      pipelineLog('BLE:CONN', 'error', `Connection failed: ${err.message}`);
      throw new FirmwareConnectionError(
        `BLE connection failed: ${err.message}`,
        undefined,
        { deviceId, originalError: err.message }
      );
    }
  }

  disconnect(): void {
    if (this.connection) {
      pipelineLog('BLE:CONN', 'warn', 'Disconnecting…');
      this.connection.disconnect();
    }
    this.resetRxAssembler();
  }

  onPing(callback: (ping: Ping) => void): () => void {
    this.pingListeners.push(callback);
    return () => {
      this.pingListeners = this.pingListeners.filter(cb => cb !== callback);
    };
  }

  onRssi(callback: (rssi: number) => void): () => void {
    this.rssiListeners.push(callback);
    return () => {
      this.rssiListeners = this.rssiListeners.filter(cb => cb !== callback);
    };
  }

  onSyncStatus(callback: (status: 'idle' | 'success' | 'error') => void): void {
    this.onSyncStatusCallback = callback;
  }

  markThrowStarted(): void {
    this.throwActive = true;
    this.pingBuffer = [];
    this.onSyncStatusCallback?.('idle');
  }

  async markThrowLanded(): Promise<void> {
    this.enqueueCurrentThrow();
    await this.flushPendingBatches();
  }

  private handlePingNotification(event: Event): void {
    try {
      const target = event.target as { value?: DataView };
      if (!target.value) return;

      // DataView may reference a larger backing buffer. Respect byteOffset/byteLength
      // so we only consume the current BLE notification payload.
      const chunk = new Uint8Array(target.value.buffer, target.value.byteOffset, target.value.byteLength);

      // Firmware path: each notify() carries exactly one complete protobuf Ping
      // message (no length prefix). Try a direct decode first; if that succeeds,
      // bypass the chunk assembler entirely. This is the normal hot path.
      if (chunk.length > 0 && this.tryDecodeWholeFrame(chunk)) {
        return;
      }

      // Fallback: legacy/length-prefixed stream or fragmented MTU path.
      // Accumulate and let splitPingFrames sort it out.
      this.appendChunk(chunk);

      if (chunk.length < this.BLE_CHUNK_SIZE) {
        this.flushAssembledFrame();
      } else {
        this.scheduleFrameFlush();
      }

    } catch (error) {
      pipelineLog('DECODE:PROTO', 'error', `${(error as Error).message}`);
      logError(error instanceof Error ? error : new Error(String(error)), 'handlePingNotification');
    }
  }

  private appendChunk(chunk: Uint8Array): void {
    if (chunk.length === 0) return;

    this.clearFragmentStaleTimer();

    for (const b of chunk) {
      this.rxFrameBuffer.push(b);
    }

    if (this.rxFrameBuffer.length > this.MAX_FRAME_BYTES) {
      const overflowBytes = this.rxFrameBuffer.length - this.MAX_FRAME_BYTES;
      this.rxFrameBuffer = this.rxFrameBuffer.slice(overflowBytes);
      pipelineLog(
        'DECODE:PROTO',
        'warn',
        `RX frame exceeded ${this.MAX_FRAME_BYTES}B; dropped oldest ${overflowBytes}B to keep stream alive`,
      );
    }
  }

  private scheduleFrameFlush(): void {
    if (this.frameFlushTimer) {
      clearTimeout(this.frameFlushTimer);
    }
    this.frameFlushTimer = setTimeout(() => {
      this.flushAssembledFrame();
    }, this.FRAME_IDLE_FLUSH_MS);
  }

  private clearFrameFlushTimer(): void {
    if (!this.frameFlushTimer) return;
    clearTimeout(this.frameFlushTimer);
    this.frameFlushTimer = null;
  }

  private scheduleFragmentStaleReset(): void {
    this.clearFragmentStaleTimer();
    if (this.rxFrameBuffer.length === 0) return;

    this.fragmentStaleTimer = setTimeout(() => {
      if (this.rxFrameBuffer.length === 0) {
        this.fragmentStaleTimer = null;
        return;
      }

      pipelineLog(
        'DECODE:PROTO',
        'warn',
        `Discarding stale partial protobuf frame after ${this.FRAGMENT_STALE_RESET_MS}ms (${this.rxFrameBuffer.length}B)`
      );
      this.resetRxAssembler();
    }, this.FRAGMENT_STALE_RESET_MS);
  }

  private clearFragmentStaleTimer(): void {
    if (!this.fragmentStaleTimer) return;
    clearTimeout(this.fragmentStaleTimer);
    this.fragmentStaleTimer = null;
  }

  private resetRxAssembler(): void {
    this.clearFrameFlushTimer();
    this.clearFragmentStaleTimer();
    this.rxFrameBuffer = [];
    this.lastHoldLogAt = 0;
    this.lastHoldLogSize = -1;
  }

  private logHeldFragment(size: number, trailing: boolean = false): void {
    const now = Date.now();
    const sizeChanged = this.lastHoldLogSize !== size;
    const quietWindowElapsed = now - this.lastHoldLogAt >= 1500;
    if (!sizeChanged && !quietWindowElapsed) {
      return;
    }

    this.lastHoldLogAt = now;
    this.lastHoldLogSize = size;

    if (trailing) {
      pipelineLog('DECODE:PROTO', 'info', `Holding ${size}B trailing fragment for the next BLE payload`);
      return;
    }

    pipelineLog('DECODE:PROTO', 'warn', `Holding ${size}B awaiting a complete protobuf frame`);
  }

  private flushAssembledFrame(): void {
    this.clearFrameFlushTimer();
    if (this.rxFrameBuffer.length === 0) return;

    const data = new Uint8Array(this.rxFrameBuffer);
    const { frames, remainder } = splitPingFrames(data);
    this.rxFrameBuffer = Array.from(remainder);

    for (const frame of frames) {
      this.processPingFrame(frame);
    }

    if (remainder.length > 0) {
      try {
        const probe = Ping.fromBinary(remainder);
        if (this.isLikelyCompletePing(probe)) {
          this.processPingFrame(remainder);
          this.rxFrameBuffer = [];
          this.clearFragmentStaleTimer();
          return;
        }
      } catch {
        // Keep buffering partial data until a complete frame can be decoded.
      }
    }

    if (frames.length === 0 && remainder.length === data.length && remainder.length > 0) {
      this.logHeldFragment(remainder.length);
      this.scheduleFragmentStaleReset();
      return;
    }

    if (remainder.length > 0) {
      this.logHeldFragment(remainder.length, true);
      this.scheduleFragmentStaleReset();
      return;
    }

    this.clearFragmentStaleTimer();
  }

  private processPingFrame(data: Uint8Array): void {
    const hexStr = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');

    let ping: Ping;
    try {
      ping = Ping.fromBinary(data);
    } catch (error) {
      pipelineLog('DECODE:PROTO', 'warn', `Dropped invalid frame (${data.length}B)`);
      logError(error instanceof Error ? error : new Error(String(error)), 'processPingFrame.Ping.fromBinary');
      return;
    }

    if (!this.isLikelyCompletePing(ping)) {
      pipelineLog('DECODE:PROTO', 'warn', `Dropped partial frame (${data.length}B) without timestamp`);
      return;
    }

    // Always prefer the currently connected app-level device id for
    // backend ownership checks; firmware-embedded ids may differ.
    if (this.connectedDeviceId) {
      ping.deviceId = this.connectedDeviceId;
    }

    const decodedFields: Record<string, string | number | boolean> = {
      device_id: ping.deviceId,
      lat: ping.lat,
      lon: ping.lon,
      alt: ping.alt,
      speed_mps: ping.speedMps,
      heading: ping.heading,
      hdop: ping.hdop,
      sats: ping.sats,
      temp_c: ping.tempC,
      accel_x: ping.accelX,
      accel_y: ping.accelY,
      accel_z: ping.accelZ,
      gyro_x: ping.gyroX,
      gyro_y: ping.gyroY,
      gyro_z: ping.gyroZ,
      timestamp: ping.timestamp,
      batt_pct: ping.battPct,
    };

    const gps = ping.lat !== 0 || ping.lon !== 0
      ? `GPS(${ping.lat.toFixed(6)},${ping.lon.toFixed(6)},${ping.alt.toFixed(0)}m sats=${ping.sats})`
      : 'GPS(no fix)';
    const imu = `IMU(a=${ping.accelX.toFixed(1)},${ping.accelY.toFixed(1)},${ping.accelZ.toFixed(1)} g=${ping.gyroX.toFixed(0)},${ping.gyroY.toFixed(0)},${ping.gyroZ.toFixed(0)})`;

    pipelineLog(
      'BLE:RX', 'info',
      `${data.length}B ${gps} ${imu} bat=${ping.battPct}%`,
      hexStr,
      decodedFields,
    );

    if (this.throwActive) {
      this.pingBuffer.push(ping);
    }

    for (const listener of this.pingListeners) {
      listener(ping);
    }
  }

  private isLikelyCompletePing(ping: Ping): boolean {
    // Firmware should always set timestamp. Using it as a guard prevents
    // partial fragment decodes from propagating null/default telemetry values.
    return Number.isFinite(ping.timestamp) && ping.timestamp > 0;
  }

  /**
   * Attempts to decode a single BLE notification payload as a complete,
   * unframed protobuf Ping (the firmware's actual wire format). Returns true
   * on success and dispatches the frame; returns false to let the caller fall
   * back to the chunk assembler for fragmented or length-prefixed streams.
   */
  private tryDecodeWholeFrame(chunk: Uint8Array): boolean {
    try {
      const probe = Ping.fromBinary(chunk);
      if (!this.isLikelyCompletePing(probe)) return false;
      this.processPingFrame(chunk);
      return true;
    } catch {
      return false;
    }
  }

  private enqueueCurrentThrow(): void {
    this.throwActive = false;
    if (this.pingBuffer.length === 0) {
      return;
    }

    this.pendingBatches.push([...this.pingBuffer]);
    this.pingBuffer = [];
    this.persistPendingBatches();
  }

  private async flushPendingBatches(): Promise<void> {
    const hadPending = this.pendingBatches.length > 0;
    if (!hadPending) {
      return;
    }

    const remaining: Ping[][] = [];
    for (const batch of this.pendingBatches) {
      try {
        await this.uploadBatch(batch);
      } catch (error) {
        logError(error instanceof Error ? error : new Error(String(error)), 'flushPendingBatches');
        remaining.push(batch);
      }
    }

    this.pendingBatches = remaining;
    this.persistPendingBatches();
    this.onSyncStatusCallback?.(remaining.length === 0 ? 'success' : 'error');
  }

  private async uploadBatch(pings: Ping[]): Promise<void> {
    const deviceId = this.connectedDeviceId || pings[0]?.deviceId || '';
    const normalizedPings = pings.map((ping) => ({
      ...ping,
      deviceId: deviceId || ping.deviceId,
    }));
    const payload = PingBatch.toBinary({
      pings: normalizedPings,
      deviceId: deviceId,
      batchTimestamp: Date.now()
    });
    pipelineLog('ENCODE:HW', 'info', `Encoded ${pings.length} pings → ${payload.length}B`);
    const requestBody = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer;

    const authHeaders = await this.getAuthHeaders();
    const response = await fetch(`${this.API_BASE_URL}/api/v1/telemetry/upload`, {
      method: 'POST',
      headers: authHeaders,
      body: requestBody,
    });

    if (!response.ok) {
      let errorDetail = '';
      try {
        errorDetail = (await response.text()).trim();
      } catch {
        errorDetail = '';
      }

      const detailSuffix = errorDetail ? ` | ${errorDetail.slice(0, 200)}` : '';
      pipelineLog('SYNC:UPLOAD', 'error', `HTTP ${response.status} — ${pings.length} pings failed${detailSuffix}`);
      throw new Error(`Telemetry upload failed: ${response.status}`);
    }

    const uploadHex = Array.from(payload.slice(0, 64)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    pipelineLog(
      'SYNC:UPLOAD', 'info',
      `${pings.length} pings (${payload.length}B) → 200 OK`,
      payload.length > 64 ? uploadHex + ' …' : uploadHex,
      { pings: pings.length, bytes: payload.length, status: 200 },
    );
  }

  private async getAuthHeaders(): Promise<HeadersInit> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/protobuf',
	  'Accept': 'application/protobuf',
    };

    return getClientAuthHeaders(headers);
  }

  private loadPendingBatches(): Ping[][] {
    if (typeof window === 'undefined') {
      return [];
    }

    try {
      const raw = localStorage.getItem(this.PENDING_BATCHES_KEY);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter((batch) => Array.isArray(batch));
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'loadPendingBatches');
      return [];
    }
  }

  private persistPendingBatches(): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      localStorage.setItem(this.PENDING_BATCHES_KEY, JSON.stringify(this.pendingBatches));
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'persistPendingBatches');
    }
  }
}

// Singleton instance
export const bleManager = new BLEManager();

