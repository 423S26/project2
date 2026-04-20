// Frontend API service to communicate with GO backend
// Uses Protobuf encoding for all requests/responses
// All requests are made to http://localhost:8080/api/v1

import { ProtoEncoder, ProtoDecoder } from './pb/codec';
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
    };

    if (body) {
      options.body = body as any;
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
                const decoder = new ProtoDecoder(new Uint8Array(data));
                const errorMsg = decoder.decodeMessage();
                errorMessage = errorMsg.field_1 || errorMsg.error || errorMessage;
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

function skipUnknownField(decoder: ProtoDecoder, wireType: number): void {
  switch (wireType) {
    case 0:
      decoder.decodeVarint();
      break;
    case 1:
      decoder.readBytes(8);
      break;
    case 2: {
      const length = decoder.decodeVarint();
      decoder.readBytes(length);
      break;
    }
    case 5:
      decoder.readBytes(4);
      break;
    default:
      throw new Error(`Unsupported wire type: ${wireType}`);
  }
}

function decodeProtoTimestamp(decoder: ProtoDecoder): string {
  const length = decoder.decodeVarint();
  if (length === 0) {
    return '';
  }

  const bytes = decoder.readBytes(length);
  const nested = new ProtoDecoder(bytes);
  let seconds = 0;
  let nanos = 0;

  while (nested.getOffset() < bytes.length) {
    const tag = nested.decodeVarint();
    const wireType = tag & 0x07;
    const fieldNumber = tag >>> 3;

    if (wireType !== 0) {
      skipUnknownField(nested, wireType);
      continue;
    }

    if (fieldNumber === 1) {
      seconds = nested.decodeVarint();
    } else if (fieldNumber === 2) {
      nanos = nested.decodeVarint();
    } else {
      nested.decodeVarint();
    }
  }

  return new Date(seconds * 1000 + nanos / 1000000).toISOString();
}

// Convert decoded proto response to frontend Session
function decodeSession(data: Uint8Array): Session {
  const decoder = new ProtoDecoder(data);
  const session: Session = {
    id: '',
    user_id: '',
    device_id: '',
    status: '',
    started_at: '',
    throw_count: 0,
    created_at: '',
  };

  while (decoder.getOffset() < data.length) {
    const tag = decoder.decodeVarint();
    const wireType = tag & 0x07;
    const fieldNumber = tag >>> 3;

    switch (fieldNumber) {
      case 1:
        session.id = decoder.decodeString();
        break;
      case 2:
        session.user_id = decoder.decodeString();
        break;
      case 3:
        session.device_id = decoder.decodeString();
        break;
      case 4:
        session.status = decoder.decodeString();
        break;
      case 5:
        session.started_at = decodeProtoTimestamp(decoder);
        break;
      case 6:
        // We intentionally ignore ended_at for this simplified frontend model.
        decodeProtoTimestamp(decoder);
        break;
      case 7:
        session.throw_count = decoder.decodeVarint();
        break;
      case 8:
        session.created_at = decodeProtoTimestamp(decoder);
        break;
      default:
        skipUnknownField(decoder, wireType);
        break;
    }
  }

  if (!session.started_at) {
    session.started_at = new Date().toISOString();
  }
  if (!session.created_at) {
    session.created_at = session.started_at;
  }

  return session;
}

function decodeSessionList(data: Uint8Array): Session[] {
  const decoder = new ProtoDecoder(data);
  const sessions: Session[] = [];

  while (decoder.getOffset() < data.length) {
    const tag = decoder.decodeVarint();
    const wireType = tag & 0x07;
    const fieldNumber = tag >>> 3;

    if (fieldNumber === 1 && wireType === 2) {
      const length = decoder.decodeVarint();
      const bytes = decoder.readBytes(length);
      sessions.push(decodeSession(bytes));
      continue;
    }

    skipUnknownField(decoder, wireType);
  }

  return sessions;
}

function decodeThrowRecord(data: Uint8Array): ThrowRecord {
  const decoder = new ProtoDecoder(data);
  const item: ThrowRecord = {
    id: '',
    session_id: '',
    session_label: '',
    disc_name: '',
    disc_type: '',
    distance: 0,
    flight_time: 0,
    exit_velocity: 0,
    timestamp: '',
  };

  while (decoder.getOffset() < data.length) {
    const tag = decoder.decodeVarint();
    const wireType = tag & 0x07;
    const fieldNumber = tag >>> 3;

    switch (fieldNumber) {
      case 1:
        item.id = decoder.decodeString();
        break;
      case 2:
        item.session_id = decoder.decodeString();
        break;
      case 3:
        item.session_label = decoder.decodeString();
        break;
      case 4:
        item.disc_name = decoder.decodeString();
        break;
      case 5:
        item.disc_type = decoder.decodeString();
        break;
      case 6:
        item.distance = decoder.decodeDouble();
        break;
      case 7:
        item.flight_time = decoder.decodeDouble();
        break;
      case 8:
        item.exit_velocity = decoder.decodeDouble();
        break;
      case 9:
        item.timestamp = decodeProtoTimestamp(decoder);
        break;
      default:
        skipUnknownField(decoder, wireType);
        break;
    }
  }

  if (!item.timestamp) {
    item.timestamp = new Date().toISOString();
  }

  return item;
}

function decodeThrowList(data: Uint8Array): ThrowRecord[] {
  const decoder = new ProtoDecoder(data);
  const throws: ThrowRecord[] = [];

  while (decoder.getOffset() < data.length) {
    const tag = decoder.decodeVarint();
    const wireType = tag & 0x07;
    const fieldNumber = tag >>> 3;

    if (fieldNumber === 1 && wireType === 2) {
      const length = decoder.decodeVarint();
      const bytes = decoder.readBytes(length);
      throws.push(decodeThrowRecord(bytes));
      continue;
    }

    skipUnknownField(decoder, wireType);
  }

  return throws;
}

// Convert decoded proto response to frontend Disc
// DiscResponse fields: id=1, user_id=2, name=3, type=4, weight=5, color=6, created_at=7
function decodeDisc(data: Uint8Array): Disc {
  const decoder = new ProtoDecoder(data);
  const disc: Disc = {
    id: '',
    user_id: '',
    name: '',
    type: '',
    weight: 0,
    color: '',
    created_at: '',
  };

  while (decoder.getOffset() < data.length) {
    const tag = decoder.decodeVarint();
    const wireType = tag & 0x07;
    const fieldNumber = tag >>> 3;

    switch (fieldNumber) {
      case 1: disc.id = decoder.decodeString(); break;
      case 2: disc.user_id = decoder.decodeString(); break;
      case 3: disc.name = decoder.decodeString(); break;
      case 4: disc.type = decoder.decodeString(); break;
      case 5: disc.weight = decoder.decodeVarint(); break;
      case 6: disc.color = decoder.decodeString(); break;
      case 7: disc.created_at = decodeProtoTimestamp(decoder); break;
      default: skipUnknownField(decoder, wireType); break;
    }
  }

  if (!disc.created_at) {
    disc.created_at = new Date().toISOString();
  }

  return disc;
}

// Session API
export const sessionAPI = {
  createSession: async (deviceId: string, notes?: string): Promise<Session> => {
    try {
      assertNotNull(deviceId, 'deviceId');
      assertType(deviceId, 'string', 'deviceId');
      assert(deviceId.length > 0, 'Device ID is empty');

      const encoded = ProtoEncoder.encodeObject({
        device_id: deviceId,
        notes: notes || "",
      });

      const response = await apiCallProtobuf<Uint8Array>(
        "/sessions",
        encoded,
        "POST"
      );

      return decodeSession(response);
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

      const response = await apiCallProtobuf<Uint8Array>(
        `/sessions/${sessionId}/end`,
        undefined,
        "PATCH"
      );

      const decoder = new ProtoDecoder(response);
      const message = decoder.decodeString();
      assert(message.length > 0, 'Received empty message from server');

      return {message};
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'sessionAPI.endSession');
      throw error;
    }
  },

  getActiveSessions: async (): Promise<Session[]> => {
    try {
      const response = await apiCallProtobuf<Uint8Array>("/sessions/active");

      const sessions = decodeSessionList(response);
      return sessions.length > 0 ? sessions : [];
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

      const decoder = new ProtoDecoder(response);
      const discs: Disc[] = [];

      try {
        while (decoder.getOffset() < response.length) {
          const tag = decoder.decodeVarint();
          const wireType = tag & 0x07;
          const fieldNumber = tag >>> 3;

          if (fieldNumber === 1 && wireType === 2) {
            const discLength = decoder.decodeVarint();
            const discBytes = decoder.readBytes(discLength);
            discs.push(decodeDisc(discBytes));
          } else {
            skipUnknownField(decoder, wireType);
          }
        }
      } catch (decodeError) {
        if (discs.length > 0 && typeof window === 'undefined') {
          console.warn('[discAPI] Partial disc list decoded:', {
            decodedCount: discs.length,
            error: (decodeError as Error).message,
          });
        } else if (discs.length === 0) {
          throw decodeError;
        }
      }

      return discs.length > 0 ? discs : [];
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'discAPI.getUserDiscs');
      throw error;
    }
  },

  createDisc: async (
    name: string,
    type: string,
    weight: number,
    color: string,
    connectionNumber?: string
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

      const encoded = ProtoEncoder.encodeObject({
        name,
        type,
        weight,
        color,
      });

      const response = await apiCallProtobuf<Uint8Array>(
        "/discs",
        encoded,
        "POST"
      );

      return decodeDisc(response);
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

      const decoder = new ProtoDecoder(response);
      const message = decoder.decodeString();
      assert(message.length > 0, 'Received empty message from server');

      return {message};
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

      const encoded = ProtoEncoder.encodeObject({
        session_id: throwData.sessionId,
        disc_id: throwData.discId,
        tee_lat: throwData.teeLat,
        tee_lon: throwData.teeLon,
        tee_alt: throwData.teeAlt,
        found_lat: throwData.foundLat,
        found_lon: throwData.foundLon,
        found_alt: throwData.foundAlt,
        distance: throwData.distance,
        max_rpm: throwData.maxRpm,
        exit_velocity: throwData.exitVelocity,
        flight_time: throwData.flightTime,
        state: throwData.state,
        is_ob: throwData.isOb,
        wobble_g: throwData.wobbleG,
        hdop: throwData.hdop,
      });

      const response = await apiCallProtobuf<Uint8Array>(
        "/throws",
        encoded,
        "POST"
      );

      const decoder = new ProtoDecoder(response);
      const message = decoder.decodeString();
      const id = decoder.decodeString();
      assert(message.length > 0, 'Received empty message from server');
      assert(id.length > 0, 'Received empty ID from server');

      return {message, id};
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
      return decodeThrowList(response);
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

      const decoder = new ProtoDecoder(response);
      const message = decoder.decodeString();
      const id = decoder.decodeString();
      assert(message.length > 0, 'Received empty message from server');
      assert(id.length > 0, 'Received empty ID from server');
      return {message, id};
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

      const decoder = new ProtoDecoder(response);
      const id = decoder.decodeString();
      const userId = decoder.decodeString();
      const preferredUnit = decoder.decodeString();
      const notificationsEnabled = decoder.decodeBoolean();
      const autoSaveEnabled = decoder.decodeBoolean();

      assert(id.length > 0, 'Received empty settings ID from server');
      assert(userId.length > 0, 'Received empty user ID from server');

      return {
        id,
        user_id: userId,
        preferred_unit: preferredUnit,
        notifications_enabled: notificationsEnabled,
        auto_save_enabled: autoSaveEnabled,
        updated_at: new Date().toISOString(),
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
  }): Promise<{message: string}> => {
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

      const encoded = ProtoEncoder.encodeObject({
        bag_location_lat: settings.bagLocationLat,
        bag_location_lon: settings.bagLocationLon,
        preferred_unit: settings.preferredUnit,
        notifications_enabled: settings.notificationsEnabled,
        auto_save_enabled: settings.autoSaveEnabled,
      });

      const response = await apiCallProtobuf<Uint8Array>(
        "/user/settings",
        encoded,
        "PATCH"
      );

      const decoder = new ProtoDecoder(response);
      const message = decoder.decodeString();
      assert(message.length > 0, 'Received empty message from server');

      return {message};
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'userSettingsAPI.updateSettings');
      throw error;
    }
  },
};

