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

// ── ANSI tag helpers (match /api/pipeline-log) ──────────────
const T = {
  ok:   '\x1b[42;30m OK   \x1b[0m',
  warn: '\x1b[43;30m WARN \x1b[0m',
  fail: '\x1b[41;37m FAIL \x1b[0m',
  info: '\x1b[46;30m INFO \x1b[0m',
  wait: '\x1b[45;37m WAIT \x1b[0m',
};
const PRE = '\x1b[36m[PREFLIGHT]\x1b[0m';
const BLE = '\x1b[35m[BLE]\x1b[0m';
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function plog(tag: string, message: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  process.stdout.write(`  ${PRE} ${tag} ${dim(ts)} | ${message}\n`);
}

function blog(tag: string, message: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  process.stdout.write(`  ${BLE} ${tag} ${dim(ts)} | ${message}\n`);
}

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

  // In local development, prefer source execution so the dashboard preflight
  // uses the latest backend code instead of a stale compiled binary.
  if (process.env.NODE_ENV !== 'production') {
    return { cmd: 'go', args: ['run', '.'], cwd: goSourceDir };
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

  // ── Preflight banner ─────────────────────────────────────
  process.stdout.write('\n');
  plog(T.info, '──── BLE Pipeline Preflight ────');
  plog(T.info, `Go API target  → ${GO_API_HOST}:${GO_API_PORT}`);

  // Check if already running
  const alreadyUp = await isPortOpen(GO_API_HOST, GO_API_PORT);
  if (alreadyUp) {
    plog(T.ok, `Go API already listening on :${GO_API_PORT}`);
    blog(T.ok, 'Pipeline ready — BLE:RX → DECODE:PROTO → DECODE:ENV → ENCODE:HW → SYNC:UPLOAD');
    plog(T.info, '──── Preflight complete ────');
    process.stdout.write('\n');
    return NextResponse.json({ status: 'already-running' });
  }

  // Resolve and validate binary
  const goSourceDir = path.join(process.cwd(), 'app', 'api', 'go');
  const { cmd, args, cwd } = resolveGoCommand(goSourceDir);

  plog(T.info, `Binary resolve → ${cmd} ${args.join(' ')}`);
  plog(T.info, `Working dir    → ${cwd}`);

  // Check env vars
  const dbUrl = process.env.DATABASE_URL;
  const jwtSecret = process.env.JWT_SECRET;
  if (dbUrl) {
    plog(T.ok, `DATABASE_URL   → set (${dbUrl.split('@').pop()?.split('/')[0] ?? '***'})`);
  } else {
    plog(T.warn, 'DATABASE_URL   → NOT SET');
  }
  plog(jwtSecret ? T.ok : T.warn, `JWT_SECRET     → ${jwtSecret ? 'set' : 'NOT SET'}`);

  // Check proto stubs
  const pbDir = path.join(goSourceDir, 'pb');
  const hasApiPb = fs.existsSync(path.join(pbDir, 'api.pb.go'));
  const hasHwPb = fs.existsSync(path.join(pbDir, 'hardware.pb.go'));
  plog(hasApiPb ? T.ok : T.fail, `Proto stubs    → api.pb.go ${hasApiPb ? '✓' : '✗'}`);
  plog(hasHwPb ? T.ok : T.fail, `Proto stubs    → hardware.pb.go ${hasHwPb ? '✓' : '✗'}`);

  // Spawn server
  plog(T.wait, 'Starting Go API server…');

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

    plog(T.fail, `Go API failed to bind :${GO_API_PORT} — ${hint}`);
    plog(T.info, '──── Preflight FAILED ────');
    process.stdout.write('\n');

    return NextResponse.json(
      { error: 'go server failed to start automatically', details: hint },
      { status: 500 }
    );
  }

  plog(T.ok, `Go API listening on :${GO_API_PORT}`);
  blog(T.ok, 'Pipeline ready — BLE:RX → DECODE:PROTO → DECODE:ENV → ENCODE:HW → SYNC:UPLOAD');
  plog(T.info, '──── Preflight complete ────');
  process.stdout.write('\n');

  return NextResponse.json({ status: 'started' });
}

