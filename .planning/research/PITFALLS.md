# Pitfalls Research: Domain Registration Service

**Project:** x402names
**Domain:** Domain registration with x402 micropayments
**Researched:** 2026-02-03
**Confidence:** MEDIUM (based on domain expertise, unable to verify current Namecheap API docs)

## Critical (Must Address in v1)

### Payment-Registration Atomicity Failure

**Risk:** Payment clears but domain registration fails, leaving customer charged with no domain. Or registration succeeds but payment verification fails, giving away free domains.

**What goes wrong:**
- Customer sends x402 payment
- Payment is verified and recorded
- Namecheap API call fails (rate limit, domain taken, API down)
- Customer is out money, no domain registered

**Consequences:**
- Financial loss for customer
- Support burden
- Reputation damage
- Potential regulatory issues (processing payments without delivering service)

**Warning signs:**
- Payment records in DB with no corresponding domain record
- Customer complaints about missing domains
- Failed API calls in logs after successful payments

**Prevention:**
1. **Use idempotency keys** for Namecheap API calls to enable safe retries
2. **State machine approach:**
   - `payment_pending` → payment received
   - `payment_verified` → x402 payment confirmed
   - `registration_pending` → about to call registrar
   - `registration_submitted` → API call made
   - `registration_confirmed` → registrar confirmed
   - `registration_failed` → registrar rejected
3. **Refund mechanism:** Automatic refund path when registration fails after payment
4. **Retry with exponential backoff** for transient registrar API failures
5. **Transaction log:** Write-ahead log of all state transitions before making them

**Implementation:**
```typescript
// Pseudo-code for atomic flow
async function registerDomainWithPayment(paymentId, domain) {
  const tx = await db.transaction();

  try {
    // 1. Verify payment exists and is valid
    const payment = await verifyX402Payment(paymentId);
    await tx.updatePaymentState(paymentId, 'verified');

    // 2. Record intent to register (idempotency key)
    const registrationId = await tx.createRegistration({
      paymentId,
      domain,
      state: 'pending',
      idempotencyKey: generateIdempotencyKey(paymentId, domain)
    });

    await tx.commit();

    // 3. Call registrar API (outside transaction)
    // If this fails, state is 'pending' and can be retried
    const result = await namecheapApi.register(domain, {
      idempotencyKey: registrationId
    });

    // 4. Update state based on result
    await db.updateRegistration(registrationId, {
      state: result.success ? 'confirmed' : 'failed',
      registrarResponse: result
    });

    if (!result.success) {
      // Trigger refund process
      await initiateRefund(paymentId);
    }

  } catch (error) {
    await tx.rollback();
    throw error;
  }
}
```

**Phase:** v1.0 - Core registration flow (MUST HAVE)

---

### Namecheap Sandbox vs Production Differences

**Risk:** Code works perfectly in sandbox but fails in production due to undocumented API differences.

**What goes wrong:**
- Sandbox accepts invalid TLD combinations that production rejects
- Rate limits are different (sandbox more permissive)
- Sandbox doesn't validate registrant contact info strictly
- Sandbox domains never actually propagate DNS
- Error codes differ between environments

**Consequences:**
- Launch day disasters
- Failed registrations in production
- Customer-facing errors
- Emergency hotfixes

**Warning signs:**
- Test coverage only uses sandbox
- No production smoke tests
- First production registration fails

**Prevention:**
1. **Document all observed differences** in a SANDBOX_VS_PROD.md file
2. **Production smoke tests** with real domains (use .com test domains you own)
3. **Canary registration:** First production deployment does 1-2 test registrations
4. **Environment-aware validation:** Stricter validation in production
5. **Monitor error codes:** Alert on any error codes not seen in sandbox testing

