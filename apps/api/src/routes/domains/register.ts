import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { OpenFacilitator, toV1NetworkId } from '@openfacilitator/sdk';
import type { PaymentRequirementsV1, PaymentPayload } from '@openfacilitator/sdk';
import type { DomainRegistrar } from '../../integrations/registrar/types';
import { validateDomain } from '../../lib/validation/domain';
import { validateTargetUrl } from '../../lib/validation/url';
import { getTldPricing, isSupportedTld } from '../../config/tlds';
import { createProblemResponse, createValidationProblem, validationErrorHook } from '../../lib/errors';
import { registrationJobs } from '../../db/schema';
import { hasPaymentBeenUsed, recordPayment } from '../../integrations/payment/replay-protection';
import { enqueueJob } from '../../lib/jobs/queue';
import type { createJobProcessor } from '../../lib/jobs/registration';
import { env } from '../../config/env';

/** USDC contract address on Base */
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

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
 * Convert USDC dollar amount to atomic units (6 decimals)
 */
function usdcToAtomicUnits(usdc: number): string {
  return String(Math.round(usdc * 1_000_000));
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
  const facilitator = new OpenFacilitator({ url: env.X402_FACILITATOR_URL });

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
      throw error;
    }

    // 5. Build payment requirements
    const amountAtomic = usdcToAtomicUnits(pricing.registrationPriceUsdc);
    const v1Network = toV1NetworkId(env.X402_NETWORK);

    const requirements: PaymentRequirementsV1 = {
      scheme: 'exact',
      network: v1Network,
      maxAmountRequired: amountAtomic,
      asset: USDC_BASE,
      payTo: env.X402_RECEIVING_ADDRESS,
    };

    // 6. Check for x-payment header — return proper 402 if missing
    const xPayment = c.req.header('x-payment');

    if (!xPayment) {
      const paymentBody = {
        x402Version: 2,
        error: 'Payment Required',
        accepts: [{
          scheme: 'exact',
          network: env.X402_NETWORK,
          amount: amountAtomic,
          asset: USDC_BASE,
          payTo: env.X402_RECEIVING_ADDRESS,
          maxTimeoutSeconds: 300,
        }],
        resource: {
          url: `${c.req.url}`,
          method: 'POST',
        },
      };
      c.header('payment-required', btoa(JSON.stringify(paymentBody)));
      return c.json(paymentBody, 402);
    }

    // 7. Decode the payment payload
    let paymentPayload: PaymentPayload;
    try {
      paymentPayload = JSON.parse(atob(xPayment));
    } catch {
      return createProblemResponse(
        c,
        400,
        'error:invalid_payment',
        'Invalid Payment',
        'Could not decode payment header'
      );
    }

    // 8. Verify the payment (does NOT settle)
    const verifyResult = await facilitator.verify(paymentPayload, requirements);
    if (!verifyResult.isValid) {
      const paymentBody = {
        x402Version: 2,
        error: 'Payment verification failed',
        reason: verifyResult.invalidReason,
        accepts: [{
          scheme: 'exact',
          network: env.X402_NETWORK,
          amount: amountAtomic,
          asset: USDC_BASE,
          payTo: env.X402_RECEIVING_ADDRESS,
          maxTimeoutSeconds: 300,
        }],
      };
      c.header('payment-required', btoa(JSON.stringify(paymentBody)));
      return c.json(paymentBody, 402);
    }

    // 9. Idempotency check
    const paymentId = await generatePaymentId(xPayment);

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

    if (hasPaymentBeenUsed(db, paymentId)) {
      return createProblemResponse(
        c,
        409,
        'error:payment_already_used',
        'Payment Already Used',
        'This payment has already been processed'
      );
    }

    // 10. Settle the payment on-chain
    const settleResult = await facilitator.settle(paymentPayload, requirements);
    if (!settleResult.success) {
      return createProblemResponse(
        c,
        500,
        'error:settlement_failed',
        'Settlement Failed',
        `Payment settlement failed: ${settleResult.errorReason || 'unknown error'}`
      );
    }

    // 11. Create registration job atomically
    const jobId = crypto.randomUUID();
    const payerWallet = settleResult.payer || verifyResult.payer || 'unknown';

    try {
      db.transaction(() => {
        recordPayment(db, {
          paymentId,
          walletAddress: payerWallet,
          amount: pricing.registrationPriceUsdc.toFixed(2),
          network: settleResult.network || env.X402_NETWORK,
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
      console.error('Failed to create registration job:', error);
      return createProblemResponse(
        c,
        500,
        'error:internal',
        'Internal Server Error',
        'Failed to create registration job'
      );
    }

    // 12. Enqueue job for background processing
    enqueueJob(jobId, () => jobProcessor.processJob(jobId));

    // 13. Return 202 Accepted with LRO response
    return c.json({
      jobId,
      statusUrl: `/registrations/${jobId}/status`,
      retryAfterSeconds: 2,
      txHash: settleResult.transaction,
      payer: payerWallet,
      message: 'Registration initiated - payment settled',
    }, 202);
  });

  return router;
}
