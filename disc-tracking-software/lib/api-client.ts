// Frontend API service to communicate with GO backend
// Uses Protobuf encoding for all requests/responses
// All requests are made to http://localhost:8080/api/v1

import { ErrorResponse } from './pb/hardware';
import { SessionRequest, SessionResponse, GetActiveSessionsResponse, EndSessionRequest, EndSessionResponse, DiscRequest, DiscResponse, GetUserDiscsResponse, DeleteDiscRequest, DeleteDiscResponse, ThrowRequest, ThrowResponse, GetThrowsResponse, UserSettingsRequest, UserSettingsResponse } from './pb/api';
import { getClientAuthHeaders } from './auth-headers';
import { pipelineLog } from './ble';
import {
  APIConnectionError,
  retryWithBackoff,
  logError,
  createDebugInfo,
  assert,
  assertNotNull,
  assertType,
} from './errors';

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_ENDPOINT ||
  "http://localhost:8080/api/v1"
).replace(/\/+$/, "");
const API_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 3;

// Type-safe interfaces for frontend use
export interface Disc {
  id: string;
  user_id: string;
  name: string;
  type: string;
  weight: number;
  color: string;
  connectionNumber?: string;
  created_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  device_id: string;
  status: string;
  started_at: string;
  ended_at?: string;
  throw_count: number;
  created_at: string;
}

export interface UserSettings {
  id: string;
  user_id: string;
  bag_location_lat?: number;
  bag_location_lon?: number;
  preferred_unit: string;
  notifications_enabled: boolean;
  auto_save_enabled: boolean;
  updated_at: string;
}

export interface ThrowRecord {
  id: string;
  session_id: string;
  session_label: string;
  disc_name: string;
  disc_type: string;
  distance: number;
  flight_time: number;
  exit_velocity: number;
  max_rpm: number;
  timestamp: string;
}

// Helper function to get auth headers with validation
async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    "Content-Type": "application/protobuf",
    "Accept": "application/protobuf",
  };

  try {
    pipelineLog('AUTH:SESSION', 'info', 'Resolving auth headers');
    return await getClientAuthHeaders(headers);
  } catch (error) {
    pipelineLog('AUTH:SESSION', 'error', `Auth header failure: ${(error as Error).message}`);
    logError(error instanceof Error ? error : new Error(String(error)), 'getAuthHeaders');
    return headers;
  }
}

// Helper function with timeout wrapper
async function fetchWithTimeout(
  resource: RequestInfo | URL,
  options?: RequestInit,
  timeout: number = API_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new APIConnectionError(
          `Request timeout after ${timeout}ms`,
          String(resource),
          undefined,
          {timeout, debug: createDebugInfo()}
        );
      }
      const message = error.message.includes('Failed to fetch')
        ? `Unable to reach API server at ${resource}. Verify the backend is running.`
        : `Fetch failed: ${error.message}`;
      throw new APIConnectionError(
        message,
        String(resource),
        undefined,
        {error: error.message, debug: createDebugInfo()}
      );
    }
    throw new APIConnectionError(
      'Unknown fetch error',
      String(resource),
      undefined,
      {debug: createDebugInfo()}
    );
  }
}

