/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

/**
 * GET /api/services/stats
 * Get statistics about synced services
 */
export async function GET(request: NextRequest) {
  try {
    // Check if Supabase is configured
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { 
          error: 'Supabase not configured',
          message: 'Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables',
          help: 'Get these from your Supabase project settings > API'
        },
        { status: 503 }
      );
    }

    // Create Supabase admin client
    const supabase = createSupabaseAdminClient();

    // Get total count
    const { count: totalServices, error: countError } = await supabase
      .from('discovered_services')
      .select('*', { count: 'exact', head: true });

    if (countError) throw countError;

    // Get most recently synced service
    const { data: mostRecent, error: recentError } = await supabase
      .from('discovered_services')
      .select('synced_at')
      .order('synced_at', { ascending: false })
      .limit(1)
      .single();

    if (recentError && recentError.code !== 'PGRST116') throw recentError; // PGRST116 = no rows

    // Supabase returns timestamps as strings, not Date objects
    const lastSyncTime = mostRecent?.synced_at || null;

    // Count by type
    const { data: typeData, error: typeError } = await supabase
      .from('discovered_services')
      .select('type');

    if (typeError) throw typeError;

    const typeCounts: Record<string, number> = {};
    (typeData || []).forEach((service: any) => {
      const type = service.type || 'unknown';
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });

    // Count by network
    const { data: networkData, error: networkError } = await supabase
      .from('discovered_services')
      .select('network');

    if (networkError) throw networkError;

    const networkCounts: Record<string, number> = {};
    (networkData || []).forEach((service: any) => {
      const network = service.network || 'unknown';
      networkCounts[network] = (networkCounts[network] || 0) + 1;
    });

    return NextResponse.json({
      totalServices,
      lastSyncTime: lastSyncTime || null, // Already a string from Supabase
      typeCounts,
      networkCounts,
    });
  } catch (error: any) {
    console.error('[Services Stats] Error:', error);
    return NextResponse.json(
      {
        error: error.message || 'Failed to fetch stats',
      },
      { status: 500 }
    );
  }
}

