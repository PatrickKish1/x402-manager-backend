// Abuse Prevention System - Rate limiting and budget controls
import { db } from '../database/client';
import { validationRequests } from '../database/schema';
import { eq, and, gte, sql } from 'drizzle-orm';

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
  if (!db) {
    return { allowed: true }; // Fail open if DB unavailable
  }

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
  const oneDayAgo = new Date(Date.now() - 86400000);

  const validations = await db!
    .select()
    .from(validationRequests)
    .where(
      and(
        eq(validationRequests.requestedByAddress, userAddress),
        eq(validationRequests.validationMode, 'free'),
        gte(validationRequests.createdAt, oneDayAgo)
      )
    );

  if (validations.length >= LIMITS.FREE_VALIDATIONS_PER_DAY) {
    return {
      allowed: false,
      reason: `Daily limit reached (${LIMITS.FREE_VALIDATIONS_PER_DAY} free validations per day)`,
      retryAfter: getTimeUntilMidnight(),
      currentUsage: {
        userDailyValidations: validations.length,
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
  const oneWeekAgo = new Date(Date.now() - 7 * 86400000);

  const validations = await db!
    .select()
    .from(validationRequests)
    .where(
      and(
        eq(validationRequests.requestedByAddress, userAddress),
        eq(validationRequests.validationMode, 'free'),
        gte(validationRequests.createdAt, oneWeekAgo)
      )
    );

  if (validations.length >= LIMITS.FREE_VALIDATIONS_PER_WEEK) {
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
  const validations = await db!
    .select()
    .from(validationRequests)
    .where(eq(validationRequests.requestedByAddress, userAddress))
    .orderBy(sql`${validationRequests.createdAt} DESC`)
    .limit(1);

  if (validations.length > 0) {
    const lastValidation = validations[0];
    const timeSinceLastValidation = Date.now() - lastValidation.createdAt.getTime();
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
  const oneHourAgo = new Date(Date.now() - 3600000);

  const validations = await db!
    .select()
    .from(validationRequests)
    .where(
      and(
        eq(validationRequests.requestedByIp, ipAddress),
        gte(validationRequests.createdAt, oneHourAgo)
      )
    );

  if (validations.length >= LIMITS.REQUESTS_PER_HOUR) {
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
  const oneDayAgo = new Date(Date.now() - 86400000);

  const validations = await db!
    .select()
    .from(validationRequests)
    .where(
      and(
        eq(validationRequests.serviceId, serviceId),
        eq(validationRequests.validationMode, 'free'),
        gte(validationRequests.createdAt, oneDayAgo)
      )
    );

  if (validations.length >= LIMITS.FREE_VALIDATIONS_PER_SERVICE_PER_DAY) {
    return {
      allowed: false,
      reason: 'Service validation limit reached for today',
      retryAfter: getTimeUntilMidnight(),
    };
  }

  // Check if last validation was too recent
  if (validations.length > 0) {
    const lastValidation = validations[0];
    const timeSinceLastValidation = Date.now() - lastValidation.createdAt.getTime();
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
  const oneDayAgo = new Date(Date.now() - 86400000);

  const result = await db!
    .select({
      total: sql<number>`COALESCE(SUM(${validationRequests.tokensSpent}), 0)`,
    })
    .from(validationRequests)
    .where(
      and(
        eq(validationRequests.validationMode, 'free'),
        gte(validationRequests.createdAt, oneDayAgo)
      )
    );

  const totalSpent = result[0]?.total || 0;

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
  if (!db) {
    return {
      dailyValidations: 0,
      weeklyValidations: 0,
      monthlyValidations: 0,
      lastValidation: null,
    };
  }

  const oneDayAgo = new Date(Date.now() - 86400000);
  const oneWeekAgo = new Date(Date.now() - 7 * 86400000);
  const oneMonthAgo = new Date(Date.now() - 30 * 86400000);

  const [daily, weekly, monthly, last] = await Promise.all([
    db.select()
      .from(validationRequests)
      .where(
        and(
          eq(validationRequests.requestedByAddress, userAddress),
          eq(validationRequests.validationMode, 'free'),
          gte(validationRequests.createdAt, oneDayAgo)
        )
      ),
    db.select()
      .from(validationRequests)
      .where(
        and(
          eq(validationRequests.requestedByAddress, userAddress),
          eq(validationRequests.validationMode, 'free'),
          gte(validationRequests.createdAt, oneWeekAgo)
        )
      ),
    db.select()
      .from(validationRequests)
      .where(
        and(
          eq(validationRequests.requestedByAddress, userAddress),
          eq(validationRequests.validationMode, 'free'),
          gte(validationRequests.createdAt, oneMonthAgo)
        )
      ),
    db.select()
      .from(validationRequests)
      .where(eq(validationRequests.requestedByAddress, userAddress))
      .orderBy(sql`${validationRequests.createdAt} DESC`)
      .limit(1),
  ]);

  return {
    dailyValidations: daily.length,
    weeklyValidations: weekly.length,
    monthlyValidations: monthly.length,
    lastValidation: last[0]?.createdAt || null,
  };
}

