# x402 Backend Service

The backend service for the x402 platform, handling payment verification, gateway proxying, analytics, and service management.

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or pnpm
- Supabase account (for PostgreSQL database)

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp ENV_SETUP.md .env.local
# Edit .env.local with your credentials

# Start development server
npm run dev
```

The backend will run on **http://localhost:3001**

---

## 📁 Project Structure

```
app/backend/
├── app/
│   ├── api/
│   │   ├── gateway/[...path]/     # Payment gateway (proxy)
│   │   ├── user-services/         # Service management
│   │   ├── analytics/             # Usage analytics
│   │   ├── discovery/             # API marketplace
│   │   ├── nonces/                # Replay attack prevention
│   │   └── health/                # Health check
│   ├── layout.tsx
│   └── favicon.ico
├── lib/
│   ├── database/
│   │   ├── client.ts              # Supabase/Drizzle client
│   │   └── schema.ts              # Database schema
│   └── services/
│       ├── analytics.service.ts   # Analytics logic
│       ├── discovery.service.ts   # Discovery logic
│       └── rate-limiter.ts        # Rate limiting
├── package.json
├── tsconfig.json
├── vercel.json                    # Vercel config (CORS, cron)
├── ENV_SETUP.md                   # Environment setup guide
└── README.md                      # This file
```

---

## 🔌 API Endpoints

### **Gateway**

```
POST /api/gateway/:userId/:serviceId/:endpoint
```

Main payment gateway that:
1. Verifies x402 payments
2. Prevents replay attacks
3. Forwards requests to upstream APIs
4. Tracks analytics

**Headers:**
- `X-Payment`: Base64-encoded payment proof (optional, triggers 402 if missing)
- `Content-Type`: Request content type
- `Authorization`: For authenticated endpoints (optional)

**Response:**
- `402 Payment Required`: If no payment provided
- `200-5xx`: Forwarded response from upstream API

---

### **Nonce Management**

```
POST /api/nonces/check
```

Check if a nonce has been used (replay attack prevention).

**Request Body:**
```json
{
  "nonce": "unique-nonce-string",
  "userAddress": "0x..."
}
```

**Response:**
```json
{
  "used": false,
  "nonce": "unique-nonce-string",
  "userAddress": "0x..."
}
```

---

```
GET /api/nonces/cleanup
```

Cleanup expired nonces (runs as cron job every hour).

**Headers:**
- `Authorization: Bearer YOUR_CRON_SECRET` (optional, for security)

**Response:**
```json
{
  "success": true,
  "deletedCount": 42,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

### **User Services**

```
GET /api/user-services
```

List all user services (API registry).

**Query Parameters:**
- `userId`: Filter by user ID
- `status`: Filter by status (active, paused, deleted)
- `discoverable`: Filter by discoverable (true/false)

**Response:**
```json
{
  "services": [
    {
      "id": "weather-api",
      "name": "Weather API",
      "description": "Real-time weather data",
      "upstreamUrl": "https://api.weather.com",
      "proxyUrl": "https://gateway.x402.io/alice/weather-api",
      "status": "active",
      "network": "base",
      "currency": "USDC"
    }
  ]
}
```

---

```
POST /api/user-services
```

Register a new service.

**Request Body:**
```json
{
  "id": "weather-api",
  "ownerAddress": "0x...",
  "name": "Weather API",
  "description": "Real-time weather data",
  "upstreamUrl": "https://api.weather.com",
  "network": "base",
  "currency": "USDC"
}
```

---

```
PUT /api/user-services/:id
```

Update a service.

---

```
DELETE /api/user-services/:id
```

Delete a service.

---

### **Analytics**

```
GET /api/analytics/:serviceId
```

Get analytics for a specific service.

**Response:**
```json
{
  "totalCalls": 12345,
  "totalRevenue": 1234.56,
  "avgResponseTime": 123,
  "errorRate": 0.05,
  "topEndpoints": [
    {
      "endpoint": "/current",
      "calls": 5000,
      "revenue": 500.00
    }
  ]
}
```

---

```
POST /api/analytics/track
```

Track an API call (internal use by gateway).

---

### **Discovery**

```
GET /api/discovery
```

List all discoverable APIs for the marketplace.

**Query Parameters:**
- `category`: Filter by category
- `network`: Filter by network
- `search`: Search query

**Response:**
```json
{
  "apis": [
    {
      "id": "weather-api",
      "name": "Weather API",
      "description": "Real-time weather data",
      "network": "base",
      "currency": "USDC",
      "pricing": {
        "amount": "1000000",
        "currency": "USDC"
      }
    }
  ]
}
```

---

### **Health Check**

```
GET /api/health
```

Check backend health.

**Response:**
```json
{
  "status": "ok",
  "timestamp": 1234567890,
  "database": "connected"
}
```

---

## 🗄️ Database Schema

### Tables

**1. `user_services`**
```sql
CREATE TABLE user_services (
  id TEXT PRIMARY KEY,
  owner_address TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  upstream_url TEXT NOT NULL,
  proxy_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  network TEXT NOT NULL DEFAULT 'base',
  currency TEXT NOT NULL DEFAULT 'USDC',
  discoverable INTEGER NOT NULL DEFAULT 1,
  health_endpoint TEXT,
  docs_type TEXT,
  docs_url TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**2. `payment_nonces`**
```sql
CREATE TABLE payment_nonces (
  id SERIAL PRIMARY KEY,
  nonce TEXT NOT NULL UNIQUE,
  user_address TEXT NOT NULL,
  service_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  network TEXT NOT NULL,
  used_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);
```

**3. `api_calls`** (Analytics)
```sql
CREATE TABLE api_calls (
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
```

**4. `service_stats`** (Aggregated)
```sql
CREATE TABLE service_stats (
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
```

---

## 🔐 Security

### Payment Verification

1. **Signature Verification**: EIP-712 signature validation
2. **Amount Validation**: Exact amount matching
3. **Recipient Validation**: Payment goes to platform wallet
4. **Network Validation**: Correct chain ID
5. **Timestamp Check**: Max 5 minutes old
6. **Nonce Uniqueness**: Prevents replay attacks

### Replay Attack Prevention

- Each payment has a unique nonce
- Nonces are stored in database when used
- Expired nonces are cleaned up hourly
- Duplicate nonces are rejected

### CORS Configuration

Configured in `vercel.json`:
```json
{
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        {
          "key": "Access-Control-Allow-Origin",
          "value": "*"
        }
      ]
    }
  ]
}
```

---

## 🚀 Deployment

### Vercel (Recommended)

```bash
# Deploy to Vercel
vercel deploy --prod

