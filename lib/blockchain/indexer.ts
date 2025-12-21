/* eslint-disable @typescript-eslint/no-explicit-any */
// Blockchain Indexer - Fetches transactions from blockchain indexers
import { db } from '../database/client';
import { blockchainTransactionsCache } from '../database/schema';
import { eq, and, desc } from 'drizzle-orm';

export interface TransactionData {
  txHash: string;
  sender: string;
  recipient: string;
  amount: bigint;
  amountFormatted: number;
  token: string;
  blockTimestamp: Date;
  chain: string;
}

export interface IndexerConfig {
  chain: string;
  rpcUrl?: string;
  indexerApiUrl?: string;
  indexerApiKey?: string;
}

/**
 * Fetch transactions for a service from blockchain indexers (Basescan, etc.)
 */
export async function fetchServiceTransactions(
  serviceId: string,
  recipientAddress: string,
  chain: string,
  tokenAddress: string,
  fromBlock?: number,
  limit: number = 100
): Promise<TransactionData[]> {
  try {
    // Use appropriate indexer based on chain
    const indexer = getIndexerForChain(chain);
    
    if (!indexer) {
      console.warn(`No indexer available for chain: ${chain}`);
      return [];
    }

    const transactions = await indexer.fetchTransactions(
      recipientAddress,
      tokenAddress,
      fromBlock,
      limit
    );

    // Cache transactions in database
    if (db && transactions.length > 0) {
      await cacheTransactions(serviceId, chain, transactions);
    }

    return transactions;
  } catch (error) {
    console.error('[Blockchain Indexer] Error fetching transactions:', error);
    return [];
  }
}

/**
 * Get cached transactions from database
 */
export async function getCachedTransactions(
  serviceId: string,
  limit: number = 100,
  offset: number = 0
): Promise<TransactionData[]> {
  if (!db) {
    return [];
  }

  try {
    const cached = await db
      .select()
      .from(blockchainTransactionsCache)
      .where(eq(blockchainTransactionsCache.serviceId, serviceId))
      .orderBy(desc(blockchainTransactionsCache.blockTimestamp))
      .limit(limit)
      .offset(offset);

    return cached.map((tx: any) => ({
      txHash: tx.txHash,
      sender: tx.sender,
      recipient: tx.recipient,
      amount: BigInt(tx.amount),
      amountFormatted: tx.amountFormatted,
      token: tx.token,
      blockTimestamp: tx.blockTimestamp,
      chain: tx.chain,
    }));
  } catch (error) {
    console.error('[Blockchain Indexer] Error fetching cached transactions:', error);
    return [];
  }
}

/**
 * Cache transactions in database
 */
async function cacheTransactions(
  serviceId: string,
  chain: string,
  transactions: TransactionData[]
): Promise<void> {
  if (!db) return;

  try {
    for (const tx of transactions) {
      await db.insert(blockchainTransactionsCache).values({
        serviceId,
        chain,
        txHash: tx.txHash,
        sender: tx.sender,
        recipient: tx.recipient,
        amount: Number(tx.amount),
        amountFormatted: tx.amountFormatted,
        token: tx.token,
        blockTimestamp: tx.blockTimestamp,
      }).onConflictDoNothing(); // Avoid duplicates
    }
  } catch (error) {
    console.error('[Blockchain Indexer] Error caching transactions:', error);
  }
}

/**
 * Get appropriate indexer for chain
 */
function getIndexerForChain(chain: string): BlockchainIndexer | null {
  const indexers: Record<string, BlockchainIndexer> = {
    base: new BasescanIndexer(),
    ethereum: new EtherscanIndexer(),
    optimism: new OptimismIndexer(),
    arbitrum: new ArbitrumIndexer(),
    polygon: new PolygonscanIndexer(),
  };

  return indexers[chain] || null;
}

/**
 * Base class for blockchain indexers
 */
abstract class BlockchainIndexer {
  abstract getApiUrl(): string;
  abstract getApiKey(): string | undefined;

