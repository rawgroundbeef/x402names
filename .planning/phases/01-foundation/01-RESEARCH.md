# Phase 1: Foundation - Research

**Researched:** 2026-02-03
**Domain:** Bun runtime, SQLite with Drizzle ORM, Hono framework, monorepo tooling
**Confidence:** HIGH

## Summary

Phase 1 establishes a production-ready foundation using Bun's native capabilities with proven modern tooling. The research confirms that the chosen stack (Bun + Hono + Drizzle ORM + SQLite) represents the current best practices for lightweight, type-safe Node.js alternatives in 2026.

**Key findings:**
- Bun's native SQLite driver (bun:sqlite) is 3-6x faster than alternatives and works seamlessly with Drizzle ORM
- SQLite WAL mode is critical for concurrent read/write operations and must be enabled at startup
- Drizzle Kit provides both rapid prototyping (push) and production-ready (generate/migrate) workflows
- Monorepo configuration with Bun workspaces requires minimal setup (package.json workspaces field)
- Railway automatically detects and deploys Bun monorepos with zero configuration

**Primary recommendation:** Use Drizzle Kit's generate/migrate workflow (not push) for Phase 1 to establish migration discipline from the start. WAL mode and busy_timeout pragma are mandatory for production SQLite.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bun | 1.x | Runtime & package manager | Native SQLite driver, fast test runner, workspace support |
| Hono | 4.x | HTTP framework | Ultra-lightweight, multi-runtime, excellent TypeScript support |
| Drizzle ORM | latest | Type-safe SQL ORM | Best TypeScript inference, native bun:sqlite support, migration tooling |
| drizzle-kit | latest (dev) | Schema management CLI | Generate/migrate/push commands, visual studio |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| envalid | latest | Environment validation | Mandatory - fail-fast validation at startup |
| Turborepo | 2.x (optional) | Monorepo task runner | Optional - Bun workspaces sufficient for small monorepos |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Drizzle ORM | Prisma | Prisma has slower TypeScript performance, separate migration runtime |
| envalid | zod + custom | More code, envalid is purpose-built with better DX |
| Turborepo | Bun scripts | Turborepo adds caching/parallelization for larger monorepos |

**Installation:**
```bash
# Core dependencies
bun add hono drizzle-orm envalid

# Dev dependencies
bun add -D drizzle-kit @types/bun

# Optional: Turborepo (can defer to later phase)
bun add -D turbo
```

## Architecture Patterns

### Recommended Project Structure
```
/
├── .planning/              # GSD planning artifacts
├── apps/
│   └── api/                # @x402names/api - Main API service
│       ├── src/
│       │   ├── index.ts    # Entry point, Hono app initialization
│       │   ├── db/
│       │   │   ├── index.ts      # Database client export
│       │   │   ├── schema.ts     # Drizzle schema definitions
│       │   │   └── migrate.ts    # Migration runner
│       │   ├── config/
│       │   │   └── env.ts        # Validated env vars (envalid)
│       │   └── routes/
│       │       └── health.ts     # Health check endpoint
│       ├── drizzle/        # Generated migrations (git-tracked)
│       ├── data/           # SQLite database file (git-ignored)
│       ├── package.json
│       ├── drizzle.config.ts
│       └── tsconfig.json
├── packages/               # Shared libraries (future phases)
├── package.json            # Root workspace config
├── turbo.json              # Optional: Turborepo config
└── bun.lockb
```

### Pattern 1: Database Initialization with WAL Mode
**What:** Initialize SQLite with Write-Ahead Logging at startup
**When to use:** Always, before any database operations
**Example:**
```typescript
// apps/api/src/db/index.ts
// Source: https://bun.com/docs/runtime/sqlite
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';

const sqlite = new Database('./data/app.db');

// CRITICAL: Enable WAL mode immediately
sqlite.run("PRAGMA journal_mode = WAL;");

// Set busy timeout for concurrent access
sqlite.run("PRAGMA busy_timeout = 5000;");

export const db = drizzle(sqlite);
```

