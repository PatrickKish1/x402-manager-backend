import { NextRequest, NextResponse } from 'next/server';
import { fetchServiceTransactions, getCachedTransactions, refreshServiceTransactionCache } from '@/lib/blockchain/indexer';
import { db } from '@/lib/database/client';
import { userServices } from '@/lib/database/schema';
import { eq } from 'drizzle-orm';

/**
 * GET /api/transactions/native?serviceId=xxx&refresh=true
 * Fetch transactions for native x402 APIs from blockchain indexers
 */
export async function GET(request: NextRequest) {
  try {
    if (!db) {
      return NextResponse.json(
        { error: 'Database not available' },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const serviceId = searchParams.get('serviceId');
    const refresh = searchParams.get('refresh') === 'true';
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!serviceId) {
      return NextResponse.json(
        { error: 'Service ID is required' },
        { status: 400 }
      );
    }

    // Fetch service details
    const services = await db
      .select()
      .from(userServices)
      .where(eq(userServices.id, serviceId))
      .limit(1);

    if (services.length === 0) {
      return NextResponse.json(
        { error: 'Service not found' },
        { status: 404 }
      );
    }

    const service = services[0];

    // If refresh requested, fetch new transactions from blockchain
    if (refresh) {
      const newCount = await refreshServiceTransactionCache(
        serviceId,
        service.paymentRecipient,
        service.network,
        service.tokenAddress || getDefaultTokenAddress(service.network)
      );

      console.log(`[Native Transactions API] Refreshed ${newCount} new transactions for service ${serviceId}`);
    }

    // Get cached transactions
    const transactions = await getCachedTransactions(serviceId, limit, offset);

    // Get total count
    const totalResult = await db.select({ count: db.sql`count(*)` })
      .from(require('@/lib/database/schema').blockchainTransactionsCache)
      .where(eq(require('@/lib/database/schema').blockchainTransactionsCache.serviceId, serviceId));

    const total = Number(totalResult[0]?.count || 0);

    return NextResponse.json({
      transactions: transactions.map(tx => ({
        ...tx,
        amount: tx.amount.toString(), // Convert BigInt to string for JSON
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + transactions.length < total,
      },
    }, { status: 200 });
  } catch (error) {
    console.error('[Native Transactions API] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch transactions',
      },
      { status: 500 }
    );
  }
}

/**
 * Get default token address for a chain
 */
function getDefaultTokenAddress(chain: string): string {
  const tokenAddresses: Record<string, string> = {
    base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
    ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum
    optimism: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', // USDC on Optimism
    arbitrum: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', // USDC on Arbitrum
    polygon: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC on Polygon
  };

  return tokenAddresses[chain] || tokenAddresses.base;
}

