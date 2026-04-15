/**
 * apply-schema.mjs
 * Safely applies the missing database schema (sessions, throws, user_settings, telemetry).
 * Run once with: node scripts/apply-schema.mjs
 *
 * - Each statement runs independently so a failure in one won't block the others.
 * - TimescaleDB hypertable conversion is attempted but skipped if the extension is unavailable.
 * - PostGIS is required for the throws geometry columns; Neon supports it on all plans.
 */

import { config } from 'dotenv';
import { neon } from '@neondatabase/serverless';

config({ path: '.env.local' });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL is not set in .env.local');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function run(label, query) {
  try {
    await sql.query(query);
    console.log(`✅  ${label}`);
  } catch (err) {
    console.warn(`⚠️   ${label} — skipped: ${err.message.split('\n')[0]}`);
  }
}

console.log('Applying missing schema to Neon database…\n');

// Extensions
await run('Enable PostGIS', `CREATE EXTENSION IF NOT EXISTS postgis CASCADE`);
await run('Enable TimescaleDB', `CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE`);

// disc_table (migration 0001 — may not have been applied)
await run('Create disc_table', `
  CREATE TABLE IF NOT EXISTS "disc_table" (
    "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id"    uuid NOT NULL REFERENCES "users_table"("id") ON DELETE cascade,
    "name"       varchar(255) NOT NULL,
    "type"       varchar(255) NOT NULL,
    "weight"     integer NOT NULL,
    "color"      varchar(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  )
`);

await run('Create stats_table', `
  CREATE TABLE IF NOT EXISTS "stats_table" (
    "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id"         uuid NOT NULL REFERENCES "users_table"("id") ON DELETE cascade,
    "device_id"       varchar(255) NOT NULL,
    "disc_id"         uuid NOT NULL REFERENCES "disc_table"("id") ON DELETE cascade,
    "state"           varchar(255) NOT NULL,
    "latitude"        real NOT NULL,
    "longitude"       real NOT NULL,
    "altitude"        real NOT NULL,
    "hdop"            real NOT NULL,
    "speed"           real NOT NULL,
    "sats"            integer NOT NULL,
    "timestamp"       timestamp with time zone NOT NULL,
    "accel_x"         real NOT NULL,
    "accel_y"         real NOT NULL,
    "accel_z"         real NOT NULL,
    "frequency_noise" real NOT NULL,
    "created_at"      timestamp with time zone DEFAULT now() NOT NULL,
    "battery_level"   integer NOT NULL
  )
`);

// sessions table
await run('Create sessions table', `
  CREATE TABLE IF NOT EXISTS "sessions" (
    "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id"      uuid NOT NULL REFERENCES "users_table"("id") ON DELETE cascade,
    "device_id"    varchar(255) NOT NULL,
    "status"       varchar(50)  NOT NULL DEFAULT 'active',
    "started_at"   timestamp with time zone NOT NULL DEFAULT now(),
    "ended_at"     timestamp with time zone,
    "throw_count"  integer DEFAULT 0,
    "total_distance" real DEFAULT 0,
    "notes"        text,
    "created_at"   timestamp with time zone DEFAULT now() NOT NULL
  )
`);

await run('Add sessions.status_check constraint', `
  DO $$ BEGIN
    ALTER TABLE sessions ADD CONSTRAINT status_check
      CHECK (status IN ('active', 'paused', 'ended'));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$
`);

// throws table — geometry columns require PostGIS
await run('Create throws table', `
  CREATE TABLE IF NOT EXISTS "throws" (
    "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id"        uuid NOT NULL REFERENCES "users_table"("id") ON DELETE cascade,
    "session_id"     uuid REFERENCES "sessions"("id") ON DELETE cascade,
    "device_id"      varchar(255) NOT NULL,
    "disc_id"        uuid REFERENCES "disc_table"("id") ON DELETE cascade,
    "timestamp"      timestamp with time zone NOT NULL,
    "tee_location"   geometry(POINTZ, 4326),
    "found_location" geometry(POINTZ, 4326),
    "distance"       real,
    "max_rpm"        real,
    "exit_velocity"  real,
    "flight_time"    real,
    "state"          varchar(50),
    "bag_location"   geometry(POINT, 4326),
    "is_ob"          boolean DEFAULT false,
    "wobble_g"       real,
    "hdop"           real,
    "created_at"     timestamp with time zone DEFAULT now() NOT NULL
  )
`);

