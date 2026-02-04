import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { decodePaymentSignatureHeader } from '@x402/core/http';
import type { DomainRegistrar } from '../../integrations/registrar/types';
import { validateDomain } from '../../lib/validation/domain';
import { validateTargetUrl } from '../../lib/validation/url';
import { getTldPricing, isSupportedTld } from '../../config/tlds';
import { createProblemResponse, createValidationProblem, validationErrorHook } from '../../lib/errors';
import { registrationJobs } from '../../db/schema';
import { hasPaymentBeenUsed, recordPayment } from '../../integrations/payment/replay-protection';
import { enqueueJob } from '../../lib/jobs/queue';
import type { createJobProcessor } from '../../lib/jobs/registration';

/**
 * Request schema for domain registration
 */
const registerSchema = z.object({
  domain: z.string().min(1),
  targetUrl: z.string().optional(),
});

/**
 * Generate a payment ID from the payment header for idempotency
 */
async function generatePaymentId(paymentHeader: string): Promise<string> {
  const hash = new Bun.CryptoHasher('sha256');
  hash.update(paymentHeader);
  return hash.digest('hex');
}

/**
 * Factory function to create register routes with dependency injection
 */
export function createRegisterRoutes(
  registrar: DomainRegistrar,
  db: BunSQLiteDatabase<any>,
  jobProcessor: ReturnType<typeof createJobProcessor>
) {
  const router = new Hono();

  /**
   * POST /domains/register
   * Register a domain with x402 payment
   */
  router.post('/', zValidator('json', registerSchema, validationErrorHook), async (c) => {
    const { domain, targetUrl } = c.req.valid('json');

    // 1. Validate domain format and URL
    const validationErrors: Array<{ field: string; code: string; message: string }> = [];

    const domainValidation = validateDomain(domain);
    if (!domainValidation.valid) {
      validationErrors.push({
        field: 'domain',
        code: 'DOMAIN_INVALID_FORMAT',
        message: domainValidation.error || 'Invalid domain format'
      });
    }

    // Validate target URL if provided
    if (targetUrl) {
      const urlValidation = validateTargetUrl(targetUrl);
      if (!urlValidation.valid) {
        // Map URL validation errors to error codes
        for (const error of urlValidation.errors) {
          let code = 'URL_VALIDATION_ERROR';
          if (error.includes('Only HTTP and HTTPS')) {
            code = 'URL_SCHEME_UNSUPPORTED';
          } else if (error.includes('Localhost')) {
            code = 'URL_LOCALHOST_REJECTED';
          } else if (error.includes('Private IP')) {
            code = 'URL_PRIVATE_ADDRESS';
          } else if (error.includes('Metadata service')) {
            code = 'URL_PRIVATE_ADDRESS';
          } else if (error.includes('credentials')) {
            code = 'URL_CREDENTIALS_REJECTED';
          } else if (error.includes('maximum length')) {
            code = 'URL_TOO_LONG';
          } else if (error.includes('Invalid URL format')) {
            code = 'URL_INVALID_FORMAT';
          }

          validationErrors.push({
            field: 'targetUrl',
            code,
            message: error
          });
        }
      }
    }

    // Return all validation errors if any exist
    if (validationErrors.length > 0) {
      return createValidationProblem(c, validationErrors);
    }

    const { tld } = domainValidation;

    // 2. Check TLD is supported
    if (!tld || !isSupportedTld(tld)) {
      return createProblemResponse(
        c,
        400,
        'error:unsupported_tld',
        'Unsupported TLD',
        `TLD .${tld} is not supported for registration`
      );
    }

    // 3. Get TLD pricing
    const pricing = getTldPricing(tld);
    if (!pricing) {
      return createProblemResponse(
        c,
        400,
        'error:pricing_not_available',
        'Pricing Not Available',
        `Pricing information not available for TLD .${tld}`
      );
    }

    // 4. Check domain availability
    try {
      const availability = await registrar.checkAvailability(domain);

      if (!availability.available) {
        return createProblemResponse(
          c,
          409,
          'error:domain_unavailable',
          'Domain Not Available',
          'Domain is not available for registration'
        );
      }

      if (availability.isPremium) {
        return createProblemResponse(
          c,
          400,
          'error:premium_domain',
          'Premium Domain Not Supported',
          'Premium domains are not supported'
        );
      }
    } catch (error) {
      // Re-throw to be caught by global error handler
      throw error;
    }

    // 5. Extract payer wallet and validate payment amount from payment header
    const paymentHeader = c.req.header('payment-signature') || c.req.header('x-payment');

    if (!paymentHeader) {
      return createProblemResponse(
        c,
        402,
        'error:payment_required',
        'Payment Required',
        'No payment header found'
      );
    }

    let paymentPayload: any;
    try {
      paymentPayload = decodePaymentSignatureHeader(paymentHeader);
    } catch (error) {
      return createProblemResponse(
        c,
        400,
        'error:invalid_payment',
        'Invalid Payment',
        'Could not decode payment header'
      );
    }

    const payerWallet = (paymentPayload.payload as any)?.authorization?.from;

    if (!payerWallet) {
      return createProblemResponse(
        c,
        400,
        'error:invalid_payment',
        'Invalid Payment',
        'Could not extract payer wallet from payment'
      );
    }

    // Payment amount validation (CRITICAL)
    const paymentAmountRaw = paymentPayload.accepted?.amount
      || (paymentPayload.payload as any)?.authorization?.value;

    if (!paymentAmountRaw) {
      return createProblemResponse(
        c,
        400,
        'error:invalid_payment',
        'Invalid Payment',
        'Could not extract payment amount'
      );
    }

    const paymentAmountUsdc = Number(paymentAmountRaw) / 1_000_000;
    const requiredAmountUsdc = pricing.registrationPriceUsdc;

    if (paymentAmountUsdc < requiredAmountUsdc) {
      return createProblemResponse(
        c,
        402,
        'error:insufficient_payment',
        'Insufficient Payment',
        `Domain ${domain} requires ${requiredAmountUsdc.toFixed(2)} USDC but payment was ${paymentAmountUsdc.toFixed(2)} USDC`
      );
    }

    // TODO [HARD-05]: Verify x402 payment signature server-side against the facilitator.
    // Currently we decode the payment header but do not cryptographically verify the signature.
    // Phase 6 hardening will add: facilitator signature verification via x402 verify functions.

    // Generate payment ID for idempotency
    const paymentId = await generatePaymentId(paymentHeader);

    // 6. Check idempotency - Look up existing job by paymentId
    const existingJob = db
      .select()
      .from(registrationJobs)
      .where(eq(registrationJobs.paymentId, paymentId))
      .get();

    if (existingJob) {
      return c.json({
        jobId: existingJob.id,
        statusUrl: `/registrations/${existingJob.id}/status`,
        retryAfterSeconds: 2,
        message: 'Registration already in progress',
      }, 202);
    }

    // Also check payment records table for replay protection
    if (hasPaymentBeenUsed(db, paymentId)) {
      return createProblemResponse(
        c,
        409,
        'error:payment_already_used',
        'Payment Already Used',
        'This payment has already been processed'
      );
    }

    // 7. Create registration job atomically
    const jobId = crypto.randomUUID();

    try {
      db.transaction(() => {
        recordPayment(db, {
          paymentId,
          walletAddress: payerWallet,
          amount: pricing.registrationPriceUsdc.toFixed(2),
          network: c.req.header('x-payment-network') || 'unknown',
          domain,
        });

        db.insert(registrationJobs).values({
          id: jobId,
          domainName: domain,
          tld,
          ownerWallet: payerWallet,
          paymentId,
          amountPaid: pricing.registrationPriceUsdc.toFixed(2),
          targetUrl: targetUrl || null,
          state: 'processing',
          progress: 0,
          currentStep: 'payment_verified',
          attempts: 0,
          createdAt: new Date(),
        } as any).run();
      });
    } catch (error) {
      // Transaction failed
      console.error('Failed to create registration job:', error);
      return createProblemResponse(
        c,
        500,
        'error:internal',
        'Internal Server Error',
        'Failed to create registration job'
      );
    }

    // 8. Enqueue job for background processing
    enqueueJob(jobId, () => jobProcessor.processJob(jobId));

    // 9. Return 202 Accepted with LRO response
    return c.json({
      jobId,
      statusUrl: `/registrations/${jobId}/status`,
      retryAfterSeconds: 2,
      message: 'Registration initiated - payment verified',
    }, 202);
  });

  return router;
}
