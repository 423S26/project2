import { config } from 'dotenv';
import { createHmac, randomUUID } from 'crypto';
import { neon } from '@neondatabase/serverless';

config({ path: '.env.local' });

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

// Get a real user ID from the database
const sql = neon(process.env.DATABASE_URL);
const users = await sql`SELECT id FROM users_table LIMIT 1`;
if (!users.length) { console.error('No users in DB'); process.exit(1); }
const userId = users[0].id;
console.log('User ID:', userId);

const now = Math.floor(Date.now() / 1000);
const token = signJwt({
  sub: userId,
  user_id: userId,
  iat: now,
  exp: now + 300,
  jti: randomUUID(),
  iss: 'nextjs-backend-token',
  aud: 'go-api',
}, process.env.JWT_SECRET);

console.log('Token:', token);

// Now test sessions/active
const resp = await fetch('http://localhost:8080/api/v1/sessions/active', {
  headers: { 'Authorization': `Bearer ${token}` }
});
console.log('Status:', resp.status, resp.statusText);
const body = await resp.arrayBuffer();
console.log('Body length:', body.byteLength);
console.log('Body bytes:', Buffer.from(body).toString('hex'));
