/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database/client';
import { userServices, paymentNonces, apiCalls } from '@/lib/database/schema';
import { eq, and } from 'drizzle-orm';
import { isAddress, recoverMessageAddress } from 'viem';

/**
 * X402 Gateway - Proxy Service for API Payment Processing
 * 
 * URL Format: /api/gateway/{userId}/{serviceId}/{...endpoint}
 * 
 * Flow:
 * 1. Parse URL to extract userId, serviceId, and endpoint path
 * 2. Lookup service in registry
 * 3. Check for X-Payment header
 * 4. If no payment:
 *    - GET requests → Return HTML payment page
 *    - Other requests → Return JSON 402 response
 * 5. If payment provided → Verify payment
 * 6. Forward request to upstream API
 * 7. Track usage and return response
 */

interface PaymentProof {
  signature: string;
  amount: string;
  token: string;
  recipient: string;
  network: string;
  timestamp: number;
  nonce: string;
  from: string;
}

interface ServiceRecord {
  id: string;
  ownerAddress: string;
  paymentRecipient: string;
  paymentRecipientEns: string | null;
  name: string;
  description: string | null;
  upstreamUrl: string;
  proxyUrl: string;
  status: string;
  network: string;
  currency: string;
  pricePerRequest: string;
  discoverable: number;
  healthEndpoint: string | null;
  docsType: string | null;
  docsUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Note: x402 operates with 0% platform fee - providers keep 100% of payments
// This makes us the most provider-friendly monetization platform!

// Token addresses by network
const TOKEN_ADDRESSES: Record<string, Record<string, string>> = {
  base: {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  },
  ethereum: {
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  },
  optimism: {
    USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  },
  arbitrum: {
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },
  polygon: {
    USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  },
};

/**
 * Check if nonce has been used (replay attack prevention)
 */
async function isNonceUsed(nonce: string, userAddress: string): Promise<boolean> {
  if (!db) {
    console.warn('[Gateway] Database not available, skipping nonce check');
    return false;
  }

  try {
    const results = await db
      .select()
      .from(paymentNonces)
      .where(
        and(
          eq(paymentNonces.nonce, nonce),
          eq(paymentNonces.userAddress, userAddress.toLowerCase())
        )
      )
      .limit(1);

    return results.length > 0;
  } catch (error) {
    console.error('[Gateway] Error checking nonce:', error);
    return false; // Fail open for now
  }
}

/**
 * Mark nonce as used
 */
async function markNonceUsed(
  nonce: string,
  userAddress: string,
  serviceId: string,
  amount: string,
  network: string
): Promise<void> {
  if (!db) {
    console.warn('[Gateway] Database not available, skipping nonce storage');
    return;
  }

  try {
    // Store nonce with 1 hour expiration
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    
    await db.insert(paymentNonces).values({
      nonce,
      userAddress: userAddress.toLowerCase(),
      serviceId,
      amount,
      network,
      expiresAt,
    });
  } catch (error) {
    console.error('[Gateway] Error storing nonce:', error);
    // Don't throw - this shouldn't block the request
  }
}

/**
 * Track API call for analytics
 */
async function trackApiCall(
  serviceId: string,
  serviceName: string,
  endpoint: string,
  method: string,
  payerAddress: string,
  amount: string,
  network: string,
  responseTime: number,
  statusCode: number,
  error?: string
): Promise<void> {
  if (!db) {
    return;
  }

  try {
    // Parse amount to formatted value
    const amountBigInt = BigInt(amount);
    const amountFormatted = Number(amount) / 1_000_000; // Assuming 6 decimals for USDC

    await db.insert(apiCalls).values({
      serviceId,
      serviceName,
      endpoint,
      method,
      payerAddress: payerAddress.toLowerCase(),
      amount: Number(amountBigInt),
      amountFormatted,
      network,
      responseTime,
      statusCode,
      error,
    });
  } catch (error) {
    console.error('[Gateway] Error tracking API call:', error);
    // Don't throw - analytics shouldn't block requests
  }
}

/**
 * Verify payment signature and check for replay attacks
 */
async function verifyPayment(
  payment: PaymentProof,
  expectedAmount: string,
  expectedRecipient: string,
  expectedNetwork: string,
  serviceId: string
): Promise<boolean> {
  try {
    // 1. Verify amount
    if (payment.amount !== expectedAmount) {
      console.error('[Gateway] Amount mismatch:', { expected: expectedAmount, received: payment.amount });
      return false;
    }

    // 2. Verify recipient
    if (payment.recipient.toLowerCase() !== expectedRecipient.toLowerCase()) {
      console.error('[Gateway] Recipient mismatch:', { expected: expectedRecipient, received: payment.recipient });
      return false;
    }

    // 3. Verify network
    if (payment.network !== expectedNetwork) {
      console.error('[Gateway] Network mismatch:', { expected: expectedNetwork, received: payment.network });
      return false;
    }

    // 4. Verify timestamp (must be within 5 minutes)
    const now = Math.floor(Date.now() / 1000);
    const MAX_AGE = 300; // 5 minutes
    if (Math.abs(now - payment.timestamp) > MAX_AGE) {
      console.error('[Gateway] Payment timestamp too old or in future');
      return false;
    }

    // 5. Check for replay attack (nonce must be unique)
    const nonceAlreadyUsed = await isNonceUsed(payment.nonce, payment.from);
    if (nonceAlreadyUsed) {
      console.error('[Gateway] Nonce already used (replay attack detected)');
      return false;
    }
    
    // 6. Verify signature
    const message = JSON.stringify({
      amount: payment.amount,
      token: payment.token,
      recipient: payment.recipient,
      network: payment.network,
      timestamp: payment.timestamp,
      nonce: payment.nonce,
    });

    try {
      const recoveredAddress = await recoverMessageAddress({
        message,
        signature: payment.signature as `0x${string}`,
      });

      if (recoveredAddress.toLowerCase() !== payment.from.toLowerCase()) {
        console.error('[Gateway] Signature verification failed');
        return false;
      }
    } catch (error) {
      console.error('[Gateway] Signature verification error:', error);
      return false;
    }

    // 7. Mark nonce as used
    await markNonceUsed(payment.nonce, payment.from, serviceId, payment.amount, payment.network);
    
    // console.log(`[Gateway]  Payment verified: ${payment.amount} from ${payment.from}`);

    return true;
  } catch (error) {
    console.error('[Gateway] Payment verification error:', error);
    return false;
  }
}

/**
 * Generate 402 Payment Required response (JSON)
 * Using x402 v2 protocol specification
 */
function generate402Response(service: ServiceRecord, endpoint: string, requestUrl: string): NextResponse {
  const tokenAddress = TOKEN_ADDRESSES[service.network]?.[service.currency] || '';

  return NextResponse.json({
    x402Version: 2, //  Upgraded to v2
    accepts: [{
      scheme: 'exact',
      network: service.network,
      maxAmountRequired: service.pricePerRequest,
      resource: requestUrl,
      description: `${service.name} - ${service.description || 'API access requires payment'}`,
      mimeType: 'application/json',
      payTo: service.paymentRecipient, //  100% goes to provider
      maxTimeoutSeconds: 300,
      asset: tokenAddress,
      extra: {
        name: service.currency,
        version: '2',
        serviceName: service.name,
        serviceId: service.id,
        endpoint,
        providerAddress: service.paymentRecipient,
        providerEnsName: service.paymentRecipientEns || null,
        platformFee: '0', //  0% platform fee
        note: 'x402 charges 0% fees - providers keep 100% of earnings',
      }
    }],
    error: 'Payment required. Please provide X-Payment header with valid payment proof.'
  }, { status: 402 });
}

/**
 * Generate HTML payment page for GET requests
 */
function generatePaymentPage(service: ServiceRecord, endpoint: string, requestUrl: string): NextResponse {
  const tokenAddress = TOKEN_ADDRESSES[service.network]?.[service.currency] || '';
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Required - ${service.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', monospace;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 600px;
      width: 100%;
      padding: 40px;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
    }
    .logo {
      font-size: 48px;
      margin-bottom: 10px;
    }
    h1 {
      color: #333;
      font-size: 28px;
      margin-bottom: 10px;
    }
    .subtitle {
      color: #666;
      font-size: 14px;
    }
    .info-box {
      background: #f8f9fa;
      border: 2px solid #667eea;
      border-radius: 10px;
      padding: 20px;
      margin: 20px 0;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px dashed #ddd;
    }
    .info-row:last-child {
      border-bottom: none;
    }
    .label {
      color: #666;
      font-weight: bold;
    }
    .value {
      color: #333;
      font-weight: bold;
    }
    .price {
      font-size: 32px;
      color: #667eea;
      text-align: center;
      margin: 20px 0;
      font-weight: bold;
    }
    .button {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 15px 30px;
      font-size: 16px;
      font-weight: bold;
      border-radius: 10px;
      cursor: pointer;
      width: 100%;
      margin: 10px 0;
      font-family: 'Courier New', monospace;
      transition: transform 0.2s;
    }
    .button:hover {
      transform: translateY(-2px);
    }
    .button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .alert {
      background: #fff3cd;
      border: 2px solid #ffc107;
      border-radius: 10px;
      padding: 15px;
      margin: 20px 0;
      color: #856404;
    }
    .code {
      background: #f4f4f4;
      padding: 10px;
      border-radius: 5px;
      font-size: 12px;
      word-break: break-all;
      margin: 10px 0;
    }
    .hidden {
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">💳</div>
      <h1>Payment Required</h1>
      <p class="subtitle">${service.name}</p>
    </div>

    <div class="info-box">
      <div class="info-row">
        <span class="label">Endpoint:</span>
        <span class="value">${endpoint}</span>
      </div>
      <div class="info-row">
        <span class="label">Network:</span>
        <span class="value">${service.network.toUpperCase()}</span>
      </div>
      <div class="info-row">
        <span class="label">Token:</span>
        <span class="value">${service.currency}</span>
      </div>
    </div>

    <div class="price">${(Number(service.pricePerRequest) / 1_000_000).toFixed(2)} ${service.currency}</div>

    <div id="alertBox" class="alert hidden"></div>

    <button id="connectButton" class="button">Connect Wallet</button>
    <button id="payButton" class="button hidden" disabled>Pay & Access API</button>

    <div class="info-box" style="margin-top: 30px; background: linear-gradient(135deg, #667eea20 0%, #764ba220 100%); border: 2px solid #667eea;">
      <h3 style="margin-bottom: 10px; color: #667eea;"> 0% Platform Fee!</h3>
      <p style="margin: 0; line-height: 1.6;">
        <strong>${(Number(service.pricePerRequest) / 1_000_000).toFixed(2)} ${service.currency}</strong> goes 100% to the API provider${service.paymentRecipientEns ? ` (<strong>${service.paymentRecipientEns}</strong>)` : ''}. 
        We don't take any cut - you pay exactly what the provider sets!
      </p>
    </div>

    <div class="info-box">
      <h3 style="margin-bottom: 10px;">How it works:</h3>
      <ol style="padding-left: 20px; line-height: 1.8;">
        <li>Connect your Web3 wallet</li>
        <li>Sign a payment authorization</li>
        <li>Access the API endpoint instantly</li>
      </ol>
    </div>

    <div class="code">
      <strong>Payment Details:</strong><br>
      Amount: ${service.pricePerRequest} (${(Number(service.pricePerRequest) / 1_000_000).toFixed(2)} ${service.currency})<br>
      Token: ${tokenAddress}<br>
      Network: ${service.network}<br>
      Recipient: ${service.paymentRecipientEns || service.paymentRecipient}<br>
      Platform Fee: <strong style="color: #10b981;">0% 🎉</strong>
    </div>
  </div>

  <script type="module">
    // Payment page logic would go here
    const connectButton = document.getElementById('connectButton');
    const payButton = document.getElementById('payButton');
    const alertBox = document.getElementById('alertBox');

    function showAlert(message, type = 'alert') {
      alertBox.textContent = message;
      alertBox.className = 'alert ' + type;
      alertBox.classList.remove('hidden');
    }

    connectButton.addEventListener('click', async () => {
      showAlert('Please install a Web3 wallet (e.g., MetaMask) to make payments.', 'alert');
    });
  </script>
</body>
</html>
  `;

  return new NextResponse(html, {
    status: 402,
    headers: {
      'Content-Type': 'text/html',
      'X-Payment-Required': 'true',
    },
  });
}

/**
 * Main gateway handler - ALL HTTP methods
 */
async function handleGatewayRequest(request: NextRequest, params: { path: string[] }) {
  const startTime = Date.now();
  
  try {
    // 1. Parse URL: /api/gateway/{userId}/{serviceId}/{...endpoint}
    const pathSegments = params.path;
    
    if (pathSegments.length < 2) {
      return NextResponse.json({
        error: 'Invalid gateway URL format. Expected: /api/gateway/{userId}/{serviceId}/{endpoint}'
      }, { status: 400 });
    }

    const [userId, serviceId, ...endpointParts] = pathSegments;
    const endpoint = '/' + endpointParts.join('/');
    
    // console.log(`[Gateway] Request: ${request.method} ${endpoint} (User: ${userId}, Service: ${serviceId})`);

    // 2. Lookup service in registry
    if (!db) {
      return NextResponse.json({
        error: 'Database not available. Please try again later.'
      }, { status: 503 });
    }

    const serviceRecords = await db
      .select()
      .from(userServices)
      .where(
        and(
          eq(userServices.ownerAddress, userId),
          eq(userServices.id, serviceId)
        )
      )
      .limit(1);

    if (serviceRecords.length === 0) {
      return NextResponse.json({
        error: 'Service not found or is not active'
      }, { status: 404 });
    }

    const service = serviceRecords[0];

    // Check if service is active
    if (service.status !== 'active') {
      return NextResponse.json({
        error: `Service is currently ${service.status}`
      }, { status: 503 });
    }

    // 3. Check for payment
    const paymentHeader = request.headers.get('X-Payment');
    const requestUrl = request.url;

    if (!paymentHeader) {
      // No payment provided
      if (request.method === 'GET') {
        // Return HTML payment page for GET requests
        return generatePaymentPage(service, endpoint, requestUrl);
      } else {
        // Return JSON 402 for other methods
        return generate402Response(service, endpoint, requestUrl);
      }
    }

    // 4. Verify payment
    let paymentProof: PaymentProof;
    try {
      const decoded = Buffer.from(paymentHeader, 'base64').toString('utf-8');
      paymentProof = JSON.parse(decoded);
    } catch (error) {
      return NextResponse.json({
        error: 'Invalid payment header format. Must be base64-encoded JSON.'
      }, { status: 402 });
    }

    const isValidPayment = await verifyPayment(
      paymentProof,
      service.pricePerRequest,
      service.paymentRecipient, //  Verify payment goes to API provider
      service.network,
      serviceId
    );

    if (!isValidPayment) {
      return NextResponse.json({
        error: 'Payment verification failed. Please check your payment details.'
      }, { status: 402 });
    }

    // 5. Forward request to upstream API
    const upstreamUrl = service.upstreamUrl + endpoint;
    
    // console.log(`[Gateway] Forwarding to upstream: ${upstreamUrl}`);

    const upstreamHeaders = new Headers(request.headers);
    upstreamHeaders.delete('X-Payment'); // Don't forward payment header
    upstreamHeaders.set('X-Forwarded-By', 'x402-gateway');
    upstreamHeaders.set('X-Service-Id', serviceId);

    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      // @ts-expect-error - duplex is needed for streaming
      duplex: 'half',
    });

    // 6. Track usage (async, don't wait)
    const responseTime = Date.now() - startTime;
    // console.log(`[Gateway]  Request completed in ${responseTime}ms - Status: ${upstreamResponse.status}`);
    
    // Track API call asynchronously
    trackApiCall(
      serviceId,
      service.name,
      endpoint,
      request.method,
      paymentProof.from,
      paymentProof.amount,
      service.network,
      responseTime,
      upstreamResponse.status,
      upstreamResponse.ok ? undefined : upstreamResponse.statusText
    ).catch(err => console.error('[Gateway] Analytics tracking error:', err));

    // 7. Return upstream response
    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.set('X-Gateway-Time', `${responseTime}ms`);
    responseHeaders.set('X-Payment-Verified', 'true');

    return new NextResponse(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });

  } catch (error) {
    console.error('[Gateway] Error:', error);
    // Never expose internal errors to frontend
    return NextResponse.json({
      success: false,
      error: 'Gateway temporarily unavailable. Please try again in a moment.'
    }, { status: 500 });
  }
}

// Export handlers for all HTTP methods
// Next.js 15: params are now async and must be awaited
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const params = await context.params;
  return handleGatewayRequest(request, params);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const params = await context.params;
  return handleGatewayRequest(request, params);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const params = await context.params;
  return handleGatewayRequest(request, params);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const params = await context.params;
  return handleGatewayRequest(request, params);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const params = await context.params;
  return handleGatewayRequest(request, params);
}

export async function OPTIONS(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  // Handle CORS preflight
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Payment, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

