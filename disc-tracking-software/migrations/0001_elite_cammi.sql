CREATE TABLE "disc_table" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(255) NOT NULL,
	"weight" integer NOT NULL,
	"color" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stats_table" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" varchar(255) NOT NULL,
	"disc_id" uuid NOT NULL,
	"state" varchar(255) NOT NULL,
	"latitude" real NOT NULL,
	"longitude" real NOT NULL,
	"altitude" real NOT NULL,
	"hdop" real NOT NULL,
	"speed" real NOT NULL,
	"sats" integer NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"accel_x" real NOT NULL,
	"accel_y" real NOT NULL,
	"accel_z" real NOT NULL,
	"frequency_noise" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"battery_level" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users_table" DROP CONSTRAINT "users_table_id_unique";--> statement-breakpoint
ALTER TABLE "disc_table" ADD CONSTRAINT "disc_table_user_id_users_table_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stats_table" ADD CONSTRAINT "stats_table_user_id_users_table_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stats_table" ADD CONSTRAINT "stats_table_disc_id_disc_table_id_fk" FOREIGN KEY ("disc_id") REFERENCES "public"."disc_table"("id") ON DELETE cascade ON UPDATE no action;