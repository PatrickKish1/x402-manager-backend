/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

/**
 * GET /api/x402/services/:serviceId
 * Get a single x402 service by service ID with validation info and votes
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
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
        },
        { status: 503 }
      );
    }

    const resolvedParams = await params;
    const serviceId = decodeURIComponent(resolvedParams.serviceId);

    // Create Supabase admin client
    const supabase = createSupabaseAdminClient();

    // Get service from discovered_services
    const { data: service, error: serviceError } = await supabase
      .from('discovered_services')
      .select('*')
      .eq('service_id', serviceId)
      .single();

    if (serviceError || !service) {
      // Try finding by resource URL if service_id doesn't match
      const { data: serviceByResource } = await supabase
        .from('discovered_services')
        .select('*')
        .eq('resource', serviceId)
        .single();

      if (!serviceByResource) {
        return NextResponse.json(
          {
            success: false,
            error: 'Service not found',
            message: `Service with ID '${serviceId}' not found`,
          },
          { status: 404 }
        );
      }
      
      // Use service found by resource
      const tempService = serviceByResource;
      
      // Get validation info
      const { data: validatedService } = await supabase
        .from('validated_services')
        .select('*')
        .eq('service_id', tempService.service_id)
        .single();

      // Get validation votes
      const { data: votes } = await supabase
        .from('validation_votes')
        .select('*')
        .eq('service_id', tempService.service_id)
        .order('created_at', { ascending: false });

      // Parse JSON fields
      const metadata = tempService.metadata ? JSON.parse(tempService.metadata) : {};
      const accepts = tempService.accepts ? JSON.parse(tempService.accepts) : [];
      const tags = tempService.tags ? JSON.parse(tempService.tags) : [];

      return NextResponse.json(
        {
          success: true,
          service: {
            id: tempService.service_id,
            serviceId: tempService.service_id,
            resource: tempService.resource,
            type: tempService.type,
            x402Version: tempService.x402_version,
            lastUpdated: tempService.last_updated,
            metadata: {
              ...metadata,
              name: tempService.name,
              description: tempService.description,
              tags: tags,
            },
            accepts: accepts,
            payment: accepts[0] ? {
              asset: accepts[0].asset,
              network: accepts[0].network,
              maxAmountRequired: accepts[0].maxAmountRequired,
              maxTimeoutSeconds: accepts[0].maxTimeoutSeconds,
              scheme: accepts[0].scheme,
              payTo: accepts[0].payTo,
            } : null,
            network: tempService.network,
            price: tempService.price,
            syncedAt: tempService.synced_at,
            createdAt: tempService.created_at,
            updatedAt: tempService.updated_at,
            validation: validatedService ? {
              status: validatedService.validation_status,
              score: validatedService.validation_score,
              lastValidatedAt: validatedService.last_validated_at,
              validVoteCount: validatedService.valid_vote_count,
              invalidVoteCount: validatedService.invalid_vote_count,
              lastValidatedByAddress: validatedService.last_validated_by_address,
              validationMode: validatedService.validation_mode,
              testnetChain: validatedService.testnet_chain,
              validationResults: validatedService.validation_results 
                ? JSON.parse(validatedService.validation_results) 
                : null,
            } : null,
            votes: (votes || []).map((vote: any) => ({
              userAddress: vote.user_address,
              vote: vote.vote,
              reason: vote.reason,
              validationDetails: vote.validation_details 
                ? JSON.parse(vote.validation_details) 
                : null,
              testResponse: vote.test_response 
                ? JSON.parse(vote.test_response) 
                : null,
              validationMode: vote.validation_mode,
              testnetChain: vote.testnet_chain,
              createdAt: vote.created_at,
              updatedAt: vote.updated_at,
            })),
          },
        },
        {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        }
      );
    }

    // Get validation info
    const { data: validatedService } = await supabase
      .from('validated_services')
      .select('*')
      .eq('service_id', serviceId)
      .single();

    // Get validation votes
    const { data: votes } = await supabase
      .from('validation_votes')
      .select('*')
      .eq('service_id', serviceId)
      .order('created_at', { ascending: false });

    // Parse JSON fields
    const metadata = service.metadata ? JSON.parse(service.metadata) : {};
    const accepts = service.accepts ? JSON.parse(service.accepts) : [];
    const tags = service.tags ? JSON.parse(service.tags) : [];
    let outputSchema = null;
    if (service.output_schema) {
      try {
        outputSchema = JSON.parse(service.output_schema);
      } catch (error) {
        console.error(`[X402 Services] Error parsing output schema for ${serviceId}:`, error);
      }
    }

    return NextResponse.json(
      {
        success: true,
        service: {
          id: service.service_id,
          serviceId: service.service_id,
          resource: service.resource,
          type: service.type,
          x402Version: service.x402_version,
          lastUpdated: service.last_updated,
          metadata: {
            ...metadata,
            name: service.name,
            description: service.description,
            tags: tags,
          },
          accepts: accepts,
          payment: accepts[0] ? {
            asset: accepts[0].asset,
            network: accepts[0].network,
            maxAmountRequired: accepts[0].maxAmountRequired,
            maxTimeoutSeconds: accepts[0].maxTimeoutSeconds,
            scheme: accepts[0].scheme,
            payTo: accepts[0].payTo,
          } : null,
          network: service.network,
          price: service.price,
          outputSchema: outputSchema, // Inferred from successful validations
          syncedAt: service.synced_at,
          createdAt: service.created_at,
          updatedAt: service.updated_at,
          validation: validatedService ? {
            status: validatedService.validation_status,
            score: validatedService.validation_score,
            lastValidatedAt: validatedService.last_validated_at,
            validVoteCount: validatedService.valid_vote_count,
            invalidVoteCount: validatedService.invalid_vote_count,
            lastValidatedByAddress: validatedService.last_validated_by_address,
            validationMode: validatedService.validation_mode,
            testnetChain: validatedService.testnet_chain,
            validationResults: validatedService.validation_results 
              ? JSON.parse(validatedService.validation_results) 
              : null,
          } : null,
          votes: (votes || []).map((vote: any) => ({
            userAddress: vote.user_address,
            vote: vote.vote,
            reason: vote.reason,
            validationDetails: vote.validation_details 
              ? JSON.parse(vote.validation_details) 
              : null,
            testResponse: vote.test_response 
              ? JSON.parse(vote.test_response) 
              : null,
            validationMode: vote.validation_mode,
            testnetChain: vote.testnet_chain,
            createdAt: vote.created_at,
            updatedAt: vote.updated_at,
          })),
        },
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      }
    );
  } catch (error: any) {
    console.error('[X402 Service Detail API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch service',
      },
      { 
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

