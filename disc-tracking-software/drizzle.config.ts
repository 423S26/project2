
import { config } from 'dotenv';

require('dotenv').config();
config({ path: '.env.local' });

export default {
  schema: "./database/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
};