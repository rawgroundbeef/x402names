/**
 * Namecheap registrar adapter
 *
 * Implements DomainRegistrar interface using Namecheap XML API.
 * Handles XML parsing, error mapping, and API authentication.
 */

import {
  DomainRegistrar,
  DomainAvailability,
  DomainPrice,
  ContactInfo,
  RegistrationResult,
  DomainStatus,
  DnsRecord,
  RenewalResult,
  TransferResult,
  RegistrarError,
  RegistrarUnavailable,
  DomainTaken,
  RegistrarAuthError,
  RegistrarRateLimitError,
} from './types';

export class NamecheapRegistrar extends DomainRegistrar {
  private readonly apiUser: string;
  private readonly apiKey: string;
  private readonly clientIp: string;
  private readonly sandbox: boolean;
  private readonly baseUrl: string;

  constructor(
    apiUser: string,
    apiKey: string,
    clientIp: string,
    sandbox: boolean = false
  ) {
    super();
    this.apiUser = apiUser;
    this.apiKey = apiKey;
    this.clientIp = clientIp;
    this.sandbox = sandbox;
    this.baseUrl = sandbox
      ? 'https://api.sandbox.namecheap.com/xml.response'
      : 'https://api.namecheap.com/xml.response';
  }

  /**
   * Make an API call to Namecheap and return the XML response
   */
  private async callApi(
    command: string,
    params: Record<string, string>
  ): Promise<string> {
    const url = new URL(this.baseUrl);

    // Add base authentication parameters
    url.searchParams.set('ApiUser', this.apiUser);
    url.searchParams.set('ApiKey', this.apiKey);
    url.searchParams.set('UserName', this.apiUser);
    url.searchParams.set('ClientIp', this.clientIp);
    url.searchParams.set('Command', command);

    // Add command-specific parameters
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    try {
      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new RegistrarUnavailable(
          `Namecheap API returned status ${response.status}`
        );
      }

      const xml = await response.text();
      this.parseXmlErrors(xml);

      return xml;
    } catch (error) {
      if (error instanceof RegistrarError) {
        throw error;
      }
      throw new RegistrarUnavailable(
        `Failed to connect to Namecheap API: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Parse XML response for errors and throw appropriate exceptions
   */
  private parseXmlErrors(xml: string): void {
    // Check if response contains errors
    if (!xml.includes('<Errors>')) {
      return;
    }

    // Extract error details using regex
    const errorMatch = xml.match(/<Error Number="(\d+)">(.*?)<\/Error>/);
    if (!errorMatch) {
      throw new RegistrarError('Unknown registrar error');
    }

    const errorNumber = parseInt(errorMatch[1], 10);
    const errorMessage = errorMatch[2];

    // Map Namecheap error codes to typed exceptions
    if (errorNumber === 2030280) {
      throw new DomainTaken(errorMessage);
    }

    if (errorNumber === 1011150) {
      throw new RegistrarAuthError(errorMessage);
    }

    if (errorNumber >= 500000) {
      throw new RegistrarRateLimitError(errorMessage);
    }

    throw new RegistrarError(`Namecheap API error ${errorNumber}: ${errorMessage}`);
  }

  async checkAvailability(domain: string): Promise<DomainAvailability> {
    const xml = await this.callApi('namecheap.domains.check', {
      DomainList: domain,
    });

    // Parse availability from XML response
    const availableMatch = xml.match(/<DomainCheckResult[^>]*Available="(true|false)"/);
    const premiumMatch = xml.match(/IsPremiumName="(true|false)"/);

    return {
      domain,
      available: availableMatch?.[1] === 'true',
      isPremium: premiumMatch?.[1] === 'true',
    };
  }

  async getPrice(domain: string): Promise<DomainPrice> {
    const xml = await this.callApi('namecheap.users.getPricing', {
      ProductType: 'DOMAIN',
      ProductName: domain,
    });

    // Parse pricing from XML response
    const registerPriceMatch = xml.match(
      /<Price Duration="1" DurationType="YEAR" Price="([\d.]+)"/
    );
    const renewPriceMatch = xml.match(
      /<Price Duration="1" DurationType="YEAR"[^>]*RenewalPrice="([\d.]+)"/
    );

    const registrationPrice = registerPriceMatch
      ? parseFloat(registerPriceMatch[1])
      : 0;
    const renewalPrice = renewPriceMatch
      ? parseFloat(renewPriceMatch[1])
      : registrationPrice;

    return {
      domain,
      registrationPrice,
      renewalPrice,
      currency: 'USD',
    };
  }

  async register(
    domain: string,
    years: number,
    contactInfo: ContactInfo
  ): Promise<RegistrationResult> {
    const xml = await this.callApi('namecheap.domains.create', {
      DomainName: domain,
      Years: years.toString(),
      RegistrantFirstName: contactInfo.firstName,
      RegistrantLastName: contactInfo.lastName,
      RegistrantAddress1: contactInfo.address1,
      RegistrantCity: contactInfo.city,
      RegistrantStateProvince: contactInfo.stateProvince,
      RegistrantPostalCode: contactInfo.postalCode,
      RegistrantCountry: contactInfo.country,
      RegistrantPhone: contactInfo.phone,
      RegistrantEmailAddress: contactInfo.email,
      TechFirstName: contactInfo.firstName,
      TechLastName: contactInfo.lastName,
      TechAddress1: contactInfo.address1,
      TechCity: contactInfo.city,
      TechStateProvince: contactInfo.stateProvince,
      TechPostalCode: contactInfo.postalCode,
      TechCountry: contactInfo.country,
      TechPhone: contactInfo.phone,
      TechEmailAddress: contactInfo.email,
      AdminFirstName: contactInfo.firstName,
      AdminLastName: contactInfo.lastName,
      AdminAddress1: contactInfo.address1,
      AdminCity: contactInfo.city,
      AdminStateProvince: contactInfo.stateProvince,
      AdminPostalCode: contactInfo.postalCode,
      AdminCountry: contactInfo.country,
      AdminPhone: contactInfo.phone,
      AdminEmailAddress: contactInfo.email,
      AuxBillingFirstName: contactInfo.firstName,
      AuxBillingLastName: contactInfo.lastName,
      AuxBillingAddress1: contactInfo.address1,
      AuxBillingCity: contactInfo.city,
      AuxBillingStateProvince: contactInfo.stateProvince,
      AuxBillingPostalCode: contactInfo.postalCode,
      AuxBillingCountry: contactInfo.country,
      AuxBillingPhone: contactInfo.phone,
      AuxBillingEmailAddress: contactInfo.email,
    });

    // Parse registration result
    const domainMatch = xml.match(/<DomainCreateResult[^>]*Domain="([^"]+)"/);
    const transactionMatch = xml.match(/TransactionID="(\d+)"/);
    const orderMatch = xml.match(/OrderID="(\d+)"/);
    const registeredMatch = xml.match(/Registered="(true|false)"/);

    return {
      success: registeredMatch?.[1] === 'true',
      domain: domainMatch?.[1] || domain,
      transactionId: transactionMatch?.[1] || '',
      orderId: orderMatch?.[1],
    };
  }

  async getStatus(domain: string): Promise<DomainStatus> {
    const xml = await this.callApi('namecheap.domains.getInfo', {
      DomainName: domain,
    });

    // Parse domain status
    const statusMatch = xml.match(/<Status>([^<]+)<\/Status>/);
    const expiresMatch = xml.match(/<Expires>([^<]+)<\/Expires>/);
    const createdMatch = xml.match(/<CreatedDate>([^<]+)<\/CreatedDate>/);

    // Extract nameservers
    const nameservers: string[] = [];
    const nsRegex = /<Nameserver>([^<]+)<\/Nameserver>/g;
    let nsMatch;
    while ((nsMatch = nsRegex.exec(xml)) !== null) {
      nameservers.push(nsMatch[1]);
    }

    return {
      domain,
      status: this.mapNamecheapStatus(statusMatch?.[1] || 'unknown'),
      expiresAt: expiresMatch ? new Date(expiresMatch[1]) : undefined,
      createdAt: createdMatch ? new Date(createdMatch[1]) : undefined,
      nameservers: nameservers.length > 0 ? nameservers : undefined,
    };
  }

  async setDnsRecords(domain: string, records: DnsRecord[]): Promise<void> {
    const params: Record<string, string> = {
      SLD: domain.split('.')[0],
      TLD: domain.split('.').slice(1).join('.'),
    };

    // Add each DNS record as numbered parameters
    records.forEach((record, index) => {
      const num = index + 1;
      params[`HostName${num}`] = record.name;
      params[`RecordType${num}`] = record.type;
      params[`Address${num}`] = record.value;
      if (record.ttl) {
        params[`TTL${num}`] = record.ttl.toString();
      }
    });

    await this.callApi('namecheap.domains.dns.setHosts', params);
  }

  async getDnsRecords(domain: string): Promise<DnsRecord[]> {
    const xml = await this.callApi('namecheap.domains.dns.getHosts', {
      SLD: domain.split('.')[0],
      TLD: domain.split('.').slice(1).join('.'),
    });

    const records: DnsRecord[] = [];
    const hostRegex = /<host[^>]*HostId="[^"]*"[^>]*Name="([^"]*)"[^>]*Type="([^"]*)"[^>]*Address="([^"]*)"[^>]*TTL="(\d+)"/g;
    let hostMatch;
    while ((hostMatch = hostRegex.exec(xml)) !== null) {
      records.push({
        name: hostMatch[1],
        type: hostMatch[2] as DnsRecord['type'],
        value: hostMatch[3],
        ttl: parseInt(hostMatch[4], 10),
      });
    }

    return records;
  }

  async renew(domain: string, years: number): Promise<RenewalResult> {
    const xml = await this.callApi('namecheap.domains.renew', {
      DomainName: domain,
      Years: years.toString(),
    });

    const transactionMatch = xml.match(/TransactionID="(\d+)"/);
    const orderMatch = xml.match(/OrderID="(\d+)"/);
    const renewedMatch = xml.match(/DomainName="([^"]+)"/);

    return {
      success: true,
      domain: renewedMatch?.[1] || domain,
      transactionId: transactionMatch?.[1] || '',
      orderId: orderMatch?.[1],
    };
  }

  async pushToAccount(domain: string, targetAccount: string): Promise<TransferResult> {
    const xml = await this.callApi('namecheap.domains.transfer.create', {
      DomainName: domain,
      Years: '1',
      ActionType: 'PUSH',
      PushTo: targetAccount,
    });

    const transactionMatch = xml.match(/TransactionID="(\d+)"/);

    return {
      success: true,
      domain,
      transactionId: transactionMatch?.[1],
    };
  }

  /**
   * Map Namecheap status strings to our standardized status type
   */
  private mapNamecheapStatus(
    status: string
  ): 'active' | 'expired' | 'pending' | 'unknown' {
    const normalized = status.toLowerCase();
    if (normalized === 'ok' || normalized === 'active') return 'active';
    if (normalized.includes('expired')) return 'expired';
    if (normalized.includes('pending')) return 'pending';
    return 'unknown';
  }
}
