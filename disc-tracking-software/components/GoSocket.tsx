"use client";
import { useEffect, useRef, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { ProtoDecoder } from '@/lib/pb/codec';
import { FirmwareConnectionError, ConnectionMonitor, logError } from '@/lib/errors';
import { toast } from 'sonner';
import { useDevice } from '@/contexts/DeviceContext';

const statusColors = {
	"IDLE": "bg-gray-500",
	"IN_FLIGHT": "bg-green-500 animate-pulse",
	"LANDED": "bg-blue-600",
};

interface TelemetryData {
	device_id: string;
	lat: number;
	lon: number;
	rpm: number;
	wobble: number;
	received_at: number;
}

interface ConnectionState {
	connected: boolean;
	healthy: boolean;
	reconnectAttempt: number;
	lastError?: string;
	lastHeartbeat?: Date;
}

type LiveTrackerProps = {
  deviceId?: string;
  onTelemetryAction?: (data: TelemetryData) => void;
  maxHistoryLength?: number;
};

export default function LiveTracker({
  onTelemetryAction,
  maxHistoryLength = 40,
}: LiveTrackerProps) {
	const { connectedDevice } = useDevice();
	const [lastPing, setLastPing] = useState<TelemetryData | null>(null);
	const [history, setHistory] = useState<TelemetryData[]>([]);
	const [connectionState, setConnectionState] = useState<ConnectionState>({
		connected: false,
		healthy: false,
		reconnectAttempt: 0,
	});

	const MAX_RECONNECT_ATTEMPTS = 5;
	const INITIAL_RECONNECT_DELAY = 1000;
	const MAX_RECONNECT_DELAY = 30000;
	const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080/ws';
	const deviceWsUrl = connectedDevice?.deviceId
		? `${WS_URL}?device_id=${encodeURIComponent(connectedDevice.deviceId)}&t=${Date.now()}`
		: null;
	const WS_TIMEOUT = 30000; // 30 seconds
	const socketRef = useRef<WebSocket | null>(null);
	const lastToastRef = useRef<{ message: string; at: number }>({ message: '', at: 0 });
	const hasShownConnectedToastRef = useRef(false);

	const showToastOnce = (message: string, type: 'error' | 'success' = 'error') => {
		const now = Date.now();
		const isDuplicate = lastToastRef.current.message === message && now - lastToastRef.current.at < 5000;
		if (isDuplicate) {
			return;
		}

		lastToastRef.current = { message, at: now };
		if (type === 'success') {
			toast.success(message);
		} else {
			toast.error(message);
		}
	};

	const getHardwareFailureMessage = (): string =>
		'Hardware connection unsuccessful. Please check if device is on or in range.';

	const toUserMessage = (error: Error): string => {
		const raw = error.message;
		if (raw.includes('required device_id')) {
			return 'Telemetry data format mismatch detected. Check backend payload schema.';
		}
		if (raw.includes('ArrayBuffer')) {
			return 'Unsupported telemetry frame received from backend.';
		}
		if (raw.toLowerCase().includes('timeout')) {
			return getHardwareFailureMessage();
		}
		if (raw.toLowerCase().includes('max reconnection attempts')) {
			return getHardwareFailureMessage();
		}
		return 'Telemetry stream error detected. Retrying connection...';
	};

	const decodeTelemetryUpdate = (data: Uint8Array): TelemetryData => {
		try {
			const decoder = new ProtoDecoder(data);
			
			// Decode TelemetryUpdate fields from app/api/go/tracker.proto
			let deviceId = '';
			let lat = 0;
			let lon = 0;
			let rpm = 0;
			let wobble = 0;

			while (decoder.getOffset() < data.length) {
				try {
					const tag = decoder.decodeVarint();
					const wireType = tag & 0x07;
					const fieldNumber = tag >>> 3;

					if (fieldNumber === 1) {
						deviceId = decoder.decodeString();
					} else if (fieldNumber === 2) {
						lat = decoder.decodeDouble();
					} else if (fieldNumber === 3) {
						lon = decoder.decodeDouble();
					} else if (fieldNumber === 4) {
						rpm = decoder.decodeDouble();
					} else if (fieldNumber === 5) {
						wobble = decoder.decodeDouble();
					} else {
						// Unknown field - skip it
						if (wireType === 2) {
							const length = decoder.decodeVarint();
							decoder.readBytes(length);
						} else if (wireType === 0 || wireType === 1 || wireType === 5) {
							if (wireType === 1) decoder.readBytes(8);
							else if (wireType === 5) decoder.readBytes(4);
							else decoder.decodeVarint();
						}
					}
				} catch (fieldError) {
					// Skip unknown fields silently to avoid console spam
					break;
				}
			}

			// Validate required fields
			if (!deviceId) {
				throw new FirmwareConnectionError(
					'TelemetryUpdate missing required device_id',
					undefined,
					{offset: decoder.getOffset()}
				);
			}

			return {
				device_id: deviceId,
				lat,
				lon,
				rpm,
				wobble,
				received_at: Date.now(),
			};
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			throw new FirmwareConnectionError(
				`Failed to decode TelemetryUpdate message: ${err.message}`,
				undefined,
				{
					dataLength: data.length,
					error: err.message,
				}
			);
		}
	};

	const createWebSocketConnection = async (attemptNumber: number = 0): Promise<WebSocket | null> => {
		try {
			const wsUrl = deviceWsUrl;
			// Validate connection parameters
			if (!wsUrl || wsUrl.length === 0) {
				throw new FirmwareConnectionError('WebSocket URL is not configured', undefined, {
					url: wsUrl,
				});
			}

			if (attemptNumber > MAX_RECONNECT_ATTEMPTS) {
				throw new FirmwareConnectionError(
					`Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) exceeded`,
					undefined,
					{attemptNumber, maxAttempts: MAX_RECONNECT_ATTEMPTS}
				);
			}

			// Initialize connection monitor for this connection
			const connectionMonitor = new ConnectionMonitor();

			const socket = new WebSocket(wsUrl);
			
			// Set to receive binary messages (protobuf)
			socket.binaryType = 'arraybuffer';

			// Set connection timeout
			const connectionTimeout = setTimeout(() => {
				if (socket.readyState !== WebSocket.OPEN) {
					const timeoutError = new FirmwareConnectionError(
						`WebSocket connection timeout after ${WS_TIMEOUT}ms`,
						undefined,
						{timeout: WS_TIMEOUT, url: wsUrl}
					);
					socket.close(4001, 'Connection timeout');
					setConnectionState(prev => ({
						...prev,
						healthy: false,
						lastError: timeoutError.message,
					}));
					showToastOnce('Telemetry connection timed out. Reconnecting...');
				}
			}, WS_TIMEOUT);

			socket.onopen = () => {
				clearTimeout(connectionTimeout);
				connectionMonitor.connect();
				setConnectionState({
					connected: true,
					healthy: true,
					reconnectAttempt: 0,
				});

				if (!hasShownConnectedToastRef.current) {
					hasShownConnectedToastRef.current = true;
					showToastOnce('Telemetry connection established.', 'success');
				}
			};

			socket.onmessage = (event: MessageEvent) => {
				try {
					// Validate message exists and is not empty
					if (!event.data || event.data.byteLength === 0) {
						return;
					}

					// Record heartbeat for connection monitoring
					connectionMonitor.recordHeartbeat();

					// Decode binary protobuf TelemetryUpdate message from backend
					if (!(event.data instanceof ArrayBuffer)) {
						throw new FirmwareConnectionError(
							'Expected binary protobuf message (ArrayBuffer)',
							undefined,
							{dataType: typeof event.data}
						);
					}

					const binaryData = new Uint8Array(event.data);
					const data = decodeTelemetryUpdate(binaryData);

					// Update connection state and UI
					setConnectionState((prev) => ({
						...prev,
						connected: true,
						healthy: true,
						lastHeartbeat: new Date(),
						lastError: undefined,
					}));

					setLastPing(data);
					setHistory((prev) => {
						const next = [...prev, data];
						return next.slice(-maxHistoryLength);
					});
					onTelemetryAction?.(data);
				} catch (error) {
					const err = error instanceof Error ? error : new Error(String(error));

					// Log error but don't disconnect - may be transient issue
					setConnectionState((prev) => ({
						...prev,
						healthy: false,
						lastError: err.message,
					}));
					showToastOnce(toUserMessage(err));
				}
			};

			socket.onerror = (event: Event) => {
				const errorMsg = `WebSocket error occurred`;
				showToastOnce('Connection to telemetry stream dropped. Reconnecting...');

				setConnectionState(prev => ({
					...prev,
					healthy: false,
					lastError: errorMsg,
				}));

				connectionMonitor.disconnect();

				// Attempt reconnection with exponential backoff
				const delay = Math.min(
					INITIAL_RECONNECT_DELAY * Math.pow(2, attemptNumber),
					MAX_RECONNECT_DELAY
				);

				setTimeout(
					() => createWebSocketConnection(attemptNumber + 1),
					delay
				);
			};

			socket.onclose = (event: CloseEvent) => {
				setConnectionState(prev => ({
					...prev,
					connected: false,
					healthy: false,
				}));

				// Attempt reconnection if not a normal closure
				if (event.code !== 1000 && attemptNumber < MAX_RECONNECT_ATTEMPTS) {
					const delay = Math.min(
						INITIAL_RECONNECT_DELAY * Math.pow(2, attemptNumber),
						MAX_RECONNECT_DELAY
					);

					showToastOnce(`Telemetry disconnected (code ${event.code}). Reconnecting...`);
					setTimeout(
						() => createWebSocketConnection(attemptNumber + 1),
						delay
					);
				} else if (event.code !== 1000) {
					const finalError = new FirmwareConnectionError(
						`WebSocket closed with code ${event.code}: ${event.reason}`,
						undefined,
						{code: event.code, reason: event.reason, wasClean: event.wasClean}
					);
					logError(finalError, 'WebSocket final closure');
					showToastOnce('Telemetry connection closed and could not recover. Refresh to retry.');
				}
			};

			return socket;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			const firmwareError = error instanceof FirmwareConnectionError
				? error
				: new FirmwareConnectionError(err.message, undefined, {originalError: err.message});

			logError(firmwareError, 'createWebSocketConnection');

			// Attempt reconnection if not max attempts
			if (attemptNumber < MAX_RECONNECT_ATTEMPTS) {
				const delay = Math.min(
					INITIAL_RECONNECT_DELAY * Math.pow(2, attemptNumber),
					MAX_RECONNECT_DELAY
				);

				setConnectionState(prev => ({
					...prev,
					reconnectAttempt: attemptNumber + 1,
					lastError: err.message,
				}));
				showToastOnce(`Telemetry connection failed. Retrying (${attemptNumber + 1}/${MAX_RECONNECT_ATTEMPTS + 1})...`);

				setTimeout(
					() => createWebSocketConnection(attemptNumber + 1),
					delay
				);
			} else {
				setConnectionState(prev => ({
					...prev,
					lastError: `Failed after ${MAX_RECONNECT_ATTEMPTS + 1} attempts`,
				}));
				showToastOnce(getHardwareFailureMessage());
			}
			return null;
		}
	};

	useEffect(() => {
		if (!connectedDevice?.deviceId) {
			if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
				socketRef.current.close(1000, 'Device disconnected');
			}
			setHistory([]);
			setLastPing(null);
			setConnectionState({
				connected: false,
				healthy: false,
				reconnectAttempt: 0,
				lastError: undefined,
			});
			hasShownConnectedToastRef.current = false;
			socketRef.current = null;
			return;
		}

		const initializeConnection = async () => {
			setHistory([]);
			setLastPing(null);
			setConnectionState({
				connected: false,
				healthy: false,
				reconnectAttempt: 0,
				lastError: undefined,
			});
			hasShownConnectedToastRef.current = false;

			socketRef.current = await createWebSocketConnection();
		};

		initializeConnection();

		return () => {
			if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
				socketRef.current.close(1000, 'Component unmounting');
			}
			socketRef.current = null;
		};
	}, [connectedDevice?.deviceId]);

	if (!connectedDevice) {
		return (
			<div></div>
		);
	}

	return (
		<div className="text-white p-4 space-y-2 bg-slate-900 rounded">
			<div className="text-sm font-bold">{connectedDevice.discName} Telemetry</div>

			{/* Connection Status */}
			<div className="flex items-center gap-2 p-2 bg-slate-800 rounded">
				<div
					className={`w-3 h-3 rounded-full transition-colors ${
						connectionState.healthy ? 'bg-green-500' : 'bg-red-500'
					}`}
				/>
				<span className="text-sm font-mono">
					{connectionState.healthy ? 'Connected' : 'Disconnected'}
					{connectionState.reconnectAttempt > 0 && ` (Attempt ${connectionState.reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS + 1})`}
				</span>
			</div>
			{connectionState.lastError && (
				<div className="text-xs text-red-300 mt-1 font-mono">{connectionState.lastError}</div>
			)}
			{lastPing?.received_at && (
				<div className="text-xs text-gray-300 mt-1 font-mono">
					Last update: {new Date(lastPing.received_at).toLocaleTimeString()}
				</div>
			)}

			{/* Telemetry Data Display */}
			{lastPing && (
				<div className="bg-slate-800 p-2 rounded text-xs font-mono">
					<div>Device: {lastPing.device_id}</div>
					<div>Latitude: {lastPing.lat.toFixed(6)}</div>
					<div>Longitude: {lastPing.lon.toFixed(6)}</div>
					<div>RPM: {lastPing.rpm.toFixed(0)}</div>
					<div>Wobble: {lastPing.wobble.toFixed(3)} g</div>
				</div>
			)}

			{/* Recharts Live Stats */}
			{history.length > 0 && (
				<div className="bg-slate-800 p-2 rounded">
					<div className="text-sm font-bold mb-2">Live Telemetry History</div>
					<ResponsiveContainer width="100%" height={200}>
						<LineChart data={history}>
							<CartesianGrid strokeDasharray="3 3" />
							<XAxis
								dataKey="received_at"
								type="number"
								scale="time"
								domain={['dataMin', 'dataMax']}
								tickFormatter={(tick) => new Date(tick).toLocaleTimeString()}
							/>
							<YAxis />
							<Tooltip
								labelFormatter={(label) => new Date(label).toLocaleTimeString()}
								formatter={(value: any, name: any) => [typeof value === 'number' ? value.toFixed(2) : 'N/A', name || 'Unknown']}
							/>
							<Line type="monotone" dataKey="rpm" stroke="#8884d8" name="RPM" />
							<Line type="monotone" dataKey="wobble" stroke="#82ca9d" name="Wobble (g)" />
						</LineChart>
					</ResponsiveContainer>
				</div>
			)}
		</div>
	);
}

