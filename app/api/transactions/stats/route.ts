import { NextRequest, NextResponse } from 'next/server';

/**
 * Get transaction statistics from x402scan
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userAddress = searchParams.get('userAddress');
    const resource = searchParams.get('resource');
    
    // Fetch all transactions for stats calculation (limit to reasonable number)
    const x402scanUrl = process.env.X402SCAN_URL || 'https://x402.arvos.xyz';
    const trpcEndpoint = `${x402scanUrl}/api/trpc/public.transfers.list`;
    
    const input: any = {
      pagination: {
        page_size: 1000, // Fetch more for accurate stats
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
      console.error('[Transaction Stats API] X402scan error:', response.status);
      return NextResponse.json(
        { success: false, error: 'Unable to retrieve transaction statistics. Please try again.' },
        { status: 500 }
      );
    }

    const data = await response.json();
    const result = data[0]?.result?.data?.json;
    const transactions = result?.items || [];

    // Filter by resource if specified
    const filteredTransactions = resource
      ? transactions.filter((tx: any) => 
          tx.resource && tx.resource.toLowerCase().includes(resource.toLowerCase())
        )
      : transactions;

    const totalTransactions = result?.total_count || filteredTransactions.length;
    
    // Calculate total volume (sum of amounts in USDC, amount is in atomic units)
    const totalVolume = filteredTransactions.reduce((sum: number, tx: any) => {
      const amount = parseFloat(tx.amount) / 1000000 || 0; // Convert from atomic units to USDC
      return sum + amount;
    }, 0);

    // Count unique clients (unique senders)
    const uniqueClients = new Set(filteredTransactions.map((tx: any) => tx.sender)).size;

    // Count by chain
    const chainCounts: Record<string, number> = {};
    filteredTransactions.forEach((tx: any) => {
      const chain = tx.chain || 'unknown';
      chainCounts[chain] = (chainCounts[chain] || 0) + 1;
    });

    return NextResponse.json({
      totalTransactions,
      totalVolume: totalVolume.toFixed(6),
      uniqueClients,
      chainCounts,
      averageTransactionSize: totalTransactions > 0 
        ? (totalVolume / totalTransactions).toFixed(6) 
        : '0',
    });
  } catch (error) {
    console.error('[Transaction Stats API] Error:', error);
    // Never expose internal errors to frontend
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred. Please try again later.' },
      { status: 500 }
    );
  }
}

