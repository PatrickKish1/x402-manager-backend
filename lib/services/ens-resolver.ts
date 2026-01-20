/**
 * ENS Resolver Service
 * Resolves ENS names and reverse lookups for wallet addresses
 * Works across multiple chains (Ethereum, Base, etc.)
 */

import { createPublicClient, http, isAddress, getAddress } from 'viem';
import { mainnet, base } from 'viem/chains';
import { normalize } from 'viem/ens';

/**
 * Resolve ENS name to address
 */
export async function resolveENS(ensName: string): Promise<{
  address: string | null;
  error?: string;
}> {
  try {
    // Validate ENS name format
    if (!ensName || !ensName.includes('.')) {
      return { address: null, error: 'Invalid ENS name format' };
    }

    // Try mainnet first (most ENS names, including .base.eth)
    const mainnetClient = createPublicClient({
      chain: mainnet,
      transport: http(),
    });

    try {
      const normalized = normalize(ensName);
      const address = await mainnetClient.getEnsAddress({ name: normalized });
      if (address) {
        return { address };
      }
    } catch (error) {
      // console.log('[ENS] Mainnet resolution failed:', error);
    }

    // Try Base for .base names (not .base.eth)
    if (ensName.endsWith('.base') && !ensName.endsWith('.base.eth')) {
      const baseClient = createPublicClient({
        chain: base,
        transport: http(),
      });

      try {
        const normalized = normalize(ensName);
        const address = await baseClient.getEnsAddress({ name: normalized });
        if (address) {
          return { address };
        }
      } catch (error) {
        // console.log('[ENS] Base resolution failed:', error);
      }
    }

    return { address: null, error: 'ENS name not found' };
  } catch (error) {
    console.error('[ENS] Resolution error:', error);
    return {
      address: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Lookup ENS name for an address (reverse resolution)
 */
export async function lookupENS(address: string): Promise<{
  name: string | null;
  error?: string;
}> {
  try {
    // Validate address
    if (!isAddress(address)) {
      return { name: null, error: 'Invalid address format' };
    }

    // Normalize address to checksummed format
    const checksummedAddress = getAddress(address);

    // Try mainnet first
    const mainnetClient = createPublicClient({
      chain: mainnet,
      transport: http(),
    });

    try {
      const name = await mainnetClient.getEnsName({
        address: checksummedAddress as `0x${string}`,
      });
      if (name) {
        return { name };
      }
    } catch (error) {
      // console.log('[ENS] Mainnet lookup failed:', error);
    }

    // Try Base
    const baseClient = createPublicClient({
      chain: base,
      transport: http(),
    });

    try {
      const name = await baseClient.getEnsName({
        address: checksummedAddress as `0x${string}`,
      });
      if (name) {
        return { name };
      }
    } catch (error) {
      // console.log('[ENS] Base lookup failed:', error);
    }

    // Try external API fallback
    try {
      const apiName = await lookupViaAPI(checksummedAddress);
      if (apiName) {
        return { name: apiName };
      }
    } catch (error) {
      // console.log('[ENS] API lookup failed:', error);
    }

    return { name: null };
  } catch (error) {
    console.error('[ENS] Lookup error:', error);
    return {
      name: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Fallback: Lookup ENS name via external API
 */
async function lookupViaAPI(address: string): Promise<string | null> {
  try {
    // Try ENSData API
    const response = await fetch(`https://api.ensdata.net/address/${address}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (response.ok) {
      const data = await response.json();
      if (data?.name || data?.ensName || data?.domain) {
        return data.name || data.ensName || data.domain;
      }
    }
  } catch (error) {
    // console.log('[ENS] ENSData API failed:', error);
  }

  return null;
}

/**
 * Validate if address or ENS name is provided
 */
export function validateAddressOrENS(input: string): {
  type: 'address' | 'ens' | 'invalid';
  value: string;
} {
  const trimmed = input.trim();

  if (!trimmed) {
    return { type: 'invalid', value: '' };
  }

  // Check if it's a valid address
  if (isAddress(trimmed)) {
    return { type: 'address', value: getAddress(trimmed) };
  }

  // Check if it's an ENS name
  if (trimmed.includes('.') && /^[a-z0-9-]+\.(eth|base|xyz|com)$/i.test(trimmed)) {
    return { type: 'ens', value: trimmed.toLowerCase() };
  }

  return { type: 'invalid', value: trimmed };
}

/**
 * Get display name for an address (ENS name if available, otherwise shortened address)
 */
export function getDisplayName(address: string, ensName?: string | null): string {
  if (ensName) {
    return ensName;
  }

  if (!isAddress(address)) {
    return address;
  }

  // Return shortened address: 0x1234...5678
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

