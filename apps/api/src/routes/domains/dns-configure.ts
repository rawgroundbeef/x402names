import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { OpenFacilitator, toV1NetworkId } from '@openfacilitator/sdk';
import type { PaymentRequirementsV1, PaymentPayload } from '@openfacilitator/sdk';
import { domains } from '../../db/schema';
import { createProblemResponse } from '../../lib/errors';
import type { DnsService } from '../../services/dns';
import type { DomainCache } from '../../redirect/cache';
import type { ContentCache } from '../../redirect/content-cache';
import { hasPaymentBeenUsed, recordPayment } from '../../integrations/payment/replay-protection';
import { env } from '../../config/env';

/** Flat fee for DNS reconfiguration in USDC */
const DNS_CONFIGURE_FEE_USDC = 1.00;

/** DNS configure fee in atomic units (6 decimals) */
const DNS_CONFIGURE_FEE_ATOMIC = String(Math.round(DNS_CONFIGURE_FEE_USDC * 1_000_000));

/** USDC contract address on Base */
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/**
 * Generate a payment ID from the payment header for idempotency
 */
async function generatePaymentId(paymentHeader: string): Promise<string> {
  const hash = new Bun.CryptoHasher('sha256');
  hash.update(paymentHeader);
  return hash.digest('hex');
}

/**
 * Factory function to create DNS reconfigure routes with dependency injection
 */
export function createDnsConfigureRoutes(
  db: BunSQLiteDatabase<any>,
  dnsService: DnsService,
  domainCache: DomainCache,
  contentCache: ContentCache
) {
  const router = new Hono();
  const facilitator = new OpenFacilitator({ url: env.X402_FACILITATOR_URL });

  /**
   * POST /:name/dns/configure
   * Reconfigure DNS for a domain with x402 payment
   */
  router.post('/:name/dns/configure', async (c) => {
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

    // 2. Build payment requirements
    const v1Network = toV1NetworkId(env.X402_NETWORK);

    const requirements: PaymentRequirementsV1 = {
      scheme: 'exact',
      network: v1Network,
      maxAmountRequired: DNS_CONFIGURE_FEE_ATOMIC,
      asset: USDC_BASE,
      payTo: env.X402_RECEIVING_ADDRESS,
    };

    // 3. Check for x-payment header
    const xPayment = c.req.header('x-payment');

    if (!xPayment) {
      const paymentBody = {
        x402Version: 2,
        error: 'Payment Required',
        accepts: [{
          scheme: 'exact',
          network: env.X402_NETWORK,
          amount: DNS_CONFIGURE_FEE_ATOMIC,
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

    // 4. Decode the payment payload
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

    // 5. Verify the payment
    const verifyResult = await facilitator.verify(paymentPayload, requirements);
    if (!verifyResult.isValid) {
      const paymentBody = {
        x402Version: 2,
        error: 'Payment verification failed',
        reason: verifyResult.invalidReason,
        accepts: [{
          scheme: 'exact',
          network: env.X402_NETWORK,
          amount: DNS_CONFIGURE_FEE_ATOMIC,
          asset: USDC_BASE,
          payTo: env.X402_RECEIVING_ADDRESS,
          maxTimeoutSeconds: 300,
          extra: { name: 'USD Coin', version: '2' },
        }],
      };
      c.header('payment-required', btoa(JSON.stringify(paymentBody)));
      return c.json(paymentBody, 402);
    }

    // 6. Verify ownership
    const payerWallet = verifyResult.payer || '';
    if (domain.ownerWallet.toLowerCase() !== payerWallet.toLowerCase()) {
      return createProblemResponse(
        c,
        403,
        'error:not_domain_owner',
        'Forbidden',
        'Only the domain owner can reconfigure DNS'
      );
    }

    // 7. Idempotency check
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

    // 8. Settle the payment
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

    // 9. Configure DNS
    let dnsResult;
    try {
      dnsResult = await dnsService.configureDomain(domainName);
    } catch (error) {
      console.error('Failed to configure DNS:', error);
      return createProblemResponse(
        c,
        500,
        'error:dns_configuration_failed',
        'DNS Configuration Failed',
        `Failed to configure DNS for ${domainName}`
      );
    }

    // 10. Update database and record payment
    try {
      db.transaction(() => {
        recordPayment(db, {
          paymentId,
          walletAddress: payerWallet,
          amount: DNS_CONFIGURE_FEE_USDC.toFixed(2),
          network: settleResult.network || env.X402_NETWORK,
          domain: domainName,
        });

        // Update status to 'live' if it was 'registered'
        if (domain.status === 'registered') {
          db.update(domains)
            .set({
              status: 'live',
              updatedAt: new Date(),
            })
            .where(eq(domains.name, domainName))
            .run();
        } else {
          db.update(domains)
            .set({ updatedAt: new Date() })
            .where(eq(domains.name, domainName))
            .run();
        }
      });
    } catch (error) {
      console.error('Failed to record DNS reconfiguration:', error);
      return createProblemResponse(
        c,
        500,
        'error:internal',
        'Internal Server Error',
        'Failed to record DNS reconfiguration'
      );
    }

    // 11. Invalidate caches
    domainCache.del(domainName);
    contentCache.delDomain(domainName);

    // 12. Return success
    return c.json({
      success: true,
      domain: domainName,
      dns: dnsResult,
      statusUpdated: domain.status === 'registered' ? 'live' : domain.status,
      txHash: settleResult.transaction,
    }, 200);
  });

  return router;
}
