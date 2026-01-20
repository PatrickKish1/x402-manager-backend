/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

/**
 * POST /api/setup/create-table
 * Create the discovered_services table in Supabase
 * Run this once to set up the table
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabaseAdminClient();

    // Execute SQL to create table
    const createTableSQL = `
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
        synced_at TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_discovered_services_resource ON discovered_services(resource);
      CREATE INDEX IF NOT EXISTS idx_discovered_services_type ON discovered_services(type);
      CREATE INDEX IF NOT EXISTS idx_discovered_services_network ON discovered_services(network);
      CREATE INDEX IF NOT EXISTS idx_discovered_services_synced_at ON discovered_services(synced_at);
      CREATE INDEX IF NOT EXISTS idx_discovered_services_service_id ON discovered_services(service_id);
    `;

    // Use RPC or direct SQL execution
    // Supabase doesn't have a direct SQL execution endpoint, so we need to use the REST API
    // For now, we'll return instructions to run it manually
    
    return NextResponse.json({
      success: true,
      message: 'Please run the SQL in Supabase SQL Editor',
      sql: createTableSQL,
      instructions: [
        '1. Go to your Supabase project dashboard',
        '2. Navigate to SQL Editor',
        '3. Paste the SQL below',
        '4. Click Run',
      ],
    });
  } catch (error: any) {
    console.error('[Create Table] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to create table',
      },
      { status: 500 }
    );
  }
}