**Known differences (MEDIUM confidence):**
- Sandbox may not enforce ICANN registrant data validation
- Sandbox rate limits typically 5x higher than production
- Sandbox domains often use `.test` or `.sandbox` TLD that behave differently
- Production requires IP whitelisting for API access (sandbox doesn't)

**Phase:** v1.0 - Testing strategy + Deployment (CRITICAL)

---

### SQLite on Ephemeral Filesystem

**Risk:** Railway/Fly.io containers restart, all registration data is lost. Customer has paid domains that are no longer tracked.

**What goes wrong:**
- SQLite file stored in container filesystem
- Container restarts (deploy, crash, platform maintenance)
- SQLite file is gone
- All payment records, domain ownership records, URL mappings lost
- Domains are registered with Namecheap but your system has no record

**Consequences:**
- Catastrophic data loss
- Cannot prove domain ownership
- Cannot manage domains (update URLs)
- Support nightmare
- Business continuity failure

**Warning signs:**
- Deployment shows SQLite file in `/app/data.db` or similar ephemeral path
- No persistent volume mounted
- `df` shows filesystem is not persistent
- Database resets after container restart

**Prevention:**
1. **Persistent volume mount (CRITICAL):**
   - Railway: Use volume mount, not container filesystem
   - Fly.io: Use `[mounts]` in fly.toml
   - Path: `/data/x402names.db` on persistent volume
2. **WAL mode enabled:**
   ```sql
   PRAGMA journal_mode = WAL;
   PRAGMA synchronous = NORMAL;
   PRAGMA busy_timeout = 5000;
   ```
3. **Automated backups:**
   - Hourly SQLite backups to S3/R2
   - Use `VACUUM INTO` for online backups
   - Test restore process
4. **Startup verification:**
   - Check DB exists and is readable on startup
   - Check known test record exists
   - Alert if DB is empty/missing
5. **Replication option:**
   - Consider Litestream for continuous replication
   - Streams WAL changes to S3 in real-time

**Railway-specific:**
```toml
# railway.toml or Railway UI
[volumes]
  [[volumes.data]]
    mountPath = "/data"

# Then in code:
const dbPath = process.env.RAILWAY_VOLUME_PATH
  ? `${process.env.RAILWAY_VOLUME_PATH}/x402names.db`
  : './data/x402names.db'; // fallback for local dev
```

**Phase:** v1.0 - Deployment configuration (CRITICAL)

---

### DNS Propagation Expectation Gap

**Risk:** Customer registers domain, immediately tries to visit it, gets DNS error, thinks service is broken.

**What goes wrong:**
- Domain registration succeeds instantly via API
- DNS records updated instantly in registrar
- DNS propagation takes 5 minutes to 48 hours globally
- Customer tries to visit domain immediately
- Browser shows "DNS_PROBE_FINISHED_NXDOMAIN"
- Customer submits support ticket / complaint

**Consequences:**
- Support burden
- Poor user experience
- Refund requests
- Negative reviews

**Warning signs:**
- Support tickets saying "domain doesn't work"
- Customers confused about when domain is "ready"

**Prevention:**
1. **Clear UX messaging:**
   ```
   ✓ Domain registered successfully!

   Your domain is now registered but DNS propagation takes 5-30 minutes.

   Status: Propagating...
   Registered: example.com → https://your-url.com

   [Check DNS Status] button
   ```

2. **DNS propagation checker:**
   - Backend job checks DNS resolution every 5 minutes
   - Updates domain status: `propagating` → `live`
   - Shows progress in UI

3. **Email notification:**
   - Send email when DNS is confirmed live
   - Include test link and setup instructions

4. **Set realistic expectations:**
   - "Usually ready in 5-30 minutes"
   - "Can take up to 24 hours globally"
   - Show estimated time remaining

5. **DNS propagation API:**
   ```typescript
   async function checkDNSPropagation(domain) {
     const results = await Promise.all([
       checkDNS(domain, '8.8.8.8'), // Google
       checkDNS(domain, '1.1.1.1'), // Cloudflare
       checkDNS(domain, '208.67.222.222'), // OpenDNS
     ]);
     return results.every(r => r.resolved);
   }
   ```

**Phase:** v1.0 - User experience (HIGH PRIORITY)

---

### x402 Payment Replay Attacks

**Risk:** Attacker captures x402 payment proof and replays it to register multiple domains for the price of one.

**What goes wrong:**
- Customer pays for one domain registration
- Attacker intercepts x402 payment proof (JWT or signature)
- Attacker replays payment proof with different domain names
- System validates payment (it's legitimate) and registers multiple domains
- Revenue loss, attacker gets free domains

**Consequences:**
- Financial loss
- Potential for abuse at scale
- Service degradation (rate limiting domains per payment)

**Warning signs:**
- Same payment ID used for multiple domains
- Suspicious pattern of rapid registrations
- Payment amount doesn't match domain count

**Prevention:**
1. **Nonce-based idempotency:**
   - Each payment includes unique nonce
   - Nonce can only be used once
   - DB constraint: `UNIQUE(payment_nonce)`

2. **Payment-to-domain binding:**
   - Payment metadata includes domain name
   - Verify domain in payment matches requested domain

3. **Amount verification:**
   ```typescript
   async function verifyPayment(payment, requestedDomain) {
     // Check payment hasn't been used
     const existing = await db.getRegistrationByPaymentId(payment.id);
     if (existing) {
       throw new Error('Payment already used for domain: ' + existing.domain);
     }

     // Check amount matches expected price
     const expectedPrice = await getPriceForDomain(requestedDomain);
     if (payment.amount !== expectedPrice) {
       throw new Error(`Payment amount ${payment.amount} doesn't match domain price ${expectedPrice}`);
     }

     // Check domain in payment metadata matches request
     if (payment.metadata?.domain && payment.metadata.domain !== requestedDomain) {
       throw new Error('Payment was for different domain');
     }

     return true;
   }
   ```

4. **Time-bound payments:**
   - Payment must be used within 15 minutes
   - Check payment timestamp

5. **x402 SDK integration:**
   - Use @openfacilitator/sdk's built-in replay protection
   - Verify payment signature fresh each time

**Phase:** v1.0 - Payment verification (CRITICAL)

---

### Namecheap API Rate Limiting

**Risk:** Surge of registration requests exceeds Namecheap rate limits, causing cascading failures.

**What goes wrong:**
- Product Hunt launch or viral moment
- 100 registration requests in 1 minute
- Namecheap API limit: 20 requests/minute (varies by endpoint)
- 80 requests get HTTP 429 rate limit errors
- Payments already processed, registrations failed
- Need to retry but hitting rate limits repeatedly

**Consequences:**
- Failed registrations
- Payment-registration atomicity issues
- Customer dissatisfaction
- Manual intervention required

**Warning signs:**
- HTTP 429 responses from Namecheap API
- Increasing queue depth
- Failed registrations after successful payments

**Prevention:**
1. **Queue-based registration:**
   ```typescript
   // Use job queue, not synchronous registration
   import { Queue } from 'bullmq';

   const registrationQueue = new Queue('registrations', {
     limiter: {
       max: 15, // Under Namecheap limit
       duration: 60000 // per minute
     }
   });

   // On payment verification
   await registrationQueue.add('register-domain', {
     paymentId,
     domain,
     targetUrl
   });
   ```

2. **Rate limiter with backoff:**
   - Respect Namecheap's rate limit headers
   - Exponential backoff on 429 errors
   - Track rate limit usage across requests

3. **Status page for customers:**
   - Show queue position
   - Estimated time to registration
   - "Your registration is queued (position 5 of 12)"

4. **Burst protection:**
   - Limit registrations per IP address
   - Captcha after 3 registrations from same IP
   - Detect and block abuse patterns

5. **Monitoring and alerting:**
   - Alert when queue depth > 50
   - Alert on sustained 429 responses
   - Dashboard showing rate limit usage

**Phase:** v1.0 - Production hardening (HIGH PRIORITY)

---

## Important (Should Address)

### URL Forwarding HTTPS Certificate Issues

**Risk:** Domain forwards to HTTPS URL, but registrar's forwarding service doesn't support HTTPS properly, showing certificate warnings.

**What goes wrong:**
- Customer registers domain, sets target URL to `https://their-site.com`
- Namecheap URL forwarding uses HTTP 301 redirect
- If target site enforces HTTPS, redirect chain: `http://new-domain.com` → `https://their-site.com` works
- But some registrars serve forwarding page over HTTP, causing mixed content warnings
- Or registrar's forwarding cert is invalid for purchased domain

