import { Hono } from 'hono';
import { getAllTlds, getTldPricing, tldConfig } from '../config/tlds';
import { createProblemResponse } from '../lib/errors';

const tlds = new Hono();

/**
 * GET /tlds
 * List all supported TLDs with USDC pricing
 */
tlds.get('/', (c) => {
  const allTlds = getAllTlds();

  return c.json({
    tlds: allTlds.map((tld) => ({
      tld: tld.tld,
      registrationPrice: tld.registrationPriceUsdc,
      renewalPrice: tld.renewalPriceUsdc,
      currency: 'USDC',
    })),
    count: allTlds.length,
    lastUpdated: tldConfig.lastUpdated,
  });
});

/**
 * GET /tlds/:tld
 * Get pricing for a specific TLD
 */
tlds.get('/:tld', (c) => {
  const tld = c.req.param('tld');
  const pricing = getTldPricing(tld);

  if (!pricing) {
    return createProblemResponse(
      c,
      404,
      'error:not_found',
      'TLD Not Found',
      `TLD '${tld}' is not supported or does not exist`
    );
  }

  return c.json({
    tld: pricing.tld,
    registrationPrice: pricing.registrationPriceUsdc,
    renewalPrice: pricing.renewalPriceUsdc,
    currency: 'USDC',
  });
});

export default tlds;
