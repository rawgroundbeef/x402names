import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { MockRegistrar } from '../../../integrations/registrar/mock';
import { createDomainRoutes } from '../index';
import { createJobProcessor } from '../../../lib/jobs/registration';
import { clearAllJobs } from '../../../lib/jobs/queue';
import { problemDetailsErrorHandler } from '../../../lib/errors';
import { DomainCache } from '../../../redirect/cache';
import { createDnsService } from '../../../services/dns';

/**
 * Helper to create a mock payment header
 */
function createMockPaymentHeader(payerWallet: string, amountUsdc: number = 2.00): string {
  const atomicAmount = String(Math.round(amountUsdc * 1_000_000));

  const payload = {
    x402Version: 2,
    resource: { url: '/domains/:name/url', description: 'URL update', mimeType: 'application/json' },
    accepted: { scheme: 'exact', network: 'eip155:84532', asset: 'USDC', amount: atomicAmount, payTo: '0x0', maxTimeoutSeconds: 300, extra: {} },
    payload: {
      authorization: {
        from: payerWallet,
        to: '0x1234567890123456789012345678901234567890',
        value: atomicAmount,
        validAfter: '0',
        validBefore: String(Math.floor(Date.now() / 1000) + 3600),
        nonce: '0x' + crypto.randomUUID().replace(/-/g, ''),
      },
      signature: '0x' + '00'.repeat(65),
    },
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

describe('PATCH /domains/:name/url', () => {
  let sqlite: Database;
  let db: ReturnType<typeof drizzle>;
  let registrar: MockRegistrar;
  let jobProcessor: ReturnType<typeof createJobProcessor>;
  let domainCache: DomainCache;
  let dnsService: ReturnType<typeof createDnsService>;
  let app: Hono;

  const testOwnerWallet = '0xABCDEF1234567890';
  const testDomainName = 'example.com';
  const testTargetUrl = 'https://example.com';

  beforeEach(() => {
    // Create in-memory database
    sqlite = new Database(':memory:');
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

    sqlite.exec(`
      CREATE TABLE payment_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id TEXT NOT NULL UNIQUE,
        wallet_address TEXT NOT NULL,
        amount TEXT NOT NULL,
        network TEXT NOT NULL,
        domain TEXT,
        created_at INTEGER NOT NULL
      );
    `);

    sqlite.exec(`
      CREATE TABLE registration_jobs (
        id TEXT PRIMARY KEY,
        domain_name TEXT NOT NULL,
        tld TEXT NOT NULL,
        owner_wallet TEXT NOT NULL,
        payment_id TEXT NOT NULL UNIQUE,
        amount_paid TEXT NOT NULL,
        target_url TEXT,
        state TEXT NOT NULL DEFAULT 'processing',
        progress INTEGER DEFAULT 0,
        current_step TEXT,
        error TEXT,
        error_code TEXT,
        registrar_order_id TEXT,
        attempts INTEGER DEFAULT 0,
        next_retry_at INTEGER,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );
    `);

    // Insert a test domain
    const now = Date.now();
    sqlite.exec(`
      INSERT INTO domains (name, tld, status, owner_wallet, target_url, created_at, updated_at)
      VALUES ('${testDomainName}', 'com', 'live', '${testOwnerWallet}', '${testTargetUrl}', ${now}, ${now});
    `);

    // Create dependencies
    registrar = new MockRegistrar();
    domainCache = new DomainCache();
    dnsService = createDnsService(registrar, '127.0.0.1');
    jobProcessor = createJobProcessor(registrar, db, dnsService);

    // Create test app
    app = new Hono();
    app.onError(problemDetailsErrorHandler);
    app.route('/domains', createDomainRoutes(registrar, db, jobProcessor, dnsService, domainCache));
  });

  afterEach(() => {
    clearAllJobs();
    sqlite.close();
  });

  test('successfully updates URL with valid payment and owner wallet', async () => {
    const newUrl = 'https://newexample.com';
    const paymentHeader = createMockPaymentHeader(testOwnerWallet, 2.00);

    const response = await app.request(`/domains/${testDomainName}/url`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': paymentHeader,
      },
      body: JSON.stringify({ targetUrl: newUrl }),
    });

    expect(response.status).toBe(200);

    const data: any = await response.json();
    expect(data.success).toBe(true);
    expect(data.updated).toBe(true);
    expect(data.domain).toBe(testDomainName);
    expect(data.targetUrl).toBe(newUrl);
    expect(data.previousUrl).toBe(testTargetUrl);

    // Verify database was updated
    const domain = sqlite.query('SELECT * FROM domains WHERE name = ?').get(testDomainName) as any;
    expect(domain.target_url).toBe(newUrl);
  });

  test('idempotent update returns updated: false when URL is same', async () => {
    const paymentHeader = createMockPaymentHeader(testOwnerWallet, 2.00);

    const response = await app.request(`/domains/${testDomainName}/url`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': paymentHeader,
      },
      body: JSON.stringify({ targetUrl: testTargetUrl }),
    });

    expect(response.status).toBe(200);

    const data: any = await response.json();
    expect(data.success).toBe(true);
    expect(data.updated).toBe(false);
    expect(data.reason).toBe('url_already_set');
    expect(data.domain).toBe(testDomainName);
    expect(data.targetUrl).toBe(testTargetUrl);
  });

  test('returns 404 for non-existent domain', async () => {
    const paymentHeader = createMockPaymentHeader(testOwnerWallet, 2.00);

    const response = await app.request('/domains/nonexistent.com/url', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': paymentHeader,
      },
      body: JSON.stringify({ targetUrl: 'https://new.com' }),
    });

    expect(response.status).toBe(404);

    const data: any = await response.json();
    expect(data.type).toBe('error:domain_not_found');
    expect(data.title).toBe('Domain Not Found');
  });

  test('returns 402 when no payment header provided', async () => {
    const response = await app.request(`/domains/${testDomainName}/url`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetUrl: 'https://new.com' }),
    });

    expect(response.status).toBe(402);

    const data: any = await response.json();
    expect(data.type).toBe('error:payment_required');
    expect(data.title).toBe('Payment Required');
    expect(data.detail).toContain('2.00 USDC');
  });

  test('returns 402 for insufficient payment', async () => {
    const paymentHeader = createMockPaymentHeader(testOwnerWallet, 1.00);

    const response = await app.request(`/domains/${testDomainName}/url`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': paymentHeader,
      },
      body: JSON.stringify({ targetUrl: 'https://new.com' }),
    });

    expect(response.status).toBe(402);

    const data: any = await response.json();
    expect(data.type).toBe('error:insufficient_payment');
    expect(data.title).toBe('Insufficient Payment');
    expect(data.detail).toContain('2.00 USDC');
    expect(data.detail).toContain('1.00 USDC');
  });

  test('returns 403 when non-owner attempts to update', async () => {
    const differentWallet = '0xDEADBEEF12345678';
    const paymentHeader = createMockPaymentHeader(differentWallet, 2.00);

    const response = await app.request(`/domains/${testDomainName}/url`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': paymentHeader,
      },
      body: JSON.stringify({ targetUrl: 'https://new.com' }),
    });

    expect(response.status).toBe(403);

    const data: any = await response.json();
    expect(data.type).toBe('error:not_domain_owner');
    expect(data.title).toBe('Forbidden');
    expect(data.detail).toContain('owner');
  });

  test('returns 400 for invalid targetUrl', async () => {
    const paymentHeader = createMockPaymentHeader(testOwnerWallet, 2.00);

    const response = await app.request(`/domains/${testDomainName}/url`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': paymentHeader,
      },
      body: JSON.stringify({ targetUrl: 'not-a-valid-url' }),
    });

    expect(response.status).toBe(400);

    const data: any = await response.json();
    expect(data.type).toBe('error:validation');
    expect(data.title).toBe('Validation Failed');
  });

  test('returns 400 when targetUrl is missing', async () => {
    const paymentHeader = createMockPaymentHeader(testOwnerWallet, 2.00);

    const response = await app.request(`/domains/${testDomainName}/url`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': paymentHeader,
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);

    const data: any = await response.json();
    expect(data.type).toBe('error:validation');
    expect(data.title).toBe('Validation Failed');
  });

  test('cache is invalidated after successful update', async () => {
    const newUrl = 'https://newexample.com';
    const paymentHeader = createMockPaymentHeader(testOwnerWallet, 2.00);

    // Pre-populate cache
    domainCache.set(testDomainName, testTargetUrl);
    expect(domainCache.get(testDomainName)).toBe(testTargetUrl);

    const response = await app.request(`/domains/${testDomainName}/url`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': paymentHeader,
      },
      body: JSON.stringify({ targetUrl: newUrl }),
    });

    expect(response.status).toBe(200);

    // Verify cache was invalidated
    expect(domainCache.get(testDomainName)).toBeNull();
  });

  test('response includes previousUrl on successful update', async () => {
    const newUrl = 'https://updated.com';
    const paymentHeader = createMockPaymentHeader(testOwnerWallet, 2.00);

    const response = await app.request(`/domains/${testDomainName}/url`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': paymentHeader,
      },
      body: JSON.stringify({ targetUrl: newUrl }),
    });

    expect(response.status).toBe(200);

    const data: any = await response.json();
    expect(data.previousUrl).toBe(testTargetUrl);
    expect(data.targetUrl).toBe(newUrl);
  });

  test('payment replay protection prevents reusing same payment', async () => {
    const newUrl = 'https://newexample.com';
    const paymentHeader = createMockPaymentHeader(testOwnerWallet, 2.00);

    // First request
    const response1 = await app.request(`/domains/${testDomainName}/url`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': paymentHeader,
      },
      body: JSON.stringify({ targetUrl: newUrl }),
    });

    expect(response1.status).toBe(200);

    // Second request with same payment header
    const response2 = await app.request(`/domains/${testDomainName}/url`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': paymentHeader,
      },
      body: JSON.stringify({ targetUrl: 'https://another.com' }),
    });

    expect(response2.status).toBe(409);

    const data: any = await response2.json();
    expect(data.type).toBe('error:payment_already_used');
    expect(data.title).toBe('Payment Already Used');
  });

  test('wallet comparison is case-insensitive', async () => {
    const newUrl = 'https://newexample.com';
    // Use mixed case wallet in payment
    const paymentHeader = createMockPaymentHeader(testOwnerWallet.toLowerCase(), 2.00);

    const response = await app.request(`/domains/${testDomainName}/url`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': paymentHeader,
      },
      body: JSON.stringify({ targetUrl: newUrl }),
    });

    expect(response.status).toBe(200);

    const data: any = await response.json();
    expect(data.success).toBe(true);
    expect(data.updated).toBe(true);
  });

  test('rejects localhost URL', async () => {
    const paymentHeader = createMockPaymentHeader(testOwnerWallet, 2.00);

    const response = await app.request(`/domains/${testDomainName}/url`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': paymentHeader,
      },
      body: JSON.stringify({ targetUrl: 'http://localhost' }),
    });

    expect(response.status).toBe(400);

    const data: any = await response.json();
    expect(data.type).toBe('error:validation');
    expect(data.errors).toBeDefined();
    const urlError = data.errors.find((e: any) => e.field === 'targetUrl');
    expect(urlError).toBeDefined();
    expect(urlError.code).toBe('URL_LOCALHOST_REJECTED');
  });

  test('rejects javascript URL', async () => {
    const paymentHeader = createMockPaymentHeader(testOwnerWallet, 2.00);

    const response = await app.request(`/domains/${testDomainName}/url`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': paymentHeader,
      },
      body: JSON.stringify({ targetUrl: 'javascript:alert(1)' }),
    });

    expect(response.status).toBe(400);

    const data: any = await response.json();
    expect(data.type).toBe('error:validation');
    expect(data.errors).toBeDefined();
    const urlError = data.errors.find((e: any) => e.field === 'targetUrl');
    expect(urlError).toBeDefined();
    expect(urlError.code).toBe('URL_SCHEME_UNSUPPORTED');
  });

  test('accepts valid URL update', async () => {
    const newUrl = 'https://valid-example.com';
    const paymentHeader = createMockPaymentHeader(testOwnerWallet, 2.00);

    const response = await app.request(`/domains/${testDomainName}/url`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': paymentHeader,
      },
      body: JSON.stringify({ targetUrl: newUrl }),
    });

    expect(response.status).toBe(200);

    const data: any = await response.json();
    expect(data.success).toBe(true);
    expect(data.updated).toBe(true);
    expect(data.targetUrl).toBe(newUrl);
  });
});
