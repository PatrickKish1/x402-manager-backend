// Discovery API Route - Proxies CDP Bazaar requests
// GET /api/discovery?limit=100&offset=0

import { NextRequest, NextResponse } from 'next/server';
import { discoveryService } from '@/lib/services/discovery.service';

// Cache for discovery responses (5 minutes)
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    const filters = {
      type: searchParams.get('type') || undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : undefined,
    };

    // Check cache
    const cacheKey = JSON.stringify(filters);
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return NextResponse.json(
        { items: cached.data, total: cached.data.length },
        {
          headers: {
            'X-Cache': 'HIT',
            'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        }
      );
    }

    // Fetch services (rate limiting handled inside discoveryService)
    const services = await discoveryService.fetchServices(filters);

    // Cache the result
    cache.set(cacheKey, { data: services, timestamp: Date.now() });

    return NextResponse.json(
      { items: services, total: services.length },
      {
        headers: {
          'X-Cache': 'MISS',
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching discovery services:', error);
    // Never expose internal errors to frontend
    return NextResponse.json(
      { success: false, error: 'Unable to load services. Please try again later.' },
      { 
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

