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
        ],
      },
    ];
  },
};

export default nextConfig;