// Helper function for Protobuf API requests with retry logic
async function apiCallProtobuf<T>(
  endpoint: string,
  body?: Uint8Array,
  method: string = "GET"
): Promise<T> {
  try {
    assertNotNull(endpoint, 'endpoint');
    assertType(endpoint, 'string', 'endpoint');
    assert(endpoint.length > 0, 'Endpoint is empty');

    if (body) {
      assertType(body, 'object', 'body');
      assert(body instanceof Uint8Array, 'Body must be Uint8Array');
      assert(body.length > 0, 'Body is empty');
    }

    const options: RequestInit = {
      method,
      headers: await getAuthHeaders(),
      cache: 'no-store',
    };

    if (body) {
      options.body = Uint8Array.from(body);
    }

    pipelineLog('API:REQ', 'info', `${method} ${endpoint}${body ? ` (${body.length}B)` : ''}`);

    // Wrap in retry logic for transient failures
    const response = await retryWithBackoff(
      async () => {
        const resp = await fetchWithTimeout(`${API_BASE_URL}${endpoint}`, options);
        
        // Check response status
        if (!resp.ok) {
          const statusCode = resp.status;
          const contentType = resp.headers.get("content-type");
          
          let errorMessage = `HTTP ${statusCode}`;
          try {
            if (contentType?.includes("protobuf")) {
              const data = await resp.arrayBuffer();
              if (data.byteLength > 0) {
                const errorMsg = ErrorResponse.fromBinary(new Uint8Array(data));
                errorMessage = errorMsg.error || errorMessage;
              }
            } else if (contentType?.includes("json")) {
              const errorData = await resp.json();
              errorMessage = errorData.error || errorData.message || errorMessage;
            }
          } catch (parseError) {
            if (typeof window === 'undefined') {
              console.warn('[apiCallProtobuf] Failed to parse error response:', parseError);
            }
          }

          throw new APIConnectionError(
            errorMessage,
            endpoint,
            statusCode,
            {
              method,
              bodyLength: body?.length,
              debug: createDebugInfo(),
            }
          );
        }

        pipelineLog('GIN:HTTP', 'info', `${resp.status} ${method} ${endpoint}`);
        return resp;
      },
      MAX_RETRIES,
      1000,
      10000
    );

    // Decode response from protobuf
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("protobuf")) {
      const arrayBuffer = await response.arrayBuffer();
      const resBytes = new Uint8Array(arrayBuffer);
      pipelineLog(
        'API:RES', 'info',
        `${arrayBuffer.byteLength}B protobuf ← ${endpoint}`,
      );
      // Empty protobuf payloads are valid for messages with only default values
      // (e.g., list responses with zero items).
      return resBytes as unknown as T;
    } else if (contentType?.includes("json")) {
      pipelineLog('API:RES', 'info', `JSON response ← ${endpoint}`);
      // Fallback to JSON if not protobuf
      return response.json() as Promise<T>;
    } else {
      throw new APIConnectionError(
        `Unexpected content-type: ${contentType || 'none'}`,
        endpoint,
        response.status,
        {acceptedTypes: ['application/protobuf', 'application/json']}
      );
    }
  } catch (error) {
    if (error instanceof APIConnectionError) {
      pipelineLog('API:RES', 'error', `${error.message} ← ${endpoint}`);
      logError(error, 'apiCallProtobuf');
      throw error;
    }
    const err = error instanceof Error ? error : new Error(String(error));
    pipelineLog('API:RES', 'error', `${err.message} ← ${endpoint}`);
    logError(err, 'apiCallProtobuf');
    throw new APIConnectionError(
      `API call failed: ${err.message}`,
      endpoint,
      undefined,
      {error: err.message, debug: createDebugInfo()}
    );
  }
}

function timestampToIsoString(ts: { seconds: bigint | number, nanos: number } | undefined | null): string {
    if (!ts) return new Date().toISOString();
    return new Date(Number(ts.seconds) * 1000 + ts.nanos / 1000000).toISOString();
}

// Session API
export const sessionAPI = {
  createSession: async (deviceId: string, notes?: string): Promise<Session> => {
    try {
      assertNotNull(deviceId, 'deviceId');
      assertType(deviceId, 'string', 'deviceId');
      assert(deviceId.length > 0, 'Device ID is empty');

      const encoded = SessionRequest.toBinary({
        deviceId: deviceId,
        notes: notes || "",
      });

      const response = await apiCallProtobuf<Uint8Array>(
        "/sessions",
        encoded,
        "POST"
      );

      const resp = SessionResponse.fromBinary(response);
      return {
        id: resp.id,
        user_id: resp.userId,
        device_id: resp.deviceId,
        status: resp.status,
        started_at: timestampToIsoString(resp.startedAt),
        throw_count: resp.throwCount,
        created_at: timestampToIsoString(resp.createdAt)
      };
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'sessionAPI.createSession');
      throw error;
    }
  },

  endSession: async (sessionId: string): Promise<{message: string}> => {
    try {
      assertNotNull(sessionId, 'sessionId');
      assertType(sessionId, 'string', 'sessionId');
      assert(sessionId.length > 0, 'Session ID is empty');

      const encoded = EndSessionRequest.toBinary({ sessionId });
      const response = await apiCallProtobuf<Uint8Array>(
        `/sessions/${sessionId}/end`,
        encoded,
        "PATCH"
      );

      const resp = EndSessionResponse.fromBinary(response);
      return {message: resp.message || 'Session ended'};
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'sessionAPI.endSession');
      throw error;
    }
  },

  getActiveSessions: async (): Promise<Session[]> => {
    try {
      const response = await apiCallProtobuf<Uint8Array>("/sessions/active");

      const resp = GetActiveSessionsResponse.fromBinary(response);
      return resp.sessions.map(s => ({
        id: s.id,
        user_id: s.userId,
        device_id: s.deviceId,
        status: s.status,
        started_at: timestampToIsoString(s.startedAt),
        throw_count: s.throwCount,
        created_at: timestampToIsoString(s.createdAt)
      }));
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'sessionAPI.getActiveSessions');
      throw error;
    }
  },
};