  async fetchTransactions(
    recipientAddress: string,
    tokenAddress: string,
    fromBlock?: number,
    limit: number = 100
  ): Promise<TransactionData[]> {
    const apiUrl = this.getApiUrl();
    const apiKey = this.getApiKey();

    if (!apiKey) {
      console.warn(`No API key configured for indexer: ${this.constructor.name}`);
      return [];
    }

    // Build API request
    const params = new URLSearchParams({
      module: 'account',
      action: 'tokentx',
      address: recipientAddress,
      contractaddress: tokenAddress,
      page: '1',
      offset: limit.toString(),
      sort: 'desc',
      apikey: apiKey,
    });

    if (fromBlock) {
      params.append('startblock', fromBlock.toString());
    }

    const url = `${apiUrl}?${params.toString()}`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.status !== '1' || !data.result) {
        console.warn(`Indexer API returned error: ${data.message}`);
        return [];
      }

      // Parse transactions
      return data.result.map((tx: any) => ({
        txHash: tx.hash,
        sender: tx.from,
        recipient: tx.to,
        amount: BigInt(tx.value),
        amountFormatted: Number(tx.value) / Math.pow(10, parseInt(tx.tokenDecimal)),
        token: tx.contractAddress,
        blockTimestamp: new Date(parseInt(tx.timeStamp) * 1000),
        chain: this.getChainName(),
      }));
    } catch (error) {
      console.error(`[${this.constructor.name}] Error fetching transactions:`, error);
      return [];
    }
  }

  abstract getChainName(): string;
}

/**
 * Basescan indexer (Base mainnet)
 */
class BasescanIndexer extends BlockchainIndexer {
  getApiUrl(): string {
    return 'https://api.basescan.org/api';
  }

  getApiKey(): string | undefined {
    return process.env.BASESCAN_API_KEY;
  }

  getChainName(): string {
    return 'base';
  }
}

/**
 * Etherscan indexer (Ethereum mainnet)
 */
class EtherscanIndexer extends BlockchainIndexer {
  getApiUrl(): string {
    return 'https://api.etherscan.io/api';
  }

  getApiKey(): string | undefined {
    return process.env.ETHERSCAN_API_KEY;
  }

  getChainName(): string {
    return 'ethereum';
  }
}

/**
 * Optimism indexer
 */
class OptimismIndexer extends BlockchainIndexer {
  getApiUrl(): string {
    return 'https://api-optimistic.etherscan.io/api';
  }

  getApiKey(): string | undefined {
    return process.env.OPTIMISM_ETHERSCAN_API_KEY;
  }

  getChainName(): string {
    return 'optimism';
  }
}

/**
 * Arbitrum indexer
 */
class ArbitrumIndexer extends BlockchainIndexer {
  getApiUrl(): string {
    return 'https://api.arbiscan.io/api';
  }

  getApiKey(): string | undefined {
    return process.env.ARBITRUM_ETHERSCAN_API_KEY;
  }

  getChainName(): string {
    return 'arbitrum';
  }
}

/**
 * Polygonscan indexer
 */
class PolygonscanIndexer extends BlockchainIndexer {
  getApiUrl(): string {
    return 'https://api.polygonscan.com/api';
  }

  getApiKey(): string | undefined {
    return process.env.POLYGONSCAN_API_KEY;
  }

  getChainName(): string {
    return 'polygon';
  }
}

/**
 * Refresh transaction cache for a service
 * This should be called periodically (e.g., every 5 minutes)
 */
export async function refreshServiceTransactionCache(
  serviceId: string,
  recipientAddress: string,
  chain: string,
  tokenAddress: string
): Promise<number> {
  try {
    // Get latest cached transaction to determine fromBlock
    let fromBlock: number | undefined;
    
    if (db) {
      const latest = await db
        .select()
        .from(blockchainTransactionsCache)
        .where(
          and(
            eq(blockchainTransactionsCache.serviceId, serviceId),
            eq(blockchainTransactionsCache.chain, chain)
          )
        )
        .orderBy(desc(blockchainTransactionsCache.blockTimestamp))
        .limit(1);

      // If we have cached data, fetch only newer transactions
      // This would require storing block number, which we can add later
    }

    // Fetch new transactions
    const transactions = await fetchServiceTransactions(
      serviceId,
      recipientAddress,
      chain,
      tokenAddress,
      fromBlock,
      100
    );

    return transactions.length;
  } catch (error) {
    console.error('[Blockchain Indexer] Error refreshing cache:', error);
    return 0;
  }
}

