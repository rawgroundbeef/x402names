/**
 * DNS configuration service
 *
 * Handles automatic DNS configuration for registered domains,
 * including A record setup and verification.
 */

import type { DomainRegistrar, DnsRecord } from '../integrations/registrar/types';

/**
 * DNS configuration result
 */
export interface DnsConfigResult {
  configured: boolean;
  records: DnsRecord[];
}

/**
 * DNS info response
 */
export interface DnsInfo {
  domain: string;
  serverIp: string;
  records: Array<{
    type: string;
    host: string;
    value: string;
    ttl: number;
  }>;
  instructions: string[];
}

/**
 * DNS verification result
 */
export interface DnsVerificationResult {
  domain: string;
  verified: boolean;
  resolvedIps: string[];
  expectedIp: string;
  message: string;
}

/**
 * DNS service interface
 */
export interface DnsService {
  configureDomain(domain: string): Promise<DnsConfigResult>;
  getDnsInfo(domain: string, serverIp: string): DnsInfo;
  verifyDns(domain: string, serverIp: string): Promise<DnsVerificationResult>;
}

/**
 * Create DNS service with dependency injection
 *
 * @param registrar - Domain registrar implementation
 * @param serverIp - IP address of the redirect server
 * @returns DNS service instance
 */
export function createDnsService(
  registrar: DomainRegistrar,
  serverIp: string
): DnsService {
  /**
   * Configure DNS A records for a domain using read-modify-write pattern
   *
   * This preserves existing MX, TXT, CNAME records while setting/replacing A records.
   */
  async function configureDomain(domain: string): Promise<DnsConfigResult> {
    // Step 1: Read existing DNS records
    const existingRecords = await registrar.getDnsRecords(domain);

    // Step 2: Filter out existing A records for '@' and 'www' hosts
    const preservedRecords = existingRecords.filter(
      (record) =>
        !(record.type === 'A' && (record.name === '@' || record.name === 'www'))
    );

    // Step 3: Create new A records
    const newARecords: DnsRecord[] = [
      { type: 'A', name: '@', value: serverIp, ttl: 300 },
      { type: 'A', name: 'www', value: serverIp, ttl: 300 },
    ];

    // Step 4: Merge and write back
    const mergedRecords = [...preservedRecords, ...newARecords];
    await registrar.setDnsRecords(domain, mergedRecords);

    return {
      configured: true,
      records: newARecords,
    };
  }

  /**
   * Get DNS configuration info for a domain
   */
  function getDnsInfo(domain: string, ip: string): DnsInfo {
    return {
      domain,
      serverIp: ip,
      records: [
        { type: 'A', host: '@', value: ip, ttl: 300 },
        { type: 'A', host: 'www', value: ip, ttl: 300 },
      ],
      instructions: [
        `Configure DNS A record for '@' (root domain) pointing to ${ip}`,
        `Configure DNS A record for 'www' subdomain pointing to ${ip}`,
        'DNS changes may take up to 48 hours to propagate globally',
        'Use the /dns/verify endpoint to check propagation status',
      ],
    };
  }

  /**
   * Verify DNS is properly configured
   */
  async function verifyDns(
    domain: string,
    expectedIp: string
  ): Promise<DnsVerificationResult> {
    try {
      // Use Bun's built-in DNS resolver
      const results = await Bun.dns.resolve(domain, 'A');
      const resolvedIps = results || [];

      // Check if any resolved IP matches expected IP
      const verified = resolvedIps.includes(expectedIp);

      return {
        domain,
        verified,
        resolvedIps,
        expectedIp,
        message: verified
          ? `DNS is correctly configured. ${domain} resolves to ${expectedIp}`
          : resolvedIps.length > 0
          ? `DNS is configured but points to ${resolvedIps.join(', ')} instead of ${expectedIp}`
          : `DNS is not yet configured. ${domain} does not resolve to any IP address`,
      };
    } catch (error) {
      // DNS resolution failed (domain doesn't resolve)
      return {
        domain,
        verified: false,
        resolvedIps: [],
        expectedIp,
        message:
          error instanceof Error
            ? `DNS resolution failed: ${error.message}`
            : `DNS resolution failed: ${domain} does not resolve`,
      };
    }
  }

  return {
    configureDomain,
    getDnsInfo,
    verifyDns,
  };
}
