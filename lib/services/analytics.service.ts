// Analytics Service
// Handles tracking and querying of API call analytics

import { db } from '../database/client';
import { apiCalls, serviceStats, userStats, endpointStats, dailyStats } from '../database/schema';
import { eq, and, gte, desc, sql, count } from 'drizzle-orm';

export interface AnalyticsCall {
  serviceId: string;
  serviceName: string;
  endpoint: string;
  method: string;
  payerAddress: string;
  amount: number;
  amountFormatted: number;
  network: string;
  transactionHash?: string;
  responseTime?: number;
  statusCode: number;
  error?: string;
}

export interface ServiceAnalytics {
  serviceId: string;
  serviceName: string;
  timeRange: string;
  metrics: {
    totalCalls: number;
    totalRevenue: number;
    avgResponseTime: number;
    uptime: number;
    errorRate: number;
    uniqueUsers: number;
  };
  callsByEndpoint: Array<{
    endpoint: string;
    calls: number;
    revenue: number;
    avgTime: number;
  }>;
  callsOverTime: Array<{
    date: string;
    calls: number;
    revenue: number;
  }>;
  topUsers: Array<{
    address: string;
    calls: number;
    revenue: number;
  }>;
}

export class AnalyticsService {
  private static instance: AnalyticsService;

  static getInstance(): AnalyticsService {
    if (!AnalyticsService.instance) {
      AnalyticsService.instance = new AnalyticsService();
    }
    return AnalyticsService.instance;
  }

  /**
   * Record an API call for analytics
   */
  async recordCall(call: AnalyticsCall): Promise<void> {
    if (!db) {
      console.warn('[Analytics] Database not available, skipping analytics recording');
      return;
    }

    try {
      const timestamp = new Date();
      const dateStr = timestamp.toISOString().split('T')[0]; // YYYY-MM-DD

      // Insert into api_calls table
      await db.insert(apiCalls).values({
        serviceId: call.serviceId,
        serviceName: call.serviceName,
        endpoint: call.endpoint,
        method: call.method,
        payerAddress: call.payerAddress,
        amount: call.amount,
        amountFormatted: call.amountFormatted,
        network: call.network,
        transactionHash: call.transactionHash,
        responseTime: call.responseTime,
        statusCode: call.statusCode,
        error: call.error,
        timestamp: timestamp,
      });

      // Update aggregated stats
      await this.updateServiceStats(call, timestamp);
      await this.updateUserStats(call, timestamp);
      await this.updateEndpointStats(call, timestamp);
      await this.updateDailyStats(call, dateStr, timestamp);
    } catch (error) {
      console.error('Error recording API call:', error);
      // Don't throw - analytics failures shouldn't break the API
    }
  }

  /**
   * Update service-level statistics
   */
  private async updateServiceStats(call: AnalyticsCall, timestamp: Date): Promise<void> {
    if (!db) return;

    const existing = await db
      .select()
      .from(serviceStats)
      .where(eq(serviceStats.serviceId, call.serviceId))
      .limit(1);

    if (existing.length > 0) {
      const stats = existing[0];
      const newTotalCalls = stats.totalCalls + 1;
      const newTotalRevenue = stats.totalRevenue + call.amount;
      const newAvgResponseTime = call.responseTime
        ? Math.round((stats.avgResponseTime * stats.totalCalls + call.responseTime) / newTotalCalls)
        : stats.avgResponseTime;
      const newErrorCount = call.statusCode >= 400 ? stats.errorCount + 1 : stats.errorCount;

      // Check if this is a new user
      const userExists = await db
        .select()
        .from(userStats)
        .where(
          and(
            eq(userStats.serviceId, call.serviceId),
            eq(userStats.userAddress, call.payerAddress)
          )
        )
        .limit(1);

      const newUniqueUsers = userExists.length === 0 ? stats.uniqueUsers + 1 : stats.uniqueUsers;

      await db
        .update(serviceStats)
        .set({
          totalCalls: newTotalCalls,
          totalRevenue: newTotalRevenue,
          totalRevenueFormatted: newTotalRevenue / 1000000,
          avgResponseTime: newAvgResponseTime,
          errorCount: newErrorCount,
          uniqueUsers: newUniqueUsers,
          lastCallAt: timestamp,
          updatedAt: new Date(),
        })
        .where(eq(serviceStats.serviceId, call.serviceId));
    } else {
      await db.insert(serviceStats).values({
        serviceId: call.serviceId,
        serviceName: call.serviceName,
        totalCalls: 1,
        totalRevenue: call.amount,
        totalRevenueFormatted: call.amount / 1000000,
        avgResponseTime: call.responseTime || 0,
        errorCount: call.statusCode >= 400 ? 1 : 0,
        uniqueUsers: 1,
        lastCallAt: timestamp,
      });
    }
  }

