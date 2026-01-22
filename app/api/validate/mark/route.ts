import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

/**
 * POST /api/validate/mark
 * Mark a service as valid or invalid (vote system - multiple users can vote)
 */
export async function POST(request: NextRequest) {
  try {
    // Check if Supabase is configured
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return NextResponse.json(
        { 
          error: 'Supabase not configured',
          details: 'Please set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables',
        },
        { status: 503 }
      );
    }

    const supabase = createSupabaseAdminClient();

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
    if (!service) {
      return NextResponse.json(
        { error: 'Service data is required' },
        { status: 400 }
      );
    }

    // Use the service's actual serviceId from the service object (backend-generated)
    // This ensures consistency with the database
    const actualServiceId = service.serviceId || service.id || serviceId;
    
    if (!actualServiceId) {
      return NextResponse.json(
        { error: 'Service ID is required. Service object must have serviceId or id field.' },
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

    let existingVote;
    let validCount = 0;
    let invalidCount = 0;
    let validationStatus: 'verified' | 'failed' | 'pending' | 'disputed' = 'pending';
    let validationScore = 0;
    let existing;

    // Check if user already voted
    const { data: existingVoteData, error: voteCheckError } = await supabase
      .from('validation_votes')
      .select('*')
      .eq('service_id', actualServiceId)
      .eq('user_address', userAddress)
      .limit(1)
      .maybeSingle();

    if (voteCheckError && !voteCheckError.message.includes('relation') && !voteCheckError.message.includes('does not exist')) {
      console.error('[Mark Validated API] Database error checking existing vote:', voteCheckError);
      throw new Error('Database operation failed');
    }

    existingVote = existingVoteData ? [existingVoteData] : [];

    // Insert or update vote
    if (existingVote.length > 0) {
      // Update existing vote
      const { error: updateError } = await supabase
        .from('validation_votes')
        .update({
          vote,
          reason: invalidReason || null,
          validation_details: validationDetails ? JSON.stringify(validationDetails) : null,
          test_response: testResponse ? JSON.stringify(testResponse) : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingVote[0].id);

      if (updateError) {
        console.error('[Mark Validated API] Database error updating vote:', updateError);
        throw new Error('Database operation failed');
      }
    } else {
      // Create new vote
      const { error: insertError } = await supabase
        .from('validation_votes')
        .insert({
          service_id: actualServiceId,
          user_address: userAddress,
          vote,
          reason: invalidReason || null,
          validation_details: validationDetails ? JSON.stringify(validationDetails) : null,
          test_response: testResponse ? JSON.stringify(testResponse) : null,
          validation_mode: validationMode,
          testnet_chain: detectedTestnetChain || null,
        });

      if (insertError) {
        console.error('[Mark Validated API] Database error inserting vote:', insertError);
        throw new Error('Database operation failed');
      }
    }

    // Get vote counts
    const { data: allVotes, error: votesError } = await supabase
      .from('validation_votes')
      .select('vote')
      .eq('service_id', actualServiceId);

    if (votesError) {
      console.error('[Mark Validated API] Database error getting vote counts:', votesError);
      throw new Error('Database operation failed');
    }

    validCount = allVotes?.filter(v => v.vote === 'valid').length || 0;
    invalidCount = allVotes?.filter(v => v.vote === 'invalid').length || 0;

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

    // Check existing validated service record
    const { data: existingService, error: serviceCheckError } = await supabase
      .from('validated_services')
      .select('*')
      .eq('service_id', actualServiceId)
      .limit(1)
      .maybeSingle();

    if (serviceCheckError && !serviceCheckError.message.includes('relation') && !serviceCheckError.message.includes('does not exist')) {
      console.error('[Mark Validated API] Database error checking existing service:', serviceCheckError);
      throw new Error('Database operation failed');
    }

    existing = existingService ? [existingService] : [];

    // Update or create validated service record
    if (existing.length > 0) {
      // Update existing record
      const { error: updateError } = await supabase
        .from('validated_services')
        .update({
          validation_status: validationStatus,
          validation_score: validationScore,
          last_validated_at: new Date().toISOString(),
          valid_vote_count: validCount,
          invalid_vote_count: invalidCount,
          testnet_chain: detectedTestnetChain || existing[0].testnet_chain || null,
          last_validated_by_address: userAddress,
          validation_mode: validationMode,
          validation_results: JSON.stringify(validationResults),
          updated_at: new Date().toISOString(),
        })
        .eq('service_id', actualServiceId);

      if (updateError) {
        console.error('[Mark Validated API] Database error updating service record:', updateError);
        throw new Error('Database operation failed');
      }
    } else {
      // Create new record
      const { error: insertError } = await supabase
        .from('validated_services')
        .insert({
          service_id: actualServiceId,
          service_name: serviceName,
          validation_status: validationStatus,
          validation_score: validationScore,
          last_validated_at: new Date().toISOString(),
          valid_vote_count: validCount,
          invalid_vote_count: invalidCount,
          testnet_chain: detectedTestnetChain || null,
          last_validated_by_address: userAddress,
          validation_mode: validationMode,
          validation_results: JSON.stringify(validationResults),
        });

      if (insertError) {
        console.error('[Mark Validated API] Database error inserting service record:', insertError);
        throw new Error('Database operation failed');
      }
    }

    return NextResponse.json({
      success: true,
      message: `Service marked as ${vote} successfully`,
      serviceId: actualServiceId,
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

