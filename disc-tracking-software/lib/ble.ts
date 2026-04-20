import { encodeMessage, decodePing, encodeHardwarePing, encodeSyncBatch, PingData } from './pb/codec';
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
      pipelineStats.decodeCount++;
      pipelineStats.encodeCount++;
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
  private onSyncStatusCallback?: (status: 'idle' | 'success' | 'error') => void;

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
  }

  onPing(callback: (ping: PingData) => void): () => void {
    this.pingListeners.push(callback);
    return () => {
      this.pingListeners = this.pingListeners.filter(cb => cb !== callback);
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

      const data = new Uint8Array(target.value.buffer);
      const hexStr = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');

      const ping = decodePing(data);
      // Stamp device_id from the connected/synced device
      if (!ping.device_id) {
        ping.device_id = this.connectedDeviceId;
      }

      // Full decoded field map for debug console (attached as expandable data)
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

      // Single compact log line per ping with GPS + sensor summary
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

      // Pre-encode to hardware.proto format for validation (no separate log)
      encodeHardwarePing(ping);

      if (this.throwActive) {
        this.pingBuffer.push(ping);
      }

      for (const listener of this.pingListeners) {
        listener(ping);
      }

    } catch (error) {
      pipelineLog('DECODE:PROTO', 'error', `${(error as Error).message}`);
      logError(error instanceof Error ? error : new Error(String(error)), 'handlePingNotification');
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
      'Accept': 'application/json',
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