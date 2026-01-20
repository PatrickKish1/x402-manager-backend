/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database/client';
import { validatedServices } from '@/lib/database/schema';
import { eq, desc, and } from 'drizzle-orm';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

/**
 * GET /api/validated-services
 * Get all validated services
 */
export async function GET(request: NextRequest) {
  try {
    if (!db) {
      return NextResponse.json(
        { error: 'Database not available' },
        { status: 503 }
      );
    }

    // Store db in const so TypeScript knows it's not null
    const database = db;

    const { searchParams } = new URL(request.url);
    const serviceId = searchParams.get('serviceId');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build where condition
    const conditions = [];
    if (serviceId) {
      conditions.push(eq(validatedServices.serviceId, serviceId));
    }
    if (status) {
      conditions.push(eq(validatedServices.validationStatus, status));
    }

    // Build and execute query with conditional where clause
    // Use type assertion to help TypeScript with conditional query building
    let query = database.select().from(validatedServices) as any;
    
    if (conditions.length === 1) {
      query = query.where(conditions[0]);
    } else if (conditions.length > 1) {
      query = query.where(and(...conditions));
    }

    // Apply pagination
    const services = await query
      .orderBy(desc(validatedServices.lastValidatedAt))
      .limit(limit)
      .offset(offset);

    // Parse validation results JSON and enrich with output schemas from discovered_services
    const supabase = createSupabaseAdminClient();
    const servicesWithParsedResults = await Promise.all(
      services.map(async (service: any) => {
        // Fetch output schema from discovered_services
        let outputSchema = null;
        try {
          const { data: discoveredService } = await supabase
            .from('discovered_services')
            .select('output_schema')
            .eq('service_id', service.serviceId)
            .single();

          if (discoveredService?.output_schema) {
            try {
              outputSchema = JSON.parse(discoveredService.output_schema);
            } catch (parseError) {
              console.error(`[Validated Services] Error parsing output schema for ${service.serviceId}:`, parseError);
            }
          }
        } catch (error) {
          // Log but don't fail if schema lookup fails
          console.error(`[Validated Services] Error fetching output schema for ${service.serviceId}:`, error);
        }

        return {
          ...service,
          validationResults: service.validationResults 
            ? JSON.parse(service.validationResults) 
            : null,
          outputSchema, // Add inferred output schema
        };
      })
    );

    return NextResponse.json({
      services: servicesWithParsedResults,
      count: services.length,
      limit,
      offset,
    }, { status: 200 });
  } catch (error) {
    console.error('[Validated Services API] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch validated services',
      },
      { status: 500 }
    );
  }
}

