/**
 * Service Sync Utility
 * Fetches services from CDP Bazaar and stores them in the database
 * Ensures uniqueness and enables fast pagination
 */

import { db } from '@/lib/database/client';
import { discoveredServices } from '@/lib/database/schema';
import { discoveryService } from './discovery.service';
import { eq, desc } from 'drizzle-orm';
import crypto from 'crypto';

export interface SyncResult {
  totalFetched: number;
  newServices: number;
  updatedServices: number;
  errors: number;
  services: any[];
}

/**
 * Generate a unique service ID from resource URL
 */
function generateServiceId(resource: string): string {
  return crypto.createHash('sha256').update(resource).digest('hex').substring(0, 16);
}

/**
 * Extract metadata from service object
 */
function extractServiceData(service: any) {
  const serviceId = generateServiceId(service.resource);
  
  return {
    serviceId,
    resource: service.resource,
    type: service.type || null,
    x402Version: service.x402Version || 1,
    lastUpdated: service.lastUpdated ? new Date(service.lastUpdated) : null,
    metadata: JSON.stringify(service.metadata || {}),
    accepts: JSON.stringify(service.accepts || []),
    description: service.metadata?.description || service.description || null,
    name: service.metadata?.name || service.name || null,
    tags: service.metadata?.tags ? JSON.stringify(service.metadata.tags) : null,
    network: service.accepts?.[0]?.network || null,
    price: service.accepts?.[0]?.maxAmountRequired || null,
  };
}

/**
 * Sync all services from CDP Bazaar to database
 * Fetches all services and stores them with unique IDs
 */
export async function syncAllServices(maxServices: number = 1000): Promise<SyncResult> {
  if (!db) {
    throw new Error('Database not available');
  }

  const result: SyncResult = {
    totalFetched: 0,
    newServices: 0,
    updatedServices: 0,
    errors: 0,
    services: [],
  };

  try {
    console.log(`[Service Sync] Starting sync (max: ${maxServices} services)...`);

    // Fetch all services from CDP Bazaar
    const allServices = await discoveryService.fetchAllServices();
    
    result.totalFetched = Math.min(allServices.length, maxServices);
    const servicesToProcess = allServices.slice(0, maxServices);

    console.log(`[Service Sync] Processing ${servicesToProcess.length} services...`);

    // Process each service
    for (const service of servicesToProcess) {
      try {
        const serviceData = extractServiceData(service);
        
        // Check if service already exists
        const existing = await db
          .select()
          .from(discoveredServices)
          .where(eq(discoveredServices.resource, serviceData.resource))
          .limit(1);

        if (existing.length > 0) {
          // Update existing service
          await db
            .update(discoveredServices)
            .set({
              ...serviceData,
              syncedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(discoveredServices.resource, serviceData.resource));
          
          result.updatedServices++;
        } else {
          // Insert new service
          await db.insert(discoveredServices).values({
            ...serviceData,
            syncedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          
          result.newServices++;
        }

        result.services.push({
          id: serviceData.serviceId,
          resource: serviceData.resource,
          name: serviceData.name,
        });
      } catch (error) {
        console.error(`[Service Sync] Error processing service ${service.resource}:`, error);
        result.errors++;
      }
    }

    console.log(`[Service Sync] Complete! New: ${result.newServices}, Updated: ${result.updatedServices}, Errors: ${result.errors}`);
    
    return result;
  } catch (error) {
    console.error('[Service Sync] Fatal error:', error);
    throw error;
  }
}

/**
 * Get total count of services in database
 */
export async function getServiceCount(): Promise<number> {
  if (!db) {
    return 0;
  }

  try {
    const result = await db.select().from(discoveredServices);
    return result.length;
  } catch (error) {
    console.error('[Service Sync] Error getting count:', error);
    return 0;
  }
}

/**
 * Get last sync time
 */
export async function getLastSyncTime(): Promise<Date | null> {
  if (!db) {
    return null;
  }

  try {
    const result = await db
      .select({ syncedAt: discoveredServices.syncedAt })
      .from(discoveredServices)
      .orderBy(desc(discoveredServices.syncedAt))
      .limit(1);
    
    return result.length > 0 ? result[0].syncedAt : null;
  } catch (error) {
    console.error('[Service Sync] Error getting last sync time:', error);
    return null;
  }
}

