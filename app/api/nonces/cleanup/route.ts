import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database/client';
import { paymentNonces } from '@/lib/database/schema';
import { lt } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

/**
 * Cleanup expired nonces (run as a cron job)
 * GET /api/nonces/cleanup
 * 
 * Add to Vercel Cron Jobs (vercel.json):
 * {
 *   "crons": [{
 *     "path": "/api/nonces/cleanup",
 *     "schedule": "0 0 * * *"  // Daily at midnight UTC (Hobby plan compatible)
 *   }]
 * }
 * 
 * Note: Vercel Hobby plans only support daily cron jobs.
 * For more frequent cleanup, upgrade to Pro plan.
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (optional security measure)
    const authHeader = request.headers.get('Authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({
        error: 'Unauthorized'
      }, { status: 401 });
    }

    if (!db) {
      return NextResponse.json({
        error: 'Database not available'
      }, { status: 503 });
    }

    // Delete nonces older than their expiration time
    const result = await db
      .delete(paymentNonces)
      .where(lt(paymentNonces.expiresAt, new Date()))
      .returning({ id: paymentNonces.id });

    const deletedCount = result.length;

    // console.log(`[Nonces] Cleanup completed: ${deletedCount} expired nonces removed`);

    return NextResponse.json({
      success: true,
      deletedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Nonces] Cleanup error:', error);
    // Never expose internal errors to frontend (this is typically a cron job)
    return NextResponse.json({
      success: false,
      error: 'Cleanup task failed. Check logs for details.'
    }, { status: 500 });
  }
}

// Also support POST for manual triggers
export const POST = GET;

