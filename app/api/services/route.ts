/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

/**
 * GET /api/services
 * Get paginated services from database
 * 
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 50, max: 100)
 * - type: Filter by service type
 * - network: Filter by network
 * - search: Search in name, description, or resource
 */
export async function GET(request: NextRequest) {
  try {
    // Check if Supabase is configured
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { 
          error: 'Supabase not configured',
          message: 'Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables',
          help: 'Get these from your Supabase project settings > API'
        },
        { status: 503 }
      );
    }

    // Create Supabase admin client
    const supabase = createSupabaseAdminClient();

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const type = searchParams.get('type');
    const network = searchParams.get('network');
    const search = searchParams.get('search');

    const offset = (page - 1) * limit;

    // Build query
    let query = supabase
      .from('discovered_services')
      .select('*', { count: 'exact' });

    // Apply filters
    if (type) {
      query = query.eq('type', type);
    }

    if (network) {
      query = query.eq('network', network);
    }

    if (search) {
      // Supabase search: use or() with ilike for multiple columns
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%,resource.ilike.%${search}%`);
    }

    // Get total count
    const { count: total, error: countError } = await query;

    if (countError) throw countError;

    // Apply pagination and ordering
    const { data: services, error: fetchError } = await query
      .order('synced_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (fetchError) throw fetchError;

    // Parse JSON fields
    const formattedServices = (services || []).map((service: any) => ({
      id: service.service_id,
      resource: service.resource,
      type: service.type,
      x402Version: service.x402_version,
      lastUpdated: service.last_updated,
      metadata: service.metadata ? JSON.parse(service.metadata) : {},
      accepts: service.accepts ? JSON.parse(service.accepts) : [],
      description: service.description,
      name: service.name,
      tags: service.tags ? JSON.parse(service.tags) : [],
      network: service.network,
      price: service.price,
      syncedAt: service.synced_at,
      createdAt: service.created_at,
      updatedAt: service.updated_at,
    }));

    return NextResponse.json({
      services: formattedServices,
      pagination: {
        page,
        limit,
        total: total || 0,
        totalPages: Math.ceil((total || 0) / limit),
        hasMore: offset + limit < (total || 0),
      },
    });
  } catch (error: any) {
    console.error('[Services API] Error:', error);
    return NextResponse.json(
      {
        error: error.message || 'Failed to fetch services',
      },
      { status: 500 }
    );
  }
}
