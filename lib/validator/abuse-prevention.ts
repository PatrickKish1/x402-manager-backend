// Abuse Prevention System - Rate limiting and budget controls
import { createSupabaseAdminClient } from '../supabase/server';

export interface AbuseCheckRequest {
  userAddress: string;
  ipAddress?: string;
  serviceId: string;
  validationMode: 'free' | 'user-paid';
}

export interface AbuseCheckResult {
  allowed: boolean;
  reason?: string;
  retryAfter?: number; // seconds until can retry
  currentUsage?: {
    userDailyValidations: number;
    userWeeklyValidations: number;
    ipHourlyValidations: number;
    serviceDailyValidations: number;
    dailyBudgetSpent: number;
  };
}

// Configuration
const LIMITS = {
  // Per User Limits
  FREE_VALIDATIONS_PER_DAY: 5,
  FREE_VALIDATIONS_PER_WEEK: 20,
  FREE_VALIDATIONS_PER_MONTH: 50,
  COOLDOWN_BETWEEN_REQUESTS: 300, // 5 minutes in seconds

  // Per IP Limits
  REQUESTS_PER_HOUR: 10,
  REQUESTS_PER_DAY: 30,

  // Per Service Limits
  FREE_VALIDATIONS_PER_SERVICE_PER_DAY: 100,
  MIN_TIME_BETWEEN_SERVICE_VALIDATIONS: 3600, // 1 hour in seconds

  // Cost Limits
  MAX_TOKENS_PER_REQUEST: 10000000, // 10 USDC max per request
  DAILY_BUDGET: 100000000, // 100 USDC per day
  ALERT_THRESHOLD: 50000000, // Alert at 50 USDC per day
};

/**
 * Check if validation request should be allowed
 */
export async function checkAbuseLimit(request: AbuseCheckRequest): Promise<AbuseCheckResult> {
  const supabase = createSupabaseAdminClient();

  // Skip abuse checks for user-paid validations
  if (request.validationMode === 'user-paid') {
    return { allowed: true };
  }

  try {
    // 1. Check user daily limit
    const userDailyCheck = await checkUserDailyLimit(request.userAddress);
    if (!userDailyCheck.allowed) {
      return userDailyCheck;
    }

    // 2. Check user weekly limit
    const userWeeklyCheck = await checkUserWeeklyLimit(request.userAddress);
    if (!userWeeklyCheck.allowed) {
      return userWeeklyCheck;
    }

    // 3. Check cooldown period
    const cooldownCheck = await checkCooldownPeriod(request.userAddress);
    if (!cooldownCheck.allowed) {
      return cooldownCheck;
    }

    // 4. Check IP rate limit (if IP provided)
    if (request.ipAddress) {
      const ipCheck = await checkIpRateLimit(request.ipAddress);
      if (!ipCheck.allowed) {
        return ipCheck;
      }
    }

    // 5. Check service validation limit
    const serviceCheck = await checkServiceLimit(request.serviceId);
    if (!serviceCheck.allowed) {
      return serviceCheck;
    }

    // 6. Check daily budget
    const budgetCheck = await checkDailyBudget();
    if (!budgetCheck.allowed) {
      return budgetCheck;
    }

    // All checks passed
    return { allowed: true };
  } catch (error) {
    console.error('[Abuse Prevention] Error:', error);
    return { allowed: true }; // Fail open on error
  }
}

/**
 * Check user daily validation limit
 */
async function checkUserDailyLimit(userAddress: string): Promise<AbuseCheckResult> {
  const supabase = createSupabaseAdminClient();
  const oneDayAgo = new Date(Date.now() - 86400000).toISOString();

  const { data: validations, error } = await supabase
    .from('validation_requests')
    .select('*')
    .eq('requested_by_address', userAddress)
    .eq('validation_mode', 'free')
    .gte('created_at', oneDayAgo);

  if (error) {
    console.error('[Abuse Prevention] Error checking daily limit:', error);
    return { allowed: true }; // Fail open
  }

  if ((validations?.length || 0) >= LIMITS.FREE_VALIDATIONS_PER_DAY) {
    return {
      allowed: false,
      reason: `Daily limit reached (${LIMITS.FREE_VALIDATIONS_PER_DAY} free validations per day)`,
      retryAfter: getTimeUntilMidnight(),
      currentUsage: {
        userDailyValidations: validations?.length || 0,
        userWeeklyValidations: 0,
        ipHourlyValidations: 0,
        serviceDailyValidations: 0,
        dailyBudgetSpent: 0,
      },
    };
  }

  return { allowed: true };
}

