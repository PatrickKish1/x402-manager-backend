/**
 * Simple utility to fetch all services from the backend
 * Easy to integrate into any frontend application
 * 
 * Usage:
 *   import { fetchAllServices } from './lib/services/fetch-all-services';
 *   const services = await fetchAllServices();
 */

export interface ServiceFetchOptions {
  backendUrl?: string;
  maxServices?: number;
  filters?: {
    type?: string;
  };
}

export interface ServiceResponse {
  items: any[];
  total: number;
}

/**
 * Fetch all services from the backend discovery endpoint
 * Automatically handles pagination to fetch up to 1000+ services
 * 
 * @param options - Configuration options
 * @returns Array of all services
 * 
 * @example
 * ```javascript
 * // Basic usage
 * const services = await fetchAllServices();
 * 
 * // With custom backend URL
 * const services = await fetchAllServices({
 *   backendUrl: 'https://your-backend.com'
 * });
 * 
 * // With filters
 * const services = await fetchAllServices({
 *   filters: { type: 'api' }
 * });
 * ```
 */
export async function fetchAllServices(
  options: ServiceFetchOptions = {}
): Promise<any[]> {
  const {
    backendUrl = 'http://localhost:3001',
    maxServices = 1000,
    filters = {}
  } = options;

  const allServices: any[] = [];
  let offset = 0;
  const limit = 100; // Max items per page
  let hasMore = true;

  while (hasMore && allServices.length < maxServices) {
    // Build URL with pagination params
    const params = new URLSearchParams();
    params.append('limit', limit.toString());
    params.append('offset', offset.toString());
    
    if (filters.type) {
      params.append('type', filters.type);
    }

    const url = `${backendUrl}/api/discovery?${params.toString()}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After') || '2';
          const delay = parseInt(retryAfter) * 1000;
          console.warn(`Rate limited. Waiting ${delay / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue; // Retry same page
        }
        
        throw new Error(`Failed to fetch services: ${response.status} ${response.statusText}`);
      }

      const data: ServiceResponse = await response.json();
      const items = data.items || [];

      // Add items to our collection
      allServices.push(...items);

      // Check if there are more pages
      // If we got fewer items than the limit, we've reached the end
      hasMore = items.length === limit;
      
      // Move to next page
      offset += limit;

      // Small delay between pages to be respectful
      if (hasMore && allServices.length < maxServices) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.error(`Error fetching services at offset ${offset}:`, error);
      throw error;
    }
  }

  return allServices;
}

/**
 * Fetch a specific page of services (useful for paginated UI)
 * 
 * @param page - Page number (1-indexed)
 * @param pageSize - Items per page (default: 100, max: 100)
 * @param options - Configuration options
 * @returns Object with items and pagination info
 * 
 * @example
 * ```javascript
 * // Get first page (items 1-100)
 * const page1 = await fetchServicesPage(1);
 * 
 * // Get second page (items 101-200)
 * const page2 = await fetchServicesPage(2);
 * ```
 */
export async function fetchServicesPage(
  page: number,
  pageSize: number = 100,
  options: ServiceFetchOptions = {}
): Promise<{ items: any[]; page: number; hasMore: boolean; total: number }> {
  const { backendUrl = 'http://localhost:3001', filters = {} } = options;
  
  const limit = Math.min(pageSize, 100); // Max 100 per page
  const offset = (page - 1) * limit;

  const params = new URLSearchParams();
  params.append('limit', limit.toString());
  params.append('offset', offset.toString());
  
  if (filters.type) {
    params.append('type', filters.type);
  }

  const url = `${backendUrl}/api/discovery?${params.toString()}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch services: ${response.status} ${response.statusText}`);
  }

  const data: ServiceResponse = await response.json();
  const items = data.items || [];

  return {
    items,
    page,
    hasMore: items.length === limit,
    total: data.total || items.length,
  };
}

