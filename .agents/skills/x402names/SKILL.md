---
name: x402names
description: Register domains, check domain availability, point domains at URLs, update domain DNS, reconfigure DNS, renew domains, transfer domains, and manage domain registrations via the x402names API. Use when the user wants to register a domain name, check if a domain is available, update where a domain points, verify DNS configuration, reconfigure DNS records, renew a domain, transfer a domain to another account, or interact with the x402names domain registration service. Triggers on phrases like "register a domain", "check domain availability", "point domain at URL", "update domain DNS", "reconfigure DNS", "renew domain", "transfer domain", "buy a domain", "set up a domain".
---

# x402names

x402names is a domain registration API that accepts USDC payments via the x402 protocol. It provides endpoints for checking domain availability, registering domains, updating target URLs, and verifying DNS configuration. All paid operations use x402 payment headers instead of API keys.

## Prerequisites

- **Server URL**: The base URL of the running x402names instance (default `http://localhost:3000`)
- **x402 wallet with USDC**: Paid endpoints (register, URL update) require a valid x402 payment header with sufficient USDC on Base Sepolia (or configured network)
- **Domain knowledge**: Familiarity with DNS concepts (A records, propagation)

## Core Workflows

### 1. Check & Register a Domain

**Goal**: Find an available domain and register it.

```
Step 1: Get supported TLDs and pricing
  GET /tlds
  → Returns list of TLDs with USDC prices

Step 2: Check availability (batch up to 10)
  POST /domains/check
  Body: {"domains": ["example.com", "example.io"]}
  → Returns availability, pricing per domain, suggestions for taken domains

Step 3: Register (requires x402 payment)
  POST /domains/register
  Headers: Payment-Signature: <x402-payment>
  Body: {"domain": "example.com", "targetUrl": "https://mysite.com"}
  → Returns 402 if no/insufficient payment
  → Returns 202 with jobId on success

Step 4: Poll registration status
  GET /registrations/:jobId/status
  → state: "processing" (poll again after retryAfterSeconds)
  → state: "succeeded" (done, includes artifactUrl)
  → state: "failed" (includes error and code)
```

The register endpoint uses a Long-Running Operation (LRO) pattern. After getting a 202, poll the status URL until the job completes.

### 2. Update a Domain's Target URL

**Goal**: Change where a registered domain redirects to.

```
Step 1: Check current domain status
  GET /domains/:domain/status
  → Confirms domain exists and shows current targetUrl

Step 2: Update URL (requires x402 payment of 2.00 USDC)
  PATCH /domains/:domain/url
  Headers: Payment-Signature: <x402-payment>
  Body: {"targetUrl": "https://new-destination.com"}
  → Returns 402 if no/insufficient payment
  → Returns 403 if payer wallet doesn't match owner
  → Returns 200 with updated info on success
```

The payer wallet extracted from the payment header must match the domain's owner wallet.

### 3. Verify DNS Configuration

**Goal**: Check that DNS is properly configured for a domain.

```
Step 1: Get DNS configuration info
  GET /domains/:domain/dns
  → Returns expected A records and setup instructions

Step 2: Verify DNS propagation
  GET /domains/:domain/dns/verify
  → Returns verified: true/false with resolved IPs vs expected
```

DNS changes can take up to 48 hours to propagate globally.

### 4. Reconfigure DNS

**Goal**: Re-run DNS A record setup for a domain (e.g., if the server IP changed or DNS was misconfigured).

```
Step 1: Reconfigure DNS (requires x402 payment of 1.00 USDC)
  POST /domains/:domain/dns/configure
  Headers: X-Payment: <x402-payment>
  → Returns 402 if no/insufficient payment
  → Returns 403 if payer wallet doesn't match owner
  → Returns 200 with DNS records that were set

Step 2: Verify propagation
  GET /domains/:domain/dns/verify
  → Returns verified: true/false
```