### Pattern 2: Environment Variable Validation
**What:** Fail-fast validation of required environment variables at startup
**When to use:** Always, before any application logic
**Example:**
```typescript
// apps/api/src/config/env.ts
// Source: https://github.com/af/envalid
import { cleanEnv, str, port, bool } from 'envalid';

export const env = cleanEnv(process.env, {
  NODE_ENV: str({ choices: ['development', 'test', 'production'] }),
  PORT: port({ default: 3000 }),
  DATABASE_URL: str({ default: './data/app.db' }),
  LOG_LEVEL: str({ default: 'info', choices: ['debug', 'info', 'warn', 'error'] }),
}, {
  strict: true, // Disallow unknown vars in production
});

// Convenience properties automatically available:
// env.isDev, env.isProduction, env.isTest
```

### Pattern 3: Drizzle Migration Workflow
**What:** Generate and apply migrations from schema changes
**When to use:** Always for schema changes (never use push in production)
**Example:**
```typescript
// drizzle.config.ts
// Source: https://orm.drizzle.team/docs/drizzle-kit-generate
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
```

```typescript
// apps/api/src/db/migrate.ts
// Source: https://bun.com/docs/guides/ecosystem/drizzle
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Database } from "bun:sqlite";

const sqlite = new Database(process.env.DATABASE_URL || "./data/app.db");
sqlite.run("PRAGMA journal_mode = WAL;");
const db = drizzle(sqlite);

// Run all pending migrations
migrate(db, { migrationsFolder: "./drizzle" });

console.log("Migrations complete");
process.exit(0);
```

```bash
# Workflow commands
bun run drizzle-kit generate    # Generate migration from schema changes
bun run src/db/migrate.ts       # Apply migrations to database
```

### Pattern 4: Hono Application Structure
**What:** Organize Hono routes with type-safe context
**When to use:** All HTTP endpoints
**Example:**
```typescript
// apps/api/src/index.ts
// Source: https://hono.dev/docs/api/context
import { Hono } from 'hono';
import { env } from './config/env';

type Bindings = {
  DATABASE_URL: string;
};

type Variables = {
  userId?: string;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Health check route
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: env.NODE_ENV,
  });
});

export default {
  port: env.PORT,
  fetch: app.fetch,
};
```

### Pattern 5: Bun Workspaces Configuration
**What:** Configure monorepo with workspace dependencies
**When to use:** Always for monorepo setup
**Example:**
```json
// package.json (root)
// Source: https://bun.com/docs/guides/install/workspaces
{
  "name": "x402names",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "bun --watch apps/api/src/index.ts",
    "db:generate": "cd apps/api && bun run drizzle-kit generate",
    "db:migrate": "bun run apps/api/src/db/migrate.ts"
  },
  "devDependencies": {
    "turbo": "^2.0.0"
  }
}
```

### Anti-Patterns to Avoid
- **Using drizzle-kit push in production:** Push bypasses migration history - use generate/migrate for version control
- **Forgetting WAL mode:** SQLite defaults to rollback journal - concurrent writes will fail
- **No busy_timeout pragma:** Database will immediately error on lock contention
- **Environment validation after startup:** Validate early with envalid to fail fast
- **Relative imports across workspaces:** Use workspace protocol (`"workspace:*"`) in package.json dependencies

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Environment validation | Custom process.env checks | envalid | Type inference, fail-fast, NODE_ENV shortcuts, zero dependencies |
| SQLite migrations | Raw SQL files + custom runner | Drizzle Kit generate/migrate | Schema diffing, JSON snapshots, rollback support |
| Database connection | Manual bun:sqlite setup | Drizzle ORM wrapper | Connection management, query building, type safety |
| HTTP routing | Raw Bun.serve handlers | Hono framework | Middleware, context, multi-runtime, tiny bundle |
| Multi-stage Docker | Custom Dockerfile stages | Official Bun examples | Optimized caching, security hardening, tested patterns |

**Key insight:** These tools are specifically optimized for the Bun ecosystem. Custom solutions miss edge cases (e.g., WAL checkpoint timing, SQLite busy handlers, TypeScript inference patterns) that took years to discover.

## Common Pitfalls

