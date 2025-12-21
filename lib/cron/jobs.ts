// Cron Jobs - Scheduled tasks for the validator system
import cron from 'node-cron';
import { db } from '../database/client';
import { userServices } from '../database/schema';
import { eq } from 'drizzle-orm';
import { refreshServiceTransactionCache } from '../blockchain/indexer';

/**
 * Initialize all cron jobs
 */
export function initializeCronJobs() {
  console.log('[Cron] Initializing scheduled tasks...');

  // Refresh blockchain transaction caches every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    console.log('[Cron] Running blockchain transaction cache refresh...');
    await refreshAllServiceTransactions();
  });

  // Clean up old validation requests every day at 2 AM
  cron.schedule('0 2 * * *', async () => {
    console.log('[Cron] Running database cleanup...');
    await cleanupOldRecords();
  });

  console.log('[Cron] Scheduled tasks initialized');
}

/**
 * Refresh transaction cache for all active services
 */
async function refreshAllServiceTransactions() {
  if (!db) {
    console.error('[Cron] Database not available');
    return;
  }

  try {
    // Get all active services
    const services = await db
      .select()
      .from(userServices)
      .where(eq(userServices.status, 'active'));

    console.log(`[Cron] Refreshing transactions for ${services.length} services`);

    let totalRefreshed = 0;

    for (const service of services) {
      try {
        const count = await refreshServiceTransactionCache(
          service.id,
          service.paymentRecipient,
          service.network,
          service.tokenAddress || getDefaultTokenAddress(service.network)
        );

        if (count > 0) {
          totalRefreshed += count;
          console.log(`[Cron] Service ${service.id}: ${count} new transactions`);
        }
      } catch (error) {
        console.error(`[Cron] Error refreshing service ${service.id}:`, error);
      }
    }

    console.log(`[Cron] Transaction cache refresh complete: ${totalRefreshed} new transactions`);
  } catch (error) {
    console.error('[Cron] Error in refreshAllServiceTransactions:', error);
  }
}

/**
 * Clean up old records from database
 */
async function cleanupOldRecords() {
  if (!db) {
    console.error('[Cron] Database not available');
    return;
  }

  try {
    // Delete validation requests older than 90 days
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const result = await db.execute(
      db.sql`
        DELETE FROM validation_requests 
        WHERE created_at < ${ninetyDaysAgo}
      `
    );

    console.log(`[Cron] Deleted ${result.rowCount} old validation requests`);

    // Delete validation test cases older than 90 days
    const result2 = await db.execute(
      db.sql`
        DELETE FROM validation_test_cases 
        WHERE created_at < ${ninetyDaysAgo}
      `
    );

    console.log(`[Cron] Deleted ${result2.rowCount} old validation test cases`);

    // Delete cached blockchain transactions older than 180 days
    const oneEightyDaysAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

    const result3 = await db.execute(
      db.sql`
        DELETE FROM blockchain_transactions_cache 
        WHERE cached_at < ${oneEightyDaysAgo}
      `
    );

    console.log(`[Cron] Deleted ${result3.rowCount} old cached transactions`);

    console.log('[Cron] Database cleanup complete');
  } catch (error) {
    console.error('[Cron] Error in cleanupOldRecords:', error);
  }
}

/**
 * Get default token address for a chain
 */
function getDefaultTokenAddress(chain: string): string {
  const tokenAddresses: Record<string, string> = {
    base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    optimism: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
    arbitrum: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
    polygon: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  };

  return tokenAddresses[chain] || tokenAddresses.base;
}