/**
 * Check user weekly validation limit
 */
async function checkUserWeeklyLimit(userAddress: string): Promise<AbuseCheckResult> {
  const supabase = createSupabaseAdminClient();
  const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const { data: validations, error } = await supabase
    .from('validation_requests')
    .select('*')
    .eq('requested_by_address', userAddress)
    .eq('validation_mode', 'free')
    .gte('created_at', oneWeekAgo);

  if (error) {
    console.error('[Abuse Prevention] Error checking weekly limit:', error);
    return { allowed: true }; // Fail open
  }

  if ((validations?.length || 0) >= LIMITS.FREE_VALIDATIONS_PER_WEEK) {
    return {
      allowed: false,
      reason: `Weekly limit reached (${LIMITS.FREE_VALIDATIONS_PER_WEEK} free validations per week)`,
      retryAfter: getTimeUntilNextWeek(),
    };
  }

  return { allowed: true };
}

/**
 * Check cooldown period between validations
 */
async function checkCooldownPeriod(userAddress: string): Promise<AbuseCheckResult> {
  const supabase = createSupabaseAdminClient();

  const { data: validations, error } = await supabase
    .from('validation_requests')
    .select('*')
    .eq('requested_by_address', userAddress)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('[Abuse Prevention] Error checking cooldown:', error);
    return { allowed: true }; // Fail open
  }

  if (validations && validations.length > 0) {
    const lastValidation = validations[0];
    const lastValidationTime = new Date(lastValidation.created_at).getTime();
    const timeSinceLastValidation = Date.now() - lastValidationTime;
    const cooldownPeriod = LIMITS.COOLDOWN_BETWEEN_REQUESTS * 1000;

    if (timeSinceLastValidation < cooldownPeriod) {
      const retryAfter = Math.ceil((cooldownPeriod - timeSinceLastValidation) / 1000);
      return {
        allowed: false,
        reason: `Please wait ${retryAfter} seconds before next validation`,
        retryAfter,
      };
    }
  }

  return { allowed: true };
}

/**
 * Check IP rate limit
 */
async function checkIpRateLimit(ipAddress: string): Promise<AbuseCheckResult> {
  const supabase = createSupabaseAdminClient();
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();

  const { data: validations, error } = await supabase
    .from('validation_requests')
    .select('*')
    .eq('requested_by_ip', ipAddress)
    .gte('created_at', oneHourAgo);

  if (error) {
    console.error('[Abuse Prevention] Error checking IP limit:', error);
    return { allowed: true }; // Fail open
  }

  if ((validations?.length || 0) >= LIMITS.REQUESTS_PER_HOUR) {
    return {
      allowed: false,
      reason: 'Too many requests from your IP address',
      retryAfter: 3600,
    };
  }

  return { allowed: true };
}

/**
 * Check service validation limit
 */