  /**
   * Update user-level statistics
   */
  private async updateUserStats(call: AnalyticsCall, timestamp: Date): Promise<void> {
    if (!db) return;

    const existing = await db
      .select()
      .from(userStats)
      .where(
        and(
          eq(userStats.serviceId, call.serviceId),
          eq(userStats.userAddress, call.payerAddress)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      const stats = existing[0];
      await db
        .update(userStats)
        .set({
          totalCalls: stats.totalCalls + 1,
          totalRevenue: stats.totalRevenue + call.amount,
          totalRevenueFormatted: (stats.totalRevenue + call.amount) / 1000000,
          lastCallAt: timestamp,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(userStats.serviceId, call.serviceId),
            eq(userStats.userAddress, call.payerAddress)
          )
        );
    } else {
      await db.insert(userStats).values({
        serviceId: call.serviceId,
        userAddress: call.payerAddress,
        totalCalls: 1,
        totalRevenue: call.amount,
        totalRevenueFormatted: call.amount / 1000000,
        firstCallAt: timestamp,
        lastCallAt: timestamp,
      });
    }
  }

  /**
   * Update endpoint-level statistics
   */
  private async updateEndpointStats(call: AnalyticsCall, timestamp: Date): Promise<void> {
    if (!db) return;

    const existing = await db
      .select()
      .from(endpointStats)
      .where(
        and(
          eq(endpointStats.serviceId, call.serviceId),
          eq(endpointStats.endpoint, call.endpoint),
          eq(endpointStats.method, call.method)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      const stats = existing[0];
      const newTotalCalls = stats.totalCalls + 1;
      const newAvgResponseTime = call.responseTime
        ? Math.round((stats.avgResponseTime * stats.totalCalls + call.responseTime) / newTotalCalls)
        : stats.avgResponseTime;

      await db
        .update(endpointStats)
        .set({
          totalCalls: newTotalCalls,
          totalRevenue: stats.totalRevenue + call.amount,
          totalRevenueFormatted: (stats.totalRevenue + call.amount) / 1000000,
          avgResponseTime: newAvgResponseTime,
          errorCount: call.statusCode >= 400 ? stats.errorCount + 1 : stats.errorCount,
          lastCallAt: timestamp,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(endpointStats.serviceId, call.serviceId),
            eq(endpointStats.endpoint, call.endpoint),
            eq(endpointStats.method, call.method)
          )
        );
    } else {
      await db.insert(endpointStats).values({
        serviceId: call.serviceId,
        endpoint: call.endpoint,
        method: call.method,
        totalCalls: 1,
        totalRevenue: call.amount,
        totalRevenueFormatted: call.amount / 1000000,
        avgResponseTime: call.responseTime || 0,
        errorCount: call.statusCode >= 400 ? 1 : 0,
        lastCallAt: timestamp,
      });
    }
  }

  /**
   * Update daily statistics
   */
  private async updateDailyStats(call: AnalyticsCall, dateStr: string, timestamp: Date): Promise<void> {
    if (!db) return;

    const existing = await db
      .select()
      .from(dailyStats)
      .where(
          and(eq(dailyStats.serviceId, call.serviceId), eq(dailyStats.date, dateStr))
      )
      .limit(1);

    if (existing.length > 0) {
      const stats = existing[0];
      const newTotalCalls = stats.totalCalls + 1;
      const newAvgResponseTime = call.responseTime
        ? Math.round((stats.avgResponseTime * stats.totalCalls + call.responseTime) / newTotalCalls)
        : stats.avgResponseTime;

      // Check if this is a new user for today
      const userExistsToday = await db
        .select()
        .from(apiCalls)
        .where(
          and(
            eq(apiCalls.serviceId, call.serviceId),
            eq(apiCalls.payerAddress, call.payerAddress),
            sql`DATE(${apiCalls.timestamp}) = ${dateStr}::date`
          )
        )
        .limit(1);

      const newUniqueUsers = userExistsToday.length === 0 ? stats.uniqueUsers + 1 : stats.uniqueUsers;

      await db
        .update(dailyStats)
        .set({
          totalCalls: newTotalCalls,
          totalRevenue: stats.totalRevenue + call.amount,
          totalRevenueFormatted: (stats.totalRevenue + call.amount) / 1000000,
          avgResponseTime: newAvgResponseTime,
          errorCount: call.statusCode >= 400 ? stats.errorCount + 1 : stats.errorCount,
          uniqueUsers: newUniqueUsers,
          updatedAt: new Date(),
        })
        .where(
          and(eq(dailyStats.serviceId, call.serviceId), eq(dailyStats.date, dateStr))
        );
    } else {
      await db.insert(dailyStats).values({
        serviceId: call.serviceId,
        date: dateStr,
        totalCalls: 1,
        totalRevenue: call.amount,
        totalRevenueFormatted: call.amount / 1000000,
        avgResponseTime: call.responseTime || 0,
        errorCount: call.statusCode >= 400 ? 1 : 0,
        uniqueUsers: 1,
      });
    }
  }

  /**
   * Get analytics for a specific service
   */
  async getServiceAnalytics(
    serviceId: string,
    timeRange: '7d' | '30d' | '90d' | '1y' = '30d'
  ): Promise<ServiceAnalytics | null> {
    if (!db) {
      console.warn('[Analytics] Database not available, cannot fetch analytics');
      return null;
    }

    try {
      const now = new Date();
      const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : 365;
      const startTimestamp = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

      // Get service stats
      const serviceStat = await db
        .select()
        .from(serviceStats)
        .where(eq(serviceStats.serviceId, serviceId))
        .limit(1);

      if (serviceStat.length === 0) {
        return null;
      }

      const stats = serviceStat[0];

      // Get endpoint stats
      const endpointStatsData = await db
        .select()
        .from(endpointStats)
        .where(eq(endpointStats.serviceId, serviceId))
        .orderBy(desc(endpointStats.totalCalls))
        .limit(10);

      // Get daily stats for time range
      const startDate = startTimestamp.toISOString().split('T')[0];
      const dailyStatsData = await db
        .select()
        .from(dailyStats)
        .where(
          and(
            eq(dailyStats.serviceId, serviceId),
            gte(dailyStats.date, startDate)
          )
        )
        .orderBy(dailyStats.date);

      // Get top users
      const topUsersData = await db
        .select()
        .from(userStats)
        .where(eq(userStats.serviceId, serviceId))
        .orderBy(desc(userStats.totalCalls))
        .limit(10);

      // Calculate uptime
      const totalCallsInRange = await db
        .select({ count: count() })
        .from(apiCalls)
        .where(
          and(
            eq(apiCalls.serviceId, serviceId),
            gte(apiCalls.timestamp, startTimestamp)
          )
        );

      const errorCallsInRange = await db
        .select({ count: count() })
        .from(apiCalls)
        .where(
          and(
            eq(apiCalls.serviceId, serviceId),
            gte(apiCalls.timestamp, startTimestamp),
            sql`${apiCalls.statusCode} >= 400`
          )
        );

      const totalCalls = totalCallsInRange[0]?.count || 0;
      const errorCalls = errorCallsInRange[0]?.count || 0;
      const uptime = totalCalls > 0 ? ((totalCalls - errorCalls) / totalCalls) * 100 : 100;
      const errorRate = totalCalls > 0 ? (errorCalls / totalCalls) * 100 : 0;

      return {
        serviceId: stats.serviceId,
        serviceName: stats.serviceName,
        timeRange,
        metrics: {
          totalCalls: stats.totalCalls,
          totalRevenue: stats.totalRevenueFormatted,
          avgResponseTime: stats.avgResponseTime,
          uptime: Math.round(uptime * 100) / 100,
          errorRate: Math.round(errorRate * 100) / 100,
          uniqueUsers: stats.uniqueUsers,
        },
        callsByEndpoint: endpointStatsData.map((ep: { endpoint: string; totalCalls: number; totalRevenueFormatted: number; avgResponseTime: number }) => ({
          endpoint: ep.endpoint,
          calls: ep.totalCalls,
          revenue: ep.totalRevenueFormatted,
          avgTime: ep.avgResponseTime,
        })),
        callsOverTime: dailyStatsData.map((daily: { date: string; totalCalls: number; totalRevenueFormatted: number }) => ({
          date: daily.date,
          calls: daily.totalCalls,
          revenue: daily.totalRevenueFormatted,
        })),
        topUsers: topUsersData.map((user: { userAddress: string; totalCalls: number; totalRevenueFormatted: number }) => ({
          address: user.userAddress,
          calls: user.totalCalls,
          revenue: user.totalRevenueFormatted,
        })),
      };
    } catch (error) {
      console.error('Error fetching service analytics:', error);
      return null;
    }
  }
}

export const analyticsService = AnalyticsService.getInstance();

