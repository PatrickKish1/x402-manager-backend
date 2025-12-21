/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database/client';
import { validatedServices, validationVotes } from '@/lib/database/schema';
import { eq, or, and, desc } from 'drizzle-orm';

/**
 * GET /api/reports
 * Get list of services with validation issues (invalid votes or failed status)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // 'failed', 'disputed', or all
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build query conditions
    let whereCondition;
    if (status) {
      whereCondition = eq(validatedServices.validationStatus, status);
    } else {
      // Default: show failed and disputed services
      whereCondition = or(
        eq(validatedServices.validationStatus, 'failed'),
        eq(validatedServices.validationStatus, 'disputed')
      );
    }

    // Get services with validation issues
    const services = await db
      .select()
      .from(validatedServices)
      .where(whereCondition)
      .orderBy(desc(validatedServices.invalidVoteCount), desc(validatedServices.updatedAt))
      .limit(limit)
      .offset(offset);

    // Get detailed vote information for each service
    const servicesWithVotes = await Promise.all(
      services.map(async (service: any) => {
        // Get all invalid votes with reasons
        const invalidVotes = await db
          .select()
          .from(validationVotes)
          .where(
            and(
              eq(validationVotes.serviceId, service.serviceId),
              eq(validationVotes.vote, 'invalid')
            )
          )
          .orderBy(desc(validationVotes.createdAt));

        // Get recent valid votes count
        const validVotes = await db
          .select()
          .from(validationVotes)
          .where(
            and(
              eq(validationVotes.serviceId, service.serviceId),
              eq(validationVotes.vote, 'valid')
            )
          )
          .limit(5);

        return {
          ...service,
          invalidVotes: invalidVotes.map((vote: any) => ({
            userAddress: vote.userAddress,
            reason: vote.reason,
            validationDetails: vote.validationDetails ? JSON.parse(vote.validationDetails) : null,
            createdAt: vote.createdAt,
          })),
          recentValidVotes: validVotes.length,
        };
      })
    );

    return NextResponse.json({
      services: servicesWithVotes,
      total: services.length,
      limit,
      offset,
    }, { status: 200 });
  } catch (error) {
    console.error('[Reports API] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch reports',
      },
      { status: 500 }
    );
  }
}

