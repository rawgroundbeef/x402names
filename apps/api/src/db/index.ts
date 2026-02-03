import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from '../config/env';
import * as schema from './schema';

// Ensure data directory exists
const dbPath = env.DATABASE_URL;
const dbDir = dirname(dbPath);
mkdirSync(dbDir, { recursive: true });

// Create SQLite database with WAL mode and production pragmas
export const sqlite = new Database(dbPath, { create: true });

// Configure SQLite for optimal performance and durability
sqlite.exec('PRAGMA journal_mode = WAL');
sqlite.exec('PRAGMA busy_timeout = 5000');
sqlite.exec('PRAGMA synchronous = NORMAL');
sqlite.exec('PRAGMA cache_size = -64000'); // 64MB
sqlite.exec('PRAGMA foreign_keys = ON');

// Create Drizzle ORM instance
export const db = drizzle(sqlite, { schema });
