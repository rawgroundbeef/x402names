import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { OpenFacilitator, toV1NetworkId } from '@openfacilitator/sdk';
import type { PaymentRequirementsV1, PaymentPayload } from '@openfacilitator/sdk';
import { domains } from '../../db/schema';
import { createProblemResponse, createValidationProblem, validationErrorHook } from '../../lib/errors';
import { validateTargetUrl } from '../../lib/validation/url';
import { DomainCache } from '../../redirect/cache';
import type { ContentCache } from '../../redirect/content-cache';
import { hasPaymentBeenUsed, recordPayment } from '../../integrations/payment/replay-protection';
import { env } from '../../config/env';

/** Flat fee for URL updates in USDC */
const URL_UPDATE_FEE_USDC = 2.00;

/** URL update fee in atomic units (6 decimals) */
const URL_UPDATE_FEE_ATOMIC = String(Math.round(URL_UPDATE_FEE_USDC * 1_000_000));

/** USDC contract address on Base */
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/**
 * Request schema for URL update
 */
const urlUpdateSchema = z.object({
  targetUrl: z.string().min(1, 'targetUrl is required'),
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
 * Factory function to create URL update routes with dependency injection
 */
export function createUrlUpdateRoutes(
  db: BunSQLiteDatabase<any>,
  domainCache: DomainCache,
  contentCache: ContentCache
) {
  const router = new Hono();
  const facilitator = new OpenFacilitator({ url: env.X402_FACILITATOR_URL });

  /**
   * PATCH /:name/url
   * Update a domain's target URL with x402 payment
   */
  router.patch('/:name/url', zValidator('json', urlUpdateSchema, validationErrorHook), async (c) => {
    const { targetUrl } = c.req.valid('json');
    const domainName = c.req.param('name');

    // 1. Validate target URL
    const urlValidation = validateTargetUrl(targetUrl);
    if (!urlValidation.valid) {
      const validationErrors = urlValidation.errors.map(error => {
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

        return {
          field: 'targetUrl',
          code,
          message: error
        };
      });

      return createValidationProblem(c, validationErrors);
    }

    // 2. Look up domain in database
    const domain = db
      .select()
      .from(domains)
      .where(eq(domains.name, domainName))
      .get();

    if (!domain) {
      return createProblemResponse(
        c,
        404,
        'error:domain_not_found',
        'Domain Not Found',
        `Domain ${domainName} does not exist`
      );
    }

    // 3. Build payment requirements
    const v1Network = toV1NetworkId(env.X402_NETWORK);

    const requirements: PaymentRequirementsV1 = {
      scheme: 'exact',
      network: v1Network,
      maxAmountRequired: URL_UPDATE_FEE_ATOMIC,
      asset: USDC_BASE,
      payTo: env.X402_RECEIVING_ADDRESS,
    };

    // 4. Check for x-payment header — return proper 402 if missing
    const xPayment = c.req.header('x-payment');

    if (!xPayment) {
      const paymentBody = {
        x402Version: 2,
        error: 'Payment Required',
        accepts: [{
          scheme: 'exact',
          network: env.X402_NETWORK,
          amount: URL_UPDATE_FEE_ATOMIC,
          asset: USDC_BASE,
          payTo: env.X402_RECEIVING_ADDRESS,
          maxTimeoutSeconds: 300,
          extra: { name: 'USD Coin', version: '2' },
        }],
        resource: {
          url: `${c.req.url}`,
          method: 'PATCH',
        },
      };
      c.header('payment-required', btoa(JSON.stringify(paymentBody)));
      return c.json(paymentBody, 402);
    }

    // 5. Decode the payment payload
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

    // 6. Verify the payment (does NOT settle)
    const verifyResult = await facilitator.verify(paymentPayload, requirements);
    if (!verifyResult.isValid) {
      const paymentBody = {
        x402Version: 2,
        error: 'Payment verification failed',
        reason: verifyResult.invalidReason,
        accepts: [{
          scheme: 'exact',
          network: env.X402_NETWORK,
          amount: URL_UPDATE_FEE_ATOMIC,
          asset: USDC_BASE,
          payTo: env.X402_RECEIVING_ADDRESS,
          maxTimeoutSeconds: 300,
          extra: { name: 'USD Coin', version: '2' },
        }],
      };
      c.header('payment-required', btoa(JSON.stringify(paymentBody)));
      return c.json(paymentBody, 402);
    }

    // 7. Verify ownership — payer wallet must match domain owner
    const payerWallet = verifyResult.payer || '';
    if (domain.ownerWallet.toLowerCase() !== payerWallet.toLowerCase()) {
      return createProblemResponse(
        c,
        403,
        'error:not_domain_owner',
        'Forbidden',
        'Only the domain owner can update the URL'
      );
    }

    // 8. Idempotency check
    if (domain.targetUrl === targetUrl) {
      return c.json({
        success: true,
        updated: false,
        reason: 'url_already_set',
        domain: domainName,
        targetUrl,
      }, 200);
    }

    const paymentId = await generatePaymentId(xPayment);
    if (hasPaymentBeenUsed(db, paymentId)) {
      return createProblemResponse(
        c,
        409,
        'error:payment_already_used',
        'Payment Already Used',
        'This payment has already been processed'
      );
    }

    // 9. Settle the payment on-chain
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

    // 10. Update database and record payment in transaction
    const previousUrl = domain.targetUrl;

    try {
      db.transaction(() => {
        recordPayment(db, {
          paymentId,
          walletAddress: payerWallet,
          amount: URL_UPDATE_FEE_USDC.toFixed(2),
          network: settleResult.network || env.X402_NETWORK,
          domain: domainName,
        });

        db.update(domains)
          .set({
            targetUrl,
            updatedAt: new Date()
          })
          .where(eq(domains.name, domainName))
          .run();
      });
    } catch (error) {
      console.error('Failed to update domain URL:', error);
      return createProblemResponse(
        c,
        500,
        'error:internal',
        'Internal Server Error',
        'Failed to update domain URL'
      );
    }

    // 11. Invalidate caches
    domainCache.del(domainName);
    contentCache.delDomain(domainName);

    // 12. Return success response
    return c.json({
      success: true,
      updated: true,
      domain: domainName,
      targetUrl,
      previousUrl,
      txHash: settleResult.transaction,
    }, 200);
  });

  return router;
}
