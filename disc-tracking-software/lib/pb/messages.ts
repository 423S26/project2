// TypeScript Protobuf Message Type Definitions
// Simplified types for frontend use

export interface SessionRequest {
  device_id: string;
  notes?: string;
}

export interface SessionResponse {
  id: string;
  user_id: string;
  device_id: string;
  status: string;
  started_at?: Date;
  ended_at?: Date;
  throw_count: number;
  created_at?: Date;
}

export interface DiscRequest {
  name: string;
  type: string;
  weight: number;
  color: string;
}

export interface DiscResponse {
  id: string;
  user_id: string;
  name: string;
  type: string;
  weight: number;
  color: string;
  created_at?: Date;
}

export interface GetUserDiscsResponse {
  discs: DiscResponse[];
}

export interface ThrowRequest {
  session_id: string;
  disc_id: string;
  tee_lat: number;
  tee_lon: number;
  tee_alt?: number;
  found_lat: number;
  found_lon: number;
  found_alt?: number;
  distance?: number;
  max_rpm?: number;
  exit_velocity?: number;
  flight_time?: number;
  state?: string;
  is_ob: boolean;
  wobble_g?: number;
  hdop?: number;
}

export interface ThrowResponse {
  message: string;
  id: string;
}

export interface UserSettingsRequest {
  bag_location_lat?: number;
  bag_location_lon?: number;
  preferred_unit: string;
  notifications_enabled: boolean;
  auto_save_enabled: boolean;
}

export interface UserSettingsResponse {
  id: string;
  user_id: string;
  bag_location_lat?: number;
  bag_location_lon?: number;
  preferred_unit: string;
  notifications_enabled: boolean;
  auto_save_enabled: boolean;
  updated_at?: Date;
}

export interface GetActiveSessionsResponse {
  sessions: SessionResponse[];
}

export interface DeleteDiscResponse {
  message: string;
  id: string;
}

export interface ErrorResponse {
  error: string;
  code: number;
}

export interface GenericMessage {
  message: string;
}

// Timestamp helper
export interface Timestamp {
  seconds: number;
  nanos: number;
}
