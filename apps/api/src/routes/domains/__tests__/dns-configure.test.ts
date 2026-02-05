import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { MockRegistrar } from '../../../integrations/registrar/mock';
import { createDomainRoutes } from '../index';
import { createJobProcessor } from '../../../lib/jobs/registration';
import { clearAllJobs } from '../../../lib/jobs/queue';
import { problemDetailsErrorHandler } from '../../../lib/errors';
import { DomainCache } from '../../../redirect/cache';
import { ContentCache } from '../../../redirect/content-cache';
import { createDnsService } from '../../../services/dns';

// Mock the OpenFacilitator SDK so tests don't make real HTTP calls
mock.module('@openfacilitator/sdk', () => ({
  OpenFacilitator: class {
    constructor() {}
    async verify(payload: any, requirements: any) {
      const paymentAmount = payload.accepted?.amount || payload.payload?.authorization?.value;
      const requiredAmount = requirements.maxAmountRequired;
      if (paymentAmount && requiredAmount && Number(paymentAmount) < Number(requiredAmount)) {
        return { isValid: false, invalidReason: 'Insufficient payment amount' };
      }
      const payer = payload.payload?.authorization?.from;
      return { isValid: true, payer };
    }
    async settle(payload: any, requirements: any) {
      const payer = payload.payload?.authorization?.from;
      return { success: true, transaction: 'mock-tx-hash', payer, network: 'eip155:8453' };
    }
  },
  toV1NetworkId: (id: string) => {
    const map: Record<string, string> = { 'eip155:8453': 'base', 'eip155:84532': 'base-sepolia' };
    return map[id] || id;
  },
}));

/**
 * Helper to create a mock payment header
 */
