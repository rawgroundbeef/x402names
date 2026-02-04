---
phase: 06-production-hardening
plan: 03
subsystem: api-documentation
tags: [error-catalog, agent-discovery, rfc-9457, machine-readable]
completed: 2026-02-04
duration: 314

dependencies:
  requires:
    - "06-01-rate-limiting"
    - "06-02-url-validation"
  provides:
    - "machine-readable-error-catalog"
    - "error-discovery-endpoint"
  affects:
    - "agent-integration"
    - "api-documentation"

tech_stack:
  added:
    - "error-catalog.json (static reference)"
  patterns:
    - "Machine-readable error documentation"
    - "Agent discovery via GET /errors"
    - "Case-insensitive error code lookup"

key_files:
  created:
    - apps/api/src/docs/error-catalog.json
    - apps/api/src/routes/errors.ts
    - apps/api/src/routes/__tests__/errors.test.ts
  modified:
    - apps/api/src/index.ts

decisions:
  - slug: error-catalog-static-json
    what: "Error catalog is static JSON file, not generated from code"
    why: "Simple, fast, allows hand-crafted descriptions and examples for agents"
    alternatives: "Generate from TypeScript types (more complex, less readable)"
    impact: "Manual maintenance required when adding new error codes"

  - slug: case-insensitive-lookup
    what: "GET /errors/:code uses case-insensitive matching"
    why: "Agents may use different casing (RATE_LIMIT_EXCEEDED vs rate_limit_exceeded)"
    alternatives: "Strict case matching (less forgiving)"
    impact: "More flexible for agent consumers"

  - slug: comprehensive-error-coverage
    what: "Catalog covers all 26 error codes across 5 categories"
    why: "Agents need complete reference of all possible error responses"
    alternatives: "Partial catalog (incomplete reference)"
    impact: "100% coverage of API error surface area"
---

# Phase 6 Plan 3: Error Catalog Summary

**One-liner:** Machine-readable error catalog documenting all 26 API error codes with examples, served via GET /errors endpoint for agent discovery.

## What Was Built

Created comprehensive error documentation system for programmatic error handling:

**Error Catalog (error-catalog.json):**
- 26 documented error codes across 5 categories
- Each entry: code, type, status, title, description, category, retryable, example
- Categories: rate_limiting (1), validation (9), payment (4), registration (7), server (5)
- Example responses for every error type
- Special fields: responseHeaders for RATE_LIMIT_EXCEEDED (Retry-After)

**Error Discovery Endpoints:**
- `GET /errors` - Full catalog with version and metadata
- `GET /errors/:code` - Individual error lookup (case-insensitive)
- Rate-limited via readLimiter (100 req/min/IP)
- 404 response for non-existent error codes

**Test Coverage:**
- 19 comprehensive tests for error catalog
- Tests catalog structure, completeness, field validation
- Tests case-insensitive lookup
- Tests all major error codes (RATE_LIMIT_EXCEEDED, DOMAIN_INVALID_FORMAT, etc.)
- Total: 201 tests passing (up from 182)

## Error Code Coverage

**Rate Limiting (1 error):**
- RATE_LIMIT_EXCEEDED (429, retryable: true, includes Retry-After header)

**Validation (9 errors):**
- VALIDATION_ERROR - Generic Zod validation failure
- DOMAIN_INVALID_FORMAT - Domain format violations
- URL_INVALID_FORMAT - Unparseable URL
- URL_SCHEME_UNSUPPORTED - Non-HTTP/HTTPS protocols
- URL_LOCALHOST_REJECTED - Localhost URLs blocked
- URL_PRIVATE_ADDRESS - Private IPs and metadata endpoints blocked (SSRF prevention)
- URL_CREDENTIALS_REJECTED - Embedded credentials rejected
- URL_TOO_LONG - URL exceeds 2048 characters

**Payment (4 errors):**
- PAYMENT_REQUIRED (402) - No payment header
- INSUFFICIENT_PAYMENT (402) - Amount too low
- INVALID_PAYMENT (400) - Malformed payment header
- PAYMENT_ALREADY_USED (409) - Replay protection triggered