**Consequences:**
- Browser security warnings
- Poor user experience
- SEO penalties (Google prefers HTTPS)
- Customer confusion

**Warning signs:**
- Customer reports certificate errors
- Browser dev tools show mixed content
- Security warnings on domain access

**Prevention:**
1. **Test registrar's forwarding:**
   - Before launch, test Namecheap URL forwarding with HTTPS target
   - Document behavior
   - Check if 301 or 302 redirect
   - Verify no certificate warnings

2. **Alternative: DNS + custom redirect:**
   - Instead of registrar's URL forwarding, use:
   - Point A record to your server
   - Your server serves 301 redirect with valid cert
   - Requires Cloudflare or similar for SSL

3. **Cloudflare proxy option:**
   - Point domain DNS to Cloudflare
   - Use Cloudflare Workers for redirect
   - Automatic HTTPS with Cloudflare cert
   - Better than registrar forwarding

4. **Documentation:**
   - Warn customers that target URL should be HTTPS
   - Show redirect behavior clearly
   - Test link before confirming

**Recommended approach:**
```typescript
// Don't rely on Namecheap URL forwarding
// Instead: Point A record to your redirect service
// Your service handles HTTPS properly

app.get('*', async (c) => {
  const domain = c.req.header('host');
  const mapping = await db.getDomainMapping(domain);

  if (mapping) {
    return c.redirect(mapping.targetUrl, 301);
  }

  return c.text('Domain not configured', 404);
});
```

**Phase:** v1.0 - URL forwarding implementation (MEDIUM PRIORITY)

---

### ICANN Registrant Data Requirements

**Risk:** Registration fails or domain is suspended because required registrant contact information is missing or invalid.

**What goes wrong:**
- Customer provides minimal info (just wants domain)
- ICANN requires: name, org, address, city, state, zip, country, phone, email
- Namecheap API rejects registration for missing fields
- Or registration succeeds but ICANN audit flags domain
- Domain suspended weeks later for invalid WHOIS data

**Consequences:**
- Failed registrations
- Domain suspensions
- Compliance violations
- Potential registrar account penalties

**Warning signs:**
- Registrar API errors about missing contact fields
- ICANN compliance emails
- Domains suspended after registration

**Prevention:**
1. **For custodial model (all domains under your account):**
   - Use your business info as registrant
   - Your company address, phone, email
   - Consistent across all registrations
   - Store in config:
   ```typescript
   const DEFAULT_REGISTRANT = {
     firstName: 'x402names',
     lastName: 'Platform',
     org: 'x402names LLC',
     address: '123 Business St',
     city: 'San Francisco',
     state: 'CA',
     zip: '94102',
     country: 'US',
     phone: '+1.4155551234',
     email: 'domains@x402names.com'
   };
   ```

2. **WHOIS privacy:**
   - Enable WHOIS privacy on all registrations
   - Hides registrant info from public WHOIS
   - Usually free or $1-2/year
   - Namecheap: `AddFreeWhoisguard: yes`

