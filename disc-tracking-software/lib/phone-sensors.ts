// lib/phone-sensors.ts
//
// Central phone-sensor manager (Geolocation + DeviceMotion + DeviceOrientation).
//
// Why this file exists:
//   The demo device's onboard IMU is unrecoverable (I2C bus wedged, battery
//   hardwired so we cannot power-cycle).  The firmware streams GPS only, so
//   spin / wobble / release-impact metrics have to come from the operator's
//   phone instead.  This module is the single source of truth for those
//   readings — every component subscribes here instead of registering its
//   own listeners (which previously caused redundant permission prompts and
//   thrashed CPU on the rotating arrow overlay).
//
// On Android Chrome, DeviceMotion / DeviceOrientationAbsolute do not require
// an explicit permission API call, but on iOS Safari they do.  We expose
// `requestPhoneSensorPermission()` which is safe to call on both platforms
// from inside a user gesture.

'use client';

import { useEffect, useState } from 'react';

// ───────────────────────────── Geo helpers ─────────────────────────────

const EARTH_RADIUS_METERS = 6_371_000;
const FEET_PER_METER = 3.28084;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance between two GPS coords, in meters. */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Same as above but in feet — convenience for UI consumers. */
export function haversineFeet(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  return haversineMeters(lat1, lon1, lat2, lon2) * FEET_PER_METER;
}

