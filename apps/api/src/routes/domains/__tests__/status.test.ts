import { describe, test, expect, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { MockRegistrar } from '../../../integrations/registrar/mock';
import { createStatusRoutes } from '../status';
import { problemDetailsErrorHandler } from '../../../lib/errors';
import { domains } from '../../../db/schema';
import { sql } from 'drizzle-orm';

describe('GET /domains/:domain/status', () => {
  let registrar: MockRegistrar;
  let sqlite: Database;
  let db: BunSQLiteDatabase<any>;
  let app: Hono;

  beforeEach(() => {
    // Create fresh in-memory database for each test
    registrar = new MockRegistrar();
    sqlite = new Database(':memory:');
    db = drizzle(sqlite);

    // Create domains table
    sqlite.exec(`
      CREATE TABLE domains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        tld TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        owner_wallet TEXT NOT NULL,
        target_url TEXT,
        payment_id TEXT UNIQUE,
        registrar_order_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(name, tld)
      )
    `);

    // Create test app
    app = new Hono();
    app.onError(problemDetailsErrorHandler);
    app.route('/', createStatusRoutes(registrar, db));
  });

  test('domain not in DB and not registered returns status: available', async () => {
    const response = await app.request('/example.com/status', {
      method: 'GET',
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toMatchObject({
      domain: 'example.com',
      status: 'available',
      ownerWallet: null,
      targetUrl: null,
      registeredAt: null,
      expiresAt: null,
      lastUpdated: null,
    });
  });

  test('domain in our DB returns full info', async () => {
    // Insert test domain
    const createdAt = new Date('2026-01-01T00:00:00Z').getTime();
    const updatedAt = new Date('2026-01-15T00:00:00Z').getTime();

    await db.insert(domains).values({
      name: 'mytest',
      tld: 'com',
      status: 'live',
      ownerWallet: '0x1234567890abcdef',
      targetUrl: 'https://example.com',
      createdAt: new Date(createdAt),
      updatedAt: new Date(updatedAt),
    });

    const response = await app.request('/mytest.com/status', {
      method: 'GET',
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toMatchObject({
      domain: 'mytest.com',
      status: 'live',
      ownerWallet: '0x1234567890abcdef',
      targetUrl: 'https://example.com',
    });
    expect(data.registeredAt).toBeDefined();
    expect(data.expiresAt).toBeDefined();
    expect(data.lastUpdated).toBeDefined();
  });

  test('invalid domain format returns 400 RFC 9457 validation error', async () => {
    const response = await app.request('/invalid..domain/status', {
      method: 'GET',
    });

    expect(response.status).toBe(400);

    const data = await response.json();
    // RFC 9457 Problem Details format
    expect(data.type).toBe('error:validation');
    expect(data.title).toBe('Invalid Domain');
    expect(data.status).toBe(400);
    expect(data.detail).toBeDefined();
  });

  test('domain registered through MockRegistrar shows as registered', async () => {
    // Register a domain through MockRegistrar
    await registrar.register(
      'registered.com',
      1,
      {
        firstName: 'Test',
        lastName: 'User',
        address1: '123 Test St',
        city: 'Test City',
        stateProvince: 'TS',
        postalCode: '12345',
        country: 'US',
        phone: '+1.5555555555',
        email: 'test@example.com',
      }
    );

    const response = await app.request('/registered.com/status', {
      method: 'GET',
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toMatchObject({
      domain: 'registered.com',
      status: 'registered',
      ownerWallet: null,
      targetUrl: null,
    });
    // Should have registrar-provided dates
    expect(data.registeredAt).toBeDefined();
    expect(data.expiresAt).toBeDefined();
  });

  test('response shape matches expected schema for all fields', async () => {
    const response = await app.request('/available.com/status', {
      method: 'GET',
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    // Verify all expected fields are present
    expect(data).toHaveProperty('domain');
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('ownerWallet');
    expect(data).toHaveProperty('targetUrl');
    expect(data).toHaveProperty('registeredAt');
    expect(data).toHaveProperty('expiresAt');
    expect(data).toHaveProperty('lastUpdated');
  });

  test('null fields for domains not in our system', async () => {
    const response = await app.request('/notours.com/status', {
      method: 'GET',
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.ownerWallet).toBeNull();
    expect(data.targetUrl).toBeNull();
  });

  test('pending status domain in DB returns correctly', async () => {
    // Insert pending domain
    await db.insert(domains).values({
      name: 'pending',
      tld: 'com',
      status: 'pending',
      ownerWallet: '0xpending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await app.request('/pending.com/status', {
      method: 'GET',
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.status).toBe('pending');
    expect(data.ownerWallet).toBe('0xpending');
  });

  test('failed status domain in DB returns correctly', async () => {
    // Insert failed domain
    await db.insert(domains).values({
      name: 'failed',
      tld: 'com',
      status: 'failed',
      ownerWallet: '0xfailed',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await app.request('/failed.com/status', {
      method: 'GET',
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.status).toBe('failed');
  });
});