3. **Validate before API call:**
   ```typescript
   function validateRegistrantData(data) {
     const required = [
       'firstName', 'lastName', 'address',
       'city', 'state', 'zip', 'country',
       'phone', 'email'
     ];

     for (const field of required) {
       if (!data[field]) {
         throw new Error(`Missing required field: ${field}`);
       }
     }

     // Validate formats
     if (!isValidEmail(data.email)) {
       throw new Error('Invalid email');
     }

     if (!isValidPhone(data.phone)) {
       throw new Error('Invalid phone (use +1.4155551234 format)');
     }
   }
   ```

4. **Registrar requirements documentation:**
   - Read Namecheap's registrant data requirements
   - Note any TLD-specific requirements (.us requires US address)
   - Test with all TLDs you plan to support

**Phase:** v1.0 - Registration implementation (HIGH PRIORITY)

---

### SQLite Concurrent Write Limitations

**Risk:** Multiple simultaneous registration requests cause "database is locked" errors.

**What goes wrong:**
- 10 customers hit registration endpoint simultaneously
- All try to write to SQLite at once
- SQLite in rollback journal mode only allows one writer
- 9 requests get `SQLITE_BUSY` error
- Registrations fail even though they should succeed

**Consequences:**
- Failed requests during traffic spikes
- Poor scalability
- Customer frustration
- Revenue loss

**Warning signs:**
- `SQLITE_BUSY` errors in logs
- Failed requests during load tests
- Errors correlate with traffic spikes

**Prevention:**
1. **Enable WAL mode (Write-Ahead Logging):**
   ```typescript
   // On DB initialization
   db.pragma('journal_mode = WAL');
   db.pragma('synchronous = NORMAL');
   db.pragma('busy_timeout = 5000'); // Wait 5s for lock
   ```
   - WAL mode allows concurrent readers + 1 writer
   - Much better than rollback journal mode

2. **Connection pool:**
   ```typescript
   import Database from 'better-sqlite3';

   const db = new Database('data/x402names.db', {
     timeout: 5000 // Wait for lock
   });

   // Single connection, but with proper WAL mode
   ```

3. **Retry logic:**
   ```typescript
   async function withRetry(fn, maxRetries = 3) {
     for (let i = 0; i < maxRetries; i++) {
       try {
         return await fn();
       } catch (error) {
         if (error.code === 'SQLITE_BUSY' && i < maxRetries - 1) {
           await sleep(100 * Math.pow(2, i)); // Exponential backoff
           continue;
         }
         throw error;
       }
     }
   }
   ```

4. **Queue writes for high concurrency:**
   - If traffic exceeds SQLite's write capacity
   - Use job queue (BullMQ) to serialize writes
   - Reads can still be concurrent with WAL mode

5. **Monitor limits:**
   - SQLite handles ~1000 writes/sec with WAL mode
   - If you exceed this, need to upgrade to PostgreSQL/MySQL
   - For v1.0, SQLite + WAL should be plenty

**Phase:** v1.0 - Database setup (CRITICAL)

---

### Domain Name Validation Edge Cases

**Risk:** Invalid domain names pass validation and sent to registrar API, causing errors or security issues.

**What goes wrong:**
- User submits: `../../admin.com` or `domain-.com` or `verylongdomainnamethatiswaymorethan63characters.com`
- Validation misses edge case
- Namecheap API rejects with cryptic error
- Or worse: registrar accepts but domain doesn't work
- Or SQL injection risk if domain used in raw queries

**Consequences:**
- Failed registrations
- Security vulnerabilities
- Poor error messages
- Wasted API calls

**Warning signs:**
- Registrar API errors on domain validation
- Strange domains in database
- Customer confusion about rejected domains

**Prevention:**
1. **Strict domain validation:**
   ```typescript
   function isValidDomain(domain: string): boolean {
     // Length checks
     if (domain.length > 253) return false; // Max domain length

     // Split into labels (parts between dots)
     const labels = domain.split('.');

     // Need at least 2 labels (domain.tld)
     if (labels.length < 2) return false;

     // TLD must be valid (check against list or pattern)
     const tld = labels[labels.length - 1];
     if (tld.length < 2) return false;

     for (const label of labels) {
       // Each label max 63 chars
       if (label.length > 63) return false;

       // Must start and end with alphanumeric
       if (!/^[a-z0-9]/.test(label)) return false;
       if (!/[a-z0-9]$/.test(label)) return false;

       // Only alphanumeric and hyphens
       if (!/^[a-z0-9-]+$/.test(label)) return false;

       // Can't be all numeric (IP address)
       if (/^\d+$/.test(label)) return false;
     }

     return true;
   }
   ```

2. **TLD whitelist:**
   - Only support specific TLDs initially (.com, .net, .org, .io)
   - Different TLDs have different rules and prices
   - Expand support gradually

3. **Punycode handling:**
   - International domain names (IDN) use punycode
   - `münchen.com` → `xn--mnchen-3ya.com`
   - Use `punycode` npm package to convert