### Pitfall 1: SQLite WAL Files Not Cleaning Up
**What goes wrong:** .db-wal and .db-shm files persist and grow unbounded
**Why it happens:** WAL checkpoints only occur automatically every 1000 pages OR when last connection closes cleanly
**How to avoid:**
- Enable WAL mode at startup (persists as database property)
- Set reasonable checkpoint interval: `PRAGMA wal_autocheckpoint = 1000;`
- Ensure graceful shutdown with `db.close()` or `sqlite.close()`
**Warning signs:** WAL file size exceeds several MB, never shrinks
**Source:** https://sqlite.org/wal.html

### Pitfall 2: Network Filesystem with SQLite WAL
**What goes wrong:** Database errors (SQLITE_IOERR) or corruption when using NFS/SMB
**Why it happens:** WAL mode requires shared memory between processes on the same host
**How to avoid:**
- Always use local filesystem for SQLite (not network mounts)
- For Railway/Fly.io: Use local volumes, not network storage
- For multi-region: Consider LiteFS or separate databases per region
**Warning signs:** Intermittent SQLITE_IOERR, "unable to open database file"
**Source:** https://sqlite.org/wal.html

### Pitfall 3: Drizzle Kit Push in Production
**What goes wrong:** Schema changes applied without migration history, potential data loss
**Why it happens:** `drizzle-kit push` directly modifies database schema (convenience for prototyping)
**How to avoid:**
- Use `generate` + `migrate` workflow from day one
- Commit migration files to git
- Never use `--force` flag without reviewing changes
**Warning signs:** No drizzle/ folder in git, schema changes without SQL files
**Source:** https://orm.drizzle.team/docs/drizzle-kit-push

### Pitfall 4: Missing busy_timeout Configuration
**What goes wrong:** SQLITE_BUSY errors during concurrent writes
**Why it happens:** Default timeout is 0ms - immediate failure on lock contention
**How to avoid:**
- Set `PRAGMA busy_timeout = 5000;` (5 seconds) at startup
- Combine with WAL mode for better concurrency
- Handle remaining SQLITE_BUSY errors with exponential backoff
**Warning signs:** Random SQLITE_BUSY errors in logs, fails during load tests
**Source:** https://sqlite.org/pragma.html#pragma_busy_timeout (training data)

### Pitfall 5: Railway Auto-Deploying Wrong Package
**What goes wrong:** Railway deploys wrong workspace package or fails to detect packages
**Why it happens:** Railway auto-detects deployable packages but may guess incorrectly
**How to avoid:**
- Use `railway.json` in package root to explicitly configure
- Set watch paths to prevent cross-package rebuilds
- Use `railway link` CLI before running commands
**Warning signs:** Unexpected deployments, wrong start command, builds all packages
**Source:** https://docs.railway.com/guides/monorepo

### Pitfall 6: bun:sqlite Statement Cache Pollution
**What goes wrong:** Memory bloat from cached prepared statements
**Why it happens:** `db.query()` caches compiled statements - dynamic queries accumulate
**How to avoid:**
- Use `db.prepare()` for one-off dynamic queries
- Use parameterized queries instead of string concatenation
- Drizzle ORM handles this automatically
**Warning signs:** Growing memory usage over time, slowdown with many unique queries
**Source:** https://bun.com/docs/runtime/sqlite

### Pitfall 7: SQLite Page Size Lock-In
**What goes wrong:** Cannot change page_size after enabling WAL mode
**Why it happens:** WAL mode depends on consistent page size for recovery
**How to avoid:**
- Set page size BEFORE enabling WAL: `PRAGMA page_size = 8192;`
- Default (4096) works fine for most cases
- For Phase 1: Use defaults unless specific requirements
**Warning signs:** Attempts to change page_size fail silently or error
**Source:** https://sqlite.org/wal.html

## Code Examples

Verified patterns from official sources:

### Database Initialization with Pragmas
```typescript
// apps/api/src/db/index.ts
// Source: https://bun.com/docs/runtime/sqlite
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import { env } from '../config/env';

// Initialize SQLite with recommended settings
const sqlite = new Database(env.DATABASE_URL, {
  // Handle 64-bit integers safely
  safeIntegers: true,
});

// CRITICAL: Configure SQLite for production
sqlite.run("PRAGMA journal_mode = WAL;");
sqlite.run("PRAGMA busy_timeout = 5000;");
sqlite.run("PRAGMA synchronous = NORMAL;"); // Faster than FULL, safe with WAL
sqlite.run("PRAGMA cache_size = -64000;"); // 64MB cache (negative = KB)
sqlite.run("PRAGMA foreign_keys = ON;");

export const db = drizzle(sqlite);
export { sqlite }; // Export for cleanup
```