// Disc API
export const discAPI = {
  getUserDiscs: async (): Promise<Disc[]> => {
    try {
      const response = await apiCallProtobuf<Uint8Array>("/discs");

      const resp = GetUserDiscsResponse.fromBinary(response);
      return resp.discs.map(d => ({
        id: d.id,
        user_id: d.userId,
        name: d.name,
        type: d.type,
        weight: d.weight,
        color: d.color,
        created_at: timestampToIsoString(d.createdAt)
      }));
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'discAPI.getUserDiscs');
      throw error;
    }
  },

  createDisc: async (
    name: string,
    type: string,
    weight: number,
    color: string
  ): Promise<Disc> => {
    try {
      assertNotNull(name, 'name');
      assertNotNull(type, 'type');
      assertType(name, 'string', 'name');
      assertType(type, 'string', 'type');
      assertType(weight, 'number', 'weight');
      assert(name.length > 0, 'Disc name is empty');
      assert(type.length > 0, 'Disc type is empty');
      assert(weight > 0, 'Disc weight must be positive');

      const encoded = DiscRequest.toBinary({ name, type, weight, color });

      const response = await apiCallProtobuf<Uint8Array>(
        "/discs",
        encoded,
        "POST"
      );

      const d = DiscResponse.fromBinary(response);
      return {
        id: d.id,
        user_id: d.userId,
        name: d.name,
        type: d.type,
        weight: d.weight,
        color: d.color,
        created_at: timestampToIsoString(d.createdAt)
      };
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'discAPI.createDisc');
      throw error;
    }
  },

  deleteDisc: async (discId: string): Promise<{message: string}> => {
    try {
      assertNotNull(discId, 'discId');
      assertType(discId, 'string', 'discId');
      assert(discId.length > 0, 'Disc ID is empty');

      const response = await apiCallProtobuf<Uint8Array>(
        `/discs/${discId}`,
        undefined,
        "DELETE"
      );

      const resp = DeleteDiscResponse.fromBinary(response);
      return {message: resp.message || 'Disc deleted'};
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'discAPI.deleteDisc');
      throw error;
    }
  },
};

// Throw API
export const throwAPI = {
  saveThrow: async (throwData: {
    sessionId: string;
    discId: string;
    teeLat: number;
    teeLon: number;
    teeAlt?: number;
    foundLat: number;
    foundLon: number;
    foundAlt?: number;
    distance?: number;
    maxRpm?: number;
    exitVelocity?: number;
    flightTime?: number;
    state?: string;
    isOb?: boolean;
    wobbleG?: number;
    hdop?: number;
  }): Promise<{message: string; id: string}> => {
    try {
      // Validate required fields
      assertNotNull(throwData, 'throwData');
      assertNotNull(throwData.sessionId, 'sessionId');
      assertNotNull(throwData.discId, 'discId');
      assertNotNull(throwData.teeLat, 'teeLat');
      assertNotNull(throwData.teeLon, 'teeLon');
      assertNotNull(throwData.foundLat, 'foundLat');
      assertNotNull(throwData.foundLon, 'foundLon');
      
      assertType(throwData.teeLat, 'number', 'teeLat');
      assertType(throwData.teeLon, 'number', 'teeLon');
      assertType(throwData.foundLat, 'number', 'foundLat');
      assertType(throwData.foundLon, 'number', 'foundLon');

      // Validate GPS coordinates are in valid range
      assert(throwData.teeLat >= -90 && throwData.teeLat <= 90, 'Tee latitude out of range');
      assert(throwData.teeLon >= -180 && throwData.teeLon <= 180, 'Tee longitude out of range');
      assert(throwData.foundLat >= -90 && throwData.foundLat <= 90, 'Found latitude out of range');
      assert(throwData.foundLon >= -180 && throwData.foundLon <= 180, 'Found longitude out of range');

      const encoded = ThrowRequest.toBinary({
        sessionId: throwData.sessionId,
        discId: throwData.discId,
        teeLat: throwData.teeLat,
        teeLon: throwData.teeLon,
        teeAlt: throwData.teeAlt || 0,
        foundLat: throwData.foundLat,
        foundLon: throwData.foundLon,
        foundAlt: throwData.foundAlt || 0,
        distance: throwData.distance || 0,
        maxRpm: throwData.maxRpm || 0,
        exitVelocity: throwData.exitVelocity || 0,
        flightTime: throwData.flightTime || 0,
        state: throwData.state || '',
        isOb: throwData.isOb || false,
        wobbleG: throwData.wobbleG || 0,
        hdop: throwData.hdop || 0,
      });

      const response = await apiCallProtobuf<Uint8Array>(
        "/throws",
        encoded,
        "POST"
      );

      const resp = ThrowResponse.fromBinary(response);
      return { message: resp.message || 'Throw saved', id: resp.id };
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'throwAPI.saveThrow');
      throw error;
    }
  },

  getThrows: async (sessionId?: string): Promise<ThrowRecord[]> => {
    try {
      const endpoint = sessionId
        ? `/throws?sessionId=${encodeURIComponent(sessionId)}`
        : "/throws";
      const response = await apiCallProtobuf<Uint8Array>(endpoint, undefined, "GET");
      
      const resp = GetThrowsResponse.fromBinary(response);
      return resp.throws.map(t => ({
        id: t.id,
        session_id: t.sessionId,
        session_label: t.sessionLabel,
        disc_name: t.discName,
        disc_type: t.discType,
        distance: t.distance,
        flight_time: t.flightTime,
        exit_velocity: t.exitVelocity,
        max_rpm: t.maxRpm || 0,
        timestamp: timestampToIsoString(t.timestamp),
      }));
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'throwAPI.getThrows');
      throw error;
    }
  },

  deleteThrow: async (throwId: string): Promise<{message: string; id: string}> => {
    try {
      assertNotNull(throwId, 'throwId');
      assertType(throwId, 'string', 'throwId');
      assert(throwId.length > 0, 'Throw ID is empty');

      const response = await apiCallProtobuf<Uint8Array>(
        `/throws/${throwId}`,
        undefined,
        "DELETE"
      );

      const resp = ThrowResponse.fromBinary(response);
      return { message: resp.message || 'Throw deleted', id: resp.id || throwId };
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'throwAPI.deleteThrow');
      throw error;
    }
  },
};

