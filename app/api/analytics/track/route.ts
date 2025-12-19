// Analytics Tracking API Route
// POST /api/analytics/track

import { NextRequest, NextResponse } from 'next/server';
import { analyticsService, AnalyticsCall } from '@/lib/services/analytics.service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    const requiredFields = ['serviceId', 'serviceName', 'endpoint', 'payerAddress', 'amount', 'statusCode'];
    for (const field of requiredFields) {
      if (!body[field]) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { 
            status: 400,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type',
            },
          }
        );
      }
    }

    const call: AnalyticsCall = {
      serviceId: body.serviceId,
      serviceName: body.serviceName,
      endpoint: body.endpoint,
      method: body.method || 'GET',
      payerAddress: body.payerAddress,
      amount: body.amount, // Amount in smallest unit
      amountFormatted: body.amountFormatted || body.amount / 1000000, // Convert to human-readable
      network: body.network || 'base',
      transactionHash: body.transactionHash,
      responseTime: body.responseTime,
      statusCode: body.statusCode,
      error: body.error,
    };

    // Record the call (non-blocking)
    analyticsService.recordCall(call).catch((error) => {
      console.error('Error recording analytics (non-blocking):', error);
    });

    return NextResponse.json(
      { success: true, message: 'Analytics recorded' },
      { 
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      }
    );
  } catch (error) {
    console.error('Error in analytics tracking:', error);
    // Never expose internal errors to frontend
    return NextResponse.json(
      { success: false, error: 'Unable to record analytics. Your request was still processed.' },
      { 
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

