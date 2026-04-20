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

// Stack-layer prefixes — different color per layer
const LAYER_PREFIX: Record<string, string> = {
  BLE:  '\x1b[35m[BLE]\x1b[0m',   // magenta
  API:  '\x1b[34m[API]\x1b[0m',   // blue
  GIN:  '\x1b[33m[GIN]\x1b[0m',   // yellow
  AUTH: '\x1b[32m[AUTH]\x1b[0m',  // green
  SYNC: '\x1b[36m[SYNC]\x1b[0m', // cyan
};

function getLayerPrefix(stage: string): string {
  const layer = stage.split(':')[0];
  // Map DECODE and ENCODE stages to BLE layer
  if (layer === 'DECODE' || layer === 'ENCODE') return LAYER_PREFIX.BLE;
  return LAYER_PREFIX[layer] ?? LAYER_PREFIX.BLE;
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function formatHexDump(hex: string): string[] {
  const bytes = hex.replace(/ …$/, '').split(' ').filter(Boolean);
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const offset = i.toString(16).padStart(4, '0');
    const chunk = bytes.slice(i, i + 16);
    const hexPart = chunk.join(' ');
    const asciiPart = chunk
      .map(b => {
        const code = parseInt(b, 16);
        return code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : '.';
      })
      .join('');
    lines.push(`${dim(offset)}  ${hexPart.padEnd(48)}  ${dim(asciiPart)}`);
  }
  if (hex.endsWith('…')) lines.push(`${dim('     … (truncated)')}`);
  return lines;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { lines } = body as {
      lines?: Array<{
        stage: string;
        status: string;
        message: string;
        hex?: string;
        data?: Record<string, unknown>;
      }>;
    };

    if (!lines || !Array.isArray(lines)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    for (const entry of lines) {
      const tag = TAGS[entry.status] ?? TAGS.info;
      const prefix = getLayerPrefix(entry.stage);
      const ts = new Date().toISOString().slice(11, 23);
      process.stdout.write(`  ${prefix} ${tag} ${ts} | ${entry.stage} | ${entry.message}\n`);

      // Print formatted hex dump block if present
      if (entry.hex) {
        const hexLines = formatHexDump(entry.hex);
        for (const hl of hexLines) {
          process.stdout.write(`  ${prefix}   ${hl}\n`);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
