import { NextRequest, NextResponse } from 'next/server';
import { validateService } from '@/lib/validator/engine';
import { checkAbuseLimit, getUserUsageStats } from '@/lib/validator/abuse-prevention';

/**
 * POST /api/validate
 * Validates an x402 service on testnet
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { serviceId, service, validationMode = 'free', userAddress, userSignature } = body;

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

    // Get IP address
    const ipAddress = request.headers.get('x-forwarded-for') || 
                      request.headers.get('x-real-ip') || 
                      'unknown';

    // Check abuse limits
    const abuseCheck = await checkAbuseLimit({
      userAddress,
      ipAddress,
      serviceId,
      validationMode,
    });

    if (!abuseCheck.allowed) {
      return NextResponse.json(
        {
          error: abuseCheck.reason,
          retryAfter: abuseCheck.retryAfter,
          currentUsage: abuseCheck.currentUsage,
        },
        { status: 429 }
      );
    }

    // Perform validation
    const result = await validateService({
      serviceId,
      service,
      validationMode,
      userAddress,
      userSignature,
      ipAddress,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error('[Validate API] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Validation failed',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/validate?userAddress=0x...
 * Get validation usage stats for a user
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userAddress = searchParams.get('userAddress');

    if (!userAddress) {
      return NextResponse.json(
        { error: 'User address is required' },
        { status: 400 }
      );
    }

    const stats = await getUserUsageStats(userAddress);

    return NextResponse.json({
      usage: stats,
      limits: {
        daily: 5,
        weekly: 20,
        monthly: 50,
      },
      remaining: {
        daily: Math.max(0, 5 - stats.dailyValidations),
        weekly: Math.max(0, 20 - stats.weeklyValidations),
        monthly: Math.max(0, 50 - stats.monthlyValidations),
      },
    }, { status: 200 });
  } catch (error) {
    console.error('[Validate API GET] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch usage stats',
      },
      { status: 500 }
    );
  }
}

