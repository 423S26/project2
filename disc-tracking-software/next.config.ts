import type { NextConfig } from "next";
import { dirname } from "path";
import { fileURLToPath } from "url";

const configDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    // Keep module resolution scoped to this app when multiple lockfiles exist.
    root: configDir,
  },
  
experimental: {
  optimizePackageImports: ['lucide-react'],
},

  reactCompiler: true,
  images : {
    unoptimized : true,
    remotePatterns : [
      {
        protocol : 'https',
        hostname : 'placehold.co',
      }
    ]
  },
  
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
          {
            // Explicitly opt this origin into the motion / orientation /
            // geolocation sensors.  Chrome on Android will otherwise
            // silently deliver zero-valued DeviceMotion events and never
            // fire `deviceorientationabsolute`, which is what we were
            // seeing in the live-tracker HUD (frozen 1.00 g, 0 °/s, no
            // compass).  Bluetooth is also explicitly allowed so Web
            // Bluetooth keeps working under stricter default policies.
            key: 'Permissions-Policy',
            value:
              'accelerometer=(self), gyroscope=(self), magnetometer=(self), geolocation=(self), bluetooth=(self)',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
