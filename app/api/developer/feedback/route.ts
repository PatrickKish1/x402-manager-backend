import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import crypto from 'crypto';

/**
 * GET /api/developer/feedback?resource=URL
 * Get validation feedback and scores for a service by resource URL
 */
export async function GET(request: NextRequest) {
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
    const { searchParams } = new URL(request.url);
    const resourceUrl = searchParams.get('resource');

    if (!resourceUrl) {
      return NextResponse.json(
        { error: 'Resource URL is required. Use ?resource=YOUR_API_ENDPOINT_URL' },
        { status: 400 }
      );
    }

    // Search for service by resource URL in discovered_services
    const { data: discoveredService, error: discoverError } = await supabase
      .from('discovered_services')
      .select('*')
      .ilike('resource', `%${resourceUrl}%`)
      .limit(10);

    if (discoverError && !discoverError.message.includes('relation') && !discoverError.message.includes('does not exist')) {
      console.error('[Developer Feedback API] Error searching services:', discoverError);
      return NextResponse.json(
        { error: 'Database error', details: discoverError.message },
        { status: 500 }
      );
    }

    if (!discoveredService || discoveredService.length === 0) {
      return NextResponse.json(
        { 
          error: 'Service not found',
          message: `No service found with resource URL matching: ${resourceUrl}`,
          suggestion: 'Make sure your API endpoint URL is registered in the x402 discovery system'
        },
        { status: 404 }
      );
    }

    // Get validation data for all matching services
    const servicesWithValidation = await Promise.all(
      discoveredService.map(async (service) => {
        const serviceId = service.service_id;

        // Get validated service record
        let { data: validatedService } = await supabase
          .from('validated_services')
          .select('*')
          .eq('service_id', serviceId)
          .maybeSingle();

        // If not found, try by resource hash (for legacy records)
        if (!validatedService) {
          const resourceHash = crypto.createHash('sha256').update(service.resource).digest('hex').substring(0, 16);
          const { data: validatedByHash } = await supabase
            .from('validated_services')
            .select('*')
            .eq('service_id', resourceHash)
            .maybeSingle();
          if (validatedByHash) {
            validatedService = validatedByHash;
          }
        }

        // Get all validation votes with feedback
        // Try by serviceId first (correct backend-generated ID)
        let { data: votes } = await supabase
          .from('validation_votes')
          .select('*')
          .eq('service_id', serviceId)
          .order('created_at', { ascending: false });

        // If no votes found, try searching by resource URL hash (for legacy votes)
        // This handles cases where votes were stored with frontend-generated serviceIds
        if (!votes || votes.length === 0) {
          const resourceHash = crypto.createHash('sha256').update(service.resource).digest('hex').substring(0, 16);
          const { data: votesByHash } = await supabase
            .from('validation_votes')
            .select('*')
            .eq('service_id', resourceHash)
            .order('created_at', { ascending: false });
          if (votesByHash && votesByHash.length > 0) {
            votes = votesByHash;
          }
        }

        // Get validation requests (test history)
        let { data: validationRequests } = await supabase
          .from('validation_requests')
          .select('*')
          .eq('service_id', serviceId)
          .order('created_at', { ascending: false })
          .limit(20);

        // If no requests found, try by resource hash (for legacy records)
        if (!validationRequests || validationRequests.length === 0) {
          const resourceHash = crypto.createHash('sha256').update(service.resource).digest('hex').substring(0, 16);
          const { data: requestsByHash } = await supabase
            .from('validation_requests')
            .select('*')
            .eq('service_id', resourceHash)
            .order('created_at', { ascending: false })
            .limit(20);
          if (requestsByHash && requestsByHash.length > 0) {
            validationRequests = requestsByHash;
          }
        }

        // Parse JSON fields
        const metadata = service.metadata ? JSON.parse(service.metadata) : {};
        const accepts = service.accepts ? JSON.parse(service.accepts) : [];
        const tags = service.tags ? JSON.parse(service.tags) : [];

        // Parse validation results
        let validationResults = null;
        if (validatedService?.validation_results) {
          try {
            validationResults = JSON.parse(validatedService.validation_results);
          } catch (e) {
            console.error('[Developer Feedback API] Error parsing validation_results:', e);
          }
        }

        // Process votes to extract feedback
        const feedback = votes
          ?.filter(vote => vote.vote === 'invalid' && vote.reason)
          .map(vote => ({
            userAddress: vote.user_address,
            reason: vote.reason,
            createdAt: vote.created_at,
            validationDetails: vote.validation_details ? JSON.parse(vote.validation_details) : null,
          })) || [];

        // Calculate statistics
        const validVotes = votes?.filter(v => v.vote === 'valid').length || 0;
        const invalidVotes = votes?.filter(v => v.vote === 'invalid').length || 0;
        const totalVotes = validVotes + invalidVotes;
        const approvalRate = totalVotes > 0 ? (validVotes / totalVotes) * 100 : 0;

        return {
          service: {
            serviceId,
            resource: service.resource,
            name: metadata.name || service.service_name || 'Unknown Service',
            description: metadata.description || '',
            tags: tags || [],
            accepts: accepts || [],
            lastUpdated: service.updated_at,
          },
          validation: validatedService ? {
            status: validatedService.validation_status,
            score: validatedService.validation_score || 0,
            validVoteCount: validatedService.valid_vote_count || 0,
            invalidVoteCount: validatedService.invalid_vote_count || 0,
            lastValidatedAt: validatedService.last_validated_at,
            testnetChain: validatedService.testnet_chain,
            validationResults,
          } : null,
          statistics: {
            totalVotes,
            validVotes,
            invalidVotes,
            approvalRate: Math.round(approvalRate * 100) / 100,
          },
          feedback,
          validationHistory: validationRequests?.map(req => ({
            requestedBy: req.requested_by_address,
            status: req.status,
            testnetChain: req.testnet_chain,
            createdAt: req.created_at,
            errorMessage: req.error_message,
            validationResults: req.validation_results ? JSON.parse(req.validation_results) : null,
          })) || [],
        };
      })
    );

    return NextResponse.json({
      success: true,
      count: servicesWithValidation.length,
      services: servicesWithValidation,
    }, { status: 200 });
  } catch (error) {
    console.error('[Developer Feedback API] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch developer feedback',
      },
      { status: 500 }
    );
  }
}
