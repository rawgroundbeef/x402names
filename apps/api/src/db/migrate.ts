import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DATABASE_URL = process.env.DATABASE_URL || './data/app.db';

// Ensure data directory exists
const dbDir = dirname(DATABASE_URL);
mkdirSync(dbDir, { recursive: true });

// Create database connection
const sqlite = new Database(DATABASE_URL, { create: true });

// Enable WAL mode for better concurrency
sqlite.exec('PRAGMA journal_mode = WAL');

// Create Drizzle instance
const db = drizzle(sqlite);

// Run migrations
console.log('Running migrations...');
migrate(db, { migrationsFolder: './drizzle' });
console.log('Migrations complete!');

// Close database
sqlite.close();
process.exit(0);
