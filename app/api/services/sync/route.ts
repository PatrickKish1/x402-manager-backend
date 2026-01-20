/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { discoveryService } from '@/lib/services/discovery.service';
import { generateServiceName, generateDisplayName } from '@/lib/services/service-naming';
import crypto from 'crypto';

/**
 * Generate a unique service ID from resource URL
 */
function generateServiceId(resource: string): string {
  return crypto.createHash('sha256').update(resource).digest('hex').substring(0, 16);
}

/**
 * POST /api/services/sync
 * Sync all services from CDP Bazaar to database
 */
export async function POST(request: NextRequest) {
  try {
    // Check if Supabase is configured
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Supabase not configured',
          message: 'Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables',
          help: 'Get these from your Supabase project settings > API'
        },
        { status: 503 }
      );
    }

    // Create Supabase admin client (bypasses RLS)
    const supabase = createSupabaseAdminClient();

    const body = await request.json().catch(() => ({}));
    const maxServices = body.maxServices || undefined; // No limit by default, or use provided value

    console.log(`[Sync Services] Starting sync${maxServices ? ` (max: ${maxServices})` : ' (fetching all services from CDP Bazaar)'}...`);

    // Fetch all services from CDP Bazaar (will fetch until total is reached or empty results)
    const allServices = await discoveryService.fetchAllServices({}, maxServices);
    
    console.log(`[Sync Services] Fetched ${allServices.length} services from CDP Bazaar`);

    let newServices = 0;
    let updatedServices = 0;
    let errors = 0;
    const totalFetched = maxServices ? Math.min(allServices.length, maxServices) : allServices.length;

    // Process each service
    const processLimit = maxServices ? Math.min(allServices.length, maxServices) : allServices.length;
    for (let i = 0; i < processLimit; i++) {
      const service = allServices[i];

      try {
        if (!service.resource) {
          console.warn(`[Sync Services] Skipping service without resource:`, service);
          errors++;
          continue;
        }

        const serviceId = generateServiceId(service.resource);
        const resource = service.resource;
        const type = service.type || null;
        const x402Version = service.x402Version || 1;
        const lastUpdated = service.lastUpdated ? new Date(service.lastUpdated).toISOString() : null;
        const metadata = service.metadata || {};
        const accepts = service.accepts || [];

        // Extract useful fields from metadata
        // Try multiple sources for description: metadata.description, accepts[0].description, or default
        let description = metadata.description || null;
        if (!description && accepts.length > 0 && accepts[0].description) {
          description = accepts[0].description;
        }
        // Set default if no description found
        if (!description || description.trim() === '') {
          description = 'No description available';
        }
        
        const metadataName = metadata.name || null;
        // Use frontend naming convention: generate name from resource if metadata name not available
        const name = generateDisplayName(resource, metadataName);
        
        // Extract tags from metadata - handle array or other formats
        let tags: string | null = null;
        if (metadata.tags) {
          if (Array.isArray(metadata.tags) && metadata.tags.length > 0) {
            tags = JSON.stringify(metadata.tags);
          } else if (typeof metadata.tags === 'string' && metadata.tags.trim() !== '') {
            // If tags is a string, try to parse it or use as-is
            try {
              const parsed = JSON.parse(metadata.tags);
              if (Array.isArray(parsed) && parsed.length > 0) {
                tags = metadata.tags;
              }
            } catch {
              // If not valid JSON, create array from string
              tags = JSON.stringify([metadata.tags]);
            }
          }
        }
        // Set default if no tags found
        if (!tags) {
          tags = JSON.stringify([]); // Empty array instead of null
        }

        // Extract from accepts array
        const firstAccept = accepts[0] || {};
        const network = firstAccept.network || null;
        const price = firstAccept.maxAmountRequired || null;

        // Check if service already exists
        const { data: existing } = await supabase
          .from('discovered_services')
          .select('resource')
          .eq('resource', resource)
          .limit(1);

        if (existing && existing.length > 0) {
          // Update existing service
          const { error: updateError } = await supabase
            .from('discovered_services')
            .update({
              type,
              x402_version: x402Version,
              last_updated: lastUpdated,
              metadata: JSON.stringify(metadata),
              accepts: JSON.stringify(accepts),
              description,
              name,
              tags,
              network,
              price,
              synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('resource', resource);

          if (updateError) throw updateError;
          updatedServices++;
        } else {
          // Insert new service
          const { error: insertError } = await supabase
            .from('discovered_services')
            .insert({
              service_id: serviceId,
              resource,
              type,
              x402_version: x402Version,
              last_updated: lastUpdated,
              metadata: JSON.stringify(metadata),
              accepts: JSON.stringify(accepts),
              description,
              name,
              tags,
              network,
              price,
              synced_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });

          if (insertError) throw insertError;
          newServices++;
        }
      } catch (error: any) {
        console.error(`[Sync Services] Error processing service ${i + 1}:`, error);
        errors++;
      }
    }

    console.log(`[Sync Services] Complete! New: ${newServices}, Updated: ${updatedServices}, Errors: ${errors}`);

    return NextResponse.json({
      success: true,
      totalFetched,
      newServices,
      updatedServices,
      errors,
      message: `Synced ${totalFetched} services (${newServices} new, ${updatedServices} updated)`,
    });
  } catch (error: any) {
    console.error('[Sync Services] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to sync services',
      },
      { status: 500 }
    );
  }
}

