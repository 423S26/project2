import { config } from 'dotenv';
import { neon } from '@neondatabase/serverless';

config({ path: '.env.local' });
const sql = neon(process.env.DATABASE_URL);

try {
  const r = await sql`SELECT to_regclass('public.sessions') as t`;
  console.log('sessions table:', r[0].t);
  
  const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'sessions' ORDER BY ordinal_position`;
  console.log('columns:', cols.map(c => `${c.column_name} (${c.data_type})`).join(', '));
} catch (e) {
  console.error('Error:', e.message);
}