async function checkServiceLimit(serviceId: string): Promise<AbuseCheckResult> {
  const supabase = createSupabaseAdminClient();
  const oneDayAgo = new Date(Date.now() - 86400000).toISOString();

  const { data: validations, error } = await supabase
    .from('validation_requests')
    .select('*')
    .eq('service_id', serviceId)
    .eq('validation_mode', 'free')
    .gte('created_at', oneDayAgo)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[Abuse Prevention] Error checking service limit:', error);
    return { allowed: true }; // Fail open
  }

  if ((validations?.length || 0) >= LIMITS.FREE_VALIDATIONS_PER_SERVICE_PER_DAY) {
    return {
      allowed: false,
      reason: 'Service validation limit reached for today',
      retryAfter: getTimeUntilMidnight(),
    };
  }

  // Check if last validation was too recent
  if (validations && validations.length > 0) {
    const lastValidation = validations[0];
    const lastValidationTime = new Date(lastValidation.created_at).getTime();
    const timeSinceLastValidation = Date.now() - lastValidationTime;
    const minTimeBetween = LIMITS.MIN_TIME_BETWEEN_SERVICE_VALIDATIONS * 1000;

    if (timeSinceLastValidation < minTimeBetween) {
      const retryAfter = Math.ceil((minTimeBetween - timeSinceLastValidation) / 1000);
      return {
        allowed: false,
        reason: `This service was recently validated. Please wait ${Math.ceil(retryAfter / 60)} minutes`,
        retryAfter,
      };
    }
  }

  return { allowed: true };
}

/**
 * Check daily budget limit
 */
async function checkDailyBudget(): Promise<AbuseCheckResult> {
  const supabase = createSupabaseAdminClient();
  const oneDayAgo = new Date(Date.now() - 86400000).toISOString();

  const { data: validations, error } = await supabase
    .from('validation_requests')
    .select('tokens_spent')
    .eq('validation_mode', 'free')
    .gte('created_at', oneDayAgo);

  if (error) {
    console.error('[Abuse Prevention] Error checking daily budget:', error);
    return { allowed: true }; // Fail open
  }

  const totalSpent = validations?.reduce((sum, v) => sum + (v.tokens_spent || 0), 0) || 0;

  // Alert if approaching threshold
  if (totalSpent >= LIMITS.ALERT_THRESHOLD) {
    console.warn(
      `[Abuse Prevention] ALERT: Daily validation budget at ${(totalSpent / LIMITS.DAILY_BUDGET * 100).toFixed(1)}%`
    );
  }

  if (totalSpent >= LIMITS.DAILY_BUDGET) {
    return {
      allowed: false,
      reason: 'Daily validation budget exhausted. Please try again tomorrow',
      retryAfter: getTimeUntilMidnight(),
    };
  }

  return { allowed: true };
}

/**
 * Get seconds until midnight UTC
 */
function getTimeUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  return Math.ceil((midnight.getTime() - now.getTime()) / 1000);
}

/**
 * Get seconds until next week (Monday 00:00 UTC)
 */
function getTimeUntilNextWeek(): number {
  const now = new Date();
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
  const nextMonday = new Date(now);
  nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday);
  nextMonday.setUTCHours(0, 0, 0, 0);
  return Math.ceil((nextMonday.getTime() - now.getTime()) / 1000);
}

/**
 * Get current usage statistics for a user
 */
export async function getUserUsageStats(userAddress: string): Promise<{
  dailyValidations: number;
  weeklyValidations: number;
  monthlyValidations: number;
  lastValidation: Date | null;
}> {
  const supabase = createSupabaseAdminClient();
  const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
  const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const oneMonthAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const [dailyResult, weeklyResult, monthlyResult, lastResult] = await Promise.all([
    supabase
      .from('validation_requests')
      .select('*', { count: 'exact' })
      .eq('requested_by_address', userAddress)
      .eq('validation_mode', 'free')
      .gte('created_at', oneDayAgo),
    supabase
      .from('validation_requests')
      .select('*', { count: 'exact' })
      .eq('requested_by_address', userAddress)
      .eq('validation_mode', 'free')
      .gte('created_at', oneWeekAgo),
    supabase
      .from('validation_requests')
      .select('*', { count: 'exact' })
      .eq('requested_by_address', userAddress)
      .eq('validation_mode', 'free')
      .gte('created_at', oneMonthAgo),
    supabase
      .from('validation_requests')
      .select('created_at')
      .eq('requested_by_address', userAddress)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
  ]);

  return {
    dailyValidations: dailyResult.count || 0,
    weeklyValidations: weeklyResult.count || 0,
    monthlyValidations: monthlyResult.count || 0,
    lastValidation: lastResult.data?.created_at ? new Date(lastResult.data.created_at) : null,
  };
}

