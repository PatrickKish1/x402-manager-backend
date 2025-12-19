import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxy transactions from x402scan TRPC API
 * X402scan has the actual blockchain transaction data from indexers
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '0');
    const pageSize = parseInt(searchParams.get('pageSize') || '15');
    const resourceFilter = searchParams.get('resource');
    const userAddress = searchParams.get('userAddress');
    const chain = searchParams.get('chain');
    
    // X402scan TRPC API endpoint
    const x402scanUrl = process.env.X402SCAN_URL || 'https://x402.arvos.xyz';
    const trpcEndpoint = `${x402scanUrl}/api/trpc/public.transfers.list`;
    
    // Build TRPC query params
    const input: any = {
      pagination: {
        page_size: pageSize,
        page,
      },
      sorting: {
        id: 'block_timestamp',
        desc: true,
      },
    };

    // Apply filters
    if (userAddress) {
      input.facilitatorIds = [userAddress.toLowerCase()];
    }
    
    if (chain) {
      input.chains = [chain];
    }

    // TRPC uses batch format
    const trpcBatch = {
      0: {
        json: input,
      },
    };

    const url = `${trpcEndpoint}?batch=1&input=${encodeURIComponent(JSON.stringify(trpcBatch))}`;
    
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('[Transactions API] X402scan error:', response.status, response.statusText);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch transactions from x402scan.' },
        { status: 500 }
      );
    }

    const data = await response.json();
    const result = data[0]?.result?.data?.json;

    if (!result) {
      return NextResponse.json({
        items: [],
        total_count: 0,
        total_pages: 0,
        current_page: page,
        page_size: pageSize,
        hasNextPage: false,
      });
    }

    // Filter by resource if specified (client-side filter since TRPC doesn't support this)
    let items = result.items || [];
    if (resourceFilter) {
      items = items.filter((item: any) => 
        item.resource && item.resource.toLowerCase().includes(resourceFilter.toLowerCase())
      );
    }

    return NextResponse.json({
      items,
      total_count: result.total_count || 0,
      total_pages: result.total_pages || 0,
      current_page: page,
      page_size: pageSize,
      hasNextPage: result.hasNextPage || false,
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

