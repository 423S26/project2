// Protobuf Codec Utilities for Frontend
// Handles encoding/decoding of protobuf messages with comprehensive error handling

import {
  ProtoBufferError,
  FirmwareConnectionError,
  ValidationError,
  BoundsError,
  assert,
  assertNotNull,
  assertType,
  assertBounds,
  logError,
  createDebugInfo,
} from '../errors';

/**
 * Encode a plain object to protobuf binary format
 * Uses a simplified varint and field encoding approach
 */
export function encodeMessage(obj: any): Uint8Array {
  try {
    assertNotNull(obj, 'object to encode');
    if (typeof obj !== 'object' || Array.isArray(obj)) {
      throw new ValidationError(
        'Expected object for encoding, got array or non-object',
        'root',
        obj,
        'object'
      );
    }
    return ProtoEncoder.encodeObject(obj);
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), 'encodeMessage');
    throw error;
  }
}

/**
 * Decode protobuf binary data to a plain object
 */
export function decodeMessage(data: Uint8Array): any {
  try {
    assertNotNull(data, 'data to decode');
    assertType(data, 'object', 'data');
    assert(data instanceof Uint8Array, 'Data must be Uint8Array', {receivedType: data.constructor.name});
    assert(data.length > 0, 'Data buffer is empty');
    
    const decoder = new ProtoDecoder(data);
    return decoder.decodeMessage();
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), 'decodeMessage');
    throw error;
  }
}

/**
 * Decode Ping message from protobuf binary data
 */
export function decodePing(data: Uint8Array): PingData {
  try {
    const decoder = new ProtoDecoder(data);
    
    let device_id = '';
    let lat = 0;
    let lon = 0;
    let alt = 0;
    let speed_mps = 0;
    let heading = 0;
    let hdop = 0;
    let sats = 0;
    let temp_c = 0;
    let accel_x = 0;
    let accel_y = 0;
    let accel_z = 0;
    let gyro_x = 0;
    let gyro_y = 0;
    let gyro_z = 0;
    let timestamp = 0;
    let batt_pct = 0;

    while (decoder.getOffset() < data.length) {
      try {
        const tag = decoder.decodeVarint();
        const wireType = tag & 0x07;
        const fieldNumber = tag >>> 3;

        if (fieldNumber === 1) {
          device_id = decoder.decodeString();
        } else if (fieldNumber === 2) {
          lat = decoder.decodeDouble();
        } else if (fieldNumber === 3) {
          lon = decoder.decodeDouble();
        } else if (fieldNumber === 4) {
          alt = decoder.decodeDouble();
        } else if (fieldNumber === 5) {
          speed_mps = decoder.decodeFloat();
        } else if (fieldNumber === 6) {
          heading = decoder.decodeFloat();
        } else if (fieldNumber === 7) {
          temp_c = decoder.decodeFloat();
        } else if (fieldNumber === 8) {
          hdop = decoder.decodeFloat();
        } else if (fieldNumber === 9) {
          sats = decoder.decodeVarint();
        } else if (fieldNumber === 10) {
          accel_x = decoder.decodeFloat();
        } else if (fieldNumber === 11) {
          accel_y = decoder.decodeFloat();
        } else if (fieldNumber === 12) {
          accel_z = decoder.decodeFloat();
        } else if (fieldNumber === 13) {
          gyro_x = decoder.decodeFloat();
        } else if (fieldNumber === 14) {
          gyro_y = decoder.decodeFloat();
        } else if (fieldNumber === 15) {
          gyro_z = decoder.decodeFloat();
        } else if (fieldNumber === 16) {
          timestamp = decoder.decodeVarint();
        } else if (fieldNumber === 17) {
          batt_pct = decoder.decodeVarint();
        } else {
          // Skip unknown fields
          if (wireType === 2) {
            const length = decoder.decodeVarint();
            decoder.readBytes(length);
          } else if (wireType === 0 || wireType === 1 || wireType === 5) {
            if (wireType === 1) decoder.readBytes(8);
            else if (wireType === 5) decoder.readBytes(4);
            else decoder.decodeVarint();
          }
        }
      } catch (fieldError) {
        break;
      }
    }

    return {
      device_id,
      lat,
      lon,
      alt,
      speed_mps,
      heading,
      hdop,
      sats,
      temp_c,
      accel_x,
      accel_y,
      accel_z,
      gyro_x,
      gyro_y,
      gyro_z,
      timestamp,
      batt_pct,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new FirmwareConnectionError(
      `Failed to decode Ping message: ${err.message}`,
      undefined,
      {
        dataLength: data.length,
        error: err.message,
      }
    );
  }
}

export interface PingData {
  device_id: string;
  lat: number;
  lon: number;
  alt: number;
  speed_mps: number;
  heading: number;
  hdop: number;
  sats: number;
  temp_c: number;
  accel_x: number;
  accel_y: number;
  accel_z: number;
  gyro_x: number;
  gyro_y: number;
  gyro_z: number;
  timestamp: number;
  batt_pct: number;
}

// ──────────────────────────────────────────────────────────────
// Helpers for hand-encoding to hardware.proto Ping format
// ──────────────────────────────────────────────────────────────

function encodeTag(fieldNumber: number, wireType: number): Uint8Array {
  return ProtoEncoder.encodeVarint((fieldNumber << 3) | wireType);
}

function encodeFloat32(value: number): Uint8Array {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, value, true);
  return new Uint8Array(buffer);
}