4. **Check availability before accepting payment:**
   ```typescript
   // Namecheap has availability check endpoint
   // Call it before showing payment
   const available = await namecheap.domains.check(domain);
   if (!available) {
     return c.json({ error: 'Domain not available' }, 400);
   }
   ```

5. **Reserved/prohibited domains:**
   - Block abusive patterns (phishing, impersonation)
   - Block reserved names (localhost, example, test)
   - Rate limit new registrant checks

**Phase:** v1.0 - Input validation (HIGH PRIORITY)

---

### Database Backup Failures

**Risk:** SQLite database becomes corrupted or lost, and backups are also broken/missing.

**What goes wrong:**
- Database file gets corrupted (power loss, disk failure)
- Try to restore from backup
- Backup is also corrupted (backed up while writes happening)
- Or backup script failed silently weeks ago
- All data permanently lost

**Consequences:**
- Catastrophic data loss
- Business continuity failure
- Cannot recover domain ownership records
- Reputation damage

**Warning signs:**
- Backup script errors ignored
- Backup restore never tested
- Backups stored on same disk as database
- No monitoring of backup success

**Prevention:**
1. **Online backups with VACUUM INTO:**
   ```typescript
   import { CronJob } from 'cron';

   // Hourly backup
   new CronJob('0 * * * *', async () => {
     const timestamp = new Date().toISOString();
     const backupPath = `/backups/x402names-${timestamp}.db`;

     try {
       // VACUUM INTO creates consistent backup
       db.exec(`VACUUM INTO '${backupPath}'`);

       // Upload to S3/R2
       await uploadToR2(backupPath);

       // Keep last 7 days local, 90 days remote
       await cleanOldBackups();

       console.log(`Backup successful: ${backupPath}`);
     } catch (error) {
       // CRITICAL: Alert on backup failure
       await alertOnBackupFailure(error);
     }
   }).start();
   ```

2. **Litestream for continuous replication:**
   ```yaml
   # litestream.yml
   dbs:
     - path: /data/x402names.db
       replicas:
         - type: s3
           bucket: x402names-backups
           path: db
           region: us-west-2
   ```
   - Streams WAL changes to S3 continuously
   - Near-zero RPO (recovery point objective)
   - Can restore to any point in time

3. **Test restores regularly:**
   ```typescript
   // Monthly restore test (automated)
   new CronJob('0 0 1 * *', async () => {
     const latestBackup = await getLatestBackup();
     const testDbPath = '/tmp/restore-test.db';

     try {
       // Download and verify
       await downloadBackup(latestBackup, testDbPath);
       const testDb = new Database(testDbPath);

       // Verify schema and data
       const count = testDb.prepare('SELECT COUNT(*) as c FROM registrations').get();

       if (count.c === 0) {
         throw new Error('Restored database is empty!');
       }

       console.log(`Restore test successful: ${count.c} records`);
     } catch (error) {
       await alertOnRestoreTestFailure(error);
     }
   }).start();
   ```

4. **Multiple backup destinations:**
   - Local backups on persistent volume
   - S3/R2 remote backups
   - Different regions/providers for redundancy

5. **Integrity checks:**
   ```typescript
   // Daily integrity check
   db.pragma('integrity_check'); // Should return 'ok'
   db.pragma('foreign_key_check'); // Should return empty
   ```

**Phase:** v1.0 - Deployment + operations (CRITICAL)

---

## Monitor (Watch For)

### Domain Squatting and Abuse

**Risk:** Bad actors register hundreds of domains to squat, phish, or spam.

**What goes wrong:**
- Attacker registers 1000 domains in 1 hour
- Uses them for phishing, malware distribution, spam
- Your registrar account gets flagged
- ICANN compliance investigation
- Potential account suspension

**Consequences:**
- Registrar account penalties
- Service suspension
- Legal liability questions
- Reputation damage

**Warning signs:**
- Unusually high registration volume from single source
- Pattern of similar domain names
- Domains registered but never used
- Domains flagged by security services

**Prevention:**
1. **Rate limiting by IP and payment source:**
   ```typescript
   // Max 5 domains per IP per hour
   // Max 10 domains per payment source per day

   const registrationLimits = {
     perIP: { max: 5, window: 3600 },
     perPaymentSource: { max: 10, window: 86400 }
   };
   ```

2. **Pattern detection:**
   - Flag registrations of sequential numbered domains
   - Flag typosquatting patterns (g00gle.com, etc)
   - Flag bulk registrations of random strings

3. **Post-registration monitoring:**
   - Check if domains resolve after 48 hours
   - Flag domains that never get DNS traffic
   - Track domains reported to phishing databases

4. **Terms of Service + abuse reporting:**
   - Clear ToS prohibiting abuse
   - Abuse report endpoint
   - Process to suspend abusive domains

5. **Manual review threshold:**
   - First registration from new payment source: automatic
   - 5+ registrations: manual review queue
   - Pattern match: block and require verification

**Phase:** v1.0 - Launch safeguards (MEDIUM PRIORITY)

---

### TLD-Specific Pricing and Requirements

**Risk:** Show single price but different TLDs have vastly different costs and requirements.