If the domain status was `registered`, it will be promoted to `live` after successful DNS reconfiguration.

### 5. Renew a Domain

**Goal**: Extend a domain's registration before it expires.

```
Step 1: Check domain status
  GET /domains/:domain/status
  → Must be "registered" or "live" to renew

Step 2: Check renewal pricing
  GET /tlds/:tld
  → renewalPrice shows the USDC cost (markup included)

Step 3: Renew (requires x402 payment matching TLD renewal price)
  POST /domains/:domain/renew
  Headers: X-Payment: <x402-payment>
  → Returns 402 if no/insufficient payment (amount varies by TLD)
  → Returns 403 if payer wallet doesn't match owner
  → Returns 200 with renewal confirmation and new expiry
```

### 6. Transfer a Domain

**Goal**: Push a domain to another Namecheap account so the owner has full registrar control.

```
Step 1: Transfer domain (requires x402 payment of 2.00 USDC)
  POST /domains/:domain/transfer
  Headers: X-Payment: <x402-payment>
  Body: {"namecheapUsername": "target-account"}
  → Returns 402 if no/insufficient payment
  → Returns 403 if payer wallet doesn't match owner
  → Returns 200 with transfer confirmation
```

After transfer, the domain status is set to `pending` (removed from active management).

### 7. Error Handling

**Discovery**: Fetch the full error catalog at `GET /errors` or a specific error at `GET /errors/:code`.

**Rate limits**: Free read endpoints are rate-limited to 100 requests/minute/IP. On 429, wait for `Retry-After` header value before retrying.

**Retryable errors**: `RATE_LIMIT_EXCEEDED`, `REGISTRAR_UNAVAILABLE`, `REGISTRAR_ERROR`, `REGISTRAR_AUTH_ERROR`, `SERVER_ERROR`. Use exponential backoff.

**Non-retryable errors**: Validation errors (400), payment errors (402/409), domain conflicts (409). Fix the request before retrying.

**Payment failure handling**: If registration fails after payment is accepted (e.g., registrar error), the job moves to `state: "failed"` with an error code. The payment is recorded but not consumed for a successful registration — you can contact the operator for resolution. The system retries registrar failures up to 3 times with exponential backoff before marking a job as failed. Payment replay protection means the same payment header always returns the same job, so retrying a request is safe.

## Making Payments

Use `@x402/fetch` to make paid requests. It wraps `fetch` and handles payment header construction automatically:

```typescript
import { wrapFetch } from "@x402/fetch";
import { createWalletClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount("0xYOUR_PRIVATE_KEY");
const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(),
});

const fetchWithPayment = wrapFetch(fetch, walletClient);

// Register a domain — payment is handled automatically
const res = await fetchWithPayment("https://x402names.example/domains/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ domain: "coolproject.com", targetUrl: "https://mysite.com" }),
});
```

`@x402/fetch` reads the 402 response, constructs the payment header with the required amount, signs it with your wallet, and retries the request. No manual header construction needed.

**Payment details**: Registration prices vary by TLD (check `GET /tlds`). URL updates cost 2.00 USDC. DNS reconfiguration costs 1.00 USDC. Domain renewal uses TLD-specific pricing (check `GET /tlds` for `renewalPrice`). Domain transfer costs 2.00 USDC. All prices are in USDC on Base Sepolia (network `eip155:84532`).

**Your wallet address becomes your identity** — the payer wallet is recorded as the domain owner. Use the same wallet for future URL updates.

## All Errors Use RFC 9457 Problem Details

Every error response follows this shape:
```json
{
  "type": "error:<error_type>",
  "title": "Human-Readable Title",
  "status": 400,
  "detail": "Specific error description"
}
```

Validation errors include an `errors` array with `field`, `code`, and `message` per field.

## API Reference

For full endpoint documentation including all request/response shapes, error codes, and pricing details, see [references/api-reference.md](references/api-reference.md).
