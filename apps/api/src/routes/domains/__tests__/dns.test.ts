/**
 * DNS endpoint tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { domains } from '../../../db/schema';
import { MockRegistrar } from '../../../integrations/registrar/mock';
import { createDnsService } from '../../../services/dns';
import { createDnsRoutes } from '../dns';

describe('DNS Endpoints', () => {
  let db: ReturnType<typeof drizzle>;
  let sqlite: Database;
  let dnsService: ReturnType<typeof createDnsService>;
  let app: ReturnType<typeof createDnsRoutes>;

  beforeEach(() => {
    // Create in-memory SQLite database
    sqlite = new Database(':memory:');

    // Initialize Drizzle
    db = drizzle(sqlite);

    // Create tables
    sqlite.exec(`
      CREATE TABLE domains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        tld TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        owner_wallet TEXT NOT NULL,
        target_url TEXT,
        payment_id TEXT UNIQUE,
        registrar_order_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // Create DNS service
    const registrar = new MockRegistrar();
    dnsService = createDnsService(registrar, '203.0.113.1');

    // Create DNS routes
    app = createDnsRoutes(db, dnsService);
  });

  test('GET /domains/:name/dns returns DNS info for registered domain', async () => {
    // Insert test domain
    db.insert(domains)
      .values({
        name: 'test.com',
        tld: 'com',
        status: 'registered',
        ownerWallet: '0x1234',
        targetUrl: 'https://example.com',
        paymentId: 'pay_123',
        registrarOrderId: 'order_123',
      } as any)
      .run();

    const response = await app.request('http://localhost/test.com/dns');

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.domain).toBe('test.com');
    expect(data.serverIp).toBe('203.0.113.1');
    expect(data.records).toHaveLength(2);
    expect(data.records[0].type).toBe('A');
    expect(data.records[0].host).toBe('@');
    expect(data.records[0].value).toBe('203.0.113.1');
    expect(data.records[1].host).toBe('www');
    expect(data.instructions).toBeDefined();
    expect(data.domainStatus).toBe('registered');
  });

  test('GET /domains/:name/dns returns 404 for unregistered domain', async () => {
    const response = await app.request('http://localhost/unknown.com/dns');

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.type).toBe('error:not_found');
    expect(data.title).toBe('Domain Not Found');
  });

  test('GET /domains/:name/dns/verify returns verification result', async () => {
    // Insert test domain
    db.insert(domains)
      .values({
        name: 'verify.com',
        tld: 'com',
        status: 'live',
        ownerWallet: '0x1234',
        targetUrl: 'https://example.com',
        paymentId: 'pay_456',
        registrarOrderId: 'order_456',
      } as any)
      .run();

    const response = await app.request('http://localhost/verify.com/dns/verify');

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.domain).toBe('verify.com');
    expect(data.verified).toBeDefined();
    expect(data.resolvedIps).toBeDefined();
    expect(data.expectedIp).toBe('203.0.113.1');
    expect(data.message).toBeDefined();
  });

  test('GET /domains/:name/dns/verify returns 404 for unregistered domain', async () => {
    const response = await app.request('http://localhost/unknown.com/dns/verify');

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.type).toBe('error:not_found');
  });

  test('DNS info response includes serverIp, records array, and instructions', async () => {
    // Insert test domain
    db.insert(domains)
      .values({
        name: 'info.com',
        tld: 'com',
        status: 'registered',
        ownerWallet: '0x1234',
        targetUrl: null,
        paymentId: 'pay_789',
        registrarOrderId: 'order_789',
      } as any)
      .run();

    const response = await app.request('http://localhost/info.com/dns');

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('serverIp');
    expect(data).toHaveProperty('records');
    expect(data).toHaveProperty('instructions');
    expect(Array.isArray(data.records)).toBe(true);
    expect(Array.isArray(data.instructions)).toBe(true);
    expect(data.instructions.length).toBeGreaterThan(0);
  });

  test('DNS service configureDomain calls registrar getDnsRecords then setDnsRecords', async () => {
    const registrar = new MockRegistrar();
    const service = createDnsService(registrar, '198.51.100.1');

    // Pre-populate with some existing records
    await registrar.setDnsRecords('config.com', [
      { type: 'A', name: '@', value: '1.2.3.4', ttl: 300 },
      { type: 'A', name: 'www', value: '1.2.3.4', ttl: 300 },
      { type: 'CNAME', name: 'mail', value: 'mail.provider.com', ttl: 300 },
    ] as any);

    // Configure domain - should preserve CNAME but replace A records
    const result = await service.configureDomain('config.com');

    expect(result.configured).toBe(true);
    expect(result.records).toHaveLength(2);
    expect(result.records[0].value).toBe('198.51.100.1');
    expect(result.records[1].value).toBe('198.51.100.1');

    // Verify existing records were read and non-A records preserved
    const finalRecords = await registrar.getDnsRecords('config.com');
    expect(finalRecords.length).toBe(3); // 2 A records + 1 CNAME
    const cnameRecord = finalRecords.find((r) => r.type === 'CNAME');
    expect(cnameRecord).toBeDefined();
    expect(cnameRecord?.name).toBe('mail');
  });
});
