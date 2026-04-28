export interface PingFrameSplitResult {
  frames: Uint8Array[];
  remainder: Uint8Array;
}

export function splitPingFrames(data: Uint8Array): PingFrameSplitResult {
  const frames: Uint8Array[] = [];
  let offset = 0;

  while (offset < data.length) {
    const varint = tryReadVarint(data, offset);
    
    // 1. Incomplete varint (need more data)
    if (!varint) {
      break;
    }

    const payloadLength = varint.value;
    const payloadStart = varint.nextOffset;

    // 2. Framing Error / Stream Corruption check
    // A Ping message is typically ~60-120 bytes.
    // If the length prefix requests an insane amount of data, we likely lost sync.
    if (payloadLength === 0 || payloadLength > 250) {
      // Step forward by 1 byte to attempt re-syncing on the next loop
      offset++;
      continue;
    }

    // 3. Incomplete payload (need more data)
    if (payloadStart + payloadLength > data.length) {
      break; 
    }

    // 4. We successfully isolated a full deterministic frame!
    // Extract JUST the payload (without the varint size prefix)
    frames.push(data.slice(payloadStart, payloadStart + payloadLength));
    
    // Advance the offset past this frame
    offset = payloadStart + payloadLength;
  }

  return {
    frames,
    remainder: data.slice(offset),
  };
}

function tryReadVarint(data: Uint8Array, offset: number): { value: number; nextOffset: number } | null {
  let value = 0;
  let shift = 0;
  let cursor = offset;

  // Max 5 bytes for a 32-bit varint buffer check
  while (cursor < data.length && shift < 35) {
    const byte = data[cursor++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value: value >>> 0, nextOffset: cursor };
    }
    shift += 7;
  }

  return null;
}
