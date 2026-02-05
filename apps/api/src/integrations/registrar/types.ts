/**
 * Abstract registrar interface and type definitions
 *
 * This module provides the abstraction layer for domain registrar operations.
 * Business logic depends on this interface, not specific registrar implementations.
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface DomainAvailability {
  domain: string;
  available: boolean;
  isPremium: boolean;
}

export interface DomainPrice {
  domain: string;
  registrationPrice: number;
  renewalPrice: number;
  currency: 'USD';
}

export interface ContactInfo {
  firstName: string;
  lastName: string;
  address1: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  country: string;
  phone: string;
  email: string;
}

export interface RegistrationResult {
  success: boolean;
  domain: string;
  transactionId: string;
  orderId?: string;
}

export interface DomainStatus {
  domain: string;
  status: 'active' | 'expired' | 'pending' | 'unknown';
  expiresAt?: Date;
  createdAt?: Date;
  nameservers?: string[];
}

export interface RenewalResult {
  success: boolean;
  domain: string;
  transactionId: string;
  orderId?: string;
  expiresAt?: Date;
}

export interface TransferResult {
  success: boolean;
  domain: string;
  transactionId?: string;
}

export interface DnsRecord {
  type: 'A' | 'AAAA' | 'CNAME' | 'URL' | 'URL301' | 'FRAME';
  name: string;
  value: string;
  ttl?: number;
}

// ============================================================================
// Abstract Registrar Class
// ============================================================================

export abstract class DomainRegistrar {
  /**
   * Check if a domain is available for registration
   */
  abstract checkAvailability(domain: string): Promise<DomainAvailability>;

  /**
   * Get pricing information for a domain
   */
  abstract getPrice(domain: string): Promise<DomainPrice>;

  /**
   * Register a domain for the specified number of years
   */
  abstract register(
    domain: string,
    years: number,
    contactInfo: ContactInfo
  ): Promise<RegistrationResult>;

  /**
   * Get the current status of a domain
   */
  abstract getStatus(domain: string): Promise<DomainStatus>;

  /**
   * Set DNS records for a domain
   */
  abstract setDnsRecords(domain: string, records: DnsRecord[]): Promise<void>;

  /**
   * Get current DNS records for a domain
   */
  abstract getDnsRecords(domain: string): Promise<DnsRecord[]>;

  /**
   * Renew a domain for the specified number of years
   */
  abstract renew(domain: string, years: number): Promise<RenewalResult>;

  /**
   * Push/transfer a domain to another registrar account
   */
  abstract pushToAccount(domain: string, targetAccount: string): Promise<TransferResult>;
}

// ============================================================================
// Error Hierarchy
// ============================================================================

/**
 * Base error class for all registrar errors
 */
export class RegistrarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistrarError';
    Object.setPrototypeOf(this, RegistrarError.prototype);
  }
}

/**
 * Thrown when the registrar API is unavailable or returns non-2xx status
 */
export class RegistrarUnavailable extends RegistrarError {
  constructor(message: string = 'Registrar API is unavailable') {
    super(message);
    this.name = 'RegistrarUnavailable';
    Object.setPrototypeOf(this, RegistrarUnavailable.prototype);
  }
}

/**
 * Thrown when attempting to register a domain that is already taken
 */
export class DomainTaken extends RegistrarError {
  constructor(domain: string) {
    super(`Domain ${domain} is already taken`);
    this.name = 'DomainTaken';
    Object.setPrototypeOf(this, DomainTaken.prototype);
  }
}

/**
 * Thrown when attempting to register an invalid or unsupported TLD
 */
export class InvalidTLD extends RegistrarError {
  constructor(tld: string) {
    super(`TLD ${tld} is invalid or not supported`);
    this.name = 'InvalidTLD';
    Object.setPrototypeOf(this, InvalidTLD.prototype);
  }
}

/**
 * Thrown when registrar authentication fails
 */
export class RegistrarAuthError extends RegistrarError {
  constructor(message: string = 'Registrar authentication failed') {
    super(message);
    this.name = 'RegistrarAuthError';
    Object.setPrototypeOf(this, RegistrarAuthError.prototype);
  }
}

/**
 * Thrown when registrar rate limit is exceeded
 */
export class RegistrarRateLimitError extends RegistrarError {
  constructor(message: string = 'Registrar rate limit exceeded') {
    super(message);
    this.name = 'RegistrarRateLimitError';
    Object.setPrototypeOf(this, RegistrarRateLimitError.prototype);
  }
}