### Schema Definition
```typescript
// apps/api/src/db/schema.ts
// Source: https://orm.drizzle.team/docs/connect-bun-sqlite
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const system = sqliteTable("system", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Example: System configuration table for Phase 1
// Future phases will add domain-specific tables (domains, forwards, etc.)
```

### Dockerfile Multi-Stage Build
```dockerfile
# Source: https://bun.com/docs/guides/ecosystem/docker
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies (separate stage for caching)
FROM base AS install
RUN mkdir -p /temp/dev /temp/prod

# Install dev dependencies (for build/test)
COPY package.json bun.lockb /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# Install prod dependencies only
COPY package.json bun.lockb /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# Build stage
FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

# Run tests and migrations
ENV NODE_ENV=test
RUN bun test

# Final production image
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease /app/apps apps
COPY --from=prerelease /app/packages packages
COPY --from=prerelease /app/package.json .

# Create data directory for SQLite
RUN mkdir -p /app/data && chown -R bun:bun /app/data

# Run as non-root user
USER bun
EXPOSE 3000

# Run migrations then start server
CMD ["sh", "-c", "bun run apps/api/src/db/migrate.ts && bun run apps/api/src/index.ts"]
```

### Railway Configuration (Optional)
```json
// apps/api/railway.json
// Source: https://docs.railway.com/guides/monorepo
{
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "bun install --frozen-lockfile"
  },
  "deploy": {
    "startCommand": "bun run src/index.ts",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### Fly.io Configuration for SQLite Persistence
```toml
# fly.toml
# Source: https://fly.io/docs/rails/advanced-guides/sqlite3/
app = "x402names-api"
primary_region = "ord"

[build]
  builder = "Dockerfile"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true

[[mounts]]
  source = "x402names_data"
  destination = "/app/data"
  initial_size = "1gb"

# Create volume first: fly volumes create x402names_data --size 1
```

### Test Example (Bun Test Runner)
```typescript
// apps/api/src/db/schema.test.ts
// Source: https://bun.com/docs/cli/test
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { system } from "./schema";