// User Settings API
export const userSettingsAPI = {
  getSettings: async (): Promise<UserSettings> => {
    try {
      const response = await apiCallProtobuf<Uint8Array>("/user/settings");
      const resp = UserSettingsResponse.fromBinary(response);
      return {
        id: resp.id,
        user_id: resp.userId,
        bag_location_lat: resp.bagLocationLat,
        bag_location_lon: resp.bagLocationLon,
        preferred_unit: resp.preferredUnit,
        notifications_enabled: resp.notificationsEnabled,
        auto_save_enabled: resp.autoSaveEnabled,
        updated_at: timestampToIsoString(resp.updatedAt),
      };
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'userSettingsAPI.getSettings');
      throw error;
    }
  },

  updateSettings: async (settings: {
    bagLocationLat?: number;
    bagLocationLon?: number;
    preferredUnit?: string;
    notificationsEnabled?: boolean;
    autoSaveEnabled?: boolean;
  }): Promise<UserSettings> => {
    try {
      // Validate optional GPS coordinates if provided
      if (settings.bagLocationLat !== undefined) {
        assertType(settings.bagLocationLat, 'number', 'bagLocationLat');
        assert(settings.bagLocationLat >= -90 && settings.bagLocationLat <= 90, 'Latitude out of range');
      }
      if (settings.bagLocationLon !== undefined) {
        assertType(settings.bagLocationLon, 'number', 'bagLocationLon');
        assert(settings.bagLocationLon >= -180 && settings.bagLocationLon <= 180, 'Longitude out of range');
      }

      const encoded = UserSettingsRequest.toBinary({
        bagLocationLat: settings.bagLocationLat,
        bagLocationLon: settings.bagLocationLon,
        preferredUnit: settings.preferredUnit || "meters",
        notificationsEnabled: settings.notificationsEnabled ?? true,
        autoSaveEnabled: settings.autoSaveEnabled ?? true,
      });

      const response = await apiCallProtobuf<Uint8Array>(
        "/user/settings",
        encoded,
        "PATCH"
      );
      
      const resp = UserSettingsResponse.fromBinary(response);
      return {
        id: resp.id,
        user_id: resp.userId,
        bag_location_lat: resp.bagLocationLat,
        bag_location_lon: resp.bagLocationLon,
        preferred_unit: resp.preferredUnit,
        notifications_enabled: resp.notificationsEnabled,
        auto_save_enabled: resp.autoSaveEnabled,
        updated_at: timestampToIsoString(resp.updatedAt),
      };
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'userSettingsAPI.updateSettings');
      throw error;
    }
  },
};