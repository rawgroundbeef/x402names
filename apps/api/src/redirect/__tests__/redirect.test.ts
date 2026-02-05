import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { createRedirectApp } from '../server';
import { DomainCache } from '../cache';
import { ContentCache } from '../content-cache';
import { domains } from '../../db/schema';

// Store original fetch for restoration
const originalFetch = globalThis.fetch;

describe('Redirect Server', () => {
  let sqlite: Database;
  let db: BunSQLiteDatabase<any>;
  let cache: DomainCache;
  let contentCache: ContentCache;
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

    // Create fresh caches with short TTL for testing
    cache = new DomainCache({ ttl: 5 });
    contentCache = new ContentCache({ ttl: 5 });

    // Create redirect app
    app = createRedirectApp(db, cache, contentCache);
  });

  afterEach(() => {
    // Restore original fetch after each test
    globalThis.fetch = originalFetch;
  });

  test('domain with targetUrl serves content inline (proxy)', async () => {
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

    // Mock fetch to return upstream content
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('<html><body>Hello from upstream</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }))
    ) as typeof fetch;

    const response = await app.request('http://testdomain.com/', {
      headers: { host: 'testdomain.com' },
    });

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Hello from upstream');
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
  });

  test('proxy preserves path', async () => {
    await db.insert(domains).values({
      name: 'testdomain.com',
      tld: 'com',
      status: 'live',
      ownerWallet: '0x1234',
      targetUrl: 'https://example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    let fetchedUrl = '';
    globalThis.fetch = mock((input: string | URL | Request) => {
      fetchedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return Promise.resolve(new Response('about page', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }));
    }) as typeof fetch;

    const response = await app.request('http://testdomain.com/about', {
      headers: { host: 'testdomain.com' },
    });

    expect(response.status).toBe(200);
    expect(fetchedUrl).toBe('https://example.com/about');
    const body = await response.text();
    expect(body).toBe('about page');
  });

  test('proxy preserves query string', async () => {
    await db.insert(domains).values({
      name: 'testdomain.com',
      tld: 'com',
      status: 'live',
      ownerWallet: '0x1234',
      targetUrl: 'https://example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    let fetchedUrl = '';
    globalThis.fetch = mock((input: string | URL | Request) => {
      fetchedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return Promise.resolve(new Response('query page', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }));
    }) as typeof fetch;

    const response = await app.request('http://testdomain.com?ref=abc', {
      headers: { host: 'testdomain.com' },
    });

    expect(response.status).toBe(200);
    expect(fetchedUrl).toBe('https://example.com/?ref=abc');
  });

  test('proxy preserves both path and query string', async () => {
    await db.insert(domains).values({
      name: 'testdomain.com',
      tld: 'com',
      status: 'live',
      ownerWallet: '0x1234',
      targetUrl: 'https://example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    let fetchedUrl = '';
    globalThis.fetch = mock((input: string | URL | Request) => {
      fetchedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return Promise.resolve(new Response('page with query', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }));
    }) as typeof fetch;

    const response = await app.request('http://testdomain.com/page?key=val', {
      headers: { host: 'testdomain.com' },
    });

    expect(response.status).toBe(200);
    expect(fetchedUrl).toBe('https://example.com/page?key=val');
  });

  test('upstream error returns 503', async () => {
    await db.insert(domains).values({
      name: 'testdomain.com',
      tld: 'com',
      status: 'live',
      ownerWallet: '0x1234',
      targetUrl: 'https://example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    globalThis.fetch = mock(() =>
      Promise.reject(new Error('network error'))
    ) as typeof fetch;

    const response = await app.request('http://testdomain.com/', {
      headers: { host: 'testdomain.com' },
    });

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain('Service Unavailable');
  });

  test('responses are cached on second request', async () => {
    await db.insert(domains).values({
      name: 'cached.com',
      tld: 'com',
      status: 'live',
      ownerWallet: '0xabcd',
      targetUrl: 'https://target.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    let fetchCallCount = 0;
    globalThis.fetch = mock(() => {
      fetchCallCount++;
      return Promise.resolve(new Response('cached content', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }));
    }) as typeof fetch;

    // First request - should call fetch
    const response1 = await app.request('http://cached.com/', {
      headers: { host: 'cached.com' },
    });
    expect(response1.status).toBe(200);
    expect(await response1.text()).toBe('cached content');
    expect(fetchCallCount).toBe(1);

    // Second request - should use content cache
    const response2 = await app.request('http://cached.com/', {
      headers: { host: 'cached.com' },
    });
    expect(response2.status).toBe(200);
    expect(await response2.text()).toBe('cached content');
    expect(fetchCallCount).toBe(1); // fetch NOT called again
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

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('content', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }))
    ) as typeof fetch;

    // First request - should query DB and cache result
    const response1 = await app.request('http://cached.com/', {
      headers: { host: 'cached.com' },
    });
    expect(response1.status).toBe(200);

    // Verify domain URL cache has the value
    const cachedValue = cache.get('cached.com');
    expect(cachedValue).toBe('https://target.com');

    // Second request - should use cache (both domain and content)
    const response2 = await app.request('http://cached.com/', {
      headers: { host: 'cached.com' },
    });
    expect(response2.status).toBe(200);
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

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('content', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }))
    ) as typeof fetch;

    // First request - caches the value
    await app.request('http://invalidate.com/', {
      headers: { host: 'invalidate.com' },
    });

    // Invalidate both caches
    cache.del('invalidate.com');
    contentCache.delDomain('invalidate.com');
    expect(cache.get('invalidate.com')).toBeNull();

    // Update database with new URL
    sqlite.exec(`
      UPDATE domains
      SET target_url = 'https://new.com'
      WHERE name = 'invalidate.com'
    `);

    // Next request should query DB and get new URL
    const response = await app.request('http://invalidate.com/', {
      headers: { host: 'invalidate.com' },
    });
    expect(response.status).toBe(200);

    // Verify new value is cached
    expect(cache.get('invalidate.com')).toBe('https://new.com');
  });

  test('registered status domain with targetUrl proxies content', async () => {
    await db.insert(domains).values({
      name: 'registered.com',
      tld: 'com',
      status: 'registered',
      ownerWallet: '0x9999',
      targetUrl: 'https://target.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('registered content', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }))
    ) as typeof fetch;

    const response = await app.request('http://registered.com/', {
      headers: { host: 'registered.com' },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('registered content');
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

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('port test content', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }))
    ) as typeof fetch;

    const response = await app.request('http://porttest.com:3001/', {
      headers: { host: 'porttest.com:3001' },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('port test content');
  });

  test('ACME challenge route returns 404 placeholder', async () => {
    const response = await app.request('http://example.com/.well-known/acme-challenge/token123', {
      headers: { host: 'example.com' },
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toContain('ACME');
  });

  test('upstream content-type is forwarded', async () => {
    await db.insert(domains).values({
      name: 'jsonsite.com',
      tld: 'com',
      status: 'live',
      ownerWallet: '0x1234',
      targetUrl: 'https://api.example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('{"data": true}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    ) as typeof fetch;

    const response = await app.request('http://jsonsite.com/', {
      headers: { host: 'jsonsite.com' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(await response.text()).toBe('{"data": true}');
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

describe('ContentCache', () => {
  test('cache stores and retrieves content', () => {
    const cache = new ContentCache();
    const content = {
      body: Buffer.from('hello'),
      contentType: 'text/html',
      statusCode: 200,
    };
    cache.set('test.com/', content);
    const result = cache.get('test.com/');
    expect(result).not.toBeNull();
    expect(result!.body.toString()).toBe('hello');
    expect(result!.contentType).toBe('text/html');
    expect(result!.statusCode).toBe(200);
  });

  test('cache returns null for missing keys', () => {
    const cache = new ContentCache();
    expect(cache.get('nonexistent')).toBeNull();
  });

  test('cache skips entries larger than 512KB', () => {
    const cache = new ContentCache();
    const largeBody = Buffer.alloc(513 * 1024); // Just over 512KB
    cache.set('big', {
      body: largeBody,
      contentType: 'application/octet-stream',
      statusCode: 200,
    });
    expect(cache.get('big')).toBeNull();
  });

  test('delDomain removes all entries for a domain', () => {
    const cache = new ContentCache();
    const content = {
      body: Buffer.from('x'),
      contentType: 'text/html',
      statusCode: 200,
    };
    cache.set('test.com/', content);
    cache.set('test.com/about', content);
    cache.set('other.com/', content);

    cache.delDomain('test.com');

    expect(cache.get('test.com/')).toBeNull();
    expect(cache.get('test.com/about')).toBeNull();
    expect(cache.get('other.com/')).not.toBeNull();
  });
});