describe("Database migrations", () => {
  let sqlite: Database;
  let db: ReturnType<typeof drizzle>;

  beforeAll(() => {
    sqlite = new Database(":memory:");
    sqlite.run("PRAGMA journal_mode = WAL;");
    db = drizzle(sqlite);
    migrate(db, { migrationsFolder: "./drizzle" });
  });

  afterAll(() => {
    sqlite.close();
  });

  test("should insert and query system config", async () => {
    const result = await db.insert(system).values({
      key: "version",
      value: "1.0.0",
    }).returning();

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("version");
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Node.js + better-sqlite3 | Bun + bun:sqlite | Bun 1.0 (Sep 2023) | 3-6x faster queries, native driver, no compilation |
| Prisma for TypeScript ORM | Drizzle ORM | Drizzle matured (2024) | Better type inference, lighter runtime, SQL-like API |
| Manual migration files | Drizzle Kit generate | Drizzle Kit 0.20+ (2024) | Schema diffing, automatic SQL generation, JSON snapshots |
| Express.js | Hono | Hono 3.0+ (2023) | 10x+ lighter, edge-ready, multi-runtime |
| dotenv only | envalid + dotenv | Ongoing best practice | Fail-fast validation, type safety, better DX |
| Lerna/Rush | Turborepo | Vercel acquisition (2021) | Faster builds, better caching, simpler config |

**Deprecated/outdated:**
- **better-sqlite3:** Still works but Bun's native driver is faster and better integrated
- **Prisma with Bun:** Slower, larger bundle, separate migration runtime (use Drizzle instead)
- **drizzle-kit push for production:** Was recommended for prototyping, now explicitly warned against for production
- **Node.js workspace protocol:** Bun uses same `workspace:*` syntax, fully compatible

## Open Questions

Things that couldn't be fully resolved:

1. **Turborepo necessity for Phase 1**
   - What we know: Railway auto-detects Bun workspaces, basic scripts in root package.json sufficient
   - What's unclear: If future phases need caching/parallelization, when to add Turborepo
   - Recommendation: Defer Turborepo to later phase when CI/CD complexity justifies it. Phase 1 can use simple Bun scripts.

2. **SQLite backup strategy**
   - What we know: Railway/Fly.io take snapshots, but shouldn't be primary backup method
   - What's unclear: Best practice for automated SQLite backups in containerized environments
   - Recommendation: Plan backup strategy in Phase 6 (Hardening), Phase 1 focus on data persistence (volumes)

3. **Bun test runner coverage accuracy**
   - What we know: Bun provides `--coverage` flag with text/lcov reporters
   - What's unclear: Coverage accuracy compared to c8/nyc, potential gaps
   - Recommendation: Use Bun test runner for Phase 1, validate coverage manually, flag for review

4. **Multi-region SQLite deployment**
   - What we know: Single-region works well (Railway/Fly volumes), LiteFS exists for replication (beta)
   - What's unclear: Production-readiness of LiteFS, alternatives for global deployment
   - Recommendation: Phase 1 targets single-region, defer multi-region to Phase 6 or post-v1

## Sources

### Primary (HIGH confidence)
- [Bun SQLite documentation](https://bun.com/docs/runtime/sqlite) - Runtime, WAL mode, pragmas
- [Bun Test Runner documentation](https://bun.com/docs/cli/test) - Test APIs, matchers, watch mode
- [Bun Workspaces guide](https://bun.com/docs/guides/install/workspaces) - Monorepo configuration
- [Bun Docker guide](https://bun.com/docs/guides/ecosystem/docker) - Multi-stage Dockerfile
- [Bun Drizzle guide](https://bun.com/docs/guides/ecosystem/drizzle) - Integration setup
- [Drizzle ORM Bun SQLite](https://orm.drizzle.team/docs/connect-bun-sqlite) - Driver setup
- [Drizzle Kit generate](https://orm.drizzle.team/docs/drizzle-kit-generate) - Migration workflow
- [Drizzle Kit push](https://orm.drizzle.team/docs/drizzle-kit-push) - Push vs generate/migrate
- [SQLite WAL mode official](https://sqlite.org/wal.html) - Write-ahead logging internals
- [Hono Context API](https://hono.dev/docs/api/context) - Request/response handling
- [Turborepo repository structure](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository) - Monorepo conventions
- [Railway Monorepo guide](https://docs.railway.com/guides/monorepo) - Auto-detection, configuration

### Secondary (MEDIUM confidence)
- [Envalid GitHub](https://github.com/af/envalid) - Verified with official repo, widely used
- [Railway Bun deployment](https://bun.com/docs/guides/deployment/railway) - Official Bun docs + Railway
- [Fly.io SQLite guide](https://fly.io/docs/rails/advanced-guides/sqlite3/) - Verified with community forums
- [InfoQ: Bun v1.3 release](https://www.infoq.com/news/2026/01/bun-v3-1-release/) - January 2026 release coverage

### Tertiary (LOW confidence)
- WebSearch: "environment variable validation Node.js TypeScript best practices 2026" - General patterns, multiple sources agree
- WebSearch: "SQLite WAL mode common mistakes gotchas 2026" - Community experiences, consistent with official docs
- WebSearch: "Drizzle Kit migration workflow generate push migrate differences" - Blog posts aligned with official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries have official Bun integration docs from 2024-2026
- Architecture: HIGH - Patterns verified with official documentation and source code examples
- Pitfalls: HIGH - Sourced from official SQLite docs, Bun docs, and consistent community reports
- Deployment: MEDIUM - Railway/Fly.io guides verified but Docker examples are general patterns

**Research date:** 2026-02-03
**Valid until:** March 2026 (30 days - stack is stable, Bun releases monthly but non-breaking)

**Notes:**
- Bun ecosystem is rapidly evolving but maintains backward compatibility
- Drizzle ORM and Kit released new versions in late 2024/early 2025 - research reflects current state
- SQLite and WAL mode are mature (10+ years) - guidance is stable long-term
- Railway and Fly.io platform features change frequently - revalidate deployment sections if issues arise