/** Initial bearing (degrees, clockwise from north) from A → B. */
export function bearingDegrees(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// ─────────────────────── Sensor snapshot shapes ───────────────────────

export type PhoneGps = {
  lat: number;
  lon: number;
  alt: number | null;
  accuracy: number; // meters
  speed: number | null; // m/s
  heading: number | null; // degrees, GPS course-over-ground
  timestamp: number;
};

export type PhoneMotion = {
  /** Linear acceleration including gravity, m/s² */
  accelX: number;
  accelY: number;
  accelZ: number;
  /** |accel| in g (subtracting 1g rest) — useful for impulse detection */
  impulseG: number;
  /** Rotation rates, deg/s */
  rotAlpha: number; // around z (yaw / spin axis when phone flat)
  rotBeta: number; // around x
  rotGamma: number; // around y
  /** |rotation| deg/s — proxy for "how violently is the phone spinning" */
  rotMagnitude: number;
  timestamp: number;
};

export type PhoneOrientation = {
  /** Compass heading clockwise from north, degrees [0,360) */
  compass: number;
  beta: number; // tilt front/back
  gamma: number; // tilt left/right
  absolute: boolean; // true if reading is referenced to true north
  timestamp: number;
};

export type PhoneSensorSnapshot = {
  gps: PhoneGps | null;
  motion: PhoneMotion | null;
  orientation: PhoneOrientation | null;
  /** Has the user (or platform) granted motion access? */
  motionPermitted: boolean;
  /** Has geolocation produced at least one fix? */
  gpsActive: boolean;
};

type Listener = (snap: PhoneSensorSnapshot) => void;

// ───────────────────────────── Manager ─────────────────────────────

class PhoneSensorManager {
  private snapshot: PhoneSensorSnapshot = {
    gps: null,
    motion: null,
    orientation: null,
    motionPermitted: false,
    gpsActive: false,
  };

  private listeners = new Set<Listener>();
  private gpsWatchId: number | null = null;
  private motionHandler: ((e: DeviceMotionEvent) => void) | null = null;
  private orientationHandler: ((e: DeviceOrientationEvent) => void) | null =
    null;
  private hasAbsoluteOrientation = false;
  private started = false;
  private lastEmitTs = 0;

  /** Subscribe.  Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    // Fire current state immediately so consumers get a non-null baseline.
    listener(this.snapshot);
    if (!this.started) {
      this.start();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stop();
      }
    };
  }

  /** Current snapshot — useful for non-React readers. */
  getSnapshot(): PhoneSensorSnapshot {
    return this.snapshot;
  }

  /**
   * Request DeviceMotion / DeviceOrientation permission.  Safe to call
   * anywhere; on platforms that don't gate behind a permission API this
   * resolves immediately to true.  MUST be invoked from inside a user
   * gesture handler on iOS Safari.
   */
  async requestPermission(): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    // iOS Safari (>= 13) exposes a static `requestPermission` on these
    // event constructors.  Other browsers don't, so feature-detect.
    type PermissionFn = () => Promise<'granted' | 'denied'>;
    const motionCtor = (
      window as unknown as { DeviceMotionEvent?: { requestPermission?: PermissionFn } }
    ).DeviceMotionEvent;
    const orientationCtor = (
      window as unknown as { DeviceOrientationEvent?: { requestPermission?: PermissionFn } }
    ).DeviceOrientationEvent;

    let motionOk = true;
    let orientationOk = true;

    if (motionCtor?.requestPermission) {
      try {
        motionOk = (await motionCtor.requestPermission()) === 'granted';
      } catch {
        motionOk = false;
      }
    }
    if (orientationCtor?.requestPermission) {
      try {
        orientationOk = (await orientationCtor.requestPermission()) === 'granted';
      } catch {
        orientationOk = false;
      }
    }

    const granted = motionOk && orientationOk;
    this.snapshot = { ...this.snapshot, motionPermitted: granted };
    this.emit();

    if (granted && !this.started) {
      this.start();
    }
    return granted;
  }

  private start(): void {
    if (typeof window === 'undefined') return;
    this.started = true;

    // ── Geolocation ─────────────────────────────────────────────────
    if ('geolocation' in navigator) {
      try {
        this.gpsWatchId = navigator.geolocation.watchPosition(
          (pos) => {
            this.snapshot = {
              ...this.snapshot,
              gps: {
                lat: pos.coords.latitude,
                lon: pos.coords.longitude,
                alt: pos.coords.altitude,
                accuracy: pos.coords.accuracy,
                speed: pos.coords.speed,
                heading: pos.coords.heading,
                timestamp: pos.timestamp,
              },
              gpsActive: true,
            };
            this.emit();
          },
          (err) =>
            console.warn('[phone-sensors] geolocation error:', err.message),
          { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 },
        );
      } catch (e) {
        console.warn('[phone-sensors] watchPosition threw:', e);
      }
    }

    // ── DeviceMotion (accel + gyro) ─────────────────────────────────
    this.motionHandler = (e: DeviceMotionEvent) => {
      const acc = e.accelerationIncludingGravity ?? e.acceleration;
      const rot = e.rotationRate;
      if (!acc && !rot) return;

      const ax = acc?.x ?? 0;
      const ay = acc?.y ?? 0;
      const az = acc?.z ?? 0;
      // Subtract 1g rest magnitude to get impulse component.
      const mag = Math.sqrt(ax * ax + ay * ay + az * az);
      const impulseG = Math.abs(mag - 9.80665) / 9.80665;

      const ra = rot?.alpha ?? 0;
      const rb = rot?.beta ?? 0;
      const rg = rot?.gamma ?? 0;
      const rotMag = Math.sqrt(ra * ra + rb * rb + rg * rg);

      this.snapshot = {
        ...this.snapshot,
        motion: {
          accelX: ax,
          accelY: ay,
          accelZ: az,
          impulseG,
          rotAlpha: ra,
          rotBeta: rb,
          rotGamma: rg,
          rotMagnitude: rotMag,
          timestamp: Date.now(),
        },
        motionPermitted: true,
      };
      this.throttledEmit();
    };
    window.addEventListener('devicemotion', this.motionHandler);

    // ── DeviceOrientation (compass) ─────────────────────────────────
    this.orientationHandler = (e: DeviceOrientationEvent) => {
      const ev = e as unknown as Record<string, unknown>;
      const isAbsolute =
        ev.absolute === true || typeof ev.webkitCompassHeading === 'number';
      if (!isAbsolute && this.hasAbsoluteOrientation) return;

      let compass: number | null = null;
      if (typeof ev.webkitCompassHeading === 'number') {
        compass = ev.webkitCompassHeading as number;
        this.hasAbsoluteOrientation = true;
      } else if (typeof ev.alpha === 'number' && ev.alpha !== null) {
        // alpha is CCW from north → flip to clockwise compass heading.
        compass = (360 - (ev.alpha as number) + 360) % 360;
        if (isAbsolute) this.hasAbsoluteOrientation = true;
      }
      if (compass === null) return;

      this.snapshot = {
        ...this.snapshot,
        orientation: {
          compass,
          beta: e.beta ?? 0,
          gamma: e.gamma ?? 0,
          absolute: this.hasAbsoluteOrientation,
          timestamp: Date.now(),
        },
      };
      this.throttledEmit();
    };
    window.addEventListener(
      'deviceorientationabsolute',
      this.orientationHandler as EventListener,
    );
    window.addEventListener(
      'deviceorientation',
      this.orientationHandler as EventListener,
    );
  }

  private stop(): void {
    if (typeof window === 'undefined') return;
    if (this.gpsWatchId !== null) {
      navigator.geolocation.clearWatch(this.gpsWatchId);
      this.gpsWatchId = null;
    }
    if (this.motionHandler) {
      window.removeEventListener('devicemotion', this.motionHandler);
      this.motionHandler = null;
    }
    if (this.orientationHandler) {
      window.removeEventListener(
        'deviceorientationabsolute',
        this.orientationHandler as EventListener,
      );
      window.removeEventListener(
        'deviceorientation',
        this.orientationHandler as EventListener,
      );
      this.orientationHandler = null;
    }
    this.started = false;
    this.hasAbsoluteOrientation = false;
  }

  /** Throttle UI emits to ~30 Hz so we don't melt React. */
  private throttledEmit(): void {
    const now = performance.now();
    if (now - this.lastEmitTs < 33) return;
    this.lastEmitTs = now;
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l(this.snapshot);
      } catch (e) {
        console.warn('[phone-sensors] listener threw:', e);
      }
    }
  }
}

export const phoneSensors = new PhoneSensorManager();

// ─────────────────────────── React hook ───────────────────────────

/**
 * React hook returning the live phone-sensor snapshot.  The manager is a
 * singleton, so multiple components mounting this hook share a single set
 * of underlying listeners.
 */
export function usePhoneSensors(): PhoneSensorSnapshot {
  const [snap, setSnap] = useState<PhoneSensorSnapshot>(() =>
    phoneSensors.getSnapshot(),
  );
  useEffect(() => phoneSensors.subscribe(setSnap), []);
  return snap;
}

/**
 * Tiny convenience: derive distance + bearing from a phone snapshot to a
 * disc location.  Returns null if either side lacks a fix.
 */
export function phoneToDisc(
  snap: PhoneSensorSnapshot,
  discLat: number | null | undefined,
  discLon: number | null | undefined,
): { meters: number; feet: number; bearing: number } | null {
  if (!snap.gps || discLat == null || discLon == null) return null;
  if (discLat === 0 && discLon === 0) return null;
  const meters = haversineMeters(snap.gps.lat, snap.gps.lon, discLat, discLon);
  return {
    meters,
    feet: meters * FEET_PER_METER,
    bearing: bearingDegrees(snap.gps.lat, snap.gps.lon, discLat, discLon),
  };
}
