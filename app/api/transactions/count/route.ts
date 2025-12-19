import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const resource = searchParams.get('resource');
    const userAddress = searchParams.get('userAddress');
    
    if (!resource && !userAddress) {
      return NextResponse.json(
        { error: 'Resource or userAddress parameter required' },
        { status: 400 }
      );
    }

    let query = supabase
      .from('x402_transactions')
      .select('*', { count: 'exact', head: true });

    if (resource) {
      query = query.eq('resource', resource);
    }

    if (userAddress) {
      query = query.eq('recipient', userAddress.toLowerCase());
    }

    const { count, error } = await query;

    if (error) {
      console.error('[Transaction Count API] Database error:', error);
      // Never expose database errors to frontend
      return NextResponse.json(
        { success: false, error: 'Unable to retrieve transaction count. Please try again.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      count: count || 0,
      resource,
      userAddress,
    });
  } catch (error) {
    console.error('[Transaction Count API] Error:', error);
    // Never expose internal errors to frontend
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred. Please try again later.' },
      { status: 500 }
    );
  }
}

