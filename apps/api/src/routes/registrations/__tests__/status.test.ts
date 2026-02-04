import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { createStatusRoutes } from '../status';
import { clearAllJobs } from '../../../lib/jobs/queue';
import { problemDetailsErrorHandler } from '../../../lib/errors';

describe('GET /registrations/:jobId/status', () => {
  let sqlite: Database;
  let db: ReturnType<typeof drizzle>;
  let app: Hono;

  beforeEach(() => {
    // Create in-memory database
    sqlite = new Database(':memory:');
    db = drizzle(sqlite);

    // Create registration_jobs table
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

    // Create test app
    app = new Hono();
    app.onError(problemDetailsErrorHandler);
    app.route('/', createStatusRoutes(db));
  });

  afterEach(() => {
    clearAllJobs();
    sqlite.close();
  });

  test('returns processing state with progress', async () => {
    // Insert a processing job
    const jobId = crypto.randomUUID();
    sqlite.exec(`
      INSERT INTO registration_jobs (
        id, domain_name, tld, owner_wallet, payment_id, amount_paid,
        state, progress, current_step, attempts, created_at
      ) VALUES (
        '${jobId}', 'test.com', 'com', '0xABCDEF', 'payment-123', '13.18',
        'processing', 33, 'payment_verified', 0, ${Date.now()}
      )
    `);

    const response = await app.request(`/${jobId}/status`, {
      method: 'GET',
    });

    expect(response.status).toBe(200);

    const data: any = await response.json();
    expect(data.state).toBe('processing');
    expect(data.progress).toBe(33);
    expect(data.currentStep).toBe('payment_verified');
    expect(data.retryAfterSeconds).toBe(2);
  });

  test('returns succeeded state with artifact URL', async () => {
    // Insert a succeeded job
    const jobId = crypto.randomUUID();
    sqlite.exec(`
      INSERT INTO registration_jobs (
        id, domain_name, tld, owner_wallet, payment_id, amount_paid,
        state, progress, current_step, attempts, created_at, completed_at
      ) VALUES (
        '${jobId}', 'success.com', 'com', '0xABCDEF', 'payment-456', '13.18',
        'succeeded', 100, 'completed', 1, ${Date.now()}, ${Date.now()}
      )
    `);

    const response = await app.request(`/${jobId}/status`, {
      method: 'GET',
    });

    expect(response.status).toBe(200);

    const data: any = await response.json();
    expect(data.state).toBe('succeeded');
    expect(data.artifactUrl).toBe('/domains/success.com/status');
    expect(data.domain).toBe('success.com');
    expect(data.ownerWallet).toBe('0xABCDEF');
    expect(data.response).toContain('registered successfully');
  });

  test('returns failed state with error details', async () => {
    // Insert a failed job
    const jobId = crypto.randomUUID();
    sqlite.exec(`
      INSERT INTO registration_jobs (
        id, domain_name, tld, owner_wallet, payment_id, amount_paid,
        state, error, error_code, attempts, created_at, completed_at
      ) VALUES (
        '${jobId}', 'failed.com', 'com', '0xABCDEF', 'payment-789', '13.18',
        'failed', 'Registrar rejected domain', 'registrar_error', 3, ${Date.now()}, ${Date.now()}
      )
    `);

    const response = await app.request(`/${jobId}/status`, {
      method: 'GET',
    });

    expect(response.status).toBe(200);

    const data: any = await response.json();
    expect(data.state).toBe('failed');
    expect(data.error).toBe('Registrar rejected domain');
    expect(data.code).toBe('registrar_error');
    expect(data.domain).toBe('failed.com');
  });

  test('returns 404 for unknown job', async () => {
    const nonexistentJobId = crypto.randomUUID();

    const response = await app.request(`/${nonexistentJobId}/status`, {
      method: 'GET',
    });

    expect(response.status).toBe(404);

    const data: any = await response.json();
    expect(data.type).toBe('error:job_not_found');
    expect(data.title).toBe('Job Not Found');
  });

  test('processing includes retryAfterSeconds', async () => {
    // Insert a processing job
    const jobId = crypto.randomUUID();
    sqlite.exec(`
      INSERT INTO registration_jobs (
        id, domain_name, tld, owner_wallet, payment_id, amount_paid,
        state, progress, current_step, attempts, created_at
      ) VALUES (
        '${jobId}', 'test.com', 'com', '0xABCDEF', 'payment-999', '13.18',
        'processing', 66, 'registrar_submitted', 1, ${Date.now()}
      )
    `);

    const response = await app.request(`/${jobId}/status`, {
      method: 'GET',
    });

    expect(response.status).toBe(200);

    const data: any = await response.json();
    expect(data.state).toBe('processing');
    expect(data.retryAfterSeconds).toBeDefined();
    expect(data.retryAfterSeconds).toBe(2);
  });

  test('succeeded includes domain info', async () => {
    // Insert a succeeded job
    const jobId = crypto.randomUUID();
    const testWallet = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1';
    sqlite.exec(`
      INSERT INTO registration_jobs (
        id, domain_name, tld, owner_wallet, payment_id, amount_paid,
        state, progress, attempts, created_at, completed_at
      ) VALUES (
        '${jobId}', 'mytest.io', 'io', '${testWallet}', 'payment-complete', '47.98',
        'succeeded', 100, 1, ${Date.now()}, ${Date.now()}
      )
    `);

    const response = await app.request(`/${jobId}/status`, {
      method: 'GET',
    });

    expect(response.status).toBe(200);

    const data: any = await response.json();
    expect(data.state).toBe('succeeded');
    expect(data.domain).toBe('mytest.io');
    expect(data.ownerWallet).toBe(testWallet);
    expect(data.artifactUrl).toBe('/domains/mytest.io/status');
  });
});
