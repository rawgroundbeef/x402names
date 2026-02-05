import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { MockRegistrar } from '../../../integrations/registrar/mock';
import { createRegisterRoutes } from '../register';
import { createJobProcessor } from '../../../lib/jobs/registration';
import { clearAllJobs } from '../../../lib/jobs/queue';
import { problemDetailsErrorHandler } from '../../../lib/errors';

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
 * Helper to create a mock payment header (base64-encoded JSON)
 */
function createMockPaymentHeader(payerWallet: string, amountUsdc: number = 10.00): string {
  const atomicAmount = String(Math.round(amountUsdc * 1_000_000));

  const payload = {
    x402Version: 2,
    resource: { url: '/domains/register', description: 'Domain registration', mimeType: 'application/json' },
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

describe('POST /domains/register', () => {
  let sqlite: Database;
  let db: ReturnType<typeof drizzle>;
  let registrar: MockRegistrar;
  let jobProcessor: ReturnType<typeof createJobProcessor>;
  let app: Hono;

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

    // Create registrar and job processor
    registrar = new MockRegistrar();
    jobProcessor = createJobProcessor(registrar, db);

    // Create test app
    app = new Hono();
    app.onError(problemDetailsErrorHandler);
    app.route('/register', createRegisterRoutes(registrar, db, jobProcessor));
  });

  afterEach(() => {
    clearAllJobs();
    sqlite.close();
  });

  test('registers an available domain with valid payment', async () => {
    const paymentHeader = createMockPaymentHeader('0xABCDEF1234567890', 13.18);

    const response = await app.request('/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment': paymentHeader,
      },
      body: JSON.stringify({ domain: 'example.com' }),
    });

    expect(response.status).toBe(202);

    const data: any = await response.json();
    expect(data.jobId).toBeDefined();
    expect(data.statusUrl).toBe(`/registrations/${data.jobId}/status`);
    expect(data.retryAfterSeconds).toBe(2);
    expect(data.message).toContain('Registration initiated');
    expect(data.txHash).toBe('mock-tx-hash');
  });

  test('returns 400 for invalid domain format', async () => {
    const paymentHeader = createMockPaymentHeader('0xABCDEF1234567890', 13.18);

    const response = await app.request('/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment': paymentHeader,
      },
      body: JSON.stringify({ domain: '---invalid' }),
    });

    expect(response.status).toBe(400);

    const data: any = await response.json();
    expect(data.type).toBe('error:validation');
    expect(data.title).toBe('Validation Failed');
  });

  test('returns 400 for unsupported TLD', async () => {
    const paymentHeader = createMockPaymentHeader('0xABCDEF1234567890', 13.18);

    const response = await app.request('/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment': paymentHeader,
      },
      body: JSON.stringify({ domain: 'test.randomtld' }),
    });

    expect(response.status).toBe(400);

    const data: any = await response.json();
    expect(data.type).toBe('error:unsupported_tld');
    expect(data.title).toBe('Unsupported TLD');
  });

  test('returns 409 for unavailable domain', async () => {
    const paymentHeader = createMockPaymentHeader('0xABCDEF1234567890', 13.18);

    const response = await app.request('/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment': paymentHeader,
      },
      body: JSON.stringify({ domain: 'taken-example.com' }),
    });

    expect(response.status).toBe(409);

    const data: any = await response.json();
    expect(data.type).toBe('error:domain_unavailable');
    expect(data.title).toBe('Domain Not Available');
  });

  test('idempotent on same payment', async () => {
    const paymentHeader = createMockPaymentHeader('0xABCDEF1234567890', 13.18);

    // First request
    const response1 = await app.request('/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment': paymentHeader,
      },
      body: JSON.stringify({ domain: 'example.com' }),
    });

    expect(response1.status).toBe(202);
    const data1: any = await response1.json();
    const jobId1 = data1.jobId;

    // Second request with same payment header
    const response2 = await app.request('/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment': paymentHeader,
      },
      body: JSON.stringify({ domain: 'example.com' }),
    });

    expect(response2.status).toBe(202);
    const data2: any = await response2.json();
    const jobId2 = data2.jobId;

    // Should return same job ID
    expect(jobId1).toBe(jobId2);
  });

  test('returns 402 with x402 payment requirements when no payment header', async () => {
    const response = await app.request('/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain: 'example.com' }),
    });

    expect(response.status).toBe(402);

    const data: any = await response.json();
    expect(data.x402Version).toBe(2);
    expect(data.error).toBe('Payment Required');
    expect(data.accepts).toBeDefined();
    expect(data.accepts).toHaveLength(1);
    expect(data.accepts[0].scheme).toBe('exact');
    expect(data.accepts[0].amount).toBeDefined();
    expect(data.accepts[0].asset).toBeDefined();
    expect(data.accepts[0].maxTimeoutSeconds).toBe(300);

    // Verify payment-required header is present and base64-encoded
    const paymentRequiredHeader = response.headers.get('payment-required');
    expect(paymentRequiredHeader).toBeDefined();
    const decoded = JSON.parse(atob(paymentRequiredHeader!));
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepts).toHaveLength(1);
  });

  test('creates registration job in database', async () => {
    const paymentHeader = createMockPaymentHeader('0xABCDEF1234567890', 13.18);

    const response = await app.request('/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment': paymentHeader,
      },
      body: JSON.stringify({ domain: 'example.com' }),
    });

    expect(response.status).toBe(202);
    const data: any = await response.json();

    // Query database to verify job exists
    const job = sqlite.query('SELECT * FROM registration_jobs WHERE id = ?').get(data.jobId) as any;
    expect(job).toBeDefined();
    expect(job.domain_name).toBe('example.com');
    expect(job.tld).toBe('com');
    expect(job.owner_wallet).toBe('0xABCDEF1234567890');
    expect(job.state).toBe('processing');
  });

  test('returns 402 for insufficient payment amount', async () => {
    // .com requires 13.18 USDC, but payment is only 5.00
    const paymentHeader = createMockPaymentHeader('0xABCDEF1234567890', 5.00);

    const response = await app.request('/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment': paymentHeader,
      },
      body: JSON.stringify({ domain: 'example.com' }),
    });

    expect(response.status).toBe(402);

    const data: any = await response.json();
    expect(data.x402Version).toBe(2);
    expect(data.error).toBe('Payment verification failed');
    expect(data.reason).toContain('Insufficient');

    // Verify payment-required header on verification failure too
    const paymentRequiredHeader = response.headers.get('payment-required');
    expect(paymentRequiredHeader).toBeDefined();
  });

  test('payment settlement extracts wallet correctly', async () => {
    const testWallet = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1';
    const paymentHeader = createMockPaymentHeader(testWallet, 13.18);

    const response = await app.request('/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment': paymentHeader,
      },
      body: JSON.stringify({ domain: 'example.com' }),
    });

    expect(response.status).toBe(202);
    const data: any = await response.json();
    expect(data.payer).toBe(testWallet);

    // Verify job has correct wallet
    const job = sqlite.query('SELECT * FROM registration_jobs WHERE id = ?').get(data.jobId) as any;
    expect(job.owner_wallet).toBe(testWallet);
  });

  test('rejects registration with FTP targetUrl', async () => {
    const paymentHeader = createMockPaymentHeader('0xABCDEF1234567890', 13.18);

    const response = await app.request('/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment': paymentHeader,
      },
      body: JSON.stringify({ domain: 'example.com', targetUrl: 'ftp://evil.com' }),
    });

    expect(response.status).toBe(400);

    const data: any = await response.json();
    expect(data.type).toBe('error:validation');
    expect(data.title).toBe('Validation Failed');
    expect(data.errors).toBeDefined();
    const urlError = data.errors.find((e: any) => e.field === 'targetUrl');
    expect(urlError).toBeDefined();
    expect(urlError.code).toBe('URL_SCHEME_UNSUPPORTED');
  });

  test('rejects registration with private IP targetUrl', async () => {
    const paymentHeader = createMockPaymentHeader('0xABCDEF1234567890', 13.18);

    const response = await app.request('/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment': paymentHeader,
      },
      body: JSON.stringify({ domain: 'example.com', targetUrl: 'http://192.168.1.1' }),
    });

    expect(response.status).toBe(400);

    const data: any = await response.json();
    expect(data.type).toBe('error:validation');
    expect(data.errors).toBeDefined();
    const urlError = data.errors.find((e: any) => e.field === 'targetUrl');
    expect(urlError).toBeDefined();
    expect(urlError.code).toBe('URL_PRIVATE_ADDRESS');
  });

  test('rejects registration with embedded credentials in targetUrl', async () => {
    const paymentHeader = createMockPaymentHeader('0xABCDEF1234567890', 13.18);

    const response = await app.request('/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment': paymentHeader,
      },
      body: JSON.stringify({ domain: 'example.com', targetUrl: 'http://user:pass@example.com' }),
    });

    expect(response.status).toBe(400);

    const data: any = await response.json();
    expect(data.type).toBe('error:validation');
    expect(data.errors).toBeDefined();
    const urlError = data.errors.find((e: any) => e.field === 'targetUrl');
    expect(urlError).toBeDefined();
    expect(urlError.code).toBe('URL_CREDENTIALS_REJECTED');
  });

  test('accepts registration with valid targetUrl', async () => {
    const paymentHeader = createMockPaymentHeader('0xABCDEF1234567890', 13.18);

    const response = await app.request('/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment': paymentHeader,
      },
      body: JSON.stringify({ domain: 'example.com', targetUrl: 'https://example.com' }),
    });

    expect(response.status).toBe(202);

    const data: any = await response.json();
    expect(data.jobId).toBeDefined();
    expect(data.statusUrl).toBe(`/registrations/${data.jobId}/status`);
  });

  test('accepts registration without targetUrl', async () => {
    const paymentHeader = createMockPaymentHeader('0xABCDEF1234567890', 13.18);

    const response = await app.request('/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment': paymentHeader,
      },
      body: JSON.stringify({ domain: 'example.com' }),
    });

    expect(response.status).toBe(202);

    const data: any = await response.json();
    expect(data.jobId).toBeDefined();
  });
});
