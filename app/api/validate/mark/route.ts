import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database/client';
import { validatedServices, validationVotes } from '@/lib/database/schema';
import { eq, and, sql } from 'drizzle-orm';

/**
 * POST /api/validate/mark
 * Mark a service as valid or invalid (vote system - multiple users can vote)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      serviceId, 
      service,
      userAddress,
      vote, // 'valid' or 'invalid'
      reason, // Reason for invalid vote (optional)
      validationMode = 'user-paid', // 'free' or 'user-paid'
      testResponse,
      testnetChain 
    } = body;

    // Validate input
    if (!serviceId) {
      return NextResponse.json(
        { error: 'Service ID is required' },
        { status: 400 }
      );
    }

    if (!service) {
      return NextResponse.json(
        { error: 'Service data is required' },
        { status: 400 }
      );
    }

    if (!userAddress) {
      return NextResponse.json(
        { error: 'User address is required' },
        { status: 400 }
      );
    }

    if (!vote || !['valid', 'invalid'].includes(vote)) {
      return NextResponse.json(
        { error: 'Vote must be either "valid" or "invalid"' },
        { status: 400 }
      );
    }

    if (vote === 'invalid' && !reason && !testResponse?.validation?.error) {
      return NextResponse.json(
        { error: 'Reason is required for invalid votes' },
        { status: 400 }
      );
    }

    // Determine testnet chain if not provided
    let detectedTestnetChain = testnetChain;
    if (!detectedTestnetChain && service?.accepts) {
      for (const accept of service.accepts) {
        const network = accept.network?.toLowerCase() || '';
        if (network.includes('sepolia') || network.includes('testnet') || network.includes('devnet')) {
          detectedTestnetChain = network;
          break;
        }
      }
    }

    // Get service name
    const serviceName = service?.metadata?.name || 
                       service?.resource?.split('/').pop() || 
                       'Unnamed Service';

    // Extract validation details
    const validationDetails = testResponse?.validation ? {
      isValid: testResponse.validation.isValid,
      hasData: testResponse.validation.hasData,
      dataType: testResponse.validation.dataType,
      error: testResponse.validation.error,
      warnings: testResponse.validation.warnings,
    } : null;

    // Get reason for invalid vote
    const invalidReason = reason || 
                         testResponse?.validation?.error || 
                         (vote === 'invalid' ? 'Service validation failed' : null);

    // Check database connection
    if (!db) {
      console.error('[Mark Validated API] Database connection not available');
      return NextResponse.json(
        { error: 'Service temporarily unavailable. Please try again later.' },
        { status: 503 }
      );
    }

    let existingVote;
    let validCount = 0;
    let invalidCount = 0;
    let validationStatus: 'verified' | 'failed' | 'pending' | 'disputed' = 'pending';
    let validationScore = 0;
    let existing;

    try {
      // Check if user already voted
      existingVote = await db
        .select()
        .from(validationVotes)
        .where(
          and(
            eq(validationVotes.serviceId, serviceId),
            eq(validationVotes.userAddress, userAddress)
          )
        )
        .limit(1);
    } catch (dbError) {
      console.error('[Mark Validated API] Database error checking existing vote:', dbError);
      throw new Error('Database operation failed');
    }

    try {
      // Insert or update vote
      if (existingVote.length > 0) {
        // Update existing vote
        await db
          .update(validationVotes)
          .set({
            vote,
            reason: invalidReason,
            validationDetails: validationDetails ? JSON.stringify(validationDetails) : null,
            testResponse: testResponse ? JSON.stringify(testResponse) : null,
            updatedAt: new Date(),
          })
          .where(eq(validationVotes.id, existingVote[0].id));
      } else {
        // Create new vote
        await db
          .insert(validationVotes)
          .values({
            serviceId,
            userAddress,
            vote,
            reason: invalidReason,
            validationDetails: validationDetails ? JSON.stringify(validationDetails) : null,
            testResponse: testResponse ? JSON.stringify(testResponse) : null,
            validationMode,
            testnetChain: detectedTestnetChain || null,
          });
      }
    } catch (dbError) {
      console.error('[Mark Validated API] Database error saving vote:', dbError);
      throw new Error('Database operation failed');
    }

    try {
      // Get vote counts
      const voteCounts = await db
        .select({
          validCount: sql<number>`COUNT(CASE WHEN ${validationVotes.vote} = 'valid' THEN 1 END)`,
          invalidCount: sql<number>`COUNT(CASE WHEN ${validationVotes.vote} = 'invalid' THEN 1 END)`,
        })
        .from(validationVotes)
        .where(eq(validationVotes.serviceId, serviceId));

      validCount = Number(voteCounts[0]?.validCount || 0);
      invalidCount = Number(voteCounts[0]?.invalidCount || 0);
    } catch (dbError) {
      console.error('[Mark Validated API] Database error getting vote counts:', dbError);
      throw new Error('Database operation failed');
    }

    // Calculate validation status based on votes
    if (validCount > invalidCount) {
      validationStatus = 'verified';
      validationScore = Math.min(100, 50 + (validCount * 10));
    } else if (invalidCount > validCount) {
      validationStatus = 'failed';
      validationScore = Math.max(0, 50 - (invalidCount * 10));
    } else if (validCount === invalidCount && validCount > 0) {
      validationStatus = 'disputed';
      validationScore = 50;
    }

    const validationResults = {
      testResponse: testResponse ? {
        status: testResponse.status,
        statusText: testResponse.statusText,
        time: testResponse.time,
        validation: testResponse.validation,
      } : null,
      validatedAt: new Date().toISOString(),
      validatedBy: userAddress,
      validationMode,
      vote,
      reason: invalidReason,
    };

    try {
      // Update or create validated service record
      existing = await db
        .select()
        .from(validatedServices)
        .where(eq(validatedServices.serviceId, serviceId))
        .limit(1);
    } catch (dbError) {
      console.error('[Mark Validated API] Database error checking existing service:', dbError);
      throw new Error('Database operation failed');
    }

    try {
      if (existing.length > 0) {
        // Update existing record
        await db
          .update(validatedServices)
          .set({
            validationStatus,
            validationScore,
            lastValidatedAt: new Date(),
            validVoteCount: validCount,
            invalidVoteCount: invalidCount,
            testnetChain: detectedTestnetChain || existing[0].testnetChain,
            lastValidatedByAddress: userAddress,
            validationMode,
            validationResults: JSON.stringify(validationResults),
            updatedAt: new Date(),
          })
          .where(eq(validatedServices.serviceId, serviceId));
      } else {
        // Create new record
        await db
          .insert(validatedServices)
          .values({
            serviceId,
            serviceName,
            validationStatus,
            validationScore,
            lastValidatedAt: new Date(),
            validVoteCount: validCount,
            invalidVoteCount: invalidCount,
            testnetChain: detectedTestnetChain || null,
            lastValidatedByAddress: userAddress,
            validationMode,
            validationResults: JSON.stringify(validationResults),
          });
      }
    } catch (dbError) {
      console.error('[Mark Validated API] Database error updating service record:', dbError);
      throw new Error('Database operation failed');
    }

    return NextResponse.json({
      success: true,
      message: `Service marked as ${vote} successfully`,
      serviceId,
      vote,
      validationStatus,
      validationScore,
      validVoteCount: validCount,
      invalidVoteCount: invalidCount,
    }, { status: 200 });
  } catch (error) {
    // Log full error details to backend console only
    console.error('[Mark Validated API] Error:', error);
    if (error instanceof Error) {
      console.error('[Mark Validated API] Error stack:', error.stack);
      // Log any database-specific error details
      if ((error as any).query) {
        console.error('[Mark Validated API] Failed query:', (error as any).query);
        console.error('[Mark Validated API] Query params:', (error as any).params);
      }
      if ((error as any).cause) {
        console.error('[Mark Validated API] Error cause:', (error as any).cause);
      }
    }
    
    // Return generic error message to frontend (no sensitive details)
    return NextResponse.json(
      {
        error: 'Failed to save validation. Please try again later.',
      },
      { status: 500 }
    );
  }
}