**What goes wrong:**
- Advertise "$10 domain registration"
- Customer tries to register .io domain (costs $35)
- Or .us domain (requires US citizenship proof)
- Payment amount wrong or registration fails

**Consequences:**
- Pricing confusion
- Failed registrations
- Revenue loss (undercharging)

**Warning signs:**
- Registrar API rejects domains with price mismatch
- Customer complaints about pricing
- Revenue doesn't match registration volume

**Prevention:**
1. **TLD price lookup:**
   ```typescript
   const TLD_PRICES = {
     'com': 10.00,
     'net': 12.00,
     'org': 12.00,
     'io': 35.00,
     'dev': 15.00,
     'ai': 120.00, // Expensive!
   };

   function getDomainPrice(domain: string): number {
     const tld = domain.split('.').pop()?.toLowerCase();
     const price = TLD_PRICES[tld];

     if (!price) {
       throw new Error(`TLD .${tld} not supported`);
     }

     return price;
   }
   ```

2. **Show price before payment:**
   - Dynamic pricing based on TLD
   - Clear breakdown
   - Update payment amount accordingly

3. **TLD requirements documentation:**
   ```typescript
   const TLD_REQUIREMENTS = {
     'us': { requiresUSCitizenship: true },
     'uk': { requiresUKAddress: true },
     'ca': { requiresCANEXUSToken: true },
   };
   ```

4. **Start with common TLDs only:**
   - v1.0: Support .com, .net, .org only
   - Expand to others in v1.1+
   - Reduces complexity

**Phase:** v1.0 if supporting multiple TLDs, v1.1 if starting with .com only

---

### Namecheap API Timeout Handling

**Risk:** Namecheap API calls hang indefinitely, blocking registration processing.

**What goes wrong:**
- Namecheap API endpoint is slow or unresponsive
- HTTP request hangs waiting for response
- Registration handler times out
- Customer sees generic error
- No retry, registration stuck

**Consequences:**
- Poor user experience
- Failed registrations
- Support burden

**Warning signs:**
- Slow API response times
- Timeout errors
- Registrations stuck in "pending" state

**Prevention:**
1. **Set aggressive timeouts:**
   ```typescript
   const namecheapApi = axios.create({
     baseURL: 'https://api.namecheap.com/xml.response',
     timeout: 10000, // 10 second timeout
   });
   ```

2. **Retry with exponential backoff:**
   ```typescript
   async function callNamecheapWithRetry(fn, maxRetries = 3) {
     for (let i = 0; i < maxRetries; i++) {
       try {
         return await fn();
       } catch (error) {
         if (error.code === 'ECONNABORTED' && i < maxRetries - 1) {
           await sleep(1000 * Math.pow(2, i));
           continue;
         }
         throw error;
       }
     }
   }
   ```

3. **Circuit breaker pattern:**
   - If Namecheap API fails repeatedly, stop calling it
   - Queue registrations until API recovers
   - Prevent cascading failures

4. **Background processing:**
   - Don't make customer wait for slow API
   - Queue registration, return immediately
   - Notify customer when complete

**Phase:** v1.0 - API integration (MEDIUM PRIORITY)

---

## Namecheap-Specific Gotchas

### Sandbox API Behavior

**Known differences (MEDIUM confidence - unable to verify with current docs):**

1. **Endpoint URLs:**
   - Sandbox: `https://api.sandbox.namecheap.com/xml.response`
   - Production: `https://api.namecheap.com/xml.response`

2. **IP Whitelisting:**
   - Production requires IP whitelisting in account settings
   - Sandbox may not enforce this strictly
   - **Action:** Whitelist deployment IPs before launch

3. **WHOIS Privacy:**
   - Sandbox may not actually enable WhoisGuard
   - Production requires explicit `AddFreeWhoisguard=yes` parameter
   - **Action:** Test WHOIS privacy in production canary

4. **Domain Availability:**
   - Sandbox may show all domains as available
   - Production requires real availability check
   - **Action:** Don't rely on sandbox availability checks

5. **DNS Propagation:**
   - Sandbox domains never actually propagate
   - Can't test real DNS behavior in sandbox
   - **Action:** Use test domain in production for DNS tests

---

### Required Fields Not in Documentation

**Common missing fields (MEDIUM confidence):**

1. **ExtendedAttributes for certain TLDs:**
   - .us requires `nexus` category and app purpose
   - .ca requires CIRA agreement
   - .uk requires registrant type
   - **Action:** Research each TLD before adding support

2. **Phone Number Format:**
   - Must be in format: `+1.4155551234`
   - Format: `+[country code].[phone number]`
   - No spaces, dashes, or parentheses
   - **Action:** Validate and format phone numbers

3. **Years Parameter:**
   - Default is 1 year if not specified
   - Multi-year registration requires `Years=2` parameter
   - **Action:** Decide if offering multi-year registrations

4. **Premium Domains:**
   - Some domains have premium pricing
   - API may return different price than expected
   - **Action:** Check `IsPremiumName` in availability response

---

### Error Code Handling

**Common error codes (MEDIUM confidence):**

