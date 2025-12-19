/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase, db } from '@/lib/database/client';
import { userServices } from '@/lib/database/schema';
import { eq } from 'drizzle-orm';
import { resolveENS, lookupENS, validateAddressOrENS } from '@/lib/services/ens-resolver';
import { isAddress } from 'viem';

export async function POST(request: NextRequest) {
  try {
    await initializeDatabase();
    
    if (!db) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 503 }
      );
    }

    const service = await request.json();
    
    // Validate required fields
    if (!service.name || !service.upstreamUrl || !service.proxyUrl || !service.ownerAddress) {
      return NextResponse.json(
        { error: 'Missing required fields: name, upstreamUrl, proxyUrl, ownerAddress' },
        { status: 400 }
      );
    }

    // Validate and resolve payment recipient
    if (!service.paymentRecipient) {
      return NextResponse.json(
        { error: 'Missing required field: paymentRecipient (wallet address or ENS name)' },
        { status: 400 }
      );
    }

    // Validate payment recipient (address or ENS)
    const recipientValidation = validateAddressOrENS(service.paymentRecipient);
    
    let paymentRecipientAddress: string;
    let paymentRecipientEns: string | null = null;

    if (recipientValidation.type === 'address') {
      // Valid address provided
      paymentRecipientAddress = recipientValidation.value;
      
      // Try to lookup ENS name for this address
      const ensLookup = await lookupENS(paymentRecipientAddress);
      if (ensLookup.name) {
        paymentRecipientEns = ensLookup.name;
        // console.log(`[Service Creation] Resolved ENS name for ${paymentRecipientAddress}: ${ensLookup.name}`);
      }
    } else if (recipientValidation.type === 'ens') {
      // ENS name provided, resolve to address
      const ensResolution = await resolveENS(recipientValidation.value);
      if (!ensResolution.address) {
        return NextResponse.json(
          { error: `Could not resolve ENS name: ${recipientValidation.value}` },
          { status: 400 }
        );
      }
      paymentRecipientAddress = ensResolution.address;
      paymentRecipientEns = recipientValidation.value;
      // console.log(`[Service Creation] Resolved ENS ${recipientValidation.value} to ${paymentRecipientAddress}`);
    } else {
      return NextResponse.json(
        { error: 'Invalid payment recipient. Must be a valid wallet address or ENS name.' },
        { status: 400 }
      );
    }

    // Validate price (must be positive number)
    const pricePerRequest = service.pricePerRequest || '1000000'; // Default: 1 USDC
    if (isNaN(parseInt(pricePerRequest)) || parseInt(pricePerRequest) <= 0) {
      return NextResponse.json(
        { error: 'Invalid price. Must be a positive number in atomic units.' },
        { status: 400 }
      );
    }

    // Generate ID if not provided
    const serviceId = service.id || `svc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Insert into database
    const newService = await db.insert(userServices).values({
      id: serviceId,
      ownerAddress: service.ownerAddress.toLowerCase(),
      paymentRecipient: paymentRecipientAddress.toLowerCase(),
      paymentRecipientEns: paymentRecipientEns,
      name: service.name,
      description: service.description || null,
      upstreamUrl: service.upstreamUrl,
      proxyUrl: service.proxyUrl,
      status: service.status || 'active',
      network: service.network || 'base',
      currency: service.currency || 'USDC',
      pricePerRequest: pricePerRequest,
      // Token configuration (for custom ERC-20 tokens)
      tokenAddress: service.tokenAddress || null,
      tokenDecimals: service.tokenDecimals || 6,
      tokenName: service.tokenName || null,
      tokenVersion: service.tokenVersion || '2',
      tokenSymbol: service.tokenSymbol || null,
      discoverable: service.discoverable ? 1 : 0,
      healthEndpoint: service.healthEndpoint || null,
      docsType: service.docsType || null,
      docsUrl: service.docsUrl || null,
    }).returning();
    
    return NextResponse.json({ 
      success: true, 
      id: serviceId,
      service: newService[0],
      paymentInfo: {
        recipient: paymentRecipientAddress,
        ensName: paymentRecipientEns,
        pricePerRequest: pricePerRequest,
        platformFee: '0',
        note: 'x402 charges 0% platform fee - you keep 100% of your earnings! 🎉'
      }
    });
  } catch (error: any) {
    console.error('Error saving user service:', error);
    // Never expose internal errors to frontend
    return NextResponse.json(
      { success: false, error: 'Unable to create service. Please check your input and try again.' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();
    
    if (!db) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const ownerAddress = searchParams.get('owner');
    
    if (!ownerAddress) {
      return NextResponse.json(
        { error: 'owner address required' },
        { status: 400 }
      );
    }
    
    // Fetch services from database
    const services = await db
      .select()
      .from(userServices)
      .where(eq(userServices.ownerAddress, ownerAddress.toLowerCase()))
      .orderBy(userServices.createdAt);
    
    // Convert discoverable integer to boolean for frontend
    const formattedServices = services.map((service: any) => ({
      ...service,
      discoverable: service.discoverable === 1
    }));

    return NextResponse.json({ 
      success: true,
      services: formattedServices 
    });
  } catch (error: any) {
    console.error('Error fetching user services:', error);
    // Never expose internal errors to frontend
    return NextResponse.json(
      { success: false, error: 'Unable to retrieve services. Please try again later.' },
      { status: 500 }
    );
  }
}

