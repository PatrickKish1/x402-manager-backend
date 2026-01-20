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
  pricePerRequest: text('price_per_request').notNull().default('1000000'), // Amount in atomic units (provider sets and keeps 100%)
  
  // Token Configuration (for custom ERC-20 tokens)
  tokenAddress: text('token_address'), // Custom token contract address (optional, uses default if not set)
  tokenDecimals: integer('token_decimals').default(6), // Token decimals (default: 6 for USDC)
  tokenName: text('token_name'), // Token name for EIP-712 (e.g., "USD Coin", "Wrapped ETH")
  tokenVersion: text('token_version').default('2'), // EIP-712 version (default: "2")
  tokenSymbol: text('token_symbol'), // Token symbol for display (e.g., "USDC", "WETH")
  
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

// Service Endpoints (with endpoint-level pricing and configuration)
export const serviceEndpoints = pgTable('service_endpoints', {
  id: serial('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  endpoint: text('endpoint').notNull(), // e.g., '/users/{id}' or '/users'
  method: text('method').notNull().default('GET'), // GET, POST, PUT, DELETE, PATCH
  description: text('description'),
  
  // Endpoint-level pricing configuration
  pricePerRequest: text('price_per_request'), // Amount in atomic units (null = use service default)
  network: text('network'), // null = use service default
  currency: text('currency'), // null = use service default
  tokenAddress: text('token_address'), // null = use service default
  tokenDecimals: integer('token_decimals'), // null = use service default
  tokenName: text('token_name'), // null = use service default
  tokenVersion: text('token_version'), // null = use service default
  tokenSymbol: text('token_symbol'), // null = use service default
  
  // Request configuration
  requiresAuth: integer('requires_auth').default(0), // 0 = false, 1 = true
  headers: text('headers'), // JSON string of default headers
  queryParams: text('query_params'), // JSON string of query param definitions
  pathParams: text('path_params'), // JSON string of path param definitions (e.g., {id: 'string'})
  requestBody: text('request_body'), // JSON string of request body schema
  
  // Response configuration
  outputSchema: text('output_schema'), // JSON string of expected output schema
  expectedStatusCode: integer('expected_status_code').default(200),
  
  // x402 extra object (for chain ID and multi-chain support)
  extra: text('extra'), // JSON string with chainId, chainName, supportedChains, etc.
  
  // Testing
  lastTestedAt: timestamp('last_tested_at'),
  lastTestResponse: text('last_test_response'), // JSON string of last test response
  lastTestStatus: integer('last_test_status'), // HTTP status code from last test
  lastTestError: text('last_test_error'),
  
  // Ordering
  orderIndex: integer('order_index').default(0),
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ============================================================================
// VALIDATOR SYSTEM TABLES
// ============================================================================

// Validated Services Registry
// Validation Votes (one per user per service - allows multiple users to validate)
export const validationVotes = pgTable('validation_votes', {
  id: serial('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  userAddress: text('user_address').notNull(),
  vote: text('vote').notNull(), // 'valid' or 'invalid'
  reason: text('reason'), // Reason for invalid vote (error message, missing keys, etc.)
  validationDetails: text('validation_details'), // JSON string with full validation results
  testResponse: text('test_response'), // JSON string of the test response
  validationMode: text('validation_mode'), // 'free' or 'user-paid'
  testnetChain: text('testnet_chain'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const validatedServices = pgTable('validated_services', {
  id: serial('id').primaryKey(),
  serviceId: text('service_id').notNull().unique(),
  serviceName: text('service_name').notNull(),
  validationStatus: text('validation_status').notNull(), // 'pending', 'verified', 'failed', 'disputed'
  validationScore: integer('validation_score'), // 0-100 (aggregated from votes)
  lastValidatedAt: timestamp('last_validated_at'),
  validVoteCount: integer('valid_vote_count').notNull().default(0), // Number of users who marked as valid
  invalidVoteCount: integer('invalid_vote_count').notNull().default(0), // Number of users who marked as invalid
  testnetChain: text('testnet_chain'), // 'base-sepolia', 'solana-devnet'
  lastValidatedByAddress: text('last_validated_by_address'), // Most recent validator
  validationMode: text('validation_mode'), // 'free', 'user-paid'
  validationResults: text('validation_results'), // JSON string (aggregated)
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Validation Requests (for abuse prevention tracking)
export const validationRequests = pgTable('validation_requests', {
  id: serial('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  requestedByAddress: text('requested_by_address').notNull(),
  requestedByIp: text('requested_by_ip'),
  validationMode: text('validation_mode').notNull(), // 'free', 'user-paid'
  status: text('status').notNull(), // 'pending', 'completed', 'failed'
  testnetChain: text('testnet_chain').notNull(),
  tokensSpent: bigint('tokens_spent', { mode: 'number' }),
  validationResults: text('validation_results'), // JSON string
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Validation Test Cases (detailed test results)
export const validationTestCases = pgTable('validation_test_cases', {
  id: serial('id').primaryKey(),
  validationRequestId: integer('validation_request_id').notNull(),
  serviceId: text('service_id').notNull(),
  endpoint: text('endpoint').notNull(),
  method: text('method').notNull(),
  testInput: text('test_input'), // JSON string
  expectedOutputSchema: text('expected_output_schema'), // JSON string
  actualOutput: text('actual_output'), // JSON string
  passed: integer('passed').notNull(), // 0 or 1 (boolean)
  errorMessage: text('error_message'),
  responseTime: integer('response_time'),
  statusCode: integer('status_code'),
  schemaValid: integer('schema_valid'), // 0 or 1
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Blockchain Transactions Cache (for native x402 APIs)
export const blockchainTransactionsCache = pgTable('blockchain_transactions_cache', {
  id: serial('id').primaryKey(),
  serviceId: text('service_id').notNull(),
  chain: text('chain').notNull(),
  txHash: text('tx_hash').notNull(),
  sender: text('sender').notNull(),
  recipient: text('recipient').notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  amountFormatted: real('amount_formatted').notNull(),
  token: text('token').notNull(),
  blockTimestamp: timestamp('block_timestamp').notNull(),
  cachedAt: timestamp('cached_at').notNull().defaultNow(),
});

// Discovered Services (from CDP Bazaar - synced and stored locally)
export const discoveredServices = pgTable('discovered_services', {
  id: serial('id').primaryKey(),
  serviceId: text('service_id').notNull().unique(), // Unique ID generated from resource URL
  resource: text('resource').notNull().unique(), // The service resource URL (unique identifier)
  type: text('type'), // Service type (e.g., 'api', 'data')
  x402Version: integer('x402_version').notNull().default(1),
  lastUpdated: timestamp('last_updated'), // Last update from CDP Bazaar
  metadata: text('metadata'), // JSON string of metadata
  accepts: text('accepts'), // JSON string of payment requirements
  description: text('description'), // Extracted from metadata
  name: text('name'), // Extracted from metadata
  tags: text('tags'), // JSON array of tags
  network: text('network'), // Extracted from accepts
  price: text('price'), // Extracted from accepts (maxAmountRequired)
  outputSchema: text('output_schema'), // JSON schema inferred from successful validation responses
  syncedAt: timestamp('synced_at').notNull().defaultNow(), // When we last synced this service
  createdAt: timestamp('created_at').notNull().defaultNow(), // When we first discovered it
  updatedAt: timestamp('updated_at').notNull().defaultNow(), // Last time we updated this record
});