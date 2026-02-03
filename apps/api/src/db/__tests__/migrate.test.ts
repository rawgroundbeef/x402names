import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { domains, system } from '../schema';
import { join } from 'node:path';

let sqlite: Database;
let db: ReturnType<typeof drizzle>;

beforeAll(() => {
  // Create in-memory database
  sqlite = new Database(':memory:');
  db = drizzle(sqlite);

  // Run migrations
  const migrationsFolder = join(import.meta.dir, '../../../drizzle');
  migrate(db, { migrationsFolder });
});

afterAll(() => {
  sqlite.close();
});

describe('Database Migrations', () => {
  test('migrations apply to fresh database', () => {
    // If we got here, migrations succeeded
    expect(sqlite).toBeDefined();
  });

  test('domains table exists with correct columns', () => {
    // Insert a test domain
    const result = db
      .insert(domains)
      .values({
        name: 'example',
        tld: 'x402',
        ownerWallet: '0x1234567890abcdef1234567890abcdef12345678',
        targetUrl: 'https://example.com',
      })
      .returning()
      .get();

    expect(result).toBeDefined();
    expect(result.id).toBeGreaterThan(0);
    expect(result.name).toBe('example');
    expect(result.tld).toBe('x402');
    expect(result.status).toBe('pending'); // Default value
    expect(result.ownerWallet).toBe('0x1234567890abcdef1234567890abcdef12345678');
    expect(result.targetUrl).toBe('https://example.com');
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.updatedAt).toBeInstanceOf(Date);
  });

  test('system table exists and supports key-value storage', () => {
    // Insert a key-value pair
    const result = db
      .insert(system)
      .values({
        key: 'test_key',
        value: 'test_value',
      })
      .returning()
      .get();

    expect(result).toBeDefined();
    expect(result.key).toBe('test_key');
    expect(result.value).toBe('test_value');

    // Query it back
    const retrieved = db
      .select()
      .from(system)
      .where((t) => t.key === 'test_key')
      .get();

    expect(retrieved?.value).toBe('test_value');
  });

  test('domains table enforces unique name constraint', () => {
    // Insert first domain
    db.insert(domains)
      .values({
        name: 'unique-test',
        tld: 'x402',
        ownerWallet: '0x1234567890abcdef1234567890abcdef12345678',
      })
      .run();

    // Try inserting same name again - should throw
    expect(() => {
      db.insert(domains)
        .values({
          name: 'unique-test',
          tld: 'x402',
          ownerWallet: '0xabcdef1234567890abcdef1234567890abcdef12',
        })
        .run();
    }).toThrow();
  });
});
