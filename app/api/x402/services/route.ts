/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

/**
 * GET /api/x402/services
 * Get paginated x402 services from database with detailed JSON response
 * 
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 50, max: 100)
 * - offset: Alternative to page (overrides page if provided)
 * - type: Filter by service type (e.g., 'api', 'data')
 * - network: Filter by network (e.g., 'eip155:8453')
 * - search: Search in name, description, or resource URL
 * - sortBy: Sort field (default: 'synced_at')
 * - sortOrder: 'asc' or 'desc' (default: 'desc')
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
        },
        { status: 503 }
      );
    }

    // Create Supabase admin client
    const supabase = createSupabaseAdminClient();

    const { searchParams } = new URL(request.url);
    
    // Parse pagination params
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');
    const limit = Math.min(
      parseInt(limitParam || '50', 10),
      100 // Max limit
    );
    
    // Calculate offset (offset param takes precedence)
    const offset = offsetParam 
      ? parseInt(offsetParam, 10)
      : (page - 1) * limit;
    
    // Parse filters
    const type = searchParams.get('type');
    const network = searchParams.get('network');
    const search = searchParams.get('search');
    const sortBy = searchParams.get('sortBy') || 'synced_at';
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';

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
      // Search across name, description, and resource
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%,resource.ilike.%${search}%`);
    }

    // Get total count (before pagination)
    const { count: total, error: countError } = await query;

    if (countError) throw countError;

    // Apply sorting and pagination
    const { data: services, error: fetchError } = await query
      .order(sortBy, { ascending: sortOrder === 'asc' })
      .range(offset, offset + limit - 1);

    if (fetchError) throw fetchError;

    // Format services with parsed JSON fields and detailed structure
    const formattedServices = (services || []).map((service: any) => {
      const metadata = service.metadata ? JSON.parse(service.metadata) : {};
      const accepts = service.accepts ? JSON.parse(service.accepts) : [];
      const tags = service.tags ? JSON.parse(service.tags) : [];
      let outputSchema = null;
      if (service.output_schema) {
        try {
          outputSchema = JSON.parse(service.output_schema);
        } catch (error) {
          console.error(`[X402 Services] Error parsing output schema for ${service.service_id}:`, error);
        }
      }

      return {
        id: service.service_id,
        serviceId: service.service_id, // Alias for consistency
        resource: service.resource,
        type: service.type,
        x402Version: service.x402_version,
        lastUpdated: service.last_updated,
        metadata: {
          ...metadata,
          name: service.name, // Use generated/updated name
          description: service.description,
          tags: tags,
        },
        accepts: accepts,
        payment: accepts[0] ? {
          asset: accepts[0].asset,
          network: accepts[0].network,
          maxAmountRequired: accepts[0].maxAmountRequired,
          maxTimeoutSeconds: accepts[0].maxTimeoutSeconds,
          scheme: accepts[0].scheme,
          payTo: accepts[0].payTo,
        } : null,
        network: service.network,
        price: service.price,
        outputSchema: outputSchema, // Inferred from successful validations
        syncedAt: service.synced_at,
        createdAt: service.created_at,
        updatedAt: service.updated_at,
      };
    });

    return NextResponse.json(
      {
        success: true,
        services: formattedServices,
        pagination: {
          page: offsetParam ? undefined : page,
          offset: offset,
          limit,
          total: total || 0,
          totalPages: Math.ceil((total || 0) / limit),
          hasMore: offset + limit < (total || 0),
          hasPrevious: offset > 0,
        },
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      }
    );
  } catch (error: any) {
    console.error('[X402 Services API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch services',
      },
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

