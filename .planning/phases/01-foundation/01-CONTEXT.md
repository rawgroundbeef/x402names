# Phase 1: Foundation - Context

**Gathered:** 2026-02-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Development environment ready with database and deployment scaffolding. SQLite database with WAL mode and migration system, environment configuration, dev mode startup, and deployment configs for Railway, Fly.io, and Docker.

</domain>

<decisions>
## Implementation Decisions

### Runtime & framework
- **Runtime:** Bun
- **HTTP framework:** Hono
- **TypeScript:** Strict mode (`strict: true`, no implicit any, strict null checks)
- **Testing:** Bun's built-in test runner (`bun:test`)

### Database
- **ORM:** Drizzle ORM with Bun's native SQLite driver
- **Migrations:** Drizzle Kit (`drizzle-kit generate` / `drizzle-kit migrate`)
- SQLite with WAL mode as specified in roadmap requirements

### Project structure
- **Repo layout:** Monorepo with workspaces (Turborepo pattern — user wants room for website and published packages later)
- **Package naming:** `@x402names/` scoped packages (e.g., `@x402names/api`)
- **Folder convention:** Feature-based within packages (`src/domains/`, `src/payments/`, `src/registrar/`)

### Deployment
- **Primary target:** Railway
- **Also include:** Dockerfile for flexibility (deploy anywhere)
- **Dev workflow:** `bun --watch` for local development

### Claude's Discretion
- **Schema scope for Phase 1:** Claude determines what tables to define now vs defer to later phases
- **Initial packages:** Claude determines which workspace packages Phase 1 needs (at minimum `@x402names/api`)
- **Database file location:** Claude picks sensible default (likely configurable via env with `./data/` default)
- **Environment variable management:** Claude picks appropriate level (likely validated config module for fail-fast behavior)

</decisions>

<specifics>
## Specific Ideas

- User mentioned Turborepo as a good pattern for the monorepo — follow that convention
- Monorepo motivated by future website and potentially published packages, not just the API
- "Feel free to pick whatever makes sense" on monorepo tooling — Turborepo is the reference but not a hard requirement

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-02-03*
