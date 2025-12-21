// Validator Engine - Core validation logic for x402 services from discovery
import Ajv from 'ajv';
import { db } from '../database/client';
import { validationRequests, validationTestCases, validatedServices } from '../database/schema';
import { eq, sql } from 'drizzle-orm';
import { signX402Payment } from './x402-payment-signer';

const ajv = new Ajv({ allErrors: true, verbose: true });

export interface ValidationRequest {
  serviceId: string;
  service: any; // Full service data from discovery
  validationMode: 'free' | 'user-paid';
  userAddress: string;
  userSignature?: string;
  ipAddress?: string;
}

export interface ValidationResult {
  validationId: number;
  serviceId: string;
  serviceName: string;
  status: 'verified' | 'failed' | 'pending';
  score: number;
  testsPassed: number;
  testsFailed: number;
  totalTests: number;
  testResults: TestResult[];
  tokensSpent: number;
  testnetChain: string;
  errorMessage?: string;
}

export interface TestResult {
  endpoint: string;
  method: string;
  passed: boolean;
  statusCode: number;
  responseTime: number;
  schemaValid: boolean;
  actualOutput?: any;
  errorMessage?: string;
}

/**
 * Main validation function - validates an x402 service
 */
export async function validateService(request: ValidationRequest): Promise<ValidationResult> {
  if (!db) {
    throw new Error('Database not available');
  }

  const service = request.service;
  if (!service || !service.resource) {
    throw new Error('Service data is required');
  }

  // 1. Determine testnet chain from service accepts
  const testnetChain = getTestnetChainFromService(service);
  if (!testnetChain && request.validationMode === 'free') {
    throw new Error('Service does not support testnet. Use user-paid mode for mainnet validation.');
  }

  // 2. Create validation request record
  const [validationRecord] = await db
    .insert(validationRequests)
    .values({
      serviceId: request.serviceId,
      requestedByAddress: request.userAddress,
      requestedByIp: request.ipAddress || null,
      validationMode: request.validationMode,
      status: 'pending',
      testnetChain: testnetChain || null,
      tokensSpent: 0,
      validationResults: null,
    })
    .returning();

  try {
    // 3. Generate test cases from service
    const testCases = await generateTestCases(service);

    // 4. Execute validation tests
    const testResults: TestResult[] = [];
    let totalTokensSpent = 0;

    for (const testCase of testCases) {
      const result = await executeTest(
        service,
        testCase,
        request,
        testnetChain
      );
      testResults.push(result);
      
      // Calculate tokens spent (if payment was made)
      if (result.statusCode === 200 && testnetChain) {
        const accept = getTestnetAccept(service, testnetChain);
        if (accept) {
          totalTokensSpent += parseInt(accept.maxAmountRequired || '0');
        }
      }

      // Store test case result
      await db.insert(validationTestCases).values({
        validationRequestId: validationRecord.id,
        serviceId: request.serviceId,
        endpoint: testCase.endpoint,
        method: testCase.method,
        testInput: testCase.testInput ? JSON.stringify(testCase.testInput) : null,
        expectedOutputSchema: testCase.expectedOutputSchema ? JSON.stringify(testCase.expectedOutputSchema) : null,
        actualOutput: result.actualOutput ? JSON.stringify(result.actualOutput) : null,
        passed: result.passed ? 1 : 0,
        errorMessage: result.errorMessage || null,
        responseTime: result.responseTime,
        statusCode: result.statusCode,
        schemaValid: result.schemaValid ? 1 : 0,
      });
    }

    // 5. Calculate validation score
    const testsPassed = testResults.filter(r => r.passed).length;
    const testsFailed = testResults.filter(r => !r.passed).length;
    const score = calculateValidationScore(testResults);
    const status = score >= 70 ? 'verified' : 'failed';

    // 6. Update validation request with results
    await db
      .update(validationRequests)
      .set({
        status: 'completed',
        tokensSpent: totalTokensSpent,
        validationResults: JSON.stringify({
          score,
          testsPassed,
          testsFailed,
          testResults,
        }),
      })
      .where(eq(validationRequests.id, validationRecord.id));

    // 7. Update or create validated service record
    const serviceName = service.metadata?.name || extractServiceName(service.resource);
    
    const existingValidated = await db
      .select()
      .from(validatedServices)
      .where(eq(validatedServices.serviceId, request.serviceId))
      .limit(1);

    if (existingValidated.length > 0) {
      await db
        .update(validatedServices)
        .set({
          validationStatus: status,
          validationScore: score,
          lastValidatedAt: new Date(),
          validationCount: sql`${validatedServices.validVoteCount} + 1`,
          testnetChain: testnetChain || null,
          validatedByAddress: request.userAddress,
          validationMode: request.validationMode,
          validationResults: JSON.stringify({ score, testsPassed, testsFailed }),
          updatedAt: new Date(),
        })
        .where(eq(validatedServices.serviceId, request.serviceId));
    } else {
      await db.insert(validatedServices).values({
        serviceId: request.serviceId,
        serviceName,
        validationStatus: status,
        validationScore: score,
        lastValidatedAt: new Date(),
        validationCount: 1,
        testnetChain: testnetChain || null,
        validatedByAddress: request.userAddress,
        validationMode: request.validationMode,
        validationResults: JSON.stringify({ score, testsPassed, testsFailed }),
      });
    }

    return {
      validationId: validationRecord.id,
      serviceId: request.serviceId,
      serviceName,
      status,
      score,
      testsPassed,
      testsFailed,
      totalTests: testResults.length,
      testResults,
      tokensSpent: totalTokensSpent,
      testnetChain: testnetChain || 'mainnet',
    };
  } catch (error) {
    await db
      .update(validationRequests)
      .set({
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      })
      .where(eq(validationRequests.id, validationRecord.id));

    throw error;
  }
}