```typescript
const NAMECHEAP_ERRORS = {
  2010166: 'Domain name not valid',
  2011170: 'Domain not available',
  2011280: 'Domain is premium, requires additional payment',
  2015166: 'Registrant information invalid',
  2030166: 'Rate limit exceeded',
  2011167: 'Contact information invalid',
};

function handleNamecheapError(errorCode: number) {
  const message = NAMECHEAP_ERRORS[errorCode]
    || `Namecheap API error: ${errorCode}`;

  // Log full error for debugging
  console.error('Namecheap error:', errorCode, message);

  // Return user-friendly message
  return {
    error: message,
    retryable: errorCode === 2030166, // Rate limit
  };
}
```

---

### Idempotency

**Critical:** Namecheap API does NOT provide built-in idempotency keys (MEDIUM confidence).

**Problem:**
- Network timeout during registration call
- Don't know if registration succeeded or failed
- Retry might register domain twice (unlikely but possible)
- Or retry might fail saying domain already registered

**Solution:**
```typescript
// Implement idempotency at application level
async function registerDomainIdempotent(domain, details) {
  const idempotencyKey = generateKey(domain, details);

  // Check if already processed
  const existing = await db.getByIdempotencyKey(idempotencyKey);
  if (existing) {
    return existing; // Return cached result
  }

  // First attempt - record intent
  await db.recordIntent(idempotencyKey, domain);

  try {
    const result = await namecheapApi.register(domain, details);
    await db.recordSuccess(idempotencyKey, result);
    return result;
  } catch (error) {
    // If error is "domain already registered", check if it's ours
    if (error.code === 2011170) {
      const info = await namecheapApi.getInfo(domain);
      if (info.registrantEmail === details.email) {
        // It's ours, previous call succeeded
        await db.recordSuccess(idempotencyKey, info);
        return info;
      }
    }

    await db.recordFailure(idempotencyKey, error);
    throw error;
  }
}
```

---

## x402 Payment Edge Cases

### Payment Amount Mismatch

**Risk:** Customer sends wrong payment amount (too little, too much).

**Prevention:**
```typescript
async function verifyPaymentAmount(payment, domain) {
  const expectedPrice = getDomainPrice(domain);
  const receivedAmount = payment.amount;

  if (receivedAmount < expectedPrice) {
    // Underpayment - reject
    await db.recordFailedPayment(payment.id, 'underpayment');
    return {
      error: `Insufficient payment. Expected ${expectedPrice} USDC, received ${receivedAmount} USDC`,
      refundRequired: true,
    };
  }

  if (receivedAmount > expectedPrice * 1.1) {
    // Overpayment (more than 10% over) - flag for manual review
    await db.recordFlaggedPayment(payment.id, 'overpayment');
    // Could auto-refund difference or apply to account credit
  }

  // Accept payment in range [expectedPrice, expectedPrice * 1.1]
  return { valid: true };
}
```

---

### x402 Payment Expiry

**Risk:** Payment verification proof expires before use.

**Prevention:**
```typescript
const PAYMENT_EXPIRY_MINUTES = 15;

async function validatePaymentTimestamp(payment) {
  const paymentAge = Date.now() - payment.timestamp;
  const maxAge = PAYMENT_EXPIRY_MINUTES * 60 * 1000;

  if (paymentAge > maxAge) {
    return {
      error: 'Payment expired. Please submit a new payment.',
      expired: true,
    };
  }

  return { valid: true };
}
```

---

### Payment Metadata Validation

**Risk:** Payment metadata doesn't match request.

**Prevention:**
```typescript
async function verifyPaymentMetadata(payment, request) {
  // Payment should include domain in metadata
  if (!payment.metadata?.domain) {
    console.warn('Payment missing domain metadata');
    // Still allow, but log warning
  } else if (payment.metadata.domain !== request.domain) {
    // Domain mismatch - reject
    return {
      error: `Payment was for domain ${payment.metadata.domain}, but requested ${request.domain}`,
      mismatch: true,
    };
  }

  // Payment should include target URL
  if (payment.metadata?.targetUrl !== request.targetUrl) {
    console.warn('Target URL mismatch in payment metadata');
    // Not critical, allow with warning
  }

  return { valid: true };
}
```

---

### Double-Spend Protection

**Risk:** Same USDC transaction used for multiple registrations.

**Prevention:**
```typescript
// x402 SDK should handle this, but verify
async function checkDoubleSpend(transactionHash) {
  const existing = await db.getPaymentByTxHash(transactionHash);

  if (existing && existing.state === 'used') {
    return {
      error: 'Transaction already used for registration',
      doubleSpend: true,
    };
  }

  // Mark as used atomically
  await db.transaction(async (tx) => {
    await tx.markPaymentUsed(transactionHash);
  });

  return { valid: true };
}
```

---

## Deployment Warnings

### Railway-Specific

1. **Ephemeral Filesystem (CRITICAL):**
   - Container filesystem is wiped on every deploy
   - **MUST** use Railway Volumes for SQLite database
   - Path: `/railway/data/x402names.db`
   - Configure in Railway UI: "Add Volume"

