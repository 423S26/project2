import { NextResponse } from 'next/server';
import net from 'net';
import path from 'path';
import { spawn } from 'child_process';
import fs from 'fs';

import { auth } from '@/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GO_API_PORT = parseInt(process.env.GO_API_PORT ?? '8080', 10);
const GO_API_HOST = process.env.GO_API_HOST ?? '127.0.0.1';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isPortOpen(host: string, port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (value: boolean) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(value);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));

    socket.connect(port, host);
  });
}

async function waitForServer(host: string, port: number, attempts: number, delayMs: number): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await isPortOpen(host, port)) {
      return true;
    }
    await sleep(delayMs);
  }
  return false;
}

/**
 * Resolve the Go binary or command to launch.
 *
 * Priority:
 *  1. GO_BINARY_PATH env var — explicit path to a compiled binary (production)
 *  2. A compiled binary next to the source tree (auto-detected)
 *  3. `go run .` — development fallback
 *
 * Returns { cmd, args, cwd }.
 */
function resolveGoCommand(goSourceDir: string): { cmd: string; args: string[]; cwd: string } {
  // 1. Explicit override
  const explicit = process.env.GO_BINARY_PATH;
  if (explicit) {
    return { cmd: explicit, args: [], cwd: path.dirname(explicit) };
  }

  // 2. Auto-detect compiled binary beside the source directory
  const binaryName = process.platform === 'win32' ? 'disc-tracking.exe' : 'disc-tracking';
  const candidates = [
    path.join(goSourceDir, binaryName),                    // app/api/go/disc-tracking[.exe]
    path.join(process.cwd(), binaryName),                   // workspace root
    path.join(process.cwd(), 'bin', binaryName),            // workspace root/bin
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { cmd: candidate, args: [], cwd: path.dirname(candidate) };
    }
  }

  // 3. Development fallback — source-level run
  return { cmd: 'go', args: ['run', '.'], cwd: goSourceDir };
}

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (await isPortOpen(GO_API_HOST, GO_API_PORT)) {
    return NextResponse.json({ status: 'already-running' });
  }

  const goSourceDir = path.join(process.cwd(), 'app', 'api', 'go');
  const { cmd, args, cwd } = resolveGoCommand(goSourceDir);

  const child = spawn(cmd, args, {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: process.env,
  });
  child.unref();

  const ready = await waitForServer(GO_API_HOST, GO_API_PORT, 30, 250);
  if (!ready) {
    const hint =
      process.env.GO_BINARY_PATH
        ? `Binary at GO_BINARY_PATH (${process.env.GO_BINARY_PATH}) did not bind port ${GO_API_PORT} in time.`
        : cmd === 'go'
        ? 'Run `go run .` in app/api/go and verify DATABASE_URL/JWT_SECRET are valid.'
        : `Binary ${cmd} did not bind port ${GO_API_PORT} in time. Verify DATABASE_URL/JWT_SECRET are valid.`;

    return NextResponse.json(
      { error: 'go server failed to start automatically', details: hint },
      { status: 500 }
    );
  }

  return NextResponse.json({ status: 'started' });
}