/**
 * Get testnet chain from service accepts
 */
function getTestnetChainFromService(service: any): string | null {
  if (!service.accepts || !Array.isArray(service.accepts)) {
    return null;
  }

  // Look for testnet networks
  const testnetKeywords = ['sepolia', 'mumbai', 'devnet', 'testnet'];
  
  for (const accept of service.accepts) {
    const network = accept.network?.toLowerCase() || '';
    if (testnetKeywords.some(keyword => network.includes(keyword))) {
      return accept.network;
    }
  }

  return null;
}

/**
 * Get testnet accept object for a specific testnet chain
 */
function getTestnetAccept(service: any, testnetChain: string): any {
  if (!service.accepts || !Array.isArray(service.accepts)) {
    return null;
  }

  return service.accepts.find(
    (accept: any) => accept.network?.toLowerCase() === testnetChain.toLowerCase()
  );
}

/**
 * Extract service name from resource URL
 */
function extractServiceName(resource: string): string {
  try {
    const url = new URL(resource);
    return url.hostname.replace('www.', '');
  } catch {
    return 'Unknown Service';
  }
}

/**
 * Generate test cases from service
 */
async function generateTestCases(service: any): Promise<any[]> {
  const testCases = [];

  // Test the main resource endpoint
  testCases.push({
    endpoint: service.resource,
    method: 'GET',
    testInput: null,
    expectedOutputSchema: service.metadata?.outputSchema || null,
  });

  // If service has endpoints defined, test those too
  if (service.endpoints && Array.isArray(service.endpoints)) {
    for (const endpoint of service.endpoints.slice(0, 3)) { // Limit to 3 endpoints
      testCases.push({
        endpoint: endpoint.path || endpoint.endpoint || '/',
        method: endpoint.method || 'GET',
        testInput: endpoint.testInput || null,
        expectedOutputSchema: endpoint.outputSchema || null,
      });
    }
  }

  return testCases;
}

/**
 * Execute a single validation test with proper x402 flow
 */
