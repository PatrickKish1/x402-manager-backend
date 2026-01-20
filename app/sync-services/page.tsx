'use client';

import { useState, useEffect } from 'react';

export default function SyncServicesPage() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [dbStatus, setDbStatus] = useState<'checking' | 'connected' | 'disconnected' | 'missing_table'>('checking');
  const [tableError, setTableError] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/services/stats');
      if (response.ok) {
        const data = await response.json();
        setStats(data);
        setDbStatus('connected');
      } else {
        const errorData = await response.json();
        if (response.status === 503) {
          setDbStatus('disconnected');
          setError(errorData.message || 'Database not configured');
        } else if (response.status === 500) {
          // Check if it's a missing table error
          const errorMessage = errorData.error?.message || errorData.message || '';
          if (errorMessage.includes('discovered_services') || errorMessage.includes('PGRST205')) {
            setDbStatus('missing_table');
            setTableError('The discovered_services table does not exist. Please create it first.');
          } else {
            setError(errorData.error?.message || errorData.message || 'Unknown error');
          }
        }
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
      setDbStatus('disconnected');
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/services/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ maxServices: 1000 }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        const errorMessage = errorData.message || errorData.error || 'Failed to sync services';
        const errorHelp = errorData.help ? `\n\n${errorData.help}` : '';
        throw new Error(`${errorMessage}${errorHelp}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        const errorMessage = data.message || data.error || 'Sync failed';
        const errorHelp = data.help ? `\n\n${data.help}` : '';
        throw new Error(`${errorMessage}${errorHelp}`);
      }
      
      setResult(data);
      setError(null);
      await fetchStats(); // Refresh stats after sync
    } catch (err: any) {
      const errorMessage = err.message || 'An error occurred';
      setError(errorMessage);
      
      // Check if it's a database connection error
      if (errorMessage.includes('Database') || errorMessage.includes('DATABASE_URL')) {
        setDbStatus('disconnected');
      }
    } finally {
      setSyncing(false);
    }
  };

  // Load stats on mount
  useEffect(() => {
    fetchStats();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Sync Services from CDP Bazaar</h1>
        
        {/* Database Status */}
        <div className={`rounded-lg shadow p-4 mb-6 ${
          dbStatus === 'connected' ? 'bg-green-50 border border-green-200' :
          dbStatus === 'disconnected' ? 'bg-red-50 border border-red-200' :
          dbStatus === 'missing_table' ? 'bg-orange-50 border border-orange-200' :
          'bg-yellow-50 border border-yellow-200'
        }`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h2 className="font-semibold mb-1">
                Database Status: {
                  dbStatus === 'connected' ? '✅ Connected' :
                  dbStatus === 'disconnected' ? '❌ Not Connected' :
                  dbStatus === 'missing_table' ? '⚠️ Missing Table' :
                  '⏳ Checking...'
                }
              </h2>
              {dbStatus === 'disconnected' && (
                <div className="text-sm text-red-700 mt-2">
                  <p className="font-semibold mb-2">Supabase connection required!</p>
                  <p className="mb-2">Please set these environment variables:</p>
                  <ul className="list-disc list-inside mb-2 space-y-1">
                    <li><code className="bg-red-100 px-1 rounded">NEXT_PUBLIC_SUPABASE_URL</code></li>
                    <li><code className="bg-red-100 px-1 rounded">SUPABASE_ANON_KEY</code></li>
                    <li><code className="bg-red-100 px-1 rounded">SUPABASE_SERVICE_ROLE_KEY</code></li>
                  </ul>
                  <p className="mb-2">Get these from: Supabase Dashboard → Project Settings → API</p>
                </div>
              )}
              {dbStatus === 'missing_table' && (
                <div className="text-sm text-orange-700 mt-2">
                  <p className="font-semibold mb-2">⚠️ Table Missing: discovered_services</p>
                  <p className="mb-3">The table needs to be created in Supabase first.</p>
                  
                  <div className="bg-white p-3 rounded border border-orange-200 mb-3">
                    <p className="font-semibold mb-2">Quick Setup:</p>
                    <ol className="list-decimal list-inside space-y-1 text-xs mb-3">
                      <li>Go to your Supabase project dashboard</li>
                      <li>Click on <strong>SQL Editor</strong> in the left sidebar</li>
                      <li>Click <strong>New Query</strong></li>
                      <li>Copy and paste the SQL below</li>
                      <li>Click <strong>Run</strong> or press Ctrl+Enter</li>
                    </ol>
                    
                    <details className="text-xs">
                      <summary className="cursor-pointer font-semibold mb-1 hover:text-orange-800">📋 Click to see SQL script</summary>
                      <pre className="bg-gray-50 p-2 rounded mt-2 overflow-x-auto text-xs border border-gray-200">
{`CREATE TABLE IF NOT EXISTS discovered_services (
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
CREATE INDEX IF NOT EXISTS idx_discovered_services_service_id ON discovered_services(service_id);`}
                      </pre>
                    </details>
                  </div>
                  
                  <p className="text-xs text-gray-600">
                    💡 After creating the table, refresh this page or click "Check Connection" below.
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    📄 Full SQL file: <code className="bg-orange-100 px-1 rounded">app/backend/supabase/create_tables.sql</code>
                  </p>
                </div>
              )}
            </div>
            <button
              onClick={fetchStats}
              className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-sm whitespace-nowrap"
            >
              Check Connection
            </button>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Service Statistics</h2>
          {stats ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-600">Total Services</p>
                <p className="text-2xl font-bold">{stats.totalServices || 0}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Last Synced</p>
                <p className="text-lg">
                  {stats.lastSyncTime 
                    ? new Date(stats.lastSyncTime).toLocaleString()
                    : 'Never'}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-gray-500">Loading stats...</p>
          )}
          <button
            onClick={fetchStats}
            className="mt-4 px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
          >
            Refresh Stats
          </button>
        </div>

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Sync Services</h2>
          <p className="text-gray-600 mb-4">
            Fetch all services from CDP Bazaar and store them in the database.
            This ensures uniqueness and enables fast pagination.
          </p>
          
          <button
            onClick={handleSync}
            disabled={syncing || dbStatus !== 'connected'}
            className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {syncing ? 'Syncing...' : 'Sync All Services'}
          </button>

          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded">
              <p className="text-red-800 font-semibold mb-2">Error:</p>
              <pre className="text-red-700 text-sm whitespace-pre-wrap">{error}</pre>
            </div>
          )}

          {result && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded">
              <h3 className="font-semibold text-green-800 mb-2">Sync Complete!</h3>
              <div className="space-y-1 text-sm">
                <p><strong>Total Fetched:</strong> {result.totalFetched}</p>
                <p><strong>New Services:</strong> {result.newServices}</p>
                <p><strong>Updated Services:</strong> {result.updatedServices}</p>
                <p><strong>Errors:</strong> {result.errors}</p>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">How It Works</h2>
          <ul className="list-disc list-inside space-y-2 text-gray-700">
            <li>Fetches all services from CDP Bazaar (up to 1000)</li>
            <li>Generates unique IDs for each service based on resource URL</li>
            <li>Stores services in database with deduplication</li>
            <li>Updates existing services if they already exist</li>
            <li>Enables fast pagination from your own database</li>
            <li>Supports Supabase realtime for live updates</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

