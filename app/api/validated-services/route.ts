/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database/client';
import { validatedServices } from '@/lib/database/schema';
import { eq, desc } from 'drizzle-orm';

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

    const { searchParams } = new URL(request.url);
    const serviceId = searchParams.get('serviceId');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    let query = db.select().from(validatedServices);

    // Filter by serviceId if provided
    if (serviceId) {
      query = query.where(eq(validatedServices.serviceId, serviceId));
    }

    // Filter by status if provided
    if (status) {
      query = query.where(eq(validatedServices.validationStatus, status));
    }

    // Apply pagination
    const services = await query
      .orderBy(desc(validatedServices.lastValidatedAt))
      .limit(limit)
      .offset(offset);

    // Parse validation results JSON
    const servicesWithParsedResults = services.map((service: any) => ({
      ...service,
      validationResults: service.validationResults 
        ? JSON.parse(service.validationResults) 
        : null,
    }));

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