# Set environment variables in Vercel dashboard
# - DATABASE_URL
# - PLATFORM_WALLET
# - CRON_SECRET
```

### Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Deploy
railway up
```

### Docker

```bash
# Build image
docker build -t x402-backend .

# Run container
docker run -p 3001:3001 \
  -e DATABASE_URL="postgresql://..." \
  -e PLATFORM_WALLET="0x..." \
  x402-backend
```

---

## 🔧 Development

### Run Development Server

```bash
npm run dev
```

### Run Tests

```bash
npm test
```

### Lint Code

```bash
npm run lint
```

### Database Migrations

```bash
# Auto-run on server start
# Or manually:
npm run db:migrate
```

---

## Monitoring

### Health Check

```bash
curl http://localhost:3001/api/health
```

### Analytics Query

```bash
curl http://localhost:3001/api/analytics/my-service-id
```

### Nonce Cleanup Status

```bash
curl http://localhost:3001/api/nonces/cleanup \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

---

## 🐛 Troubleshooting

### Database Connection Issues

**Error:** `Database not available`

**Solution:**
1. Check `DATABASE_URL` is set correctly
2. Verify Supabase project is active
3. Check connection string format: `postgresql://user:pass@host:port/db`

### Gateway Not Proxying

**Error:** `Service not found`

**Solution:**
1. Verify service is registered in `user_services` table
2. Check `ownerAddress` and `id` match URL
3. Ensure service `status` is `active`

### Nonce Already Used

**Error:** `Nonce already used (replay attack detected)`

**Solution:**
- Generate a new unique nonce for each payment
- Check if cron job is running to cleanup old nonces
- Manually cleanup: `DELETE FROM payment_nonces WHERE expires_at < NOW();`

---

## 📝 License

MIT

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

## 📧 Support

For issues and questions, please open a GitHub issue.

---

**Built with ❤️ for the x402 platform**
