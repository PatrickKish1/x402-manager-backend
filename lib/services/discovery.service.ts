// Discovery Service - Migrated from frontend
// Handles fetching and caching of x402 services from CDP Bazaar

import { rateLimiters } from './rate-limiter';

export interface X402Service {
  resource: string;
  type: string;
  x402Version: number;
  lastUpdated: string;
  metadata: Record<string, any>;
  accepts: any[];
}

export interface DiscoveryFilters {
  type?: string;
  limit?: number;
  offset?: number;
}

const CDP_BAZAAR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources';

export class DiscoveryService {
  private static instance: DiscoveryService;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  static getInstance(): DiscoveryService {
    if (!DiscoveryService.instance) {
      DiscoveryService.instance = new DiscoveryService();
    }
    return DiscoveryService.instance;
  }

  /**
   * Fetch services from CDP Bazaar with rate limiting
   */
  async fetchServices(filters?: DiscoveryFilters): Promise<X402Service[]> {
    const cacheKey = JSON.stringify(filters || {});
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.data;
    }

    // Wait for rate limit token (queue-based, thread-safe)
    await rateLimiters.cdp.waitForToken();

    const params = new URLSearchParams();
    if (filters?.type) params.append('type', filters.type);
    if (filters?.limit) params.append('limit', filters.limit.toString());
    if (filters?.offset) params.append('offset', filters.offset.toString());

    const url = `${CDP_BAZAAR_URL}${params.toString() ? '?' + params.toString() : ''}`;

    const queueLength = (rateLimiters.cdp as any).queue?.length || 0;
    // console.log(`[Backend] Fetching from CDP: ${url} (queue length: ${queueLength})`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'X402-Backend/1.0',
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter ? parseInt(retryAfter) * 1000 : 5000; // Default 5 seconds
        console.warn(`[Backend] Rate limited by CDP API. Waiting ${delay / 1000} seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.fetchServices(filters); // Retry
      }
      throw new Error(`Failed to fetch services: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const services = data.items || [];

    this.cache.set(cacheKey, { data: services, timestamp: Date.now() });
    return services;
  }

  /**
   * Fetch all services with pagination
   * Fetches until we reach the total from API or get empty results
   */
  async fetchAllServices(
    initialFilters?: DiscoveryFilters,
    maxServices?: number
  ): Promise<X402Service[]> {
    let allServices: X402Service[] = [];
    let offset = 0;
    const limit = 100;
    let totalFromAPI: number | null = null;
    // Default to no limit, or use provided maxServices
    const max = maxServices || Infinity;

    while (true) {
      // Fetch directly from API to get pagination info (bypass cache for total)
      await rateLimiters.cdp.waitForToken();

      const params = new URLSearchParams();
      if (initialFilters?.type) params.append('type', initialFilters.type);
      params.append('limit', limit.toString());
      params.append('offset', offset.toString());

      const url = `${CDP_BAZAAR_URL}${params.toString() ? '?' + params.toString() : ''}`;

      let response: Response | null = null;
      let retryCount = 0;
      const maxRetries = 5;

      // Retry logic for rate limits
      while (retryCount < maxRetries) {
        response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'X402-Backend/1.0',
          },
        });

        if (response.ok) {
          break; // Success, exit retry loop
        }

        if (response.status === 429) {
          retryCount++;
          const retryAfter = response.headers.get('Retry-After');
          const delay = retryAfter ? parseInt(retryAfter) * 1000 : 5000;
          console.warn(`[Backend] Rate limited by CDP API (attempt ${retryCount}/${maxRetries}). Waiting ${delay / 1000} seconds before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue; // Retry same request
        }

        // Non-429 error, throw immediately
        throw new Error(`Failed to fetch services: ${response.status} ${response.statusText}`);
      }

      if (!response || !response.ok) {
        console.error(`[Backend] Failed to fetch after ${maxRetries} retries. Stopping at ${allServices.length} services.`);
        break; // Stop fetching if we can't get the page after retries
      }

      const data = await response.json();
      const servicesPage = data.items || [];
      
      // Get total from pagination response (only set once on first page)
      if (totalFromAPI === null && data.pagination?.total !== undefined) {
        totalFromAPI = data.pagination.total;
        console.log(`[Backend] Total services in CDP Bazaar: ${totalFromAPI}`);
      }
      
      allServices = [...allServices, ...servicesPage];
      console.log(`[Backend] Fetched page ${Math.floor(offset / limit) + 1}: ${servicesPage.length} services (total so far: ${allServices.length}/${totalFromAPI || 'unknown'})`);

      // Stop if:
      // 1. Received empty page (no more services)
      // 2. Reached the total from API (all services fetched)
      // 3. Reached maxServices limit
      // 4. Received fewer items than requested (safety check - no more pages)
      const shouldStop = 
        servicesPage.length === 0 ||
        (totalFromAPI !== null && allServices.length >= totalFromAPI) ||
        allServices.length >= max ||
        servicesPage.length < limit;

      if (shouldStop) {
        console.log(`[Backend] Stopping fetch: empty=${servicesPage.length === 0}, reachedTotal=${totalFromAPI !== null && allServices.length >= totalFromAPI}, reachedMax=${allServices.length >= max}, fewerItems=${servicesPage.length < limit}`);
        break;
      }
      
      offset += limit;
      // Wait 1 second between pages to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`[Backend] Fetched ${allServices.length} services (total in API: ${totalFromAPI || 'unknown'})`);
    return allServices;
  }
}

export const discoveryService = DiscoveryService.getInstance();

