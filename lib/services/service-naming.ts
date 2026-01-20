/**
 * Service Naming Utilities
 * Matches frontend naming convention from app/celo-x402/lib/x402-service-id.ts
 */

/**
 * Generate a hash from a string (simple hash function)
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Generate a service name from a resource URL
 * Returns a short, URL-safe identifier matching frontend convention
 * 
 * Examples:
 * - https://api.example.com/v1/data → example-com-v1-data
 * - https://weather.api.com/forecast → weather-api-com-forecast
 */
export function generateServiceName(resource: string): string {
  if (!resource) return 'unknown';
  
  try {
    // Use a combination of domain and path for uniqueness
    const url = new URL(resource);
    const domain = url.hostname.replace(/\./g, '-');
    const path = url.pathname.replace(/\//g, '-').replace(/^-|-$/g, '');
    const combined = `${domain}${path ? `-${path}` : ''}`;
    
    // If too long, use hash
    if (combined.length > 50) {
      return simpleHash(resource);
    }
    
    // Make URL-safe and lowercase
    return combined
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  } catch {
    // Fallback to hash if URL parsing fails
    return simpleHash(resource);
  }
}

/**
 * Get service name from a service object
 */
export function getServiceName(service: { resource: string }): string {
  return generateServiceName(service?.resource || '');
}

/**
 * Generate a display name from metadata
 * Falls back to service name if metadata name is not available
 */
export function generateDisplayName(
  resource: string,
  metadataName?: string | null
): string {
  if (metadataName && metadataName.trim()) {
    return metadataName.trim();
  }
  return generateServiceName(resource);
}

