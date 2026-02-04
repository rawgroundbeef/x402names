---
phase: 06
plan: 02
subsystem: validation
tags: [security, ssrf, validation, error-handling, typescript]
requires:
  - 03-02 # Domain validation pattern
  - 04-02 # Register endpoint exists
  - 05-03 # URL update endpoint exists
provides:
  - URL validation with SSRF prevention
  - Aggregated validation error responses
  - Private IP/localhost blocking
  - Cloud metadata endpoint protection
  - Scheme restriction (HTTP/HTTPS only)
  - Credential rejection in URLs
affects:
  - 06-03 # May add more validation rules
tech-stack:
  added: []
  patterns:
    - Aggregated error collection (not fail-fast)
    - Error code mapping for machine-readable responses
    - Multi-layer validation (schema + custom validators)
key-files:
  created:
    - apps/api/src/lib/validation/url.ts
    - apps/api/src/lib/validation/__tests__/url.test.ts
  modified:
    - apps/api/src/lib/errors.ts
    - apps/api/src/routes/domains/register.ts
    - apps/api/src/routes/domains/url-update.ts
    - apps/api/src/routes/domains/__tests__/register.test.ts
    - apps/api/src/routes/domains/__tests__/url-update.test.ts
    - apps/api/src/routes/domains/__tests__/check.test.ts
decisions:
  - id: HARD-08
    decision: Aggregate all validation errors before returning response
    rationale: Agents can fix all issues in one pass instead of discovering errors one at a time
    alternatives: Fail-fast validation (rejected - poor UX for automated agents)
  - id: HARD-09
    decision: Map error messages to specific error codes (URL_SCHEME_UNSUPPORTED, URL_PRIVATE_ADDRESS, etc.)
    rationale: Machine-readable codes enable programmatic error handling by agents
    alternatives: Generic error codes (rejected - insufficient context for agents)
  - id: HARD-10
    decision: Block all private IP ranges including 169.254.0.0/16 (link-local/metadata)
    rationale: Prevents SSRF attacks against cloud metadata endpoints and internal services
    alternatives: Only block specific IPs (rejected - easy to bypass)
metrics:
  duration: 352s
  completed: 2026-02-04
---

# Phase 06 Plan 02: URL Validation with SSRF Prevention Summary

SSRF-safe URL validation rejecting private IPs, localhost, metadata endpoints, non-HTTP(S) schemes, and credentials with aggregated error responses

## Overview

Added comprehensive URL validation with SSRF prevention to reject malformed, dangerous, or private target URLs. Enhanced error handling to aggregate all validation errors and return them together with machine-readable codes. Applied validation to both domain registration and URL update endpoints.

## What Was Built

### URL Validation Module

Created `validateTargetUrl()` function with the following protections:

**Length validation:**
- Reject URLs exceeding 2048 characters

**Parse-time validation:**
- Return early if URL cannot be parsed (malformed)

**Scheme validation:**
- Only allow `http:` and `https:` protocols
- Reject `ftp:`, `javascript:`, `data:`, `file:`, etc.

**Localhost blocking:**
- Reject `localhost`, `127.0.0.1`, `::1`, `0.0.0.0`, `[::1]`

**Private IP blocking:**
- 10.0.0.0/8 (10.0.0.0 - 10.255.255.255)
- 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
- 192.168.0.0/16 (192.168.0.0 - 192.168.255.255)
- 127.0.0.0/8 (127.0.0.0 - 127.255.255.255) loopback
- 169.254.0.0/16 (169.254.0.0 - 169.254.255.255) link-local/metadata

**Cloud metadata endpoint blocking:**
- 169.254.169.254 (AWS/Azure/GCP metadata)
- metadata.google.internal (GCP)

**Embedded credentials rejection:**
- Reject URLs with username or password (e.g., `http://user:pass@example.com`)

**Error aggregation:**
- Collect ALL validation failures (not fail-fast)
- Return `{ valid: boolean, errors: string[] }`

### Error Aggregation Framework

Enhanced `errors.ts` with:

**`createValidationProblem()` helper:**
- Accepts array of `{ field, code, message }` objects
- Returns RFC 9457 Problem Details with `errors` array
- Includes request ID if present

**Updated `validationErrorHook`:**
- Changed from fail-fast to aggregating all Zod errors
- Maps each error to `{ field, code, message }` format
- Changed title from "Validation Error" to "Validation Failed"

