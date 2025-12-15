import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // API-only backend - no static pages
  output: 'standalone',
  
  // Optimize for API routes
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  
  // CORS headers for API routes
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
    ];
  },
};

export default nextConfig;
