import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { OpenFacilitator, toV1NetworkId } from '@openfacilitator/sdk';
import type { PaymentRequirementsV1, PaymentPayload } from '@openfacilitator/sdk';
import type { DomainRegistrar } from '../../integrations/registrar/types';
import { domains } from '../../db/schema';
import { createProblemResponse, validationErrorHook } from '../../lib/errors';
import { hasPaymentBeenUsed, recordPayment } from '../../integrations/payment/replay-protection';
import { env } from '../../config/env';

/** Flat fee for domain transfer in USDC */
const TRANSFER_FEE_USDC = 2.00;

/** Transfer fee in atomic units (6 decimals) */
const TRANSFER_FEE_ATOMIC = String(Math.round(TRANSFER_FEE_USDC * 1_000_000));

/** USDC contract address on Base */
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/**
 * Request schema for domain transfer
 */
const transferSchema = z.object({
  namecheapUsername: z.string().min(1, 'namecheapUsername is required'),
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
 * Factory function to create domain transfer routes with dependency injection
 */
export function createTransferRoutes(
  registrar: DomainRegistrar,
  db: BunSQLiteDatabase<any>
) {
  const router = new Hono();
  const facilitator = new OpenFacilitator({ url: env.X402_FACILITATOR_URL });

  /**
   * POST /:name/transfer
   * Transfer/push a domain to another Namecheap account with x402 payment
   */
  router.post('/:name/transfer', zValidator('json', transferSchema, validationErrorHook), async (c) => {
    const { namecheapUsername } = c.req.valid('json');
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
      maxAmountRequired: TRANSFER_FEE_ATOMIC,
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
          amount: TRANSFER_FEE_ATOMIC,
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
          amount: TRANSFER_FEE_ATOMIC,
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
        'Only the domain owner can transfer this domain'
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

    // 9. Push domain to target account
    let transferResult;
    try {
      transferResult = await registrar.pushToAccount(domainName, namecheapUsername);
    } catch (error) {
      console.error('Failed to transfer domain:', error);
      return createProblemResponse(
        c,
        500,
        'error:transfer_failed',
        'Transfer Failed',
        `Failed to transfer domain ${domainName}`
      );
    }

    // 10. Record payment and update domain status
    try {
      db.transaction(() => {
        recordPayment(db, {
          paymentId,
          walletAddress: payerWallet,
          amount: TRANSFER_FEE_USDC.toFixed(2),
          network: settleResult.network || env.X402_NETWORK,
          domain: domainName,
        });

        db.update(domains)
          .set({
            status: 'pending',
            updatedAt: new Date(),
          })
          .where(eq(domains.name, domainName))
          .run();
      });
    } catch (error) {
      console.error('Failed to record transfer:', error);
      return createProblemResponse(
        c,
        500,
        'error:internal',
        'Internal Server Error',
        'Failed to record domain transfer'
      );
    }

    // 11. Return success
    return c.json({
      success: true,
      domain: domainName,
      transferredTo: namecheapUsername,
      transfer: {
        transactionId: transferResult.transactionId,
      },
      txHash: settleResult.transaction,
    }, 200);
  });

  return router;
}
