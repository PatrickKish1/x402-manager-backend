// Database Schema for Analytics and Service Tracking
// Using Drizzle ORM with PostgreSQL (Supabase)

import { pgTable, text, integer, real, bigint, timestamp, date, serial } from 'drizzle-orm/pg-core';

// Analytics Tables
export const apiCalls = pgTable('api_calls', {
  id: serial('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  serviceName: text('service_name').notNull(),
  endpoint: text('endpoint').notNull(),
  method: text('method').notNull().default('GET'),
  payerAddress: text('payer_address').notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(), // Amount in smallest unit (e.g., wei, micro-USDC)
  amountFormatted: real('amount_formatted').notNull(), // Human-readable amount
  network: text('network').notNull(),
  transactionHash: text('transaction_hash'),
  responseTime: integer('response_time'), // Response time in milliseconds
  statusCode: integer('status_code').notNull(),
  error: text('error'), // Error message if any
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Service Statistics (aggregated for faster queries)
export const serviceStats = pgTable('service_stats', {
  id: serial('id').primaryKey(),
  serviceId: text('service_id').notNull().unique(),
  serviceName: text('service_name').notNull(),
  totalCalls: integer('total_calls').notNull().default(0),
  totalRevenue: bigint('total_revenue', { mode: 'number' }).notNull().default(0), // In smallest unit
  totalRevenueFormatted: real('total_revenue_formatted').notNull().default(0),
  avgResponseTime: integer('avg_response_time').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  uniqueUsers: integer('unique_users').notNull().default(0),
  lastCallAt: timestamp('last_call_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// User Statistics (per user per service)
export const userStats = pgTable('user_stats', {
  id: serial('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  userAddress: text('user_address').notNull(),
  totalCalls: integer('total_calls').notNull().default(0),
  totalRevenue: bigint('total_revenue', { mode: 'number' }).notNull().default(0),
  totalRevenueFormatted: real('total_revenue_formatted').notNull().default(0),
  firstCallAt: timestamp('first_call_at').notNull().defaultNow(),
  lastCallAt: timestamp('last_call_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Endpoint Statistics (per endpoint per service)
export const endpointStats = pgTable('endpoint_stats', {
  id: serial('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  endpoint: text('endpoint').notNull(),
  method: text('method').notNull().default('GET'),
  totalCalls: integer('total_calls').notNull().default(0),
  totalRevenue: bigint('total_revenue', { mode: 'number' }).notNull().default(0),
  totalRevenueFormatted: real('total_revenue_formatted').notNull().default(0),
  avgResponseTime: integer('avg_response_time').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  lastCallAt: timestamp('last_call_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Time-series data for charts (aggregated by day)
export const dailyStats = pgTable('daily_stats', {
  id: serial('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  date: date('date').notNull(), // YYYY-MM-DD format
  totalCalls: integer('total_calls').notNull().default(0),
  totalRevenue: bigint('total_revenue', { mode: 'number' }).notNull().default(0),
  totalRevenueFormatted: real('total_revenue_formatted').notNull().default(0),
  avgResponseTime: integer('avg_response_time').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  uniqueUsers: integer('unique_users').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// User Services (for service management)
export const userServices = pgTable('user_services', {
  id: text('id').primaryKey(), // Service ID from x402
  ownerAddress: text('owner_address').notNull(), // Creator of the service
  paymentRecipient: text('payment_recipient').notNull(), // Who receives payments (can be different from owner)
  paymentRecipientEns: text('payment_recipient_ens'), // ENS name for payment recipient (optional)
  name: text('name').notNull(),
  description: text('description'),
  upstreamUrl: text('upstream_url').notNull(),
  proxyUrl: text('proxy_url').notNull(),
  status: text('status').notNull().default('active'), // active, inactive, maintenance
  network: text('network').notNull().default('base'),
  currency: text('currency').notNull().default('USDC'),
  pricePerRequest: text('price_per_request').notNull().default('1000000'), // 1 USDC in atomic units (provider sets and keeps 100%)
  discoverable: integer('discoverable').notNull().default(1), // SQLite boolean (1 = true, 0 = false)
  healthEndpoint: text('health_endpoint'),
  docsType: text('docs_type'), // swagger, link, manual
  docsUrl: text('docs_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Payment Nonces (for replay attack prevention)
export const paymentNonces = pgTable('payment_nonces', {
  id: serial('id').primaryKey(),
  nonce: text('nonce').notNull().unique(),
  userAddress: text('user_address').notNull(),
  serviceId: text('service_id').notNull(),
  amount: text('amount').notNull(),
  network: text('network').notNull(),
  usedAt: timestamp('used_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(), // For automatic cleanup
});