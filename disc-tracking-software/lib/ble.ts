import { encodeMessage, decodePing, PingData } from './pb/codec';
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
  private onPingCallback?: (ping: PingData) => void;
  private syncInterval?: NodeJS.Timeout;

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
          this.connection = null;
          this.stopSync();
        },
      };

      // Set up notification handler
      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', this.handlePingNotification.bind(this));

      // Start periodic sync
      this.startSync();

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

  private handlePingNotification(event: Event): void {
    try {
      const target = event.target as { value?: DataView };
      if (!target.value) return;

      const data = new Uint8Array(target.value.buffer);
      const ping = decodePing(data);

      this.pingBuffer.push(ping);

      if (this.onPingCallback) {
        this.onPingCallback(ping);
      }

    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'handlePingNotification');
    }
  }

  private startSync(): void {
    // Sync every 5 seconds or when buffer reaches 10 pings
    this.syncInterval = setInterval(() => {
      if (this.pingBuffer.length >= 10) {
        this.syncBuffer();
      }
    }, 5000);
  }

  private stopSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = undefined;
    }
    this.syncBuffer(); // Send remaining pings
  }

  private async syncBuffer(): Promise<void> {
    if (this.pingBuffer.length === 0) return;

    try {
      const batch = {
        pings: this.pingBuffer,
      };

      const batchBytes = encodeMessage(batch);
      const requestBody = batchBytes.buffer.slice(batchBytes.byteOffset, batchBytes.byteOffset + batchBytes.byteLength) as ArrayBuffer;

      const response = await fetch('http://localhost:8080/api/v1/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/protobuf',
        },
        body: requestBody,
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.status}`);
      }

      this.pingBuffer = []; // Clear buffer on success

    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'syncBuffer');
      // Keep buffer for retry
    }
  }
}

// Singleton instance
export const bleManager = new BLEManager();