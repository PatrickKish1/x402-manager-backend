// Database Client Setup
// Using Supabase (PostgreSQL) with Drizzle ORM

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Get Supabase connection string from environment
const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;

// Only throw error if we're not in build mode (Next.js build doesn't need DB connection)
if (!connectionString && process.env.NODE_ENV !== 'production' && !process.env.NEXT_PHASE) {
  console.warn('⚠️  DATABASE_URL or SUPABASE_DATABASE_URL not set. Database features will be unavailable.');
}

// Create postgres client (only if connection string is available)
const client = connectionString ? postgres(connectionString, {
  max: 10, // Maximum number of connections
}) : null as any;

// Create Drizzle instance (only if client exists)
export const db = client ? drizzle(client, { schema }) : null as any;

// Initialize database tables
export async function initializeDatabase() {
  if (!client || !connectionString) {
    console.warn('⚠️  Database connection not available. Skipping initialization.');
    return;
  }
  
  try {
    // Create tables if they don't exist using raw SQL
    const sql = `
      CREATE TABLE IF NOT EXISTS api_calls (
        id SERIAL PRIMARY KEY,
        service_id TEXT NOT NULL,
        service_name TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        method TEXT NOT NULL DEFAULT 'GET',
        payer_address TEXT NOT NULL,
        amount BIGINT NOT NULL,
        amount_formatted REAL NOT NULL,
        network TEXT NOT NULL,
        transaction_hash TEXT,
        response_time INTEGER,
        status_code INTEGER NOT NULL,
        error TEXT,
        timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS service_stats (
        id SERIAL PRIMARY KEY,
        service_id TEXT NOT NULL UNIQUE,
        service_name TEXT NOT NULL,
        total_calls INTEGER NOT NULL DEFAULT 0,
        total_revenue BIGINT NOT NULL DEFAULT 0,
        total_revenue_formatted REAL NOT NULL DEFAULT 0,
        avg_response_time INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        unique_users INTEGER NOT NULL DEFAULT 0,
        last_call_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_stats (
        id SERIAL PRIMARY KEY,
        service_id TEXT NOT NULL,
        user_address TEXT NOT NULL,
        total_calls INTEGER NOT NULL DEFAULT 0,
        total_revenue BIGINT NOT NULL DEFAULT 0,
        total_revenue_formatted REAL NOT NULL DEFAULT 0,
        first_call_at TIMESTAMP NOT NULL DEFAULT NOW(),
        last_call_at TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(service_id, user_address)
      );

      CREATE TABLE IF NOT EXISTS endpoint_stats (
        id SERIAL PRIMARY KEY,
        service_id TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        method TEXT NOT NULL DEFAULT 'GET',
        total_calls INTEGER NOT NULL DEFAULT 0,
        total_revenue BIGINT NOT NULL DEFAULT 0,
        total_revenue_formatted REAL NOT NULL DEFAULT 0,
        avg_response_time INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        last_call_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(service_id, endpoint, method)
      );

      CREATE TABLE IF NOT EXISTS daily_stats (
        id SERIAL PRIMARY KEY,
        service_id TEXT NOT NULL,
        date DATE NOT NULL,
        total_calls INTEGER NOT NULL DEFAULT 0,
        total_revenue BIGINT NOT NULL DEFAULT 0,
        total_revenue_formatted REAL NOT NULL DEFAULT 0,
        avg_response_time INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        unique_users INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(service_id, date)
      );

      CREATE TABLE IF NOT EXISTS user_services (
        id TEXT PRIMARY KEY,
        owner_address TEXT NOT NULL,
        payment_recipient TEXT NOT NULL,
        payment_recipient_ens TEXT,
        name TEXT NOT NULL,
        description TEXT,
        upstream_url TEXT NOT NULL,
        proxy_url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        network TEXT NOT NULL DEFAULT 'base',
        currency TEXT NOT NULL DEFAULT 'USDC',
        price_per_request TEXT NOT NULL DEFAULT '1000000',
        discoverable INTEGER NOT NULL DEFAULT 1,
        health_endpoint TEXT,
        docs_type TEXT,
        docs_url TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS payment_nonces (
        id SERIAL PRIMARY KEY,
        nonce TEXT NOT NULL UNIQUE,
        user_address TEXT NOT NULL,
        service_id TEXT NOT NULL,
        amount TEXT NOT NULL,
        network TEXT NOT NULL,
        used_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL
      );

      -- Create indexes for better query performance
      CREATE INDEX IF NOT EXISTS idx_api_calls_service_id ON api_calls(service_id);
      CREATE INDEX IF NOT EXISTS idx_api_calls_timestamp ON api_calls(timestamp);
      CREATE INDEX IF NOT EXISTS idx_api_calls_payer_address ON api_calls(payer_address);
      CREATE INDEX IF NOT EXISTS idx_api_calls_service_timestamp ON api_calls(service_id, timestamp);
      
      CREATE INDEX IF NOT EXISTS idx_service_stats_service_id ON service_stats(service_id);
      
      CREATE INDEX IF NOT EXISTS idx_user_stats_service_user ON user_stats(service_id, user_address);
      CREATE INDEX IF NOT EXISTS idx_user_stats_user_address ON user_stats(user_address);
      
      CREATE INDEX IF NOT EXISTS idx_endpoint_stats_service_endpoint ON endpoint_stats(service_id, endpoint, method);
      
      CREATE INDEX IF NOT EXISTS idx_daily_stats_service_date ON daily_stats(service_id, date);
      CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date);
      
      CREATE INDEX IF NOT EXISTS idx_user_services_owner ON user_services(owner_address);
      CREATE INDEX IF NOT EXISTS idx_user_services_status ON user_services(status);
      
      CREATE INDEX IF NOT EXISTS idx_payment_nonces_nonce ON payment_nonces(nonce);
      CREATE INDEX IF NOT EXISTS idx_payment_nonces_user ON payment_nonces(user_address);
      CREATE INDEX IF NOT EXISTS idx_payment_nonces_expires ON payment_nonces(expires_at);
    `;
    
    // Execute the SQL using postgres client
    await client.unsafe(sql);

    // console.log(' Database initialized successfully');
  } catch (error) {
    console.error(' Error initializing database:', error);
    throw error;
  }
}

// Close database connection (for cleanup) - not typically needed for serverless/pooled connections
export function closeDatabase() {
  // For postgres-js, the pool manages connections, no explicit close needed here
  // console.log('Database client is managed by the pool.');
}
