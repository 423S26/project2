-- user_devices: Maps hardware BLE device IDs (e.g. "D9936A126356") to user accounts.
-- When a signed-in user connects to a BLE tracker, the hardware ID is auto-registered here.
-- verifyDeviceOwnership checks this table so telemetry uploads are authorized.

CREATE TABLE IF NOT EXISTS "user_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users_table"("id") ON DELETE cascade,
	"hardware_device_id" varchar(255) NOT NULL,
	"name" varchar(255),
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_devices_user_hardware_unique" UNIQUE ("user_id", "hardware_device_id")
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON user_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_hardware_id ON user_devices(hardware_device_id);
