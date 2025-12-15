# X402 Backend Service

Backend API service for x402 analytics tracking and service management.

## Features

- **Analytics Tracking**: Track API calls, revenue, response times, and user statistics
- **Database**: SQLite database with Drizzle ORM (easily migratable to PostgreSQL/MySQL)
- **Caching**: Server-side caching for improved performance
- **CORS**: Configured for cross-origin requests from frontend
- **Rate Limiting**: Built-in rate limiting support

## Setup

1. Install dependencies:
```bash
npm install
# or
pnpm install
```

**Note for Windows users**: `better-sqlite3` requires native compilation. You may need:
- Visual Studio Build Tools with "Desktop development with C++" workload
- Or use WSL (Windows Subsystem for Linux)
- Or use a pre-built binary: `npm install better-sqlite3 --build-from-source=false`

2. Copy environment file:
```bash
cp env.example .env
```

3. Start development server:
```bash
npm run dev
# or
pnpm dev
```

The backend will run on `http://localhost:3001`

## Database

This backend uses **Supabase (PostgreSQL)** for data storage. 

### Setup Supabase:

1. Create a Supabase project at https://supabase.com
2. Get your database connection string from: Project Settings > Database > Connection string
3. Add it to your `.env` file as `DATABASE_URL` or `SUPABASE_DATABASE_URL`
4. The database tables will be automatically created on first run

The database schema includes:
- `api_calls` - Individual API call records
- `service_stats` - Aggregated service statistics
- `user_stats` - Per-user statistics
- `endpoint_stats` - Per-endpoint statistics  
- `daily_stats` - Time-series data for charts

## API Endpoints

### Analytics

- `GET /api/analytics/[serviceId]?timeRange=30d` - Get service analytics
- `POST /api/analytics/track` - Track an API call

### Example Usage

```typescript
// Track an API call
await fetch('http://localhost:3001/api/analytics/track', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    serviceId: 'service-123',
    serviceName: 'Weather API',
    endpoint: '/current',
    method: 'GET',
    payerAddress: '0x...',
    amount: 50000, // micro-USDC
    amountFormatted: 0.05, // USDC
    network: 'base',
    transactionHash: '0x...',
    responseTime: 45,
    statusCode: 200,
  }),
});

// Get analytics
const analytics = await fetch(
  'http://localhost:3001/api/analytics/service-123?timeRange=30d'
).then(r => r.json());
```

## Database

The database is automatically initialized on first run. SQLite database files are stored in `./data/` directory.

For production, consider migrating to PostgreSQL or MySQL by updating the database client configuration.

## Architecture

- `lib/database/` - Database schema and client
- `lib/services/` - Business logic services
- `app/api/` - API route handlers
