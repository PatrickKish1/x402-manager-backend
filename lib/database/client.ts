// Database Client Setup
// Using Supabase with Drizzle ORM via Supabase SSR

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { createSupabaseAdminClient } from '../supabase/server';

// Get Supabase connection from environment
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Create postgres connection from Supabase client
// We'll use the Supabase client's connection internally
let client: postgres.Sql | null = null;
let db: ReturnType<typeof drizzle> | null = null;

// Initialize database connection using Supabase
export async function initializeDatabaseConnection() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.warn('Supabase environment variables not set. Database features will be unavailable.');
    return;
  }

  try {
    // Create Supabase admin client to get connection string
    const supabase = createSupabaseAdminClient();
    
    // Extract connection details from Supabase URL
    // Supabase URL format: https://[project-ref].supabase.co
    // We need to construct the PostgreSQL connection string
    const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
    
    // Get database password from environment or use service role key
    // For Supabase, we can use the connection pooling URL
    const connectionString = process.env.SUPABASE_DB_PASSWORD
      ? `postgresql://postgres.${projectRef}:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@aws-0-${projectRef.split('.')[0]}.pooler.supabase.com:6543/postgres`
      : process.env.DATABASE_URL; // Fallback to DATABASE_URL if provided

    if (!connectionString) {
      console.warn('No database connection string available. Using Supabase client directly.');
      return;
    }

    // Create postgres client
    client = postgres(connectionString, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });

    // Create Drizzle instance
    db = drizzle(client, { schema });

    // Test connection
    await client`SELECT 1`;
    
    console.log('Database connection initialized');
  } catch (error: any) {
    console.error('Error initializing database connection:', error.message);
    client = null;
    db = null;
  }
}

// Initialize on module load (for server-side)
if (typeof window === 'undefined') {
  initializeDatabaseConnection().catch(console.error);
}

// Export db and client (will be null if not initialized)
export { db, client };

// Initialize database tables
export async function initializeDatabase() {
  if (!db || !client) {
    await initializeDatabaseConnection();
  }

  if (!db || !client) {
    const error = new Error('Database connection not available');
    (error as any).code = 'DATABASE_NOT_AVAILABLE';
    throw error;
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
        token_address TEXT,
        token_decimals INTEGER DEFAULT 6,
        token_name TEXT,
        token_version TEXT DEFAULT '2',
        token_symbol TEXT,
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

      CREATE TABLE IF NOT EXISTS discovered_services (
        id SERIAL PRIMARY KEY,
        service_id TEXT NOT NULL UNIQUE,
        resource TEXT NOT NULL UNIQUE,
        type TEXT,
        x402_version INTEGER NOT NULL DEFAULT 1,
        last_updated TIMESTAMP,
        metadata TEXT,
        accepts TEXT,
        description TEXT,
        name TEXT,
        tags TEXT,
        network TEXT,
        price TEXT,
        output_schema TEXT,
        synced_at TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
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

      CREATE INDEX IF NOT EXISTS idx_discovered_services_resource ON discovered_services(resource);
      CREATE INDEX IF NOT EXISTS idx_discovered_services_type ON discovered_services(type);
      CREATE INDEX IF NOT EXISTS idx_discovered_services_network ON discovered_services(network);
      CREATE INDEX IF NOT EXISTS idx_discovered_services_synced_at ON discovered_services(synced_at);
    `;

    await client.unsafe(sql);
    console.log('Database tables initialized');
  } catch (error: any) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

// Close database connection (for cleanup)
export function closeDatabase() {
  if (client) {
    client.end();
    client = null;
    db = null;
  }
}
