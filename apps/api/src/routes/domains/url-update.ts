import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { decodePaymentSignatureHeader } from '@x402/core/http';
import { domains } from '../../db/schema';
import { createProblemResponse, validationErrorHook } from '../../lib/errors';
import { DomainCache } from '../../redirect/cache';
import { hasPaymentBeenUsed, recordPayment } from '../../integrations/payment/replay-protection';

/**
 * Flat fee for URL updates
 */
const URL_UPDATE_FEE_USDC = 2.00;

/**
 * Request schema for URL update
 */
const urlUpdateSchema = z.object({
  targetUrl: z.string().url(),
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
  domainCache: DomainCache
) {
  const router = new Hono();

  /**
   * PATCH /:name/url
   * Update a domain's target URL with x402 payment
   */
  router.patch('/:name/url', zValidator('json', urlUpdateSchema, validationErrorHook), async (c) => {
    const { targetUrl } = c.req.valid('json');
    const domainName = c.req.param('name');

    // 1. Look up domain in database
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

    // 2. Extract payment header
    const paymentHeader = c.req.header('payment-signature') || c.req.header('x-payment');

    if (!paymentHeader) {
      return createProblemResponse(
        c,
        402,
        'error:payment_required',
        'Payment Required',
        'URL update costs 2.00 USDC'
      );
    }

    // 3. Decode payment
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

    // 4. Extract payer wallet
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

    // 5. Validate payment amount
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

    if (paymentAmountUsdc < URL_UPDATE_FEE_USDC) {
      return createProblemResponse(
        c,
        402,
        'error:insufficient_payment',
        'Insufficient Payment',
        `URL update requires ${URL_UPDATE_FEE_USDC.toFixed(2)} USDC but payment was ${paymentAmountUsdc.toFixed(2)} USDC`
      );
    }

    // 6. Verify ownership
    if (domain.ownerWallet.toLowerCase() !== payerWallet.toLowerCase()) {
      return createProblemResponse(
        c,
        403,
        'error:not_domain_owner',
        'Forbidden',
        'Only the domain owner can update the URL'
      );
    }

    // 7. Idempotency check
    if (domain.targetUrl === targetUrl) {
      return c.json({
        success: true,
        updated: false,
        reason: 'url_already_set',
        domain: domainName,
        targetUrl,
      }, 200);
    }

    // 8. Check payment replay protection
    const paymentId = await generatePaymentId(paymentHeader);
    if (hasPaymentBeenUsed(db, paymentId)) {
      return createProblemResponse(
        c,
        409,
        'error:payment_already_used',
        'Payment Already Used',
        'This payment has already been processed'
      );
    }

    // 9. Update database and record payment in transaction
    const previousUrl = domain.targetUrl;

    try {
      db.transaction(() => {
        // Record payment for replay protection
        recordPayment(db, {
          paymentId,
          walletAddress: payerWallet,
          amount: URL_UPDATE_FEE_USDC.toFixed(2),
          network: c.req.header('x-payment-network') || 'unknown',
          domain: domainName,
        });

        // Update domain
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

    // 10. Invalidate cache
    domainCache.del(domainName);

    // 11. Return success response
    return c.json({
      success: true,
      updated: true,
      domain: domainName,
      targetUrl,
      previousUrl,
    }, 200);
  });

  return router;
}
