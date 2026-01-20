// X402 Payment Signer - Creates proper EIP-712 signatures for x402 payments
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http } from 'viem';
import { baseSepolia, sepolia } from 'viem/chains';

export interface X402PaymentRequest {
  accept: {
    scheme: string;
    network: string;
    maxAmountRequired: string;
    resource: string;
    description: string;
    mimeType: string;
    payTo: string;
    maxTimeoutSeconds: number;
    asset: string;
    extra?: {
      name: string;
      version: string;
      chainId?: number;
    };
  };
  network: string;
  fromAddress: string | null; // null = use validator wallet
}

export interface X402PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
      data?: string;
    };
  };
}

/**
 * Sign x402 payment using EIP-712
 */
export async function signX402Payment(request: X402PaymentRequest): Promise<X402PaymentPayload> {
  const { accept, network, fromAddress } = request;

  // Get validator private key
  const privateKey = getValidatorPrivateKey(network);
  if (!privateKey) {
    throw new Error(`No validator wallet configured for network: ${network}`);
  }

  // Create account
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const from = fromAddress || account.address;

  // Get chain config
  const chain = getChainConfig(network);
  const chainId = accept.extra?.chainId || chain.id;

  // Create wallet client
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(getRpcUrl(network)),
  });

  // Generate nonce (32 bytes)
  const nonce = generateNonce32();

  // Calculate validity window
  const now = Math.floor(Date.now() / 1000);
  const validAfter = now - 60; // Allow 1 minute clock skew
  const validBefore = now + (accept.maxTimeoutSeconds || 300);

  // Build EIP-712 domain
  const domain = {
    name: accept.extra?.name || 'USD Coin',
    version: accept.extra?.version || '2',
    chainId: chainId,
    verifyingContract: accept.asset as `0x${string}`,
  };

  // Build EIP-712 types
  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  };

  // Build message
  const message = {
    from: from as `0x${string}`,
    to: accept.payTo as `0x${string}`,
    value: BigInt(accept.maxAmountRequired),
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce: nonce as `0x${string}`,
  };

  // Sign typed data using wallet client
  const signature = await walletClient.signTypedData({
    account,
    domain,
    types,
    primaryType: 'TransferWithAuthorization',
    message,
  });

  // Build x402 payload
  const payload: X402PaymentPayload = {
    x402Version: 1,
    scheme: accept.scheme || 'exact',
    network: accept.network,
    payload: {
      signature,
      authorization: {
        from,
        to: accept.payTo,
        value: accept.maxAmountRequired,
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce: nonce,
      },
    },
  };

  return payload;
}

/**
 * Get validator private key for specific network
 */
function getValidatorPrivateKey(network: string): string | undefined {
  const keyMap: Record<string, string | undefined> = {
    'base-sepolia': process.env.VALIDATOR_WALLET_PRIVATE_KEY_BASE_SEPOLIA,
    'sepolia': process.env.VALIDATOR_WALLET_PRIVATE_KEY_SEPOLIA,
    'optimism-sepolia': process.env.VALIDATOR_WALLET_PRIVATE_KEY_OPTIMISM_SEPOLIA,
    'arbitrum-sepolia': process.env.VALIDATOR_WALLET_PRIVATE_KEY_ARBITRUM_SEPOLIA,
    'polygon-mumbai': process.env.VALIDATOR_WALLET_PRIVATE_KEY_POLYGON_MUMBAI,
  };

  return keyMap[network.toLowerCase()];
}

/**
 * Get chain configuration for viem
 */
function getChainConfig(network: string) {
  const chainMap: Record<string, any> = {
    'base-sepolia': baseSepolia,
    'sepolia': sepolia,
  };

  return chainMap[network.toLowerCase()] || baseSepolia;
}

/**
 * Get RPC URL for network
 */
function getRpcUrl(network: string): string {
  const rpcMap: Record<string, string> = {
    'base-sepolia': process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
    'sepolia': process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',
    'optimism-sepolia': process.env.OPTIMISM_SEPOLIA_RPC_URL || 'https://sepolia.optimism.io',
    'arbitrum-sepolia': process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
  };

  return rpcMap[network.toLowerCase()] || 'https://sepolia.base.org';
}

/**
 * Generate 32-byte nonce (bytes32)
 */
function generateNonce32(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