function encodeFloat64(value: number): Uint8Array {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, true);
  return new Uint8Array(buffer);
}

/**
 * Encode a PingData into hardware.proto Ping binary.
 * Field numbers now match firmware tracker.proto exactly.
 *
 *   hardware.proto field layout (aligned with tracker.proto):
 *     1=device_id(string)
 *     2=lat(double)  3=lon(double)  4=alt(double)
 *     5=speed_mps(float)  6=heading(float)  7=temp_c(float)
 *     8=hdop(float)  9=sats(int32)
 *    10=accel_x(float) 11=accel_y(float) 12=accel_z(float)
 *    13=gyro_x(float)  14=gyro_y(float)  15=gyro_z(float)
 *    16=timestamp(int64)  17=batt_pct(int32)
 */
export function encodeHardwarePing(ping: PingData): Uint8Array {
  const parts: Uint8Array[] = [];

  // field 1: device_id (string, wire 2)
  if (ping.device_id) {
    const encoded = ProtoEncoder.encodeString(ping.device_id);
    parts.push(encodeTag(1, 2));
    parts.push(ProtoEncoder.encodeVarint(encoded.length));
    parts.push(encoded);
  }

  // field 2: lat (double, wire 1)
  if (ping.lat !== 0) {
    parts.push(encodeTag(2, 1));
    parts.push(encodeFloat64(ping.lat));
  }

  // field 3: lon (double, wire 1)
  if (ping.lon !== 0) {
    parts.push(encodeTag(3, 1));
    parts.push(encodeFloat64(ping.lon));
  }

  // field 4: alt (double, wire 1)
  if (ping.alt !== 0) {
    parts.push(encodeTag(4, 1));
    parts.push(encodeFloat64(ping.alt));
  }

  // field 5: speed_mps (float, wire 5)
  if (ping.speed_mps !== 0) {
    parts.push(encodeTag(5, 5));
    parts.push(encodeFloat32(ping.speed_mps));
  }

  // field 6: heading (float, wire 5)
  if (ping.heading !== 0) {
    parts.push(encodeTag(6, 5));
    parts.push(encodeFloat32(ping.heading));
  }

  // field 7: temp_c (float, wire 5)
  if (ping.temp_c !== 0) {
    parts.push(encodeTag(7, 5));
    parts.push(encodeFloat32(ping.temp_c));
  }

  // field 8: hdop (float, wire 5)
  if (ping.hdop !== 0) {
    parts.push(encodeTag(8, 5));
    parts.push(encodeFloat32(ping.hdop));
  }

  // field 9: sats (int32, wire 0)
  if (ping.sats !== 0) {
    parts.push(encodeTag(9, 0));
    parts.push(ProtoEncoder.encodeVarint(ping.sats));
  }

  // field 10: accel_x (float, wire 5)
  if (ping.accel_x !== 0) {
    parts.push(encodeTag(10, 5));
    parts.push(encodeFloat32(ping.accel_x));
  }

  // field 11: accel_y (float, wire 5)
  if (ping.accel_y !== 0) {
    parts.push(encodeTag(11, 5));
    parts.push(encodeFloat32(ping.accel_y));
  }

  // field 12: accel_z (float, wire 5)
  if (ping.accel_z !== 0) {
    parts.push(encodeTag(12, 5));
    parts.push(encodeFloat32(ping.accel_z));
  }

  // field 13: gyro_x (float, wire 5)
  if (ping.gyro_x !== 0) {
    parts.push(encodeTag(13, 5));
    parts.push(encodeFloat32(ping.gyro_x));
  }

  // field 14: gyro_y (float, wire 5)
  if (ping.gyro_y !== 0) {
    parts.push(encodeTag(14, 5));
    parts.push(encodeFloat32(ping.gyro_y));
  }

  // field 15: gyro_z (float, wire 5)
  if (ping.gyro_z !== 0) {
    parts.push(encodeTag(15, 5));
    parts.push(encodeFloat32(ping.gyro_z));
  }

  // field 16: timestamp (int64, wire 0)
  if (ping.timestamp !== 0) {
    parts.push(encodeTag(16, 0));
    parts.push(ProtoEncoder.encodeVarint(ping.timestamp));
  }

  // field 17: batt_pct (int32, wire 0)
  if (ping.batt_pct !== 0) {
    parts.push(encodeTag(17, 0));
    parts.push(ProtoEncoder.encodeVarint(ping.batt_pct));
  }

  return ProtoEncoder.concatenateArrays(parts);
}

