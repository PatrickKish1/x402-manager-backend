import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Initialize Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '0');
    const pageSize = parseInt(searchParams.get('pageSize') || '15');
    const resourceFilter = searchParams.get('resource');
    const userAddress = searchParams.get('userAddress');
    const chain = searchParams.get('chain');
    
    // Build query
    let query = supabase
      .from('x402_transactions')
      .select('*', { count: 'exact' })
      .order('block_timestamp', { ascending: false });

    // Apply filters
    if (resourceFilter) {
      query = query.eq('resource', resourceFilter);
    }
    
    if (userAddress) {
      query = query.eq('recipient', userAddress.toLowerCase());
    }

    if (chain) {
      query = query.eq('chain', chain);
    }

    // Pagination
    const from = page * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      console.error('[Transactions API] Database error:', error);
      // Never expose database errors to frontend
      return NextResponse.json(
        { success: false, error: 'Failed to fetch transactions. Please try again.' },
        { status: 500 }
      );
    }

    const totalPages = count ? Math.ceil(count / pageSize) : 0;
    const hasNextPage = page < totalPages - 1;

    return NextResponse.json({
      items: data || [],
      total_count: count || 0,
      total_pages: totalPages,
      current_page: page,
      page_size: pageSize,
      hasNextPage,
    });
  } catch (error) {
    console.error('[Transactions API] Error:', error);
    // Never expose internal errors to frontend
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred. Please try again later.' },
      { status: 500 }
    );
  }
}

