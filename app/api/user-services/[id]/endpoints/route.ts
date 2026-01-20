/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database/client';
import { serviceEndpoints } from '@/lib/database/schema';
import { eq } from 'drizzle-orm';

/**
 * POST /api/user-services/:id/endpoints
 * Save endpoints for a service
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!db) {
      return NextResponse.json(
        { error: 'Database not available' },
        { status: 503 }
      );
    }

    const resolvedParams = await params;
    const serviceId = resolvedParams.id;
    const body = await request.json();
    const { endpoints } = body;

    if (!Array.isArray(endpoints)) {
      return NextResponse.json(
        { error: 'Endpoints must be an array' },
        { status: 400 }
      );
    }

    // Delete existing endpoints for this service
    await db.delete(serviceEndpoints).where(eq(serviceEndpoints.serviceId, serviceId));

    // Insert new endpoints
    if (endpoints.length > 0) {
      await db.insert(serviceEndpoints).values(
        endpoints.map((ep: any, index: number) => ({
          id: ep.id || crypto.randomUUID(),
          serviceId,
          endpoint: ep.endpoint,
          method: ep.method,
          description: ep.description || null,
          pricePerRequest: ep.pricePerRequest || null,
          network: ep.network || null,
          currency: ep.currency || null,
          tokenAddress: ep.tokenAddress || null,
          tokenDecimals: ep.tokenDecimals || null,
          tokenName: ep.tokenName || null,
          tokenVersion: ep.tokenVersion || null,
          tokenSymbol: ep.tokenSymbol || null,
          pathParams: ep.pathParams ? JSON.stringify(ep.pathParams) : null,
          queryParams: ep.queryParams ? JSON.stringify(ep.queryParams) : null,
          headers: ep.headers ? JSON.stringify(ep.headers) : null,
          requestBody: ep.requestBody ? JSON.stringify(ep.requestBody) : null,
          outputSchema: ep.outputSchema ? JSON.stringify(ep.outputSchema) : null,
          expectedStatusCode: ep.expectedStatusCode || 200,
          extra: ep.extra ? JSON.stringify(ep.extra) : null,
          orderIndex: index,
        }))
      );
    }

    // Save multi-chain config if provided
    if (body.multiChainConfig) {
      // Store in user_services table or a separate table
      // For now, we'll store it as JSON in a service metadata field
      // This can be enhanced later with a dedicated table
    }

    return NextResponse.json({
      success: true,
      message: `Saved ${endpoints.length} endpoints`,
    }, { status: 200 });
  } catch (error) {
    console.error('[Save Endpoints API] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to save endpoints',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/user-services/:id/endpoints
 * Get endpoints for a service
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!db) {
      return NextResponse.json(
        { error: 'Database not available' },
        { status: 503 }
      );
    }

    const resolvedParams = await params;
    const serviceId = resolvedParams.id;

    const endpoints = await db
      .select()
      .from(serviceEndpoints)
      .where(eq(serviceEndpoints.serviceId, serviceId))
      .orderBy(serviceEndpoints.orderIndex);

    // Parse JSON fields
    const parsedEndpoints = endpoints.map((ep: any) => ({
      ...ep,
      pathParams: ep.pathParams ? JSON.parse(ep.pathParams) : null,
      queryParams: ep.queryParams ? JSON.parse(ep.queryParams) : null,
      headers: ep.headers ? JSON.parse(ep.headers) : null,
      requestBody: ep.requestBody ? JSON.parse(ep.requestBody) : null,
      outputSchema: ep.outputSchema ? JSON.parse(ep.outputSchema) : null,
      extra: ep.extra ? JSON.parse(ep.extra) : null,
    }));

    return NextResponse.json({
      endpoints: parsedEndpoints,
    }, { status: 200 });
  } catch (error) {
    console.error('[Get Endpoints API] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch endpoints',
      },
      { status: 500 }
    );
  }
}

