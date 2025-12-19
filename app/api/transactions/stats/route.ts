import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userAddress = searchParams.get('userAddress');
    const resource = searchParams.get('resource');
    
    // Build base query
    let query = supabase
      .from('x402_transactions')
      .select('amount, sender, chain');

    if (userAddress) {
      query = query.eq('recipient', userAddress.toLowerCase());
    }

    if (resource) {
      query = query.eq('resource', resource);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Transaction Stats API] Database error:', error);
      // Never expose database errors to frontend
      return NextResponse.json(
        { success: false, error: 'Unable to retrieve transaction statistics. Please try again.' },
        { status: 500 }
      );
    }

    // Calculate stats
    const transactions = data || [];
    const totalTransactions = transactions.length;
    
    // Calculate total volume (sum of amounts)
    const totalVolume = transactions.reduce((sum, tx) => {
      const amount = parseFloat(tx.amount) || 0;
      return sum + amount;
    }, 0);

    // Count unique clients (unique senders)
    const uniqueClients = new Set(transactions.map(tx => tx.sender)).size;

    // Count by chain
    const chainCounts: Record<string, number> = {};
    transactions.forEach(tx => {
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

