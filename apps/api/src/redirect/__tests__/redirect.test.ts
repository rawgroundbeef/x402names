import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { createRedirectApp } from '../server';
import { DomainCache } from '../cache';
import { domains } from '../../db/schema';

describe('Redirect Server', () => {
  let sqlite: Database;
  let db: BunSQLiteDatabase<any>;
  let cache: DomainCache;
  let app: ReturnType<typeof createRedirectApp>;

  beforeEach(() => {
    // Create fresh in-memory database for each test
    sqlite = new Database(':memory:');
    db = drizzle(sqlite);

    // Create domains table
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
      )
    `);

    // Create fresh cache with short TTL for testing
    cache = new DomainCache({ ttl: 5 });

    // Create redirect app
    app = createRedirectApp(db, cache);
  });

  test('domain with targetUrl returns 301 redirect', async () => {
    // Insert domain with target URL
    await db.insert(domains).values({
      name: 'testdomain.com',
      tld: 'com',
      status: 'live',
      ownerWallet: '0x1234',
      targetUrl: 'https://example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await app.request('http://testdomain.com/', {
      headers: { host: 'testdomain.com' },
    });

    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('https://example.com/');
  });

  test('redirect preserves path', async () => {
    await db.insert(domains).values({
      name: 'testdomain.com',
      tld: 'com',
      status: 'live',
      ownerWallet: '0x1234',
      targetUrl: 'https://example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await app.request('http://testdomain.com/about', {
      headers: { host: 'testdomain.com' },
    });

    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('https://example.com/about');
  });

  test('redirect preserves query string', async () => {
    await db.insert(domains).values({
      name: 'testdomain.com',
      tld: 'com',
      status: 'live',
      ownerWallet: '0x1234',
      targetUrl: 'https://example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await app.request('http://testdomain.com?ref=abc', {
      headers: { host: 'testdomain.com' },
    });

    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('https://example.com/?ref=abc');
  });

  test('redirect preserves both path and query string', async () => {
    await db.insert(domains).values({
      name: 'testdomain.com',
      tld: 'com',
      status: 'live',
      ownerWallet: '0x1234',
      targetUrl: 'https://example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await app.request('http://testdomain.com/page?key=val', {
      headers: { host: 'testdomain.com' },
    });

    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('https://example.com/page?key=val');
  });

  test('domain with no targetUrl returns holding page', async () => {
    await db.insert(domains).values({
      name: 'unconfigured.com',
      tld: 'com',
      status: 'registered',
      ownerWallet: '0x5678',
      targetUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await app.request('http://unconfigured.com/', {
      headers: { host: 'unconfigured.com' },
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('not configured');
    expect(html).toContain('unconfigured.com');
  });

  test('unknown domain returns landing page', async () => {
    const response = await app.request('http://unknown.com/', {
      headers: { host: 'unknown.com' },
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('available for registration');
    expect(html).toContain('unknown.com');
  });

  test('cache hit prevents database query on second request', async () => {
    await db.insert(domains).values({
      name: 'cached.com',
      tld: 'com',
      status: 'live',
      ownerWallet: '0xabcd',
      targetUrl: 'https://target.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // First request - should query DB and cache result
    const response1 = await app.request('http://cached.com/', {
      headers: { host: 'cached.com' },
    });
    expect(response1.status).toBe(301);

    // Verify cache has the value
    const cachedValue = cache.get('cached.com');
    expect(cachedValue).toBe('https://target.com');

    // Second request - should use cache
    const response2 = await app.request('http://cached.com/', {
      headers: { host: 'cached.com' },
    });
    expect(response2.status).toBe(301);
    expect(response2.headers.get('Location')).toBe('https://target.com/');
  });

  test('cache invalidation causes DB query on next request', async () => {
    await db.insert(domains).values({
      name: 'invalidate.com',
      tld: 'com',
      status: 'live',
      ownerWallet: '0xdef0',
      targetUrl: 'https://old.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // First request - caches the value
    await app.request('http://invalidate.com/', {
      headers: { host: 'invalidate.com' },
    });

    // Invalidate cache
    cache.del('invalidate.com');
    expect(cache.get('invalidate.com')).toBeNull();

    // Update database with new URL
    await sqlite.exec(`
      UPDATE domains
      SET target_url = 'https://new.com'
      WHERE name = 'invalidate.com'
    `);

    // Next request should query DB and get new URL
    const response = await app.request('http://invalidate.com/', {
      headers: { host: 'invalidate.com' },
    });
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('https://new.com/');

    // Verify new value is cached
    expect(cache.get('invalidate.com')).toBe('https://new.com');
  });

  test('registered status domain with targetUrl redirects', async () => {
    await db.insert(domains).values({
      name: 'registered.com',
      tld: 'com',
      status: 'registered',
      ownerWallet: '0x9999',
      targetUrl: 'https://target.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await app.request('http://registered.com/', {
      headers: { host: 'registered.com' },
    });

    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('https://target.com/');
  });

  test('pending status domain shows holding page', async () => {
    await db.insert(domains).values({
      name: 'pending.com',
      tld: 'com',
      status: 'pending',
      ownerWallet: '0x8888',
      targetUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await app.request('http://pending.com/', {
      headers: { host: 'pending.com' },
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('not configured');
  });

  test('root request without valid domain returns service info', async () => {
    const response = await app.request('http://localhost/', {
      headers: { host: 'localhost' },
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.service).toBe('x402names-redirect');
  });

  test('request with port in host header strips port correctly', async () => {
    await db.insert(domains).values({
      name: 'porttest.com',
      tld: 'com',
      status: 'live',
      ownerWallet: '0x7777',
      targetUrl: 'https://example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await app.request('http://porttest.com:3001/', {
      headers: { host: 'porttest.com:3001' },
    });

    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('https://example.com/');
  });

  test('ACME challenge route returns 404 placeholder', async () => {
    const response = await app.request('http://example.com/.well-known/acme-challenge/token123', {
      headers: { host: 'example.com' },
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toContain('ACME');
  });
});

describe('DomainCache', () => {
  test('cache stores and retrieves values', () => {
    const cache = new DomainCache();
    cache.set('test.com', 'https://example.com');
    expect(cache.get('test.com')).toBe('https://example.com');
  });

  test('cache returns null for missing keys', () => {
    const cache = new DomainCache();
    expect(cache.get('nonexistent.com')).toBeNull();
  });

  test('cache delete removes value', () => {
    const cache = new DomainCache();
    cache.set('test.com', 'https://example.com');
    cache.del('test.com');
    expect(cache.get('test.com')).toBeNull();
  });

  test('cache flush clears all values', () => {
    const cache = new DomainCache();
    cache.set('test1.com', 'https://example1.com');
    cache.set('test2.com', 'https://example2.com');
    cache.flush();
    expect(cache.get('test1.com')).toBeNull();
    expect(cache.get('test2.com')).toBeNull();
  });

  test('cache accepts custom TTL', () => {
    const cache = new DomainCache({ ttl: 1 });
    // Just verify it constructs successfully with custom TTL
    expect(cache).toBeDefined();
  });
});