**Registration (7 errors):**
- DOMAIN_UNAVAILABLE (409) - Domain already taken
- DOMAIN_NOT_FOUND (404) - Domain not in system
- DOMAIN_UNSUPPORTED_TLD (400) - TLD not supported
- NOT_DOMAIN_OWNER (403) - Wallet mismatch
- PREMIUM_DOMAIN (400) - Premium domains not supported
- PRICING_NOT_AVAILABLE (400) - TLD pricing not configured
- TLD_NOT_FOUND (404) - TLD not found
- JOB_NOT_FOUND (404) - Registration job not found
- INVALID_JOB_STATE (500) - Corrupted job state

**Server (5 errors):**
- SERVER_ERROR (500, retryable: true) - Internal error
- REGISTRAR_UNAVAILABLE (503, retryable: true) - Registrar down
- REGISTRAR_ERROR (502, retryable: true) - Registrar returned error
- REGISTRAR_AUTH_ERROR (503, retryable: true) - Registrar auth failed

## Task Breakdown

### Task 1: Create error catalog JSON and errors endpoint
**Duration:** ~3 minutes
**Commit:** ada8f34

**Work completed:**
1. Created `apps/api/src/docs/` directory
2. Audited codebase for all `createProblemResponse` and `createValidationProblem` calls
3. Created comprehensive `error-catalog.json` with 26 entries
4. Each entry includes: code, type, status, title, description, category, retryable, example
5. Created `apps/api/src/routes/errors.ts` with two endpoints:
   - `GET /` - Full catalog
   - `GET /:code` - Individual error (case-insensitive)
6. Updated `apps/api/src/index.ts`:
   - Imported errors route
   - Mounted at `/errors`
   - Added rate limiting for `/errors/*`

**Files modified:**
- Created: apps/api/src/docs/error-catalog.json (26 errors documented)
- Created: apps/api/src/routes/errors.ts (catalog endpoint)
- Modified: apps/api/src/index.ts (route mounting)

### Task 2: Write error catalog tests and run full test suite
**Duration:** ~2 minutes
**Commit:** 76fe6f5

**Work completed:**
1. Created comprehensive test suite: `apps/api/src/routes/__tests__/errors.test.ts`
2. Tests for `GET /errors`:
   - Returns 200 with JSON catalog
   - Has version, categories, errors array
   - Contains 26+ errors
   - All entries have required fields
   - All categories covered (rate_limiting, validation, payment, registration, server)
   - Valid HTTP status codes (400-599)
3. Tests for `GET /errors/:code`:
   - Returns specific error details
   - Case-insensitive matching (RATE_LIMIT_EXCEEDED == rate_limit_exceeded)
   - Returns 404 for non-existent codes
   - Tests major errors: RATE_LIMIT_EXCEEDED, DOMAIN_INVALID_FORMAT, SERVER_ERROR, PAYMENT_REQUIRED, etc.
4. Ran full test suite: **201 tests passing** (19 new error catalog tests)

**Files modified:**
- Created: apps/api/src/routes/__tests__/errors.test.ts (19 tests)

## Deviations from Plan

**Added errors not in original plan:**
- JOB_NOT_FOUND (404) - Found in `apps/api/src/routes/registrations/status.ts`
- INVALID_JOB_STATE (500) - Found in same file
- DOMAIN_UNSUPPORTED_TLD (400) - Synonym for unsupported TLD

**Rationale:** Plan specified auditing all `createProblemResponse` calls. These errors were discovered during comprehensive audit and included for completeness.

**Impact:** Better catalog coverage (26 errors vs. ~20 estimated in plan).

## Technical Decisions

**1. Static JSON vs. Code Generation**
- **Decision:** Use static JSON file
- **Why:** Simple, fast, allows hand-crafted agent-friendly descriptions
- **Tradeoff:** Manual maintenance when adding errors
- **Alternative:** Generate from TypeScript error types (more complex, less control)

**2. Case-Insensitive Lookup**
- **Decision:** `GET /errors/:code` converts to uppercase for matching
- **Why:** Agents may use different casing conventions
- **Example:** `/errors/rate_limit_exceeded` works same as `/errors/RATE_LIMIT_EXCEEDED`

