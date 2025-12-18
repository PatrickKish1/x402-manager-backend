/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase, db } from '@/lib/database/client';
import { userServices } from '@/lib/database/schema';
import { eq } from 'drizzle-orm';

// Next.js 15: params are now async
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await initializeDatabase();
    
    if (!db) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 503 }
      );
    }

    const params = await context.params;
    const serviceId = params.id;
    
    // Delete from database
    const result = await db
      .delete(userServices)
      .where(eq(userServices.id, serviceId))
      .returning();
    
    if (result.length === 0) {
      return NextResponse.json(
        { error: 'Service not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ 
      success: true,
      message: 'Service deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting user service:', error);
    return NextResponse.json(
      { error: 'Failed to delete service', details: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await initializeDatabase();
    
    if (!db) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 503 }
      );
    }

    const params = await context.params;
    const serviceId = params.id;
    const updates = await request.json();
    
    // Prepare update data (exclude id and timestamps)
    const updateData: any = {};
    const allowedFields = [
      'name', 'description', 'upstreamUrl', 'proxyUrl', 
      'status', 'network', 'currency', 'discoverable',
      'healthEndpoint', 'docsType', 'docsUrl'
    ];
    
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        // Convert discoverable boolean to integer
        if (field === 'discoverable') {
          updateData[field] = updates[field] ? 1 : 0;
        } else {
          updateData[field] = updates[field];
        }
      }
    }
    
    // Always update updatedAt
    updateData.updatedAt = new Date();
    
    // Update in database
    const result = await db
      .update(userServices)
      .set(updateData)
      .where(eq(userServices.id, serviceId))
      .returning();
    
    if (result.length === 0) {
      return NextResponse.json(
        { error: 'Service not found' },
        { status: 404 }
      );
    }
    
    // Convert discoverable integer to boolean for response
    const updatedService = {
      ...result[0],
      discoverable: result[0].discoverable === 1
    };
    
    return NextResponse.json({ 
      success: true, 
      id: serviceId,
      service: updatedService
    });
  } catch (error: any) {
    console.error('Error updating user service:', error);
    return NextResponse.json(
      { error: 'Failed to update service', details: error.message },
      { status: 500 }
    );
  }
}

