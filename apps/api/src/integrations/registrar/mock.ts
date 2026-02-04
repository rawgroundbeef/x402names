/**
 * Mock registrar for testing
 *
 * Returns realistic hardcoded data without making external API calls.
 * Used for fast, isolated testing and development.
 */

import {
  DomainRegistrar,
  DomainAvailability,
  DomainPrice,
  ContactInfo,
  RegistrationResult,
  DomainStatus,
  DnsRecord,
} from './types';

export class MockRegistrar extends DomainRegistrar {
  private readonly registeredDomains: Set<string> = new Set();
  private readonly dnsRecords: Map<string, DnsRecord[]> = new Map();

  async checkAvailability(domain: string): Promise<DomainAvailability> {
    // Domains starting with "taken-" are unavailable
    const available = !domain.startsWith('taken-') && !this.registeredDomains.has(domain);

    return {
      domain,
      available,
      isPremium: false,
    };
  }

  async getPrice(domain: string): Promise<DomainPrice> {
    const tld = domain.split('.').pop()?.toLowerCase();

    // Realistic TLD pricing
    const priceMap: Record<string, number> = {
      com: 10.98,
      net: 13.98,
      org: 14.98,
      io: 39.98,
    };

    const registrationPrice = priceMap[tld || 'com'] || 10.98;

    return {
      domain,
      registrationPrice,
      renewalPrice: registrationPrice,
      currency: 'USD',
    };
  }

  async register(
    domain: string,
    years: number,
    contactInfo: ContactInfo
  ): Promise<RegistrationResult> {
    // Track registered domains for future availability checks
    this.registeredDomains.add(domain);

    return {
      success: true,
      domain,
      transactionId: `MOCK-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      orderId: `MOCK-ORDER-${Date.now()}`,
    };
  }

  async getStatus(domain: string): Promise<DomainStatus> {
    const isRegistered = this.registeredDomains.has(domain);

    return {
      domain,
      status: isRegistered ? 'active' : 'unknown',
      expiresAt: isRegistered ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) : undefined,
      createdAt: isRegistered ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) : undefined,
      nameservers: isRegistered ? ['ns1.mock.com', 'ns2.mock.com'] : undefined,
    };
  }

  async setDnsRecords(domain: string, records: DnsRecord[]): Promise<void> {
    this.dnsRecords.set(domain, records);
  }

  async getDnsRecords(domain: string): Promise<DnsRecord[]> {
    return this.dnsRecords.get(domain) || [];
  }
}
