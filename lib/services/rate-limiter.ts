// Rate Limiter Service
// Implements token bucket algorithm for API rate limiting

export interface RateLimiterConfig {
  requestsPerSecond: number;
  requestsPerMinute?: number;
  burstSize?: number;
}

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per millisecond
  private readonly requestsPerMinute?: number;
  private minuteWindow: { timestamp: number; count: number }[] = [];
  private queue: Array<() => void> = []; // Queue for waiting requests
  private processing: boolean = false; // Mutex to prevent concurrent processing

  constructor(config: RateLimiterConfig) {
    this.maxTokens = config.burstSize || config.requestsPerSecond;
    this.tokens = this.maxTokens;
    this.refillRate = config.requestsPerSecond / 1000; // convert to per millisecond
    this.lastRefill = Date.now();
    this.requestsPerMinute = config.requestsPerMinute;
  }

  /**
   * Wait until a token is available (thread-safe with queue)
   */
  async waitForToken(): Promise<void> {
    return new Promise((resolve) => {
      // Add to queue
      this.queue.push(resolve);
      
      // Process queue if not already processing
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process the queue of waiting requests
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      // Refill tokens
      this.refill();
      
      // Try to acquire token
      if (this.tryAcquire()) {
        const resolve = this.queue.shift();
        if (resolve) {
          resolve();
        }
      } else {
        // No tokens available, wait for refill
        const timeToWait = Math.ceil((1 - this.tokens) / this.refillRate);
        await this.sleep(Math.max(timeToWait, 1000)); // Minimum 1 second delay for CDP API
      }
    }

    this.processing = false;
  }

  /**
   * Refill tokens based on time elapsed
   */
  private refill(): void {
    const now = Date.now();
    const timeSinceLastRefill = now - this.lastRefill;
    const tokensToAdd = timeSinceLastRefill * this.refillRate;
    
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Try to acquire a token without waiting (called after refill)
   */
  private tryAcquire(): boolean {
    const now = Date.now();

    // Check per-minute limit if configured
    if (this.requestsPerMinute) {
      this.cleanupMinuteWindow(now);
      if (this.minuteWindow.length >= this.requestsPerMinute) {
        return false;
      }
    }

    // Try to consume a token
    if (this.tokens >= 1) {
      this.tokens -= 1;
      
      // Track request in minute window
      if (this.requestsPerMinute) {
        this.minuteWindow.push({ timestamp: now, count: 1 });
      }
      
      return true;
    }

    return false;
  }

  private cleanupMinuteWindow(now: number): void {
    const oneMinuteAgo = now - 60000;
    this.minuteWindow = this.minuteWindow.filter(
      entry => entry.timestamp > oneMinuteAgo
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getTokenCount(): number {
    this.refill();
    return this.tokens;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
    this.minuteWindow = [];
  }
}

// Pre-configured rate limiters
export const rateLimiters = {
  // CDP API: 1 req/sec to stay well under 2.77 req/sec limit (more conservative)
  cdp: new RateLimiter({
    requestsPerSecond: 1, // Reduced from 2 to 1 for safety
    requestsPerMinute: 60, // Reduced from 120 to 60 for safety
    burstSize: 2, // Reduced from 3 to 2
  }),
  etherscan: new RateLimiter({
    requestsPerSecond: 2,
    burstSize: 3,
  }),
  etherscanStandard: new RateLimiter({
    requestsPerSecond: 9,
    burstSize: 12,
  }),
  squid: new RateLimiter({
    requestsPerSecond: 5,
    burstSize: 10,
  }),
};

