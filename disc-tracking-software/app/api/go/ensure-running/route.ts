import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ ok: true, status: 'running', message: 'Backend is managed by Vercel Serverless automatically' }, { status: 200 });
}

export async function GET() {
  return NextResponse.json({ ok: true, status: 'running', message: 'Backend is managed by Vercel Serverless automatically' }, { status: 200 });
}
