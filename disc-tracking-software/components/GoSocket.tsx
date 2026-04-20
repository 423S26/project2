"use client";
import { useEffect, useRef, useState } from 'react';
import { ProtoDecoder } from '@/lib/pb/codec';
import { getClientAuthHeaders } from '@/lib/auth-headers';
import { FirmwareConnectionError, ConnectionMonitor, logError } from '@/lib/errors';
import { toast } from 'sonner';
import { useDevice } from '@/contexts/DeviceContext';
import { useSettings } from '@/contexts/SettingsContext';
import { pipelineLog } from '@/lib/ble';

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
	lastError?: string;
	lastFetch?: Date;
}

type LiveTrackerProps = {
  deviceId?: string;
  activeSessionId?: string;
  onTelemetryAction?: (data: TelemetryData) => void;
};

export default function LiveTracker({
  activeSessionId,
  onTelemetryAction,
}: LiveTrackerProps) {
	const { connectedDevice } = useDevice();
	const { settings } = useSettings();
	const [lastPing, setLastPing] = useState<TelemetryData | null>(null);
	const [connectionState, setConnectionState] = useState<ConnectionState>({
		connected: false,
		healthy: false,
	});

	const POLL_INTERVAL = 1000; // Poll every 1 second
	const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
	const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
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

	const getAuthHeaders = async (): Promise<Record<string, string>> => {
		return getClientAuthHeaders({
			'Content-Type': 'application/protobuf',
		});
	};

	const fetchTelemetry = async () => {
		if (!connectedDevice?.deviceId) return;

		try {
			const headers = await getAuthHeaders();
			const url = `${API_BASE_URL}/api/v1/telemetry?device_id=${encodeURIComponent(connectedDevice.deviceId)}`;
			const response = await fetch(url, {
				headers,
			});

			if (!response.ok) {
				pipelineLog('GIN:HTTP', 'error', `${response.status} ${response.statusText}`);
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const buffer = await response.arrayBuffer();
			const data = new Uint8Array(buffer);

			// Decode the GetTelemetryResponse protobuf
			const telemetryUpdates = decodeTelemetryResponse(data);

			// Only log when we actually received records
			if (telemetryUpdates.length > 0) {
				const latest = telemetryUpdates[telemetryUpdates.length - 1];
				pipelineLog(
					'API:RES', 'info',
					`${telemetryUpdates.length} record(s) ${data.length}B — lat=${latest.lat.toFixed(6)} lon=${latest.lon.toFixed(6)} rpm=${latest.rpm.toFixed(0)}`,
				);
			}

			if (telemetryUpdates.length > 0) {
				// Use the most recent telemetry update
				const latestUpdate = telemetryUpdates[telemetryUpdates.length - 1];
				const telemetryData: TelemetryData = {
					device_id: latestUpdate.deviceId,
					lat: latestUpdate.lat,
					lon: latestUpdate.lon,
					rpm: latestUpdate.rpm,
					wobble: latestUpdate.wobble,
					received_at: latestUpdate.timestamp,
				};

				setLastPing(telemetryData);
				onTelemetryAction?.(telemetryData);

				setConnectionState({
					connected: true,
					healthy: true,
					lastFetch: new Date(),
				});

				if (!hasShownConnectedToastRef.current) {
					hasShownConnectedToastRef.current = true;
					showToastOnce('Telemetry data received.', 'success');
				}
			} else {
				// No telemetry data yet, but connection is healthy
				setConnectionState({
					connected: true,
					healthy: true,
					lastFetch: new Date(),
				});
			}
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			pipelineLog('API:RES', 'warn', `Telemetry fetch: ${err.message}`);
			setConnectionState(prev => ({
				...prev,
				healthy: false,
				lastError: err.message,
			}));
		}
	};

	const decodeTelemetryResponse = (data: Uint8Array): any[] => {
		if (!data || data.length === 0) return [];

		try {
			const decoder = new ProtoDecoder(data);
			const telemetryUpdates: any[] = [];

			while (decoder.getOffset() < data.length) {
				const tag = decoder.decodeVarint();
				const wireType = tag & 0x07;
				const fieldNumber = tag >>> 3;

				if (fieldNumber === 1 && wireType === 2) {
					// field 1 = repeated TelemetryUpdate (length-delimited sub-message)
					const length = decoder.decodeVarint();
					const endOffset = decoder.getOffset() + length;

					let deviceId = '';
					let lat = 0;
					let lon = 0;
					let alt = 0;
					let rpm = 0;
					let wobble = 0;
					let timestamp = 0;

					while (decoder.getOffset() < endOffset) {
						const innerTag = decoder.decodeVarint();
						const innerWireType = innerTag & 0x07;
						const innerFieldNumber = innerTag >>> 3;

						if (innerFieldNumber === 1 && innerWireType === 2) deviceId = decoder.decodeString();
						else if (innerFieldNumber === 2 && innerWireType === 1) lat = decoder.decodeDouble();
						else if (innerFieldNumber === 3 && innerWireType === 1) lon = decoder.decodeDouble();
						else if (innerFieldNumber === 4 && innerWireType === 1) alt = decoder.decodeDouble();
						else if (innerFieldNumber === 5 && innerWireType === 1) rpm = decoder.decodeDouble();
						else if (innerFieldNumber === 6 && innerWireType === 1) wobble = decoder.decodeDouble();
						else if (innerFieldNumber === 7 && innerWireType === 0) timestamp = decoder.decodeVarint();
						else {
							// Skip unknown fields by wire type
							if (innerWireType === 2) {
								const skipLen = decoder.decodeVarint();
								decoder.readBytes(skipLen);
							} else if (innerWireType === 0) decoder.decodeVarint();
							else if (innerWireType === 1) decoder.readBytes(8);
							else if (innerWireType === 5) decoder.readBytes(4);
							else break; // unknown wire type, bail out of this entry
						}
					}

					telemetryUpdates.push({
						deviceId,
						lat,
						lon,
						alt,
						rpm,
						wobble,
						timestamp,
					});
				} else {
					// Skip unknown top-level fields
					if (wireType === 2) {
						const skipLen = decoder.decodeVarint();
						decoder.readBytes(skipLen);
					} else if (wireType === 0) decoder.decodeVarint();
					else if (wireType === 1) decoder.readBytes(8);
					else if (wireType === 5) decoder.readBytes(4);
					else break; // unknown wire type at top level
				}
			}

			return telemetryUpdates;
		} catch (error) {
			// Log decode failure to pipeline but don't throw — return empty
			const err = error instanceof Error ? error : new Error(String(error));
			pipelineLog('API:DECODE', 'warn', `Decode skipped (${data.length}B): ${err.message}`);
			return [];
		}
	};

	useEffect(() => {
		if (!connectedDevice?.deviceId || !activeSessionId) {
			// Stop polling when no device or session
			if (pollIntervalRef.current) {
				clearInterval(pollIntervalRef.current);
				pollIntervalRef.current = null;
			}
			setLastPing(null);
			setConnectionState({
				connected: false,
				healthy: false,
			});
			hasShownConnectedToastRef.current = false;
			return;
		}

		// Start polling when device and session are available
		setLastPing(null);
		setConnectionState({
			connected: false,
			healthy: false,
		});
		hasShownConnectedToastRef.current = false;

		// Initial fetch
		fetchTelemetry();

		// Start polling
		pollIntervalRef.current = setInterval(fetchTelemetry, POLL_INTERVAL);

		return () => {
			if (pollIntervalRef.current) {
				clearInterval(pollIntervalRef.current);
				pollIntervalRef.current = null;
			}
		};
	}, [connectedDevice?.deviceId, activeSessionId]);

	if (!connectedDevice) {
		return (
			<div></div>
		);
	}

	return (
		<div className="text-white p-4 space-y-2 bg-slate-900 rounded">
			{settings.showDebugConsole && (
			<>
			<div className="text-sm font-bold">{connectedDevice.discName} Telemetry</div>

			{/* Connection Status */}
			<div className="flex items-center gap-2 p-2 bg-slate-800 rounded">
				<div
					className={`w-3 h-3 rounded-full transition-colors ${
						connectionState.healthy ? 'bg-green-500' : 'bg-red-500'
					}`}
				/>
				<span className="text-sm font-mono">
					{connectionState.healthy ? 'Active' : 'Inactive'}
				</span>
			</div>
			{connectionState.lastError && (
				<div className="text-xs text-red-300 mt-1 font-mono">{connectionState.lastError}</div>
			)}
			{connectionState.lastFetch && (
				<div className="text-xs text-gray-300 mt-1 font-mono">
					Last fetch: {connectionState.lastFetch.toLocaleTimeString()}
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
			</>
			)}
		</div>
	);
}

