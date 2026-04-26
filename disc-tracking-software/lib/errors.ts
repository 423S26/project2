/**
 * Comprehensive Error Handling for Disc Tracking Software
 * Provides custom error classes and assertion utilities for debugging
 */

// Custom Error Classes
export class ProtoBufferError extends Error {
  constructor(message: string, public context?: Record<string, any>) {
    super(`[ProtoBuf] ${message}`);
    this.name = 'ProtoBufferError';
    if (context) {
      const nestedError = typeof context.error === 'string' ? context.error : '';
      const isExpectedBoundsError = nestedError.includes('[Bounds] Buffer bounds exceeded');
      const isExpectedTruncationMessage = /String length exceeds remaining buffer|Length-delimited field exceeds remaining buffer|String read exceeded buffer bounds|Negative string length encountered|Negative length-delimited field length encountered/.test(message);
      const hasExpectedTruncationShape =
        typeof context.length === 'number' &&
        typeof context.remaining === 'number' &&
        context.length > context.remaining;
      if (!isExpectedBoundsError && !isExpectedTruncationMessage && !hasExpectedTruncationShape) {
        console.log('%c[ProtoBuf] Error Context:', 'color:#f87171', context);
      }
    }
  }
}

export class APIConnectionError extends Error {
  constructor(
    message: string,
    public endpoint: string,
    public statusCode?: number,
    public context?: Record<string, any>
  ) {
    super(`[API Connection] ${message} (${endpoint})`);
    this.name = 'APIConnectionError';
  }
}

export class FirmwareConnectionError extends Error {
  constructor(
    message: string,
    public deviceId?: string,
    public context?: Record<string, any>
  ) {
    super(`[Firmware] ${message}${deviceId ? ` (Device: ${deviceId})` : ''}`);
    this.name = 'FirmwareConnectionError';
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
    public receivedValue?: any,
    public expectedType?: string
  ) {
    super(`[Validation] ${message}`);
    this.name = 'ValidationError';
  }
}

export class BoundsError extends Error {
  constructor(
    message: string,
    public offset: number,
    public bufferLength: number,
    public requestedLength?: number
  ) {
    super(`[Bounds] ${message} (offset: ${offset}, buffer: ${bufferLength}, requested: ${requestedLength})`);
    this.name = 'BoundsError';
  }
}

// Assertion Utilities
export function assert(condition: boolean, message: string, context?: Record<string, any>): asserts condition {
  if (!condition) {
    throw new Error(`[Assert] ${message}`);
  }
}

export function assertNotNull<T>(value: T | null | undefined, fieldName: string, context?: Record<string, any>): asserts value is T {
  if (value === null || value === undefined) {
    throw new ValidationError(
      `Required field is null or undefined: ${fieldName}`,
      fieldName,
      value,
      'non-null'
    );
  }
}

export function assertType(value: any, expectedType: string, fieldName: string): void {
  const actualType = typeof value;
  if (actualType !== expectedType) {
    throw new ValidationError(
      `Type mismatch for field '${fieldName}': expected ${expectedType}, got ${actualType}`,
      fieldName,
      value,
      expectedType
    );
  }
}

export function assertBounds(offset: number, bufferLength: number, requestedLength: number = 1): void {
  if (offset < 0 || offset + requestedLength > bufferLength) {
    throw new BoundsError(
      `Buffer bounds exceeded`,
      offset,
      bufferLength,
      requestedLength
    );
  }
}

export function assertRange(value: number, min: number, max: number, fieldName: string): void {
  if (value < min || value > max) {
    throw new ValidationError(
      `Value out of range for '${fieldName}': expected ${min}-${max}, got ${value}`,
      fieldName,
      value,
      `${min}-${max}`
    );
  }
}

// Error Recovery Helpers
export function logError(error: Error, context: string): void {
  if (typeof window === 'undefined') {
    console.error(`[${context}] ${error.name}: ${error.message}`);
    if (error instanceof ProtoBufferError && error.context) {
      console.error('Context:', error.context);
    }
    if (error instanceof APIConnectionError && error.context) {
      console.error('Context:', error.context);
    }
    if (error instanceof FirmwareConnectionError && error.context) {
      console.error('Context:', error.context);
    }
  }
}

export function createDebugInfo(): Record<string, any> {
  return {
    timestamp: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    url: typeof window !== 'undefined' ? window.location.href : 'unknown',
    memory: typeof performance !== 'undefined' && (performance as any).memory
      ? (performance as any).memory.usedJSHeapSize
      : 'unknown',
  };
}

// Retry Logic for Network Operations
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000,
  maxDelay: number = 10000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 4xx errors are client errors – retrying will never help
      if (lastError instanceof APIConnectionError &&
          lastError.statusCode !== undefined &&
          lastError.statusCode >= 400 && lastError.statusCode < 500) {
        break;
      }

      if (attempt < maxRetries - 1) {
        // Exponential backoff with jitter
        const delay = Math.min(
          initialDelay * Math.pow(2, attempt) + Math.random() * 1000,
          maxDelay
        );
        if (typeof window === 'undefined') {
          console.warn(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, lastError.message);
        }
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw new Error(`Operation failed after ${maxRetries} attempts: ${lastError?.message}`);
}

// Connection Status Monitoring
export class ConnectionMonitor {
  private isConnected: boolean = false;
  private lastHeartbeat: number = Date.now();
  private heartbeatTimeout: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL = 5000; // 5 seconds
  private readonly HEARTBEAT_TIMEOUT = 15000; // 15 seconds

  connect(): void {
    this.isConnected = true;
    this.lastHeartbeat = Date.now();
    this.startHeartbeat();
    console.log('[ConnectionMonitor] Connected');
  }

  disconnect(): void {
    this.isConnected = false;
    this.stopHeartbeat();
    console.log('[ConnectionMonitor] Disconnected');
  }

  recordHeartbeat(): void {
    this.lastHeartbeat = Date.now();
  }

  isHealthy(): boolean {
    const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat;
    return this.isConnected && timeSinceLastHeartbeat < this.HEARTBEAT_TIMEOUT;
  }

  private startHeartbeat(): void {
    this.heartbeatTimeout = setInterval(() => {
      if (!this.isHealthy() && this.isConnected) {
        console.warn('[ConnectionMonitor] Heartbeat timeout detected');
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimeout) {
      clearInterval(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  getStatus(): {isConnected: boolean; isHealthy: boolean; timeSinceLastHeartbeat: number} {
    return {
      isConnected: this.isConnected,
      isHealthy: this.isHealthy(),
      timeSinceLastHeartbeat: Date.now() - this.lastHeartbeat,
    };
  }
}
