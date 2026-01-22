import type { NextConfig } from "next";
import path from 'path';

const nextConfig: NextConfig = {
  // API-only backend - no static pages
  // Only use standalone in production (Vercel) to avoid Windows symlink issues in dev
  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,
  
  // Set Turbopack root to current directory to prevent watching entire Desktop
  // This fixes the "OS file watch limit reached" error
  turbopack: {
    root: path.resolve(__dirname),
  },
  
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