await run('Add throws.state_check constraint', `
  DO $$ BEGIN
    ALTER TABLE throws ADD CONSTRAINT state_check
      CHECK (state IN ('in_flight', 'landed', 'out_of_bounds'));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$
`);

// Convert throws to TimescaleDB hypertable (skipped if TimescaleDB not available)
await run('Convert throws to hypertable', `
  SELECT create_hypertable('throws', 'timestamp', if_not_exists => TRUE)
`);

// user_settings table
await run('Create user_settings table', `
  CREATE TABLE IF NOT EXISTS "user_settings" (
    "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id"               uuid NOT NULL UNIQUE REFERENCES "users_table"("id") ON DELETE cascade,
    "bag_location_lat"      real,
    "bag_location_lon"      real,
    "preferred_unit"        varchar(20) DEFAULT 'meters',
    "notifications_enabled" boolean DEFAULT true,
    "auto_save_enabled"     boolean DEFAULT true,
    "created_at"            timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at"            timestamp with time zone DEFAULT now() NOT NULL
  )
`);

// telemetry table
await run('Create telemetry table', `
  CREATE TABLE IF NOT EXISTS "telemetry" (
    "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "device_id"       varchar(255) NOT NULL,
    "user_id"         uuid NOT NULL REFERENCES "users_table"("id") ON DELETE cascade,
    "timestamp"       timestamp with time zone NOT NULL,
    "latitude"        real,
    "longitude"       real,
    "altitude"        real,
    "accel_x"         real,
    "accel_y"         real,
    "accel_z"         real,
    "rpm"             real,
    "hdop"            real,
    "sats"            integer,
    "speed"           real,
    "battery_level"   integer,
    "frequency_noise" real,
    "created_at"      timestamp with time zone DEFAULT now() NOT NULL
  )
`);

// Convert telemetry to hypertable (skipped if TimescaleDB not available)
await run('Convert telemetry to hypertable', `
  SELECT create_hypertable('telemetry', 'timestamp', if_not_exists => TRUE)
`);

// Indexes
await run('Index: sessions(user_id, started_at)',  `CREATE INDEX IF NOT EXISTS idx_sessions_user_id  ON sessions(user_id DESC, started_at DESC)`);
await run('Index: sessions(status, user_id)',       `CREATE INDEX IF NOT EXISTS idx_sessions_status   ON sessions(status, user_id)`);
await run('Index: throws(user_id, timestamp)',      `CREATE INDEX IF NOT EXISTS idx_throws_user_id    ON throws(user_id DESC, timestamp DESC)`);
await run('Index: throws(session_id, timestamp)',   `CREATE INDEX IF NOT EXISTS idx_throws_session_id ON throws(session_id DESC, timestamp DESC)`);
await run('Index: throws(device_id, timestamp)',    `CREATE INDEX IF NOT EXISTS idx_throws_device_id  ON throws(device_id, timestamp DESC)`);
await run('Index: user_settings(user_id)',          `CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id)`);
await run('Index: telemetry(device_id, timestamp)', `CREATE INDEX IF NOT EXISTS idx_telemetry_device_id  ON telemetry(device_id DESC, timestamp DESC)`);
await run('Index: telemetry(user_id, timestamp)',   `CREATE INDEX IF NOT EXISTS idx_telemetry_user_id    ON telemetry(user_id DESC, timestamp DESC)`);

// GIST spatial indexes — only succeed if PostGIS is available
await run('GIST index: throws.found_location',     `CREATE INDEX IF NOT EXISTS idx_throws_found_location ON throws USING GIST(found_location)`);
await run('GIST index: throws.tee_location',       `CREATE INDEX IF NOT EXISTS idx_throws_tee_location   ON throws USING GIST(tee_location)`);

console.log('\nDone. Any ⚠️  warnings above are non-critical (e.g. TimescaleDB not on your plan).');
console.log('As long as sessions, throws, user_settings, and telemetry show ✅  you are good to go.');
