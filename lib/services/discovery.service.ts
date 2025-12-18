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
   */
  async fetchAllServices(initialFilters?: DiscoveryFilters): Promise<X402Service[]> {
    let allServices: X402Service[] = [];
    let offset = 0;
    const limit = 100;
    const maxServices = 1000;

    while (true) {
      const currentFilters = { ...initialFilters, limit, offset };
      const servicesPage = await this.fetchServices(currentFilters);
      allServices = [...allServices, ...servicesPage];

      if (servicesPage.length < limit || allServices.length >= maxServices) {
        break;
      }
      offset += limit;
      // Wait 1 second between pages to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return allServices;
  }
}

export const discoveryService = DiscoveryService.getInstance();

