import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { OpenFacilitator, toV1NetworkId } from '@openfacilitator/sdk';
import type { PaymentRequirementsV1, PaymentPayload } from '@openfacilitator/sdk';
import type { DomainRegistrar } from '../../integrations/registrar/types';
import { domains } from '../../db/schema';
import { createProblemResponse } from '../../lib/errors';
import { getTldPricing } from '../../config/tlds';
import { hasPaymentBeenUsed, recordPayment } from '../../integrations/payment/replay-protection';
import { env } from '../../config/env';

/** USDC contract address on Base */
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/**
 * Convert USDC dollar amount to atomic units (6 decimals)
 */
function usdcToAtomicUnits(usdc: number): string {
  return String(Math.round(usdc * 1_000_000));
}

/**
 * Generate a payment ID from the payment header for idempotency
 */
async function generatePaymentId(paymentHeader: string): Promise<string> {
  const hash = new Bun.CryptoHasher('sha256');
  hash.update(paymentHeader);
  return hash.digest('hex');
}

/**
 * Factory function to create domain renewal routes with dependency injection
 */
export function createRenewRoutes(
  registrar: DomainRegistrar,
  db: BunSQLiteDatabase<any>
) {
  const router = new Hono();
  const facilitator = new OpenFacilitator({ url: env.X402_FACILITATOR_URL });

  /**
   * POST /:name/renew
   * Renew a domain with x402 payment
   */
  router.post('/:name/renew', async (c) => {
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

    // 2. Validate domain status
    if (domain.status !== 'registered' && domain.status !== 'live') {
      return createProblemResponse(
        c,
        400,
        'error:invalid_domain_status',
        'Invalid Domain Status',
        `Domain ${domainName} has status '${domain.status}' and cannot be renewed`
      );
    }

    // 3. Get renewal pricing from TLD config with markup
    const pricing = getTldPricing(domain.tld);
    if (!pricing) {
      return createProblemResponse(
        c,
        400,
        'error:unsupported_tld',
        'Unsupported TLD',
        `TLD '${domain.tld}' is not supported for renewal`
      );
    }

    const renewalFeeUsdc = pricing.renewalPriceUsdc;
    const renewalFeeAtomic = usdcToAtomicUnits(renewalFeeUsdc);

    // 4. Build payment requirements
    const v1Network = toV1NetworkId(env.X402_NETWORK);

    const requirements: PaymentRequirementsV1 = {
      scheme: 'exact',
      network: v1Network,
      maxAmountRequired: renewalFeeAtomic,
      asset: USDC_BASE,
      payTo: env.X402_RECEIVING_ADDRESS,
    };

    // 5. Check for x-payment header
    const xPayment = c.req.header('x-payment');

    if (!xPayment) {
      const paymentBody = {
        x402Version: 2,
        error: 'Payment Required',
        accepts: [{
          scheme: 'exact',
          network: env.X402_NETWORK,
          amount: renewalFeeAtomic,
          asset: USDC_BASE,
          payTo: env.X402_RECEIVING_ADDRESS,
          maxTimeoutSeconds: 300,
          extra: { name: 'USD Coin', version: '2' },
        }],
        resource: {
          url: `${c.req.url}`,
          method: 'POST',
        },
      };
      c.header('payment-required', btoa(JSON.stringify(paymentBody)));
      return c.json(paymentBody, 402);
    }

    // 6. Decode the payment payload
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

    // 7. Verify the payment
    const verifyResult = await facilitator.verify(paymentPayload, requirements);
    if (!verifyResult.isValid) {
      const paymentBody = {
        x402Version: 2,
        error: 'Payment verification failed',
        reason: verifyResult.invalidReason,
        accepts: [{
          scheme: 'exact',
          network: env.X402_NETWORK,
          amount: renewalFeeAtomic,
          asset: USDC_BASE,
          payTo: env.X402_RECEIVING_ADDRESS,
          maxTimeoutSeconds: 300,
          extra: { name: 'USD Coin', version: '2' },
        }],
      };
      c.header('payment-required', btoa(JSON.stringify(paymentBody)));
      return c.json(paymentBody, 402);
    }

    // 8. Verify ownership
    const payerWallet = verifyResult.payer || '';
    if (domain.ownerWallet.toLowerCase() !== payerWallet.toLowerCase()) {
      return createProblemResponse(
        c,
        403,
        'error:not_domain_owner',
        'Forbidden',
        'Only the domain owner can renew this domain'
      );
    }

    // 9. Idempotency check
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

    // 10. Settle the payment
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

    // 11. Renew domain via registrar
    let renewalResult;
    try {
      renewalResult = await registrar.renew(domainName, 1);
    } catch (error) {
      console.error('Failed to renew domain:', error);
      return createProblemResponse(
        c,
        500,
        'error:renewal_failed',
        'Renewal Failed',
        `Failed to renew domain ${domainName}`
      );
    }

    // 12. Record payment and update domain
    try {
      db.transaction(() => {
        recordPayment(db, {
          paymentId,
          walletAddress: payerWallet,
          amount: renewalFeeUsdc.toFixed(2),
          network: settleResult.network || env.X402_NETWORK,
          domain: domainName,
        });

        db.update(domains)
          .set({ updatedAt: new Date() })
          .where(eq(domains.name, domainName))
          .run();
      });
    } catch (error) {
      console.error('Failed to record renewal:', error);
      return createProblemResponse(
        c,
        500,
        'error:internal',
        'Internal Server Error',
        'Failed to record domain renewal'
      );
    }

    // 13. Return success
    return c.json({
      success: true,
      domain: domainName,
      renewal: {
        transactionId: renewalResult.transactionId,
        orderId: renewalResult.orderId,
        expiresAt: renewalResult.expiresAt?.toISOString(),
      },
      price: renewalFeeUsdc,
      txHash: settleResult.transaction,
    }, 200);
  });

  return router;
}
