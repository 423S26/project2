import { NextResponse } from 'next/server';
import { createHmac, randomUUID } from 'crypto';

import { auth } from '@/auth';

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = createHmac('sha256', secret).update(signingInput).digest();
  const encodedSignature = base64UrlEncode(signature);

  return `${signingInput}.${encodedSignature}`;
}

export async function POST() {
  const session = await auth();
  const userId = String(session?.user?.id || '').trim();

  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return NextResponse.json({ error: 'JWT_SECRET is not configured' }, { status: 500 });
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: userId,
    user_id: userId,
    iat: now,
    exp: now + 5 * 60,
    jti: randomUUID(),
    iss: 'nextjs-backend-token',
    aud: 'go-api',
  };

  const token = signJwt(payload, jwtSecret);
  return NextResponse.json({ token });
}
