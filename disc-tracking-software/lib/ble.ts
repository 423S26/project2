import { encodeMessage, decodePing, PingData } from './pb/codec';
import { getClientAuthHeaders } from './auth-headers';
import { FirmwareConnectionError, logError } from './errors';

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
  private pingBuffer: PingData[] = [];
  private pendingBatches: PingData[][] = [];
  private throwActive = false;
  private onPingCallback?: (ping: PingData) => void;
  private onSyncStatusCallback?: (status: 'idle' | 'success' | 'error') => void;

  private readonly API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  private readonly PENDING_BATCHES_KEY = 'pendingTelemetryBatchesV1';

  constructor() {
    this.pendingBatches = this.loadPendingBatches();
  }

  async connect(deviceId: string): Promise<void> {
    try {
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

      // Set up notification handler
      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', this.handlePingNotification.bind(this));

      // Attempt to flush previously failed batches after reconnect.
      void this.flushPendingBatches();

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new FirmwareConnectionError(
        `BLE connection failed: ${err.message}`,
        undefined,
        { deviceId, originalError: err.message }
      );
    }
  }

  disconnect(): void {
    if (this.connection) {
      this.connection.disconnect();
    }
  }

  onPing(callback: (ping: PingData) => void): void {
    this.onPingCallback = callback;
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
      const ping = decodePing(data);

      if (this.throwActive) {
        this.pingBuffer.push(ping);
      }

      if (this.onPingCallback) {
        this.onPingCallback(ping);
      }

    } catch (error) {
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
    const payload = encodeMessage({ pings });
    const requestBody = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer;

    const authHeaders = await this.getAuthHeaders();
    const response = await fetch(`${this.API_BASE_URL}/api/v1/telemetry/upload`, {
      method: 'POST',
      headers: authHeaders,
      body: requestBody,
    });

    if (!response.ok) {
      throw new Error(`Telemetry upload failed: ${response.status}`);
    }
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