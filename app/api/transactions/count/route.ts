import { NextRequest, NextResponse } from 'next/server';

/**
 * Transaction count endpoint
 * 
 * TODO: Implement blockchain indexing solution
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userAddress = searchParams.get('userAddress');
    const chain = searchParams.get('chain');

    // Return 0 until indexing is implemented
    return NextResponse.json({
      count: 0,
      userAddress,
      chain,
      message: 'Transaction indexing not yet implemented.',
    });
  } catch (error) {
    console.error('[Transaction Count API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Unable to retrieve transaction count.' },
      { status: 500 }
    );
  }
}

