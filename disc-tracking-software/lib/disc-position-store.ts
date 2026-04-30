/**
 * Tiny pub/sub singleton holding the most recent disc-side GPS fix from
 * ANY source (BLE wire ping or API-fallback poll).  Multiple components
 * (TelemetryLiveTracker, DiscActionsDropdown's TrackerDisplay) need to
 * render the live phone↔disc Δ, but the live BLE handler is owned by
 * one component while the API fallback poll is owned by another.  This
 * store lets either source publish the latest fix and any subscriber
 * compute Δ reactively without owning its own poll loop.
 *
 * Source semantics:
 *   - 'ble' is preferred when fresh.  We only allow an 'api' update to
 *     replace a 'ble' fix that is older than `BLE_STALE_MS` so a slow
 *     API poll cannot clobber live wire data.
 */

const BLE_STALE_MS = 4_000;

export interface DiscPositionSnapshot {
  lat: number;
  lon: number;
  /** ms since epoch when the fix was received (client clock). */
  receivedAt: number;
  source: 'ble' | 'api';
}

type Listener = (snap: DiscPositionSnapshot) => void;

class DiscPositionStore {
  private snapshot: DiscPositionSnapshot | null = null;
  private listeners = new Set<Listener>();

  publish(lat: number, lon: number, source: 'ble' | 'api'): void {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const now = Date.now();

    // Don't let a stale API poll overwrite a fresh BLE fix.
    if (
      source === 'api' &&
      this.snapshot &&
      this.snapshot.source === 'ble' &&
      now - this.snapshot.receivedAt < BLE_STALE_MS
    ) {
      return;
    }

    this.snapshot = { lat, lon, receivedAt: now, source };
    for (const cb of this.listeners) {
      try { cb(this.snapshot); } catch { /* listener errors are non-fatal */ }
    }
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    if (this.snapshot) {
      // Replay the latest snapshot so new subscribers see current state.
      try { cb(this.snapshot); } catch { /* ignore */ }
    }
    return () => { this.listeners.delete(cb); };
  }

  getSnapshot(): DiscPositionSnapshot | null {
    return this.snapshot;
  }

  /** Used when the device disconnects / a session ends. */
  reset(): void {
    this.snapshot = null;
  }
}

export const discPositionStore = new DiscPositionStore();