// User API
export const userAPI = {
  getCurrentUser: async () => {
    try {
      const response = await apiCallProtobuf("/user");
      const decoder = new ProtoDecoder(response as Uint8Array);
      
      const id = decoder.decodeString();
      const email = decoder.decodeString();
      const name = decoder.decodeString();

      assert(id.length > 0, 'Received empty user ID from server');
      assert(email.length > 0, 'Received empty email from server');

      return {id, email, name};
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'userAPI.getCurrentUser');
      throw error;
    }
  },

  updateProfile: async (userData: { fullName?: string; email?: string }) => {
    try {
      if (userData.email !== undefined) {
        assertType(userData.email, 'string', 'email');
        assert(userData.email.includes('@'), 'Invalid email format');
      }
      if (userData.fullName !== undefined) {
        assertType(userData.fullName, 'string', 'fullName');
        assert(userData.fullName.length > 0, 'Full name is empty');
      }

      const encoded = ProtoEncoder.encodeObject({
        full_name: userData.fullName,
        email: userData.email,
      });

      const response = await apiCallProtobuf<Uint8Array>(
        "/user",
        encoded,
        "PATCH"
      );

      const decoder = new ProtoDecoder(response);
      const message = decoder.decodeString();
      assert(message.length > 0, 'Received empty message from server');

      return {message};
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'userAPI.updateProfile');
      throw error;
    }
  },
};
