import { uuid, varchar, pgTable, text, timestamp, pgEnum, date, boolean, jsonb, index, serial, integer, numeric, real } from 'drizzle-orm/pg-core';

//Main entry-point for defining database schema using Drizzle ORM with PostgreSQL
//Schema definitions for users, disc, stats

//<-------------------------------------------------------------->//

//ASSOCIATIONS BETWEEN USER TABLE and DISC TABLE
    //USER to DISC
    //One-to-Many
    //A user can have many discs
    //One disc can have only one owner/user

//ASSOCIATIONS BETWEEN USER and STATS
    //USER to STATS
    //One-to-Many
    //A user can have many stats
    //Stats can belong to one user

//ASSOCIATIONS BETWEEN DISC and STATS
    //DISC to STATS
    //Many-to-Many
    //A disc can have many stats
    //Stats can belong to many discs

//<-------------------------------------------------------------->//

export const usersTable = pgTable('users_table', 
{
  id: uuid('id').primaryKey().defaultRandom(),
  full_name: varchar('full_name', {length: 255}).notNull(),
  email: text('email').notNull().unique(),
  phone: varchar('phone', {length: 20}).notNull().default(''),
  password: text('password').notNull(),
  last_activity_date: date('last_activity_date').notNull().defaultNow(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type InsertUser = typeof usersTable.$inferInsert;
export type SelectUser = typeof usersTable.$inferSelect;


export const discTable = pgTable('disc_table',
{
  id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    type: varchar('type', { length: 255 }).notNull(),
    weight: integer('weight').notNull(),
    color: varchar('color', { length: 255 }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type InsertDisc = typeof discTable.$inferInsert;
export type SelectDisc = typeof discTable.$inferSelect;

export const statsTable = pgTable('stats_table', (t) => ({
  id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
    device_id: varchar('device_id', { length: 255 }).notNull(),
    disc_id: uuid('disc_id').notNull().references(() => discTable.id, { onDelete: 'cascade' }),
    state: varchar('state', { length: 255 }).notNull(),
    latitude: real('latitude').notNull(),
    longitude: real('longitude').notNull(),
    altitude: real('altitude').notNull(),
    hdop: real('hdop').notNull(),
    speed: real('speed').notNull(),
    sats: integer('sats').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    accel_x: real('accel_x').notNull(),
    accel_y: real('accel_y').notNull(),
    accel_z: real('accel_z').notNull(),
    frequency_noise: real('frequency_noise').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    battery_level: integer('battery_level').notNull(),
}));

export type InsertStats = typeof statsTable.$inferInsert;
export type SelectStats = typeof statsTable.$inferSelect;
