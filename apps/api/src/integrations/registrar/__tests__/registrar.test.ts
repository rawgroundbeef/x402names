/**
 * Registrar interface and mock tests
 *
 * Tests the error hierarchy and MockRegistrar conformance to DomainRegistrar.
 * Does NOT test NamecheapRegistrar (requires external API).
 */

import { describe, test, expect } from 'bun:test';
import {
  DomainRegistrar,
  RegistrarError,
  RegistrarUnavailable,
  DomainTaken,
  InvalidTLD,
  RegistrarAuthError,
  RegistrarRateLimitError,
  ContactInfo,
} from '../types';
import { MockRegistrar } from '../mock';

describe('Error Hierarchy', () => {
  test('RegistrarError is instanceof Error', () => {
    const error = new RegistrarError('test error');
    expect(error instanceof Error).toBe(true);
    expect(error instanceof RegistrarError).toBe(true);
    expect(error.name).toBe('RegistrarError');
    expect(error.message).toBe('test error');
  });

  test('DomainTaken is instanceof RegistrarError', () => {
    const error = new DomainTaken('example.com');
    expect(error instanceof Error).toBe(true);
    expect(error instanceof RegistrarError).toBe(true);
    expect(error instanceof DomainTaken).toBe(true);
    expect(error.name).toBe('DomainTaken');
    expect(error.message).toContain('example.com');
  });

  test('InvalidTLD is instanceof RegistrarError', () => {
    const error = new InvalidTLD('.xyz');
    expect(error instanceof Error).toBe(true);
    expect(error instanceof RegistrarError).toBe(true);
    expect(error instanceof InvalidTLD).toBe(true);
    expect(error.name).toBe('InvalidTLD');
    expect(error.message).toContain('.xyz');
  });

  test('RegistrarUnavailable is instanceof RegistrarError', () => {
    const error = new RegistrarUnavailable('API down');
    expect(error instanceof Error).toBe(true);
    expect(error instanceof RegistrarError).toBe(true);
    expect(error instanceof RegistrarUnavailable).toBe(true);
    expect(error.name).toBe('RegistrarUnavailable');
    expect(error.message).toBe('API down');
  });

  test('RegistrarAuthError is instanceof RegistrarError', () => {
    const error = new RegistrarAuthError('Invalid credentials');
    expect(error instanceof Error).toBe(true);
    expect(error instanceof RegistrarError).toBe(true);
    expect(error instanceof RegistrarAuthError).toBe(true);
    expect(error.name).toBe('RegistrarAuthError');
    expect(error.message).toBe('Invalid credentials');
  });

  test('RegistrarRateLimitError is instanceof RegistrarError', () => {
    const error = new RegistrarRateLimitError('Too many requests');
    expect(error instanceof Error).toBe(true);
    expect(error instanceof RegistrarError).toBe(true);
    expect(error instanceof RegistrarRateLimitError).toBe(true);
    expect(error.name).toBe('RegistrarRateLimitError');
    expect(error.message).toBe('Too many requests');
  });

  test('Each error has correct name property', () => {
    expect(new RegistrarError('test').name).toBe('RegistrarError');
    expect(new DomainTaken('test.com').name).toBe('DomainTaken');
    expect(new InvalidTLD('.com').name).toBe('InvalidTLD');
    expect(new RegistrarUnavailable('test').name).toBe('RegistrarUnavailable');
    expect(new RegistrarAuthError('test').name).toBe('RegistrarAuthError');
    expect(new RegistrarRateLimitError('test').name).toBe('RegistrarRateLimitError');
  });

  test('Each error has descriptive message', () => {
    expect(new RegistrarError('custom message').message).toBe('custom message');
    expect(new DomainTaken('example.com').message).toContain('example.com');
    expect(new InvalidTLD('.xyz').message).toContain('.xyz');
    expect(new RegistrarUnavailable('down').message).toBe('down');
    expect(new RegistrarAuthError('auth fail').message).toBe('auth fail');
    expect(new RegistrarRateLimitError('rate limit').message).toBe('rate limit');
  });
});

