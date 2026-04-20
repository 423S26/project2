import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ANSI tag map — matches the Go backend and preflight tags
const TAGS: Record<string, string> = {
  ok:   '\x1b[42;30m OK   \x1b[0m',
  warn: '\x1b[43;30m WARN \x1b[0m',
  fail: '\x1b[41;37m FAIL \x1b[0m',
  info: '\x1b[46;30m INFO \x1b[0m',
  wait: '\x1b[45;37m WAIT \x1b[0m',
};
const BLE_PREFIX = '\x1b[35m[BLE]\x1b[0m';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { lines } = body as { lines?: Array<{ stage: string; status: string; message: string; hex?: string }> };

    if (!lines || !Array.isArray(lines)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    for (const entry of lines) {
      const tag = TAGS[entry.status] ?? TAGS.info;
      const ts = new Date().toISOString().slice(11, 23);
      process.stdout.write(`  ${BLE_PREFIX} ${tag} ${ts} | ${entry.stage} | ${entry.message}\n`);

      // Print hex dump block if present
      if (entry.hex) {
        const hexLines = entry.hex.split('\n');
        for (const hl of hexLines) {
          process.stdout.write(`  ${BLE_PREFIX}   ${hl}\n`);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
