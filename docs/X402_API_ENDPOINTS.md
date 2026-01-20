# X402 Services API Endpoints

Complete API documentation for fetching x402 services from the backend database.

## Base URL

All endpoints are prefixed with `/api/x402/services`

## Endpoints

### 1. Get Paginated Services

**GET** `/api/x402/services`

Get a paginated list of all x402 services with detailed JSON response.

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | `1` | Page number (ignored if `offset` is provided) |
| `offset` | number | - | Direct offset (takes precedence over `page`) |
| `limit` | number | `50` | Items per page (max: 100) |
| `type` | string | - | Filter by service type (e.g., `api`, `data`) |
| `network` | string | - | Filter by network (e.g., `eip155:8453`) |
| `search` | string | - | Search in name, description, or resource URL |
| `sortBy` | string | `synced_at` | Field to sort by |
| `sortOrder` | string | `desc` | Sort order: `asc` or `desc` |

#### Example Request

```bash
curl "http://localhost:3000/api/x402/services?page=1&limit=20&type=api&network=eip155:8453"
```

#### Response

```json
{
  "success": true,
  "services": [
    {
      "id": "a1b2c3d4e5f6g7h8",
      "serviceId": "a1b2c3d4e5f6g7h8",
      "resource": "https://api.example.com/v1/data",
      "type": "api",
      "x402Version": 1,
      "lastUpdated": "2024-01-15T10:30:00Z",
      "metadata": {
        "name": "example-com-v1-data",
        "description": "Example API service",
        "tags": ["data", "api"]
      },
      "accepts": [...],
      "payment": {
        "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "network": "eip155:8453",
        "maxAmountRequired": "1000000",
        "maxTimeoutSeconds": 30,
        "scheme": "upto",
        "payTo": "0x..."
      },
      "network": "eip155:8453",
      "price": "1000000",
      "syncedAt": "2024-01-15T10:30:00Z",
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "offset": 0,
    "limit": 20,
    "total": 1000,
    "totalPages": 50,
    "hasMore": true,
    "hasPrevious": false
  }
}
```

#### JavaScript Example

```javascript
async function fetchServices(page = 1, limit = 50) {
  const response = await fetch(
    `/api/x402/services?page=${page}&limit=${limit}`
  );
  const data = await response.json();
  
  if (data.success) {
    console.log(`Fetched ${data.services.length} services`);
    console.log(`Total: ${data.pagination.total}`);
    return data.services;
  }
}
```

---

### 2. Get Service by ID

**GET** `/api/x402/services/:serviceId`

Get a single service by service ID, including validation information and votes.

#### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `serviceId` | string | Service ID (can also be resource URL for backward compatibility) |

#### Example Request

```bash
curl "http://localhost:3000/api/x402/services/a1b2c3d4e5f6g7h8"
```

#### Response

```json
{
  "success": true,
  "service": {
    "id": "a1b2c3d4e5f6g7h8",
    "serviceId": "a1b2c3d4e5f6g7h8",
    "resource": "https://api.example.com/v1/data",
    "type": "api",
    "x402Version": 1,
    "lastUpdated": "2024-01-15T10:30:00Z",
    "metadata": {
      "name": "example-com-v1-data",
      "description": "Example API service",
      "tags": ["data", "api"]
    },
    "accepts": [...],
    "payment": {...},
    "network": "eip155:8453",
    "price": "1000000",
    "syncedAt": "2024-01-15T10:30:00Z",
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:00Z",
    "validation": {
      "status": "verified",
      "score": 85,
      "lastValidatedAt": "2024-01-15T10:30:00Z",
      "validVoteCount": 10,
      "invalidVoteCount": 2,
      "lastValidatedByAddress": "0x1234...",
      "validationMode": "free",
      "testnetChain": "base-sepolia",
      "validationResults": {...}
    },
    "votes": [
      {
        "userAddress": "0x1234...",
        "vote": "valid",
        "reason": null,
        "validationDetails": {...},
        "testResponse": {...},
        "validationMode": "free",
        "testnetChain": "base-sepolia",
        "createdAt": "2024-01-15T10:30:00Z",
        "updatedAt": "2024-01-15T10:30:00Z"
      }
    ]
  }
}
```

#### JavaScript Example

```javascript
async function getServiceDetails(serviceId) {
  const response = await fetch(`/api/x402/services/${serviceId}`);
  const data = await response.json();
  
  if (data.success) {
    console.log(`Service: ${data.service.metadata.name}`);
    console.log(`Validation Status: ${data.service.validation?.status}`);
    console.log(`Votes: ${data.service.votes.length}`);
    return data.service;
  }
}
```


## Error Responses

All endpoints return errors in this format:

```json
{
  "success": false,
  "error": "Error message",
  "message": "Detailed error description"
}
```

HTTP Status Codes:
- `200` - Success
- `404` - Service not found
- `500` - Server error
- `503` - Service unavailable (database not configured)

