-- TimescaleDB Migration: Enable extension and create hypertables for time-series data
-- This migration adds TimescaleDB support for efficient time-series storage

-- Enable TimescaleDB extension if not already enabled
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- Enable PostGIS for geospatial data
CREATE EXTENSION IF NOT EXISTS postgis CASCADE;

-- Create sessions table for throw tracking sessions
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users_table"("id") ON DELETE cascade,
	"device_id" varchar(255) NOT NULL,
	"status" varchar(50) NOT NULL DEFAULT 'active',
	"started_at" timestamp with time zone NOT NULL DEFAULT now(),
	"ended_at" timestamp with time zone,
	"throw_count" integer DEFAULT 0,
	"total_distance" real DEFAULT 0,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Create throws table as a hypertable for efficient time-series queries
CREATE TABLE IF NOT EXISTS "throws" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users_table"("id") ON DELETE cascade,
	"session_id" uuid REFERENCES "sessions"("id") ON DELETE cascade,
	"device_id" varchar(255) NOT NULL,
	"disc_id" uuid REFERENCES "disc_table"("id") ON DELETE cascade,
	"timestamp" timestamp with time zone NOT NULL,
	"tee_location" geometry(POINTZ, 4326),
	"found_location" geometry(POINTZ, 4326),
	"distance" real,
	"max_rpm" real,
	"exit_velocity" real,
	"flight_time" real,
	"state" varchar(50),
	"bag_location" geometry(POINT, 4326),
	"is_ob" boolean DEFAULT false,
	"wobble_g" real,
	"hdop" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Convert throws table to hypertable for time-series optimization
SELECT create_hypertable('throws', 'timestamp', if_not_exists => TRUE);

-- Create user_settings table
CREATE TABLE IF NOT EXISTS "user_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL UNIQUE REFERENCES "users_table"("id") ON DELETE cascade,
	"bag_location_lat" real,
	"bag_location_lon" real,
	"preferred_unit" varchar(20) DEFAULT 'meters',
	"notifications_enabled" boolean DEFAULT true,
	"auto_save_enabled" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Create telemetry table as a hypertable for raw sensor data
CREATE TABLE IF NOT EXISTS "telemetry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" varchar(255) NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users_table"("id") ON DELETE cascade,
	"timestamp" timestamp with time zone NOT NULL,
	"latitude" real,
	"longitude" real,
	"altitude" real,
	"accel_x" real,
	"accel_y" real,
	"accel_z" real,
	"rpm" real,
	"hdop" real,
	"sats" integer,
	"speed" real,
	"battery_level" integer,
	"frequency_noise" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Convert telemetry table to hypertable
SELECT create_hypertable('telemetry', 'timestamp', if_not_exists => TRUE);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_throws_user_id ON throws(user_id DESC, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_throws_session_id ON throws(session_id DESC, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_throws_device_id ON throws(device_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_throws_found_location ON throws USING GIST(found_location);
CREATE INDEX IF NOT EXISTS idx_throws_tee_location ON throws USING GIST(tee_location);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id DESC, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status, user_id);

CREATE INDEX IF NOT EXISTS idx_telemetry_device_id ON telemetry(device_id DESC, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_user_id ON telemetry(user_id DESC, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

-- Add constraints for data integrity
ALTER TABLE sessions ADD CONSTRAINT status_check CHECK (status IN ('active', 'paused', 'ended'));
ALTER TABLE throws ADD CONSTRAINT state_check CHECK (state IN ('in_flight', 'landed', 'out_of_bounds'));
