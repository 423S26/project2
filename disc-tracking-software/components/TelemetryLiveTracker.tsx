"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { SyncBatch } from '@/lib/pb/api';
import { Ping } from '@/lib/pb/hardware';

import { getClientAuthHeaders } from '@/lib/auth-headers';
import { toast } from 'sonner';
import { useDevice } from '@/contexts/DeviceContext';
import { useSettings } from '@/contexts/SettingsContext';
import {
  pipelineLog,
  onPipelineLog,
  getPipelineStats,
  getPipelineLogs,
  clearPipelineLogs,
  type PipelineStats,
  type PipelineLogEntry,
  bleManager,
} from '@/lib/ble';
import { usePhoneSensors, haversineMeters, bearingDegrees } from '@/lib/phone-sensors';
import { discPositionStore } from '@/lib/disc-position-store';


interface TelemetryData {
	deviceId: string;
	lat: number;
	lon: number;
	rpm: number;
	wobble: number;
	received_at: number;
	sats?: number;
	hdop?: number;
	battPct?: number;
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

/** Compute RPM from gyro Z-axis (deg/s → RPM). 1 RPM = 6 deg/s. */
function rpmFromGyroZ(gyroZ: number): number {
	const rpm = Math.abs(gyroZ) / 6;
	return rpm < 5 ? 0 : rpm; // suppress sensor noise below 30 deg/s
}

/** Compute distance from BLE RSSI based on Free Space Path Loss model */
function calculateRssiDistance(rssi: number): number {
        if (rssi === 0) return -1.0;
        // txPower is the RSSI value at 1 meter. Often calibrated per device.
        const txPower = -65;
        // factor is the environmental attenuation factor. 2.0 = free space, 3.0+ = obstacles
        const factor = 2.0; 
        return Math.pow(10, (txPower - rssi) / (10 * factor));
}

function hasReliableBleFix(ping: Ping | null): boolean {
	if (!ping) return false;
	// The Goku Nano v3.1 firmware doesn't always populate sats/hdop in
	// every Ping (those fields are optional in the protobuf and depend on
	// which NMEA sentence the GPS task last parsed).  Gating on them was
	// hiding genuinely-good fixes from the UI.  Trust the coordinates as
	// the primary signal and treat sats/hdop as a hard ceiling only when
	// they're clearly unusable (hdop > 10).
	if (ping.lat === 0 && ping.lon === 0) return false;
	if (Math.abs(ping.lat) > 90 || Math.abs(ping.lon) > 180) return false;
	if (ping.hdop > 10) return false;
	return true;
}

const POLL_INTERVAL = 1000; // ms — API fallback poll rate
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080')
	.replace(/\/+$/, '')
	.replace(/\/api\/v1$/, '');

// Decode a SyncBatch protobuf response (server returns repeated Ping fields).
// Defined at module scope so it is not re-created on every render.
function decodeTelemetryResponse(data: Uint8Array): TelemetryData[] {
  if (!data || data.length === 0) return [];
  try {
    const batch = SyncBatch.fromBinary(data);
    return batch.pings.map(ping => {
      const rawRpm = Math.abs(ping.gyroZ) / 6;
      const rpm = rawRpm < 5 ? 0 : rawRpm;
      const wobble = Math.abs(ping.accelZ - 1.0);
      return {
        deviceId: ping.deviceId,
        lat: ping.lat,
        lon: ping.lon,
        rpm,
        wobble,
        sats: ping.sats,
        hdop: ping.hdop,
        battPct: ping.battPct,
        received_at: ping.timestamp || Date.now(),
      };
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    pipelineLog('API:DECODE', 'warn', `Decode skipped (${data.length}B): ${err.message}`);
    return [];
  }
}

export default function LiveTracker({
	deviceId,
  activeSessionId,
  onTelemetryAction,
}: LiveTrackerProps) {
	const { connectedDevice } = useDevice();
	const { settings } = useSettings();
	const [lastPing, setLastPing] = useState<TelemetryData | null>(null);
	const [lastBlePing, setLastBlePing] = useState<Ping | null>(null);
	const [pipeStats, setPipeStats] = useState<PipelineStats>(getPipelineStats);
	const [pipeLogs, setPipeLogs] = useState<PipelineLogEntry[]>(getPipelineLogs);
	const [connectionState, setConnectionState] = useState<ConnectionState>({
		connected: false,
		healthy: false,
	});
	// Track when BLE last delivered data so we can skip API overwrites
	const bleLastPingRef = useRef<number>(0);
	const apiForbiddenUntilRef = useRef<number>(0);
	const hasLoggedForbiddenRef = useRef(false);

        const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
        const [userHeading, setUserHeading] = useState<number | null>(null);
        const [currentRssi, setCurrentRssi] = useState<number | null>(null);

        // The phone-sensor singleton handles geolocation + DeviceMotion +
        // DeviceOrientation in one place; we just mirror what we need into
        // local state so the rest of the component (and existing JSX)
        // continues to work unchanged.  This replaces two effects that
        // each registered their own listeners.
        const phoneSnap = usePhoneSensors();
        useEffect(() => {
                if (phoneSnap.gps) {
                        setUserLocation({ lat: phoneSnap.gps.lat, lon: phoneSnap.gps.lon });
                }
                if (phoneSnap.orientation) {
                        setUserHeading(phoneSnap.orientation.compass);
                }
        }, [phoneSnap.gps, phoneSnap.orientation]);
	useEffect(() => {
		const unsub = onPipelineLog((_entry, stats) => {
			setPipeStats({ ...stats });
			setPipeLogs(getPipelineLogs());
		});
		return unsub;
	}, []);

	// Subscribe to live BLE pings — this is the SOURCE OF TRUTH for the
	// debug console.  All values are decoded directly from the firmware
	// binary on the wire; nothing here comes from the API.
	useEffect(() => {
		const unsubscribe = bleManager.onPing((ping: Ping) => {
			bleLastPingRef.current = Date.now();
			setLastBlePing(ping);
			// Publish to the shared disc-position store so any subscriber
			// (TrackerDisplay, etc.) can compute live Δ from this BLE fix.
			if (hasReliableBleFix(ping)) {
				discPositionStore.publish(ping.lat, ping.lon, 'ble');
			}
			// Derived metrics (computed client-side from raw BLE fields)
			const rpm = rpmFromGyroZ(ping.gyroZ);
			const wobble = Math.abs(ping.accelZ - 1.0);
			const telemetry: TelemetryData = {
				deviceId: ping.deviceId,
				lat: ping.lat,
				lon: ping.lon,
				rpm,
				wobble,
				received_at: ping.timestamp,
				sats: ping.sats,
				hdop: ping.hdop,
				battPct: ping.battPct,
			};
			setLastPing(telemetry);
			onTelemetryAction?.(telemetry);
			setConnectionState({
				connected: true,
				healthy: true,
				lastFetch: new Date(),
			});
		});

		const unsubRssi = bleManager.onRssi((rssi: number) => {
			setCurrentRssi(rssi);
		});

		return () => {
			unsubscribe();
			unsubRssi();
		};
	}, [onTelemetryAction]);

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

	const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
		return getClientAuthHeaders({
			'Content-Type': 'application/protobuf',
		});
	}, []);

	const fetchTelemetry = useCallback(async () => {
		const telemetryDeviceId = deviceId || lastBlePing?.deviceId || connectedDevice?.deviceId;
		if (!telemetryDeviceId) return;

		if (Date.now() < apiForbiddenUntilRef.current) {
			return;
		}

		// When BLE is actively providing wire data, skip API polling entirely.
		// The debug console shows raw BLE data; polling the API would overwrite
		// it with stale DB values (including wrong RPM from old formula).
		const bleRecentMs = Date.now() - bleLastPingRef.current;
		if (bleRecentMs < 5000) return;

		try {
			const headers = await getAuthHeaders();
			// Backend expects snake_case query param `device_id`. Mismatched casing
			// previously produced HTTP 400 on every poll.
			const url = `${API_BASE_URL}/api/v1/telemetry?device_id=${encodeURIComponent(telemetryDeviceId)}`;
			const response = await fetch(url, {
				headers,
			});

			if (!response.ok) {
				if (response.status === 403) {
					apiForbiddenUntilRef.current = Date.now() + 60000;
					if (!hasLoggedForbiddenRef.current) {
						hasLoggedForbiddenRef.current = true;
						pipelineLog(
							'GIN:HTTP',
							'warn',
							`403 Forbidden for telemetry deviceId=${telemetryDeviceId}. Backing off polling for 60s.`
						);
					}
					return;
				}
				if (response.status >= 500) {
					// Transient server error (Vercel cold-start, pool exhausted, etc).
					// Back off briefly so we don't pile on. Reuses the same gate
					// as 403 so the polling loop short-circuits cleanly.
					apiForbiddenUntilRef.current = Date.now() + 15000;
					pipelineLog(
						'GIN:HTTP',
						'warn',
						`${response.status} ${response.statusText} — backing off telemetry polling for 15s`,
					);
					return;
				}
				pipelineLog('GIN:HTTP', 'error', `${response.status} ${response.statusText}`);
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			hasLoggedForbiddenRef.current = false;

			const buffer = await response.arrayBuffer();
			const data = new Uint8Array(buffer);

			// Decode the GetTelemetryResponse protobuf
			const telemetryUpdates = decodeTelemetryResponse(data);

			// Only log when we actually received records (suppress empty poll noise)
			if (telemetryUpdates.length > 0) {
				const latest = telemetryUpdates[telemetryUpdates.length - 1];
				pipelineLog(
					'API:RES', 'info',
					`${telemetryUpdates.length} record(s) ${data.length}B — lat=${latest.lat.toFixed(6)} lon=${latest.lon.toFixed(6)} rpm=${latest.rpm.toFixed(0)}`,
				);
			}

			if (telemetryUpdates.length > 0) {
				// Use the most recent telemetry update (API fallback only)
				const latestUpdate = telemetryUpdates[telemetryUpdates.length - 1];
				// Publish to the shared disc-position store as an API-source
				// fix.  The store guards against clobbering a fresher BLE fix.
				const latLonOk =
					latestUpdate.lat !== 0 &&
					latestUpdate.lon !== 0 &&
					Math.abs(latestUpdate.lat) <= 90 &&
					Math.abs(latestUpdate.lon) <= 180 &&
					(latestUpdate.hdop == null || latestUpdate.hdop <= 10);
				if (latLonOk) {
					discPositionStore.publish(latestUpdate.lat, latestUpdate.lon, 'api');
				}
				const telemetryData: TelemetryData = {
					deviceId: latestUpdate.deviceId,
					lat: latestUpdate.lat,
					lon: latestUpdate.lon,
					rpm: latestUpdate.rpm,
					wobble: latestUpdate.wobble,
					received_at: latestUpdate.received_at,
					sats: latestUpdate.sats,
					hdop: latestUpdate.hdop,
					battPct: latestUpdate.battPct,
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
	}, [connectedDevice?.deviceId, deviceId, lastBlePing?.deviceId, onTelemetryAction, getAuthHeaders]);

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
		apiForbiddenUntilRef.current = 0;
		hasLoggedForbiddenRef.current = false;
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
	}, [connectedDevice?.deviceId, activeSessionId, fetchTelemetry]);

	if (!connectedDevice) {
		return (
			<div></div>
		);
	}

	// Calculate distance and bearing if we have both locations
	let distanceToDisc: number | null = null;
	let bearingToDisc: number | null = null;
	let relativeBearing: number | null = null;
	const activePing = lastBlePing || lastPing;
	const canUseGpsDistance = lastBlePing
		? hasReliableBleFix(lastBlePing)
		: Boolean(
			activePing &&
			activePing.lat !== 0 &&
			activePing.lon !== 0 &&
			Math.abs(activePing.lat) <= 90 &&
			Math.abs(activePing.lon) <= 180 &&
			(activePing.hdop == null || activePing.hdop <= 10)
		);
	if (userLocation && activePing && canUseGpsDistance) {
		const meters = haversineMeters(userLocation.lat, userLocation.lon, activePing.lat, activePing.lon);
		distanceToDisc = meters;
		bearingToDisc = bearingDegrees(userLocation.lat, userLocation.lon, activePing.lat, activePing.lon);
		if (userHeading !== null) {
			relativeBearing = ((bearingToDisc - userHeading) + 360) % 360;
		}
	}

	let fallbackDistance: number | null = null;
	if (distanceToDisc === null && currentRssi !== null && currentRssi < 0) {
		fallbackDistance = calculateRssiDistance(currentRssi);
	}

	// Color map for pipeline stages
	const stageColor = (stage: string) => {
		const layer = stage.split(':')[0];
		if (layer === 'BLE' || layer === 'DECODE' || layer === 'ENCODE') return 'text-purple-400';
		if (layer === 'API') return 'text-blue-400';
		if (layer === 'GIN') return 'text-yellow-400';
		if (layer === 'AUTH') return 'text-green-400';
		if (layer === 'SYNC') return 'text-cyan-400';
		return 'text-gray-400';
	};

	return (
		<div className="text-white p-4 space-y-2 bg-slate-900 rounded">
			{settings.showDebugConsole && (
			<>
			{/* ═══ Developer Debug Console ═══ */}
			<div className="border border-slate-700 rounded">
				<div className="bg-slate-800 px-3 py-1.5 border-b border-slate-700 flex items-center gap-2">
					<span className="text-xs font-mono text-green-400">●</span>
					<span className="text-sm font-bold font-mono tracking-wide">Developer Debug Console</span>
					<span className="ml-auto text-[10px] text-gray-500 font-mono">{connectedDevice.discName}</span>
				</div>

				<div className="p-3 space-y-3">
					{/* ── Connection & Device ── */}
					<div className="flex items-center gap-3 text-xs font-mono">
						<div className="flex items-center gap-1.5">
							<div className={`w-2 h-2 rounded-full ${connectionState.healthy ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
							<span>{connectionState.healthy ? 'CONNECTED' : 'OFFLINE'}</span>
						</div>
						<span className="text-gray-600">│</span>
						<div className={`flex items-center gap-1.5 ${pipeStats.bleConnected ? 'text-purple-400' : 'text-gray-600'}`}>
							<span>{pipeStats.bleConnected ? 'BLE ✓' : 'BLE ✗'}</span>
						</div>
						{connectionState.lastFetch && (
							<>
								<span className="text-gray-600">│</span>
								<span className="text-gray-400">Last: {connectionState.lastFetch.toLocaleTimeString()}</span>
							</>
						)}
						{connectionState.lastError && (
							<span className="text-red-400 ml-auto truncate max-w-48">{connectionState.lastError}</span>
						)}
					</div>

					{/* ── Telemetry Data ── */}
					{/* Always render the device panel so the user can see the     */}
					{/* tracker's state side-by-side with the phone sensors below, */}
					{/* even before the first Ping has been decoded.               */}
					<div className="bg-slate-800/60 rounded p-2 text-xs font-mono border border-slate-700/50 space-y-2">
							<div className="flex items-center justify-between">
								<span className="text-[10px]">
									<span className="text-orange-400">DEVICE</span>
									<span className="text-gray-500"> · LIVE TELEMETRY {lastBlePing ? '(BLE WIRE)' : lastPing ? '(API FALLBACK)' : '(awaiting…)'}</span>
								</span>
								<span className="text-[10px] text-gray-600">
									{lastBlePing
										? `t=${lastBlePing.timestamp}`
										: lastPing
											? `t=${lastPing.received_at}`
											: pipeStats.bleConnected
												? 'BLE link up — waiting for first ping'
												: 'no BLE link'}
								</span>
							</div>

							{!lastBlePing && !lastPing && (
								<div className="text-[10px] text-gray-500 italic py-1">
									{pipeStats.bleConnected
										? 'Connected to disc — first telemetry packet has not arrived yet.'
										: 'Pair a tracker via Bluetooth to see live device GPS, IMU and battery.'}
								</div>
							)}

							{lastBlePing ? (
								<>
								{/* ── Computed Metrics (from raw BLE fields) ── */}
								<div className="grid grid-cols-4 gap-x-4 gap-y-0.5 pb-1.5 border-b border-slate-700/30">
									<div>dev: <span className="text-cyan-300">{lastBlePing.deviceId}</span></div>
									<div>rpm: <span className={`${rpmFromGyroZ(lastBlePing.gyroZ) > 0 ? 'text-yellow-300' : 'text-gray-500'}`}>{rpmFromGyroZ(lastBlePing.gyroZ).toFixed(0)}</span></div>
									<div>wobble: <span className={`${Math.abs(lastBlePing.accelZ - 1.0) > 0.1 ? 'text-orange-300' : 'text-gray-500'}`}>{Math.abs(lastBlePing.accelZ - 1.0).toFixed(3)}g</span></div>
									<div>bat: <span className="text-emerald-300">{lastBlePing.battPct}%</span></div>
								</div>

								{/* ── GPS Data (from raw BLE fields) ── */}
								<div className="pb-1.5 border-b border-slate-700/30">
									<div className="flex justify-between items-center mb-0.5">
										<div className="text-[10px] text-green-500/70">GPS</div>
										{distanceToDisc !== null && !isNaN(distanceToDisc) ? (
											<div className="text-[10px] text-green-400">
												Dist: <span className="font-bold">{distanceToDisc.toFixed(1)}m</span> {relativeBearing !== null && (
													<span className="ml-1" style={{ display: 'inline-block', transform: `rotate(${Math.round(relativeBearing)}deg)` }}>
														↑
													</span>
												)}
											</div>
										) : fallbackDistance !== null ? (
											<div className="text-[10px] text-blue-400">
												Est. Dist (RSSI): <span className="font-bold">{fallbackDistance.toFixed(1)}m</span>
											</div>
										) : null}
									</div>
									<div className="grid grid-cols-4 gap-x-4 gap-y-0.5">
										<div>lat: <span className="text-green-300">{lastBlePing.lat.toFixed(6)}</span></div>
										<div>lon: <span className="text-green-300">{lastBlePing.lon.toFixed(6)}</span></div>
										<div>alt: <span className="text-green-300">{lastBlePing.alt.toFixed(1)}m</span></div>
										<div>speed: <span className="text-green-300">{lastBlePing.speedMps.toFixed(1)}m/s</span></div>
										<div>heading: <span className="text-green-300">{lastBlePing.heading.toFixed(0)}&deg;</span></div>
										<div>sats: <span className={`${lastBlePing.sats >= 5 ? 'text-blue-300' : lastBlePing.sats >= 3 ? 'text-yellow-300' : 'text-gray-500'}`}>{lastBlePing.sats}</span></div>
										<div>hdop: <span className={`${lastBlePing.hdop > 0 && lastBlePing.hdop <= 2 ? 'text-blue-300' : lastBlePing.hdop <= 4 ? 'text-yellow-300' : lastBlePing.hdop <= 10 ? 'text-orange-300' : 'text-red-400'}`}>{lastBlePing.hdop.toFixed(2)}</span></div>
										<div className="text-[10px] text-gray-600">{hasReliableBleFix(lastBlePing) ? (lastBlePing.sats >= 5 && lastBlePing.hdop > 0 && lastBlePing.hdop <= 2 ? '● FIX OK' : '◐ FIX') : '○ NO FIX'}</div>
									</div>
								</div>

								{/* ── IMU Data (from raw BLE fields) ── */}
								<div>
									<div className="text-[10px] text-yellow-500/70 mb-0.5">IMU (LSM6DS3)</div>
									<div className="grid grid-cols-3 gap-x-4 gap-y-0.5">
										<div>aX: <span className="text-yellow-300">{lastBlePing.accelX.toFixed(3)}g</span></div>
										<div>aY: <span className="text-yellow-300">{lastBlePing.accelY.toFixed(3)}g</span></div>
										<div>aZ: <span className="text-yellow-300">{lastBlePing.accelZ.toFixed(3)}g</span></div>
										<div>gX: <span className="text-orange-300">{lastBlePing.gyroX.toFixed(1)}&deg;/s</span></div>
										<div>gY: <span className="text-orange-300">{lastBlePing.gyroY.toFixed(1)}&deg;/s</span></div>
										<div>gZ: <span className="text-orange-300">{lastBlePing.gyroZ.toFixed(1)}&deg;/s</span></div>
										<div>temp: <span className="text-red-300">{lastBlePing.tempC.toFixed(1)}&deg;C</span></div>
										<div className="col-span-2 text-[10px] text-gray-600">
											|a|={Math.sqrt(lastBlePing.accelX**2 + lastBlePing.accelY**2 + lastBlePing.accelZ**2).toFixed(3)}g
											{' '}|g|={Math.sqrt(lastBlePing.gyroX**2 + lastBlePing.gyroY**2 + lastBlePing.gyroZ**2).toFixed(1)}&deg;/s
										</div>
									</div>
								</div>
								</>
							) : lastPing && (
								<>
								{/* ── API fallback (no BLE connection) ── */}
								<div className="grid grid-cols-4 gap-x-4 gap-y-0.5 pb-1.5 border-b border-slate-700/30">
									<div>dev: <span className="text-cyan-300">{lastPing.deviceId}</span></div>
									<div>rpm: <span className={`${lastPing.rpm > 0 ? 'text-yellow-300' : 'text-gray-500'}`}>{lastPing.rpm.toFixed(0)}</span></div>
									<div>wobble: <span className={`${lastPing.wobble > 0.1 ? 'text-orange-300' : 'text-gray-500'}`}>{lastPing.wobble.toFixed(3)}g</span></div>
								</div>
								<div className="pb-1.5 border-b border-slate-700/30">
									<div className="flex justify-between items-center mb-0.5">
										<div className="text-[10px] text-green-500/70">GPS</div>
										{distanceToDisc !== null && (
											<div className="text-[10px] text-green-400">
												Dist: <span className="font-bold">{distanceToDisc.toFixed(1)}m</span> {relativeBearing !== null && (
													<span className="ml-1" style={{ display: 'inline-block', transform: `rotate(${Math.round(relativeBearing)}deg)` }}>
														↑
													</span>
												)}
											</div>
										)}
									</div>
									<div className="grid grid-cols-4 gap-x-4 gap-y-0.5">
										<div>lat: <span className="text-green-300">{lastPing.lat.toFixed(6)}</span></div>
										<div>lon: <span className="text-green-300">{lastPing.lon.toFixed(6)}</span></div>
										<div className="col-span-2 text-gray-600 text-[10px]">Full GPS/IMU detail via BLE only</div>
									</div>
								</div>
								</>
							)}
						</div>

					{/* ── Phone Sensor Compensation ── */}
					{/* The demo device has no working IMU, so the phone supplies   */}
					{/* spin / impulse / compass data.  This row exposes the live   */}
					{/* state of those readings + the phone↔disc GPS drift (Δ).    */}
					<div className="bg-slate-800/60 rounded p-2 text-xs font-mono border border-slate-700/50">
						<div className="flex items-center gap-3 text-[10px]">
							<span className="text-cyan-400">PHONE SENSORS</span>
							<span className={phoneSnap.gpsActive ? 'text-green-400' : 'text-gray-500'}>
								{phoneSnap.gpsActive ? '● GPS' : '○ GPS'}
							</span>
							<span className={phoneSnap.motion ? 'text-green-400' : 'text-gray-500'}>
								{phoneSnap.motion ? '● MOTION' : '○ MOTION'}
							</span>
							<span className={phoneSnap.orientation ? 'text-green-400' : 'text-gray-500'}>
								{phoneSnap.orientation ? '● COMPASS' : '○ COMPASS'}
							</span>
							{distanceToDisc !== null && (
								<span className="ml-auto text-[#54c4c3]">
									Δ {distanceToDisc < 1 ? distanceToDisc.toFixed(2) : distanceToDisc.toFixed(1)} m
								</span>
							)}
						</div>
						{phoneSnap.motion && (
							<div className="grid grid-cols-3 gap-x-3 mt-1 text-[10px] text-white/70">
								<div>|a|: <span className="text-yellow-300">{phoneSnap.motion.impulseG.toFixed(2)}g</span></div>
								<div>|ω|: <span className="text-orange-300">{phoneSnap.motion.rotMagnitude.toFixed(0)}°/s</span></div>
								<div>RPM*: <span className="text-yellow-300">{(phoneSnap.motion.rotMagnitude / 6).toFixed(0)}</span></div>
							</div>
						)}
						{phoneSnap.gps && (
							<div className="grid grid-cols-2 gap-x-3 mt-1 text-[10px] text-white/70">
								<div>lat: <span className="text-cyan-300">{phoneSnap.gps.lat.toFixed(6)}</span></div>
								<div>lon: <span className="text-cyan-300">{phoneSnap.gps.lon.toFixed(6)}</span></div>
								<div>acc: <span className="text-cyan-300">{phoneSnap.gps.accuracy.toFixed(1)}m</span></div>
								<div>spd: <span className="text-cyan-300">{phoneSnap.gps.speed != null ? `${phoneSnap.gps.speed.toFixed(1)}m/s` : '—'}</span></div>
							</div>
						)}
						{phoneSnap.orientation && (
							<div className="mt-1 text-[10px] text-white/70">
								heading: <span className="text-cyan-300">{phoneSnap.orientation.compass.toFixed(0)}°</span>
								<span className="text-white/40 ml-2">({phoneSnap.orientation.absolute ? 'true north' : 'relative'})</span>
							</div>
						)}
					</div>

					{/* ── Pipeline Counters ── */}
					<div className="grid grid-cols-2 gap-2">
						{/* BLE / Device Pipeline */}
						<div className="bg-slate-800/60 rounded p-2 text-xs font-mono border border-slate-700/50">
							<div className="text-[10px] text-purple-400 mb-1">BLE PIPELINE</div>
							<div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
								<div>RX: <span className="text-white">{pipeStats.rxCount}</span></div>
								<div>Decoded: <span className="text-white">{pipeStats.decodeCount}</span></div>
								<div>Encoded: <span className="text-white">{pipeStats.encodeCount}</span></div>
								<div>Uploaded: <span className="text-white">{pipeStats.uploadCount}</span></div>
							</div>
							{pipeStats.lastRxAt && (
								<div className="text-gray-500 mt-1 text-[10px]">Last RX: {new Date(pipeStats.lastRxAt).toLocaleTimeString()}</div>
							)}
						</div>

						{/* API / Backend */}
						<div className="bg-slate-800/60 rounded p-2 text-xs font-mono border border-slate-700/50">
							<div className="text-[10px] text-blue-400 mb-1">API &amp; BACKEND</div>
							<div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
								<div className="text-blue-300">Req: <span className="text-white">{pipeStats.apiReqCount}</span></div>
								<div className="text-blue-300">Res: <span className="text-white">{pipeStats.apiResCount}</span></div>
								<div className="text-yellow-300">GIN: <span className="text-white">{pipeStats.ginCount}</span></div>
								<div className="text-green-300">Auth: <span className="text-white">{pipeStats.authCount}</span></div>
							</div>
							{pipeStats.lastApiAt && (
								<div className="text-gray-500 mt-1 text-[10px]">Last API: {new Date(pipeStats.lastApiAt).toLocaleTimeString()}</div>
							)}
						</div>
					</div>

					{/* ── Error Counter ── */}
					{pipeStats.errorCount > 0 && (
						<div className="bg-red-900/20 border border-red-800/50 rounded px-2 py-1 text-xs font-mono text-red-400">
							{pipeStats.errorCount} pipeline error{pipeStats.errorCount > 1 ? 's' : ''}
						</div>
					)}

					{/* ── Full-Stack Pipeline Log with Binary Data Flow ── */}
					<div className="bg-black/40 rounded border border-slate-700/50">
						<div className="flex items-center px-2 py-1 border-b border-slate-700/50">
							<span className="text-[10px] font-mono text-gray-400 tracking-wider">PIPELINE LOG</span>
							<button
								onClick={() => { clearPipelineLogs(); setLastPing(null); setLastBlePing(null); }}
								className="ml-2 text-[9px] font-mono text-gray-500 hover:text-red-400 border border-slate-700 rounded px-1 py-0.5 hover:border-red-500/50 transition-colors"
							>CLR</button>
							<span className="ml-auto text-[10px] font-mono text-gray-600">{pipeLogs.length} events</span>
						</div>
						<div className="max-h-64 overflow-y-auto font-mono text-[11px] leading-relaxed">
							{pipeLogs.length === 0 && (
								<div className="text-gray-600 px-2 py-4 text-center">No pipeline events yet</div>
							)}
							{pipeLogs.slice(-30).map((entry, i) => (
								<div key={`${entry.timestamp}-${i}`} className="group">
									{/* Log line */}
									<div className={`px-2 py-0.5 hover:bg-slate-800/40 ${
										entry.level === 'error' ? 'bg-red-900/10' : ''
									}`}>
										<span className="text-gray-600">
											{new Date(entry.timestamp).toLocaleTimeString()}
										</span>{' '}
										<span className={stageColor(entry.stage)}>
											[{entry.stage}]
										</span>{' '}
										<span className={
											entry.level === 'error' ? 'text-red-400'
											: entry.level === 'warn' ? 'text-yellow-400'
											: 'text-gray-300'
										}>
											{entry.message}
										</span>
									</div>
								</div>
							))}
						</div>
					</div>
				</div>
			</div>
			</>
			)}
		</div>
	);
}