**3. Comprehensive Example Responses**
- **Decision:** Every error has realistic example field
- **Why:** Agents can see exact JSON structure they'll receive
- **Format:** Full RFC 9457 Problem Details object with type, title, status, detail

**4. Retryable Flag**
- **Decision:** Boolean flag for each error indicating if retry makes sense
- **Why:** Helps agents decide backoff strategy
- **Examples:**
  - `true`: RATE_LIMIT_EXCEEDED, SERVER_ERROR, REGISTRAR_UNAVAILABLE (transient)
  - `false`: DOMAIN_INVALID_FORMAT, PAYMENT_ALREADY_USED, URL_PRIVATE_ADDRESS (permanent)

## Verification Results

All verification criteria met:

✅ `bun test` passes all tests (201 total, 19 new)
✅ `GET /errors` returns complete catalog with 26 documented error codes
✅ `GET /errors/:code` returns individual error details
✅ Every `createProblemResponse` and `createValidationProblem` usage has catalog entry
✅ Catalog covers all 5 categories: rate_limiting, validation, payment, registration, server
✅ Each entry includes realistic example response

**Catalog completeness verified:**
- Audited all route files: register, url-update, status, dns, tlds, registrations/status
- Audited error handler: `apps/api/src/lib/errors.ts`
- Audited rate limiter: `apps/api/src/lib/middleware/rate-limit.ts`
- All error codes documented

## Testing Evidence

**Test Results:**
```
bun test v1.3.5
201 pass
0 fail
1126 expect() calls
Ran 201 tests across 15 files. [245ms]
```

**New error catalog tests (19 total):**
- Catalog structure and completeness
- Field validation (code, type, status, title, description, category, retryable, example)
- Category coverage (all 5 categories present)
- Status code validity (400-599)
- Individual error lookups (RATE_LIMIT_EXCEEDED, DOMAIN_INVALID_FORMAT, etc.)
- Case-insensitive matching
- 404 for non-existent codes

## Integration Points

**Consumers:**
- AI agents needing to programmatically handle API errors
- Client libraries for error mapping
- Documentation generators
- Monitoring/alerting systems

**Data Flow:**
1. Agent calls API endpoint
2. Error occurs → RFC 9457 Problem Details response
3. Agent consults `GET /errors` or `GET /errors/:code`
4. Agent reads `retryable` flag to decide backoff strategy
5. Agent uses `example` field to validate response structure

**Future Enhancements:**
- OpenAPI schema generation from error catalog
- SDK error type generation (TypeScript, Python, etc.)
- Error analytics dashboard (which errors occur most?)

## Next Phase Readiness

**Phase 6 Production Hardening - COMPLETE:**
- ✅ Plan 01: Rate limiting (100 req/min/IP, RFC 9457 429 responses)
- ✅ Plan 02: URL validation with SSRF prevention (9 validation error codes)
- ✅ Plan 03: Error catalog (26 errors documented, agent discovery endpoint)

**Blockers:** None

**Concerns:** None

**Ready for production:**
- All production hardening complete
- 201 tests passing
- Error catalog provides agent-friendly error handling
- SSRF prevention protects against URL-based attacks
- Rate limiting prevents abuse of free endpoints

## Commits

| Commit | Type | Description | Files |
|--------|------|-------------|-------|
| ada8f34 | feat | Create error catalog and errors endpoint | error-catalog.json, errors.ts, index.ts |
| 76fe6f5 | test | Add error catalog endpoint tests | errors.test.ts |

## Success Metrics

**Coverage:**
- 26 error codes documented (100% of API errors)
- 5 categories covered (100% of error categories)
- 201 tests passing (19 new, 0 failures)

**Quality:**
- Every error has example response
- Every error has retryable flag
- Every error has human + machine-readable info
- Case-insensitive lookup for flexibility

**Performance:**
- Static JSON catalog (instant response)
- Rate-limited endpoint (100 req/min/IP)
- Lightweight route (no DB queries)

---

**Phase 6 Production Hardening complete.** All error codes documented, error discovery endpoint live, full test suite passing.