describe('MockRegistrar', () => {
  const mockRegistrar = new MockRegistrar();

  const testContactInfo: ContactInfo = {
    firstName: 'John',
    lastName: 'Doe',
    address1: '123 Test St',
    city: 'San Francisco',
    stateProvince: 'CA',
    postalCode: '94102',
    country: 'US',
    phone: '+1.4155551234',
    email: 'john@example.com',
  };

  test('MockRegistrar is instanceof DomainRegistrar', () => {
    expect(mockRegistrar instanceof DomainRegistrar).toBe(true);
  });

  test('checkAvailability returns available: true for normal domain', async () => {
    const result = await mockRegistrar.checkAvailability('test.com');
    expect(result.domain).toBe('test.com');
    expect(result.available).toBe(true);
    expect(result.isPremium).toBe(false);
  });

  test('checkAvailability returns available: false for taken- prefix', async () => {
    const result = await mockRegistrar.checkAvailability('taken-example.com');
    expect(result.domain).toBe('taken-example.com');
    expect(result.available).toBe(false);
    expect(result.isPremium).toBe(false);
  });

  test('getPrice returns correct price for .com', async () => {
    const result = await mockRegistrar.getPrice('test.com');
    expect(result.domain).toBe('test.com');
    expect(result.registrationPrice).toBe(10.98);
    expect(result.renewalPrice).toBe(10.98);
    expect(result.currency).toBe('USD');
  });

  test('getPrice returns correct price for .io', async () => {
    const result = await mockRegistrar.getPrice('test.io');
    expect(result.domain).toBe('test.io');
    expect(result.registrationPrice).toBe(39.98);
    expect(result.renewalPrice).toBe(39.98);
    expect(result.currency).toBe('USD');
  });

  test('getPrice returns correct price for .net', async () => {
    const result = await mockRegistrar.getPrice('test.net');
    expect(result.registrationPrice).toBe(13.98);
  });

  test('getPrice returns correct price for .org', async () => {
    const result = await mockRegistrar.getPrice('test.org');
    expect(result.registrationPrice).toBe(14.98);
  });

  test('getPrice returns default price for unknown TLD', async () => {
    const result = await mockRegistrar.getPrice('test.xyz');
    expect(result.registrationPrice).toBe(10.98);
  });

  test('register returns success with MOCK- transactionId', async () => {
    const result = await mockRegistrar.register('newdomain.com', 1, testContactInfo);
    expect(result.success).toBe(true);
    expect(result.domain).toBe('newdomain.com');
    expect(result.transactionId).toMatch(/^MOCK-/);
    expect(result.orderId).toMatch(/^MOCK-ORDER-/);
  });

  test('register makes domain unavailable for future checks', async () => {
    const domain = 'registered-test.com';

    // Initially available
    const beforeRegister = await mockRegistrar.checkAvailability(domain);
    expect(beforeRegister.available).toBe(true);

    // Register it
    await mockRegistrar.register(domain, 1, testContactInfo);

    // Now unavailable
    const afterRegister = await mockRegistrar.checkAvailability(domain);
    expect(afterRegister.available).toBe(false);
  });

  test('getStatus returns active status for registered domain', async () => {
    const domain = 'status-test.com';
    await mockRegistrar.register(domain, 1, testContactInfo);

    const result = await mockRegistrar.getStatus(domain);
    expect(result.domain).toBe(domain);
    expect(result.status).toBe('active');
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.nameservers).toEqual(['ns1.mock.com', 'ns2.mock.com']);
  });

  test('getStatus returns unknown status for unregistered domain', async () => {
    const result = await mockRegistrar.getStatus('never-registered.com');
    expect(result.status).toBe('unknown');
    expect(result.expiresAt).toBeUndefined();
    expect(result.createdAt).toBeUndefined();
    expect(result.nameservers).toBeUndefined();
  });

  test('getDnsRecords returns empty array initially', async () => {
    const result = await mockRegistrar.getDnsRecords('test.com');
    expect(result).toEqual([]);
  });

  test('setDnsRecords resolves without error', async () => {
    await expect(
      mockRegistrar.setDnsRecords('test.com', [
        { type: 'A', name: '@', value: '192.0.2.1' },
      ])
    ).resolves.toBeUndefined();
  });

  test('setDnsRecords persists records for getDnsRecords', async () => {
    const domain = 'dns-test.com';
    const records = [
      { type: 'A' as const, name: '@', value: '192.0.2.1' },
      { type: 'CNAME' as const, name: 'www', value: 'example.com' },
    ];

    await mockRegistrar.setDnsRecords(domain, records);
    const result = await mockRegistrar.getDnsRecords(domain);

    expect(result).toEqual(records);
  });
});

describe('Type Safety', () => {
  test('MockRegistrar is assignable to DomainRegistrar variable', () => {
    const registrar: DomainRegistrar = new MockRegistrar();
    expect(registrar).toBeInstanceOf(DomainRegistrar);
    expect(registrar).toBeInstanceOf(MockRegistrar);
  });

  test('All DomainRegistrar methods are callable through base class reference', async () => {
    const registrar: DomainRegistrar = new MockRegistrar();

    const testContact: ContactInfo = {
      firstName: 'Test',
      lastName: 'User',
      address1: '123 Main St',
      city: 'Anytown',
      stateProvince: 'CA',
      postalCode: '12345',
      country: 'US',
      phone: '+1.5555555555',
      email: 'test@example.com',
    };

    // All methods should be callable and return expected types
    const availability = await registrar.checkAvailability('test.com');
    expect(availability).toHaveProperty('available');

    const price = await registrar.getPrice('test.com');
    expect(price).toHaveProperty('registrationPrice');

    const registration = await registrar.register('test.com', 1, testContact);
    expect(registration).toHaveProperty('success');

    const status = await registrar.getStatus('test.com');
    expect(status).toHaveProperty('status');

    await registrar.setDnsRecords('test.com', []);
    const records = await registrar.getDnsRecords('test.com');
    expect(Array.isArray(records)).toBe(true);
  });
});
