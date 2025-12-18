import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database/client';
import { paymentNonces } from '@/lib/database/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Check if a nonce has been used (for client-side validation)
 * POST /api/nonces/check
 */
export async function POST(request: NextRequest) {
  try {
    const { nonce, userAddress } = await request.json();

    if (!nonce || !userAddress) {
      return NextResponse.json({
        error: 'Missing required fields: nonce, userAddress'
      }, { status: 400 });
    }

    if (!db) {
      return NextResponse.json({
        error: 'Database not available'
      }, { status: 503 });
    }

    // Check if nonce exists in database
    const results = await db
      .select()
      .from(paymentNonces)
      .where(
        and(
          eq(paymentNonces.nonce, nonce),
          eq(paymentNonces.userAddress, userAddress.toLowerCase())
        )
      )
      .limit(1);

    return NextResponse.json({
      used: results.length > 0,
      nonce,
      userAddress,
    });
  } catch (error) {
    console.error('[Nonces] Error checking nonce:', error);
    return NextResponse.json({
      error: 'Failed to check nonce',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