function createMockPaymentHeader(payerWallet: string, amountUsdc: number = 1.00): string {
  const atomicAmount = String(Math.round(amountUsdc * 1_000_000));

  const payload = {
    x402Version: 2,
    resource: { url: '/domains/:name/dns/configure', description: 'DNS reconfigure', mimeType: 'application/json' },
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

describe('POST /domains/:name/dns/configure', () => {
  let sqlite: Database;
  let db: ReturnType<typeof drizzle>;
  let registrar: MockRegistrar;
  let jobProcessor: ReturnType<typeof createJobProcessor>;
  let domainCache: DomainCache;
  let contentCache: ContentCache;
  let dnsService: ReturnType<typeof createDnsService>;
  let app: Hono;

  const testOwnerWallet = '0xABCDEF1234567890';
  const testDomainName = 'example.com';

  beforeEach(() => {
    sqlite = new Database(':memory:');
    db = drizzle(sqlite);

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

    const now = Date.now();
    sqlite.exec(`
      INSERT INTO domains (name, tld, status, owner_wallet, target_url, created_at, updated_at)
      VALUES ('${testDomainName}', 'com', 'registered', '${testOwnerWallet}', 'https://example.com', ${now}, ${now});
    `);

    registrar = new MockRegistrar();
    domainCache = new DomainCache();
    contentCache = new ContentCache();
    dnsService = createDnsService(registrar, '1.2.3.4');
    jobProcessor = createJobProcessor(registrar, db, dnsService);

    app = new Hono();
    app.onError(problemDetailsErrorHandler);
    app.route('/domains', createDomainRoutes(registrar, db, jobProcessor, dnsService, domainCache, contentCache));
  });

  afterEach(() => {
    clearAllJobs();
    sqlite.close();
  });

  test('successfully reconfigures DNS with valid payment', async () => {
    const paymentHeader = createMockPaymentHeader(testOwnerWallet, 1.00);

    const response = await app.request(`/domains/${testDomainName}/dns/configure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment': paymentHeader,
      },
    });

    expect(response.status).toBe(200);

    const data: any = await response.json();
    expect(data.success).toBe(true);
    expect(data.domain).toBe(testDomainName);
    expect(data.dns).toBeDefined();
    expect(data.dns.configured).toBe(true);
    expect(data.txHash).toBe('mock-tx-hash');
  });

  test('updates status from registered to live', async () => {
    const paymentHeader = createMockPaymentHeader(testOwnerWallet, 1.00);

    const response = await app.request(`/domains/${testDomainName}/dns/configure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment': paymentHeader,
      },
    });

    expect(response.status).toBe(200);

    const data: any = await response.json();
    expect(data.statusUpdated).toBe('live');

    // Verify DB was updated
    const domain = sqlite.query('SELECT * FROM domains WHERE name = ?').get(testDomainName) as any;
    expect(domain.status).toBe('live');
  });

  test('does not change status if already live', async () => {
    // Update domain to 'live' status
    sqlite.exec(`UPDATE domains SET status = 'live' WHERE name = '${testDomainName}'`);

    const paymentHeader = createMockPaymentHeader(testOwnerWallet, 1.00);

    const response = await app.request(`/domains/${testDomainName}/dns/configure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment': paymentHeader,
      },
    });

    expect(response.status).toBe(200);

    const data: any = await response.json();
    expect(data.statusUpdated).toBe('live');

    const domain = sqlite.query('SELECT * FROM domains WHERE name = ?').get(testDomainName) as any;
    expect(domain.status).toBe('live');
  });

  test('returns 404 for non-existent domain', async () => {
    const paymentHeader = createMockPaymentHeader(testOwnerWallet, 1.00);

    const response = await app.request('/domains/nonexistent.com/dns/configure', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment': paymentHeader,
      },
    });

    expect(response.status).toBe(404);

    const data: any = await response.json();
    expect(data.type).toBe('error:domain_not_found');
  });

  test('returns 402 when no payment header', async () => {
    const response = await app.request(`/domains/${testDomainName}/dns/configure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    expect(response.status).toBe(402);

    const data: any = await response.json();
    expect(data.x402Version).toBe(2);
    expect(data.error).toBe('Payment Required');
    expect(data.accepts).toHaveLength(1);
    expect(data.accepts[0].amount).toBe('1000000');
  });

  test('returns 402 for insufficient payment', async () => {
    const paymentHeader = createMockPaymentHeader(testOwnerWallet, 0.50);

    const response = await app.request(`/domains/${testDomainName}/dns/configure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment': paymentHeader,
      },
    });

    expect(response.status).toBe(402);

    const data: any = await response.json();
    expect(data.error).toBe('Payment verification failed');
  });

  test('returns 403 when non-owner attempts reconfiguration', async () => {
    const differentWallet = '0xDEADBEEF12345678';
    const paymentHeader = createMockPaymentHeader(differentWallet, 1.00);

    const response = await app.request(`/domains/${testDomainName}/dns/configure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment': paymentHeader,
      },
    });

    expect(response.status).toBe(403);

    const data: any = await response.json();
    expect(data.type).toBe('error:not_domain_owner');
  });

  test('cache is invalidated after successful reconfiguration', async () => {
    domainCache.set(testDomainName, 'https://example.com');
    expect(domainCache.get(testDomainName)).toBe('https://example.com');

    const paymentHeader = createMockPaymentHeader(testOwnerWallet, 1.00);

    const response = await app.request(`/domains/${testDomainName}/dns/configure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment': paymentHeader,
      },
    });

    expect(response.status).toBe(200);
    expect(domainCache.get(testDomainName)).toBeNull();
  });

  test('payment replay protection prevents reusing same payment', async () => {
    const paymentHeader = createMockPaymentHeader(testOwnerWallet, 1.00);

    const response1 = await app.request(`/domains/${testDomainName}/dns/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-payment': paymentHeader },
    });
    expect(response1.status).toBe(200);

    const response2 = await app.request(`/domains/${testDomainName}/dns/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-payment': paymentHeader },
    });
    expect(response2.status).toBe(409);

    const data: any = await response2.json();
    expect(data.type).toBe('error:payment_already_used');
  });
});
