// Protobuf Codec Utilities for Frontend
// Handles encoding/decoding of protobuf messages with comprehensive error handling

import {
  ProtoBufferError,
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
            // Field tag: (fieldNumber << 3) | wireType
            // wireType 2 = length-delimited (for strings and embedded messages)
            const tag = (fieldNumber << 3) | 2;
            assert(tag >= 0, 'Field tag must be non-negative');
            
            const tagBytes = this.encodeVarint(tag);
            const lengthBytes = this.encodeVarint(encoded.length);
            
            assert(tagBytes.length > 0, 'Tag encoding produced empty array');
            assert(lengthBytes.length > 0, 'Length encoding produced empty array');
            
            parts.push(tagBytes);
            parts.push(lengthBytes);
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

