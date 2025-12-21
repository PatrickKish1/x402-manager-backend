// Testnet Payment System - Signs transactions using platform wallet
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http } from 'viem';
import { baseSepolia, sepolia } from 'viem/chains';

export interface TestnetPaymentRequest {
  amount: string;
  recipient: string;
  token: string;
  network: string;
}

export interface PaymentProof {
  signature: string;
  amount: string;
  token: string;
  recipient: string;
  network: string;
  timestamp: number;
  nonce: string;
  from: string;
}

/**
 * Sign a testnet payment using platform validator wallet
 * This is ONLY used for FREE validations on testnets
 */
export async function signTestnetPayment(request: TestnetPaymentRequest): Promise<PaymentProof> {
  const { amount, recipient, token, network } = request;

  // Get private key based on network
  const privateKey = getValidatorPrivateKey(network);
  if (!privateKey) {
    throw new Error(`No validator wallet configured for network: ${network}`);
  }

  // Create account from private key
  const account = privateKeyToAccount(privateKey as `0x${string}`);

  // Create wallet client
  const chain = getChainConfig(network);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(getRpcUrl(network)),
  });

  // Generate nonce and timestamp
  const nonce = generateNonce();
  const timestamp = Math.floor(Date.now() / 1000);

  // Create message to sign
  const message = JSON.stringify({
    amount,
    token,
    recipient,
    network,
    timestamp,
    nonce,
  });

  // Sign message
  const signature = await walletClient.signMessage({
    message,
  });

  return {
    signature,
    amount,
    token,
    recipient,
    network,
    timestamp,
    nonce,
    from: account.address,
  };
}

/**
 * Get validator private key for specific testnet
 */
function getValidatorPrivateKey(network: string): string | undefined {
  const keyMap: Record<string, string | undefined> = {
    'base-sepolia': process.env.VALIDATOR_WALLET_PRIVATE_KEY_BASE_SEPOLIA,
    'sepolia': process.env.VALIDATOR_WALLET_PRIVATE_KEY_SEPOLIA,
    'optimism-sepolia': process.env.VALIDATOR_WALLET_PRIVATE_KEY_OPTIMISM_SEPOLIA,
    'arbitrum-sepolia': process.env.VALIDATOR_WALLET_PRIVATE_KEY_ARBITRUM_SEPOLIA,
    'polygon-mumbai': process.env.VALIDATOR_WALLET_PRIVATE_KEY_POLYGON_MUMBAI,
    // Solana uses different signing, would need separate implementation
  };

  return keyMap[network];
}

/**
 * Get chain configuration for viem
 */
function getChainConfig(network: string) {
  const chainMap: Record<string, any> = {
    'base-sepolia': baseSepolia,
    'sepolia': sepolia,
  };

  return chainMap[network] || baseSepolia;
}

/**
 * Get RPC URL for testnet
 */
function getRpcUrl(network: string): string {
  const rpcMap: Record<string, string> = {
    'base-sepolia': process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
    'sepolia': process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',
    'optimism-sepolia': process.env.OPTIMISM_SEPOLIA_RPC_URL || 'https://sepolia.optimism.io',
    'arbitrum-sepolia': process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
  };

  return rpcMap[network] || 'https://sepolia.base.org';
}

/**
 * Generate unique nonce for payment
 */
function generateNonce(): string {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Get validator wallet balance (for monitoring)
 */
export async function getValidatorBalance(network: string): Promise<bigint> {
  const privateKey = getValidatorPrivateKey(network);
  if (!privateKey) {
    return BigInt(0);
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const chain = getChainConfig(network);
  
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(getRpcUrl(network)),
  });

  // This would query the actual balance
  // For now, return 0
  return BigInt(0);
}