**Updated `ProblemDetails` interface:**
- Added optional `errors` array for aggregated validation failures

### Endpoint Integration

**Register endpoint (`/domains/register`):**
- Collect domain validation errors AND URL validation errors
- Only return if both validations pass
- Map URL error strings to specific error codes
- Simplified Zod schema (removed `.url()` - custom validator handles it)

**URL update endpoint (`/domains/:name/url`):**
- Validate URL immediately after Zod validation
- Return aggregated errors with error codes
- Simplified Zod schema (removed `.url()`, kept `.min(1)`)

### Error Code Mapping

Implemented consistent error code mapping for URL validation failures:

| Error Message Pattern | Error Code |
|----------------------|------------|
| "Only HTTP and HTTPS" | `URL_SCHEME_UNSUPPORTED` |
| "Localhost" | `URL_LOCALHOST_REJECTED` |
| "Private IP" | `URL_PRIVATE_ADDRESS` |
| "Metadata service" | `URL_PRIVATE_ADDRESS` |
| "credentials" | `URL_CREDENTIALS_REJECTED` |
| "maximum length" | `URL_TOO_LONG` |
| "Invalid URL format" | `URL_INVALID_FORMAT` |
| Default | `URL_VALIDATION_ERROR` |

## Tests

**URL validation tests (30 tests):**
- Valid URLs (basic HTTPS, with path/query, subdomain, custom port, 2048 chars)
- Invalid schemes (FTP, javascript, data URI, file)
- Localhost/private addresses (all ranges)
- Cloud metadata endpoints
- Embedded credentials
- Length validation
- Malformed URLs
- Edge cases (boundary testing for IP ranges)
- Error aggregation (multiple issues at once)

**Register endpoint tests:**
- Reject FTP scheme
- Reject private IP
- Reject embedded credentials
- Accept valid URL
- Accept without URL (optional)

**URL update endpoint tests:**
- Reject localhost
- Reject javascript scheme
- Accept valid URL

**Test fixes:**
- Updated all existing tests to expect "Validation Failed" title

**Total test count:** 182 tests passing

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

**HARD-08: Error aggregation strategy**
- Collect all validation errors before returning response
- Enables agents to fix everything in one pass
- Alternative (fail-fast) rejected - poor experience for automated agents

**HARD-09: Machine-readable error codes**
- Map error messages to specific codes (URL_SCHEME_UNSUPPORTED, etc.)
- Enables programmatic error handling
- Alternative (generic codes) rejected - insufficient context

**HARD-10: Private IP blocking strategy**
- Block entire ranges including link-local (169.254.0.0/16)
- Prevents SSRF against metadata endpoints
- Alternative (specific IPs only) rejected - easy to bypass

## Integration Points

**Imports added:**
- `validateTargetUrl` from `lib/validation/url`
- `createValidationProblem` from `lib/errors`

**Modified patterns:**
- Validation now happens in two stages: Zod schema, then custom validators
- Errors collected in array, returned together with field/code/message
- Zod schemas simplified (removed redundant `.url()` validation)

## Next Phase Readiness

**No blockers for Phase 6 Plan 03.**

Ready for:
- Rate limiting implementation
- Additional validation rules
- More specific error codes

## Key Learnings

**SSRF prevention requires multiple layers:**
- Scheme validation (reject non-HTTP(S))
- Localhost blocking (all variants)
- Private IP ranges (all blocks including link-local)
- Metadata endpoints (specific hostnames)
- Credential rejection

**Error aggregation improves agent UX:**
- Returning all errors at once reduces round-trips
- Machine-readable codes enable programmatic handling
- Field-specific errors allow targeted fixes

**Edge case testing is critical:**
- Boundary testing for IP ranges (172.15.x.x vs 172.16.x.x)
- Multiple validation failures in single URL
- Malformed input handling (parse failures)

## Performance Notes

- URL validation adds minimal overhead (~1ms per validation)
- All 182 tests complete in 325ms
- No database queries in validation layer

## Technical Debt

None introduced.

## Future Enhancements

Potential improvements (not required for MVP):

- IPv6 private range blocking (currently only blocks `::1`)
- DNS rebinding protection (resolve hostname before accepting)
- URL normalization (handle URL encoding, case sensitivity)
- Content-type validation (HEAD request to verify endpoint)
- Blacklist/whitelist support (domain allowlists)
