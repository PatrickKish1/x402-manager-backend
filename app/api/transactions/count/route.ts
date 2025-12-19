import { NextRequest, NextResponse } from 'next/server';

/**
 * Get transaction count from x402scan
 */
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

    // Fetch from transactions list endpoint (x402scan doesn't have dedicated count endpoint)
    const x402scanUrl = process.env.X402SCAN_URL || 'https://x402.arvos.xyz';
    const trpcEndpoint = `${x402scanUrl}/api/trpc/public.transfers.list`;
    
    const input: any = {
      pagination: {
        page_size: 1, // We only need the count
        page: 0,
      },
      sorting: {
        id: 'block_timestamp',
        desc: true,
      },
    };

    if (userAddress) {
      input.facilitatorIds = [userAddress.toLowerCase()];
    }

    const trpcBatch = {
      0: {
        json: input,
      },
    };

    const url = `${trpcEndpoint}?batch=1&input=${encodeURIComponent(JSON.stringify(trpcBatch))}`;
    
    const response = await fetch(url);

    if (!response.ok) {
      console.error('[Transaction Count API] X402scan error:', response.status);
      return NextResponse.json(
        { success: false, error: 'Unable to retrieve transaction count. Please try again.' },
        { status: 500 }
      );
    }

    const data = await response.json();
    const result = data[0]?.result?.data?.json;

    return NextResponse.json({
      count: result?.total_count || 0,
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