async function executeTest(
  service: any,
  testCase: any,
  request: ValidationRequest,
  testnetChain: string | null
): Promise<TestResult> {
  const startTime = Date.now();

  try {
    // Step 1: Get payment requirements (make request without payment)
    const testUrl = testCase.endpoint.startsWith('http') 
      ? testCase.endpoint 
      : `${service.resource}${testCase.endpoint}`;

    const requirementsResponse = await fetch(testUrl, {
      method: testCase.method,
      headers: {
        'Accept': 'application/json',
      },
    });

    // If not 402, service doesn't require payment (might be a non-x402 endpoint)
    if (requirementsResponse.status !== 402) {
      const responseTime = Date.now() - startTime;
      const responseData = await requirementsResponse.json().catch(() => ({}));
      
      return {
        endpoint: testCase.endpoint,
        method: testCase.method,
        passed: requirementsResponse.ok,
        statusCode: requirementsResponse.status,
        responseTime,
        schemaValid: true, // Can't validate schema if no x402 response
        actualOutput: responseData,
        errorMessage: requirementsResponse.ok ? undefined : `Unexpected status: ${requirementsResponse.status}`,
      };
    }

    // Step 2: Parse payment requirements
    const requirements = await requirementsResponse.json();
    if (!requirements.accepts || requirements.accepts.length === 0) {
      throw new Error('No payment requirements found in 402 response');
    }

    // Step 3: Select appropriate accept (prefer testnet for free mode)
    let accept = requirements.accepts[0];
    if (testnetChain && request.validationMode === 'free') {
      const testnetAccept = requirements.accepts.find(
        (a: any) => a.network?.toLowerCase().includes(testnetChain.toLowerCase())
      );
      if (testnetAccept) {
        accept = testnetAccept;
      }
    }

    // Step 4: Create payment signature
    let paymentPayload: any = null;
    
    if (request.validationMode === 'free' && testnetChain) {
      // Platform pays (testnet)
      paymentPayload = await signX402Payment({
        accept,
        network: testnetChain,
        fromAddress: null, // Will use validator wallet
      });
    } else if (request.validationMode === 'user-paid' && request.userSignature) {
      // User pays (mainnet) - signature should be provided
      // For now, we'll need to reconstruct the payload from the signature
      // This would require the user to sign on the frontend
      throw new Error('User-paid validation requires frontend payment signing');
    } else {
      throw new Error('Invalid validation mode or missing signature');
    }

    // Step 5: Make request with payment
    const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');
    const paidResponse = await fetch(testUrl, {
      method: testCase.method,
      headers: {
        'Content-Type': 'application/json',
        'X-Payment': paymentHeader,
      },
      body: testCase.method !== 'GET' && testCase.testInput
        ? JSON.stringify(testCase.testInput)
        : undefined,
    });

    const responseTime = Date.now() - startTime;
    const statusCode = paidResponse.status;

    // Step 6: Parse response
    let responseData;
    try {
      responseData = await paidResponse.json();
    } catch {
      responseData = await paidResponse.text();
    }

    // Step 7: Validate schema if provided
    let schemaValid = true;
    if (testCase.expectedOutputSchema && typeof responseData === 'object') {
      try {
        const validate = ajv.compile(testCase.expectedOutputSchema);
        schemaValid = validate(responseData);
      } catch (schemaError) {
        schemaValid = false;
      }
    }

    // Step 8: Determine if test passed
    const passed = paidResponse.ok && schemaValid;

    return {
      endpoint: testCase.endpoint,
      method: testCase.method,
      passed,
      statusCode,
      responseTime,
      schemaValid,
      actualOutput: responseData,
      errorMessage: passed ? undefined : `Status: ${statusCode}, Schema Valid: ${schemaValid}`,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return {
      endpoint: testCase.endpoint,
      method: testCase.method,
      passed: false,
      statusCode: 0,
      responseTime,
      schemaValid: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Calculate validation score (0-100)
 */
function calculateValidationScore(testResults: TestResult[]): number {
  if (testResults.length === 0) return 0;

  let totalScore = 0;
  const weights = {
    statusCode200: 30,
    schemaValid: 40,
    responseTime: 20,
    noErrors: 10,
  };

  for (const result of testResults) {
    let testScore = 0;

    if (result.statusCode === 200) testScore += weights.statusCode200;
    if (result.schemaValid) testScore += weights.schemaValid;
    if (result.responseTime < 2000) testScore += weights.responseTime;
    if (!result.errorMessage) testScore += weights.noErrors;

    totalScore += testScore;
  }

  return Math.min(100, Math.round(totalScore / testResults.length));
}