/**
 * Encode a batch of PingData into hardware.proto PingBatch binary.
 *
 *   PingBatch: repeated Ping pings=1, string device_id=2, int64 batch_timestamp=3
 */
export function encodeSyncBatch(pings: PingData[], deviceId: string): Uint8Array {
  const parts: Uint8Array[] = [];

  for (const ping of pings) {
    const encoded = encodeHardwarePing(ping);
    // field 1 (repeated Ping), wire 2 (length-delimited)
    parts.push(encodeTag(1, 2));
    parts.push(ProtoEncoder.encodeVarint(encoded.length));
    parts.push(encoded);
  }

  // field 2: device_id (string, wire 2)
  if (deviceId) {
    const idBytes = ProtoEncoder.encodeString(deviceId);
    parts.push(encodeTag(2, 2));
    parts.push(ProtoEncoder.encodeVarint(idBytes.length));
    parts.push(idBytes);
  }

  // field 3: batch_timestamp (int64, wire 0)
  const now = Date.now();
  parts.push(encodeTag(3, 0));
  parts.push(ProtoEncoder.encodeVarint(now));

  return ProtoEncoder.concatenateArrays(parts);
}

/**
 * Simple protobuf message encoder for basic types
 */
export class ProtoEncoder {
  /**
   * Encode a string
   */
  static encodeString(value: string): Uint8Array {
    try {
      assertNotNull(value, 'string value');
      assertType(value, 'string', 'value');
      const encoded = new TextEncoder().encode(value);
      assert(encoded instanceof Uint8Array, 'TextEncoder must return Uint8Array');
      return encoded;
    } catch (error) {
      throw new ProtoBufferError('String encoding failed', {
        value: value?.substring(0, 100),
        error: (error as Error).message,
        debug: createDebugInfo(),
      });
    }
  }

