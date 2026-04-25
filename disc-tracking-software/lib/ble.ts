import { decodePing, encodeHardwarePing, encodeSyncBatch, PingData, splitPingFrames } from './pb/codec';
import { getClientAuthHeaders } from './auth-headers';
import { FirmwareConnectionError, logError } from './errors';

// ──────────────────────────────────────────────────────────────
// TUI Pipeline — full-stack end-to-end telemetry logging
// Bottom → Top:  BLE → DECODE → ENCODE → API → GIN → AUTH
// ──────────────────────────────────────────────────────────────

export type PipelineStage =
  | 'BLE:CONN' | 'BLE:RX'
  | 'DECODE:PROTO' | 'DECODE:ENV'
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

const TRACKER_SERVICE_UUID = '19b10000-e8f2-537e-4f6c-d104768a1214';
const PING_CHARACTERISTIC_UUID = '19b10001-e8f2-537e-4f6c-d104768a1214';

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
  private pingBuffer: PingData[] = [];
  private pendingBatches: PingData[][] = [];
  private throwActive = false;
  private pingListeners: Array<(ping: PingData) => void> = [];
  private rssiListeners: Array<(rssi: number) => void> = [];
  private onSyncStatusCallback?: (status: 'idle' | 'success' | 'error') => void;
  private readonly BLE_CHUNK_SIZE = 20;
  private readonly FRAME_IDLE_FLUSH_MS = 40;
  private readonly FRAGMENT_STALE_RESET_MS = 2000;
  private readonly MAX_FRAME_BYTES = 2048;
  private rxFrameBuffer: number[] = [];
  private frameFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private fragmentStaleTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
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

      // Connect to GATT server
      const server = await device.gatt!.connect();

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

      // Get the service
      const service = await server.getPrimaryService(TRACKER_SERVICE_UUID);

      // Get the characteristic
      const characteristic = await service.getCharacteristic(PING_CHARACTERISTIC_UUID);

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

  onPing(callback: (ping: PingData) => void): () => void {
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
      this.appendChunk(chunk);

      // Firmware streams protobuf frames over 20-byte BLE notifications.
      // A short chunk usually marks frame end; exact-multiple frames are flushed on idle.
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
      pipelineLog(
        'DECODE:PROTO',
        'warn',
        `RX frame exceeded ${this.MAX_FRAME_BYTES}B; resetting assembler to prevent overflow`,
      );
      this.resetRxAssembler();
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

    if (frames.length === 0 && remainder.length === data.length && remainder.length > 0) {
      pipelineLog('DECODE:PROTO', 'warn', `Holding ${remainder.length}B awaiting a complete protobuf frame`);
      this.scheduleFragmentStaleReset();
      return;
    }

    if (remainder.length > 0) {
      pipelineLog('DECODE:PROTO', 'info', `Holding ${remainder.length}B trailing fragment for the next BLE payload`);
      this.scheduleFragmentStaleReset();
      return;
    }

    this.clearFragmentStaleTimer();
  }

  private processPingFrame(data: Uint8Array): void {
    const hexStr = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');

    let ping: PingData;
    try {
      ping = decodePing(data);
    } catch (error) {
      pipelineLog('DECODE:PROTO', 'warn', `Dropped invalid frame (${data.length}B)`);
      logError(error instanceof Error ? error : new Error(String(error)), 'processPingFrame.decodePing');
      return;
    }

    if (!this.isLikelyCompletePing(ping)) {
      pipelineLog('DECODE:PROTO', 'warn', `Dropped partial frame (${data.length}B) without timestamp`);
      return;
    }

    if (!ping.device_id) {
      ping.device_id = this.connectedDeviceId;
    }

    const decodedFields: Record<string, string | number | boolean> = {
      device_id: ping.device_id,
      lat: ping.lat,
      lon: ping.lon,
      alt: ping.alt,
      speed_mps: ping.speed_mps,
      heading: ping.heading,
      hdop: ping.hdop,
      sats: ping.sats,
      temp_c: ping.temp_c,
      accel_x: ping.accel_x,
      accel_y: ping.accel_y,
      accel_z: ping.accel_z,
      gyro_x: ping.gyro_x,
      gyro_y: ping.gyro_y,
      gyro_z: ping.gyro_z,
      timestamp: ping.timestamp,
      batt_pct: ping.batt_pct,
    };

    const gps = ping.lat !== 0 || ping.lon !== 0
      ? `GPS(${ping.lat.toFixed(6)},${ping.lon.toFixed(6)},${ping.alt.toFixed(0)}m sats=${ping.sats})`
      : 'GPS(no fix)';
    const imu = `IMU(a=${ping.accel_x.toFixed(1)},${ping.accel_y.toFixed(1)},${ping.accel_z.toFixed(1)} g=${ping.gyro_x.toFixed(0)},${ping.gyro_y.toFixed(0)},${ping.gyro_z.toFixed(0)})`;

    pipelineLog(
      'BLE:RX', 'info',
      `${data.length}B ${gps} ${imu} bat=${ping.batt_pct}%`,
      hexStr,
      decodedFields,
    );

    encodeHardwarePing(ping);

    if (this.throwActive) {
      this.pingBuffer.push(ping);
    }

    for (const listener of this.pingListeners) {
      listener(ping);
    }
  }

  private isLikelyCompletePing(ping: PingData): boolean {
    // Firmware should always set timestamp. Using it as a guard prevents
    // partial fragment decodes from propagating null/default telemetry values.
    return Number.isFinite(ping.timestamp) && ping.timestamp > 0;
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

    const remaining: PingData[][] = [];
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

  private async uploadBatch(pings: PingData[]): Promise<void> {
    const deviceId = this.connectedDeviceId || pings[0]?.device_id || '';
    const payload = encodeSyncBatch(pings, deviceId);
    const requestBody = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer;

    const authHeaders = await this.getAuthHeaders();
    const response = await fetch(`${this.API_BASE_URL}/api/v1/telemetry/upload`, {
      method: 'POST',
      headers: authHeaders,
      body: requestBody,
    });

    if (!response.ok) {
      pipelineLog('SYNC:UPLOAD', 'error', `HTTP ${response.status} — ${pings.length} pings failed`);
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

  private loadPendingBatches(): PingData[][] {
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