2. **Environment Variables:**
   - Railway injects `RAILWAY_VOLUME_PATH` env var
   - Use it to locate database:
   ```typescript
   const dbPath = process.env.RAILWAY_VOLUME_PATH
     ? `${process.env.RAILWAY_VOLUME_PATH}/x402names.db`
     : './data/x402names.db';
   ```

3. **IP Address for Namecheap Whitelisting:**
   - Railway gives you a public IP
   - But it can change on redeploys
   - **Action:** Check IP after every deploy: `curl ifconfig.me`
   - Whitelist in Namecheap dashboard

4. **Automatic Restarts:**
   - Railway restarts containers periodically
   - Ensure database connection re-established on restart
   - WAL mode handles this gracefully

5. **Build vs Runtime:**
   - Build happens in one container
   - Runtime happens in another
   - Don't create DB during build, only at runtime

---

### Fly.io-Specific

1. **Persistent Volumes:**
   ```toml
   # fly.toml
   [mounts]
     source = "x402names_data"
     destination = "/data"
   ```
   - Create volume first: `fly volumes create x402names_data --size 1`
   - DB path: `/data/x402names.db`

2. **Multiple Regions:**
   - If deploying to multiple regions, each needs its own volume
   - SQLite doesn't support distributed writes
   - **Recommendation:** Single region for v1.0

3. **Health Checks:**
   ```toml
   [http_service.checks]
     [http_service.checks.db_health]
       method = "GET"
       path = "/health/db"
       interval = "30s"
       timeout = "5s"
   ```
   - Implement endpoint that checks DB is accessible

---

### Backup Strategy on PaaS

1. **Railway:**
   - Volumes are persistent but not automatically backed up
   - **MUST** implement application-level backups to S3
   - See "Database Backup Failures" section above

2. **Fly.io:**
   - Volumes have snapshots but are manual
   - **MUST** implement application-level backups
   - Consider Litestream for continuous replication

3. **Both platforms:**
   - Test restore from backup on fresh instance
   - Document restore procedure
   - Automate backup uploads (hourly minimum)

---

### Environment-Specific Configuration

```typescript
// config.ts
const isProduction = process.env.NODE_ENV === 'production';
const isRailway = !!process.env.RAILWAY_VOLUME_PATH;
const isFly = !!process.env.FLY_APP_NAME;

export const config = {
  database: {
    path: isRailway
      ? `${process.env.RAILWAY_VOLUME_PATH}/x402names.db`
      : isFly
      ? '/data/x402names.db'
      : './data/x402names.db',

    // More aggressive WAL checkpointing on PaaS
    walCheckpointInterval: isProduction ? 1000 : 5000,
  },

  namecheap: {
    apiUrl: isProduction
      ? 'https://api.namecheap.com/xml.response'
      : 'https://api.sandbox.namecheap.com/xml.response',

    apiKey: process.env.NAMECHEAP_API_KEY,
    username: process.env.NAMECHEAP_USERNAME,
  },

  backups: {
    enabled: isProduction,
    interval: '0 * * * *', // Hourly
    destination: process.env.BACKUP_S3_BUCKET,
  },
};
```

---

### Zero-Downtime Deploys

**Risk:** Deploy interrupts in-flight registrations.

**Prevention:**
1. **Graceful shutdown:**
   ```typescript
   process.on('SIGTERM', async () => {
     console.log('SIGTERM received, graceful shutdown...');

     // Stop accepting new requests
     await server.close();

     // Wait for in-flight requests (30s max)
     await waitForInflightRequests(30000);

     // Close DB connection
     db.close();

     process.exit(0);
   });
   ```

2. **Health check that fails before shutdown:**
   ```typescript
   let shuttingDown = false;

   app.get('/health', (c) => {
     if (shuttingDown) {
       return c.text('Shutting down', 503);
     }
     return c.text('OK', 200);
   });
   ```

3. **Queue-based registrations:**
   - In-flight registrations in queue survive deploys
   - Queue storage (Redis/BullMQ) is separate from app
   - Registrations resume after deploy

---

## Summary

**Critical pitfalls for v1.0:**
1. Payment-registration atomicity (financial risk)
2. SQLite on ephemeral filesystem (data loss)
3. Sandbox vs production differences (launch failure)
4. DNS propagation UX (support burden)
5. x402 payment replay attacks (revenue loss)
6. Namecheap rate limiting (scalability)
7. Database backups (disaster recovery)
8. Concurrent write handling (reliability)

**Confidence assessment:**
- Payment atomicity patterns: HIGH (universal pattern)
- SQLite production practices: HIGH (well-documented)
- Namecheap specifics: MEDIUM (unable to verify current API docs)
- x402 SDK behavior: MEDIUM (new SDK, limited public documentation)
- Deployment platforms: HIGH (Railway/Fly.io well-documented)

**Recommended phase priorities:**
1. **v1.0 Core:** Atomicity, SQLite config, validation, backups
2. **v1.0 Hardening:** Rate limiting, error handling, monitoring
3. **v1.1+:** Abuse prevention, TLD expansion, advanced features

**Research gaps:**
- Current Namecheap API documentation (need to verify error codes, field requirements)
- @openfacilitator/sdk replay protection behavior
- Railway/Fly.io volume backup features