  /**
   * Encode a number (varint for integers, fixed for floats)
   */
  static encodeNumber(value: number): Uint8Array {
    try {
      assertNotNull(value, 'number value');
      assertType(value, 'number', 'value');
      
      if (!Number.isFinite(value)) {
        throw new ValidationError(
          'Number is not finite',
          'value',
          value,
          'finite number'
        );
      }

      if (Number.isInteger(value)) {
        // Validate integer range for varint encoding
        if (value < -2147483648 || value > 2147483647) {
          console.warn('[ProtoEncoder] Integer overflow warning:', {value});
        }
        return this.encodeVarint(value);
      } else {
        // Double encoding for floats
        const buffer = new ArrayBuffer(8);
        const view = new DataView(buffer);
        view.setFloat64(0, value, true);
        const result = new Uint8Array(buffer);
        assert(result.length === 8, 'Double encoding must produce 8 bytes');
        return result;
      }
    } catch (error) {
      throw new ProtoBufferError('Number encoding failed', {
        value,
        error: (error as Error).message,
        debug: createDebugInfo(),
      });
    }
  }

  /**
   * Encode a boolean
   */
  static encodeBoolean(value: boolean): Uint8Array {
    try {
      assertNotNull(value, 'boolean value');
      assertType(value, 'boolean', 'value');
      const result = new Uint8Array([value ? 1 : 0]);
      assert(result.length === 1, 'Boolean encoding must produce 1 byte');
      return result;
    } catch (error) {
      throw new ProtoBufferError('Boolean encoding failed', {
        value,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Encode an object as a protobuf message (simplified)
   */
  static encodeObject(obj: any): Uint8Array {
    try {
      assertNotNull(obj, 'object');
      
      if (typeof obj !== 'object' || Array.isArray(obj)) {
        throw new ValidationError(
          'Expected object for encoding',
          'root',
          obj,
          'object'
        );
      }

      const parts: Uint8Array[] = [];
      let fieldNumber = 1;
      const maxFieldNumber = 536870911; // Protobuf max field number

      for (const [key, value] of Object.entries(obj)) {
        if (value === null || value === undefined) {
          fieldNumber++;
          continue;
        }

        assert(fieldNumber <= maxFieldNumber, `Field number exceeds maximum: ${fieldNumber}`, {
          key,
          fieldNumber,
        });

        let encoded: Uint8Array | null = null;

        try {
          if (typeof value === 'string') {
            encoded = this.encodeString(value);
          } else if (typeof value === 'number') {
            encoded = this.encodeNumber(value);
          } else if (typeof value === 'boolean') {
            encoded = this.encodeBoolean(value);
          } else if (Array.isArray(value)) {
            encoded = this.encodeArray(value);
          } else {
            console.warn('[ProtoEncoder] Skipping unsupported type for field:', {
              key,
              type: typeof value,
            });
          }
        } catch (fieldError) {
          throw new ProtoBufferError(`Failed to encode field '${key}'`, {
            fieldNumber,
            key,
            valueType: typeof value,
            error: (fieldError as Error).message,
          });
        }

        if (encoded) {
          try {
            // Choose the correct protobuf wire type:
            //   0 = varint  (int32, int64, bool, enum)
            //   1 = 64-bit  (double, fixed64)
            //   2 = length-delimited (string, bytes, embedded messages, packed arrays)
            let wireType: number;
            if (typeof value === 'boolean') {
              wireType = 0;
            } else if (typeof value === 'number') {
              wireType = Number.isInteger(value) ? 0 : 1;
            } else {
              wireType = 2;
            }

            const tag = (fieldNumber << 3) | wireType;
            assert(tag >= 0, 'Field tag must be non-negative');

            const tagBytes = this.encodeVarint(tag);
            assert(tagBytes.length > 0, 'Tag encoding produced empty array');

            parts.push(tagBytes);

            if (wireType === 2) {
              // Length-delimited: prefix with byte count
              const lengthBytes = this.encodeVarint(encoded.length);
              assert(lengthBytes.length > 0, 'Length encoding produced empty array');
              parts.push(lengthBytes);
            }
            // wireType 0 (varint) and wireType 1 (64-bit) carry their own length implicitly

            parts.push(encoded);
          } catch (tagError) {
            throw new ProtoBufferError(`Failed to encode tag/length for field '${key}'`, {
              fieldNumber,
              key,
              encodedLength: encoded.length,
              error: (tagError as Error).message,
            });
          }
        }

        fieldNumber++;
      }

      const result = this.concatenateArrays(parts);
      assert(result instanceof Uint8Array, 'Final result must be Uint8Array');
      return result;
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'encodeObject');
      throw error;
    }
  }

  /**
   * Encode an array
   */
  static encodeArray(arr: any[]): Uint8Array {
    try {
      assertNotNull(arr, 'array');
      assert(Array.isArray(arr), 'Value must be an array', {type: typeof arr});
      
      if (arr.length === 0) {
        console.warn('[ProtoEncoder] Encoding empty array');
        return new Uint8Array();
      }

      const parts: Uint8Array[] = [];
      
      for (let i = 0; i < arr.length; i++) {
        try {
          const item = arr[i];
          if (item !== null && item !== undefined) {
            parts.push(this.encodeObject(item));
          }
        } catch (itemError) {
          throw new ProtoBufferError(`Failed to encode array item at index ${i}`, {
            index: i,
            itemType: typeof arr[i],
            error: (itemError as Error).message,
          });
        }
      }

      return this.concatenateArrays(parts);
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'encodeArray');
      throw error;
    }
  }

  /**
   * Encode a varint (variable-length integer)
   */
  static encodeVarint(value: number): Uint8Array {
    try {
      assertNotNull(value, 'value');
      assertType(value, 'number', 'value');

      const buffer: number[] = [];
      let v = value >>> 0; // Convert to unsigned 32-bit

      while (v >= 0x80) {
        buffer.push((v & 0xff) | 0x80);
        v >>>= 7;
        assert(buffer.length <= 10, 'Varint encoding exceeded maximum 10 bytes', {value});
      }
      buffer.push(v & 0xff);

      const result = new Uint8Array(buffer);
      assert(result.length <= 10, 'Varint must not exceed 10 bytes');
      return result;
    } catch (error) {
      throw new ProtoBufferError('Varint encoding failed', {
        value,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Concatenate multiple byte arrays
   */
  static concatenateArrays(arrays: Uint8Array[]): Uint8Array {
    try {
      assertNotNull(arrays, 'arrays');
      assert(Array.isArray(arrays), 'Input must be an array of Uint8Array');

      const totalLength = arrays.reduce((sum, arr) => {
        assertNotNull(arr, 'array element');
        assert(arr instanceof Uint8Array, 'Array element must be Uint8Array');
        return sum + arr.length;
      }, 0);

      const result = new Uint8Array(totalLength);
      let offset = 0;
      
      for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
        assert(offset <= totalLength, 'Offset exceeded total length');
      }

      assert(result.length === totalLength, 'Concatenation length mismatch');
      return result;
    } catch (error) {
      throw new ProtoBufferError('Array concatenation failed', {
        arrayCount: arrays.length,
        error: (error as Error).message,
      });
    }
  }
}

/**
 * Simple protobuf message decoder
 */
export class ProtoDecoder {
  private data: Uint8Array;
  private offset: number = 0;

  constructor(data: Uint8Array) {
    try {
      assertNotNull(data, 'data');
      assert(data instanceof Uint8Array, 'Data must be Uint8Array', {
        receivedType: data.constructor.name,
      });
      this.data = data;
      this.offset = 0;
    } catch (error) {
      throw new ProtoBufferError('ProtoDecoder initialization failed', {
        dataType: typeof data,
        error: (error as Error).message,
      });
    }
  }

  getOffset(): number {
    return this.offset;
  }

  private assertCanRead(length: number = 1): void {
    assertBounds(this.offset, this.data.length, length);
  }

  /**
   * Decode a single varint
   */
  decodeVarint(): number {
    try {
      this.assertCanRead(1);
      let value = 0;
      let shift = 0;
      let byteCount = 0;

      while (this.offset < this.data.length && byteCount < 10) {
        const byte = this.data[this.offset++];
        value |= (byte & 0x7f) << shift;
        
        if ((byte & 0x80) === 0) {
          return value >>> 0; // Convert to unsigned
        }
        
        shift += 7;
        byteCount++;
      }

      if (byteCount >= 10) {
        throw new ProtoBufferError('Varint exceeded maximum 10 bytes', {
          offset: this.offset,
          byteCount,
        });
      }

      throw new BoundsError(
        'Varint incomplete at end of buffer',
        this.offset,
        this.data.length
      );
    } catch (error) {
      if (error instanceof BoundsError || error instanceof ProtoBufferError) {
        throw error;
      }
      throw new ProtoBufferError('Varint decoding failed', {
        offset: this.offset,
        bufferLength: this.data.length,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Read n bytes
   */
  readBytes(n: number): Uint8Array {
    try {
      assertNotNull(n, 'number of bytes to read');
      assertType(n, 'number', 'n');
      
      if (n < 0) {
        throw new ValidationError(
          'Cannot read negative number of bytes',
          'n',
          n,
          'non-negative number'
        );
      }

      if (n === 0) {
        return new Uint8Array();
      }

      this.assertCanRead(n);
      const result = this.data.slice(this.offset, this.offset + n);
      
      assert(result.length === n, `Read bytes length mismatch: expected ${n}, got ${result.length}`, {
        offset: this.offset,
        requested: n,
        got: result.length,
      });

      this.offset += n;
      return result;
    } catch (error) {
      if (error instanceof BoundsError || error instanceof ValidationError) {
        throw error;
      }
      throw new ProtoBufferError('Bytes reading failed', {
        requestedLength: n,
        offset: this.offset,
        bufferLength: this.data.length,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Decode a string
   */
  decodeString(): string {
    try {
      const length = this.decodeVarint();
      
      if (length === 0) {
        return '';
      }

      if (length > 1048576) {
        console.warn('[ProtoDecoder] Large string length detected:', {length});
      }

      const bytes = this.readBytes(length);
      
      try {
        const result = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
        return result;
      } catch (decodingError) {
        throw new ProtoBufferError('UTF-8 decoding failed', {
          length,
          byteSample: Array.from(bytes.slice(0, 20)),
          error: (decodingError as Error).message,
        });
      }
    } catch (error) {
      if (error instanceof ProtoBufferError || error instanceof BoundsError) {
        throw error;
      }
      throw new ProtoBufferError('String decoding failed', {
        offset: this.offset,
        bufferLength: this.data.length,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Decode a double (float64)
   */
  decodeDouble(): number {
    try {
      const bytes = this.readBytes(8);
      assert(bytes.length === 8, 'Double must be exactly 8 bytes', {
        receivedLength: bytes.length,
      });

      const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
      const value = view.getFloat64(0, true);
      
      if (!Number.isFinite(value)) {
        console.warn('[ProtoDecoder] Non-finite double value:', {value});
      }

      return value;
    } catch (error) {
      throw new ProtoBufferError('Double decoding failed', {
        offset: this.offset - 8,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Decode a float (float32)
   */
  decodeFloat(): number {
    try {
      const bytes = this.readBytes(4);
      assert(bytes.length === 4, 'Float must be exactly 4 bytes', {
        receivedLength: bytes.length,
      });

      const view = new DataView(bytes.buffer, bytes.byteOffset, 4);
      const value = view.getFloat32(0, true);
      
      if (!Number.isFinite(value)) {
        console.warn('[ProtoDecoder] Non-finite float value:', {value});
      }

      return value;
    } catch (error) {
      throw new ProtoBufferError('Float decoding failed', {
        offset: this.offset - 4,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Decode a boolean
   */
  decodeBoolean(): boolean {
    try {
      const value = this.decodeVarint();
      return value !== 0;
    } catch (error) {
      throw new ProtoBufferError('Boolean decoding failed', {
        offset: this.offset,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Decode an int32
   */
  decodeInt32(): number {
    try {
      return this.decodeVarint() >>> 0; // Unsigned conversion
    } catch (error) {
      throw new ProtoBufferError('Int32 decoding failed', {
        offset: this.offset,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Try to decode a message (simplified - mostly useful for strings)
   */
  decodeMessage(): any {
    try {
      const result: any = {};
      let fieldNumber = 1;
      const startOffset = this.offset;

      while (this.offset < this.data.length && fieldNumber <= 32) {
        try {
          const tag = this.decodeVarint();
          const wireType = tag & 0x07;
          const fieldNum = tag >>> 3;

          assert(fieldNum > 0 && fieldNum <= 536870911, 'Field number out of valid range', {
            fieldNum,
            wireType,
          });

          if (wireType === 0) {
            // Varint
            result[`field_${fieldNum}`] = this.decodeVarint();
          } else if (wireType === 1) {
            // 64-bit fixed
            result[`field_${fieldNum}`] = this.decodeDouble();
          } else if (wireType === 2) {
            // Length-delimited (string or nested message)
            const length = this.decodeVarint();
            
            if (length > 1048576) {
              console.warn('[ProtoDecoder] Large field detected:', {fieldNum, length});
            }

            const bytes = this.readBytes(length);
            try {
              result[`field_${fieldNum}`] = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
            } catch {
              // If UTF-8 decoding fails, store as bytes
              result[`field_${fieldNum}`] = bytes;
            }
          } else if (wireType === 5) {
            // 32-bit fixed
            result[`field_${fieldNum}`] = this.decodeFloat();
          } else {
            throw new ProtoBufferError(`Unknown wire type: ${wireType}`, {
              fieldNum,
              offset: this.offset,
            });
          }
        } catch (fieldError) {
          if (fieldError instanceof ProtoBufferError || fieldError instanceof BoundsError) {
            // Log field-level errors but continue parsing if possible
            console.warn('[ProtoDecoder] Field parsing error:', {
              fieldNumber,
              offset: this.offset,
              error: (fieldError as Error).message,
            });
            break;
          }
          throw fieldError;
        }
        fieldNumber++;
      }

      assert(Object.keys(result).length > 0, 'Decoded message is empty', {
        startOffset,
        endOffset: this.offset,
        bytesRead: this.offset - startOffset,
      });

      return result;
    } catch (error) {
      logError(error instanceof Error ? error : new Error(String(error)), 'decodeMessage');
      throw error;
    }
  }
}

/**
 * Convert Date to protobuf Timestamp
 */
export function dateToTimestamp(date: Date): {seconds: number; nanos: number} {
  try {
    assertNotNull(date, 'date');
    assert(date instanceof Date, 'Value must be a Date instance', {
      receivedType: typeof date,
    });

    if (!Number.isFinite(date.getTime())) {
      throw new ValidationError(
        'Date is invalid (time is not finite)',
        'date',
        date,
        'valid Date'
      );
    }

    const ms = date.getTime();
    const seconds = Math.floor(ms / 1000);
    const nanos = (ms % 1000) * 1000000;

    assert(Number.isFinite(seconds), 'Seconds is not finite');
    assert(Number.isFinite(nanos), 'Nanos is not finite');
    assert(nanos >= 0 && nanos < 1000000000, 'Nanos out of valid range', {
      nanos,
    });

    return {seconds, nanos};
  } catch (error) {
    throw new ProtoBufferError('Date to timestamp conversion failed', {
      date: date?.toString(),
      error: (error as Error).message,
    });
  }
}

/**
 * Convert protobuf Timestamp to Date
 */
export function timestampToDate(timestamp: any): Date {
  try {
    if (!timestamp) {
      console.warn('[timestampToDate] Null/undefined timestamp, returning current date');
      return new Date();
    }

    const seconds = timestamp.seconds || 0;
    const nanos = timestamp.nanos || 0;

    assertType(seconds, 'number', 'seconds');
    assertType(nanos, 'number', 'nanos');

    assert(Number.isFinite(seconds), 'Seconds is not finite', {seconds});
    assert(Number.isFinite(nanos), 'Nanos is not finite', {nanos});
    assert(nanos >= 0 && nanos < 1000000000, 'Nanos out of valid range', {
      nanos,
      max: 999999999,
    });

    const ms = seconds * 1000 + nanos / 1000000;
    const date = new Date(ms);

    assert(date instanceof Date, 'Failed to create Date object');
    assert(Number.isFinite(date.getTime()), 'Resulting date is invalid');

    return date;
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), 'timestampToDate');
    // Return current date as fallback
    return new Date();
  }
}

