import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  
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
