import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { batchCheckSchema } from '../../lib/validation/domain';
import { validateDomain } from '../../lib/validation/domain';
import { DomainRegistrar, RegistrarUnavailable } from '../../integrations/registrar/types';
import { getTldPricing, isSupportedTld } from '../../config/tlds';
import { generateSuggestions } from '../../lib/suggestions/alternatives';
import { validationErrorHook } from '../../lib/errors';

/**
 * Result for a single domain availability check
 */
interface DomainCheckResult {
  domain: string;
  available: boolean;
  price?: {
    registration: number;
    renewal: number;
    currency: string;
  } | null;
  suggestions?: string[];
  error?: string;
}

/**
 * Factory function to create check routes with registrar dependency injection
 */
export function createCheckRoutes(registrar: DomainRegistrar) {
  const router = new Hono();

  /**
   * POST /domains/check
   * Batch availability check for 1-10 domains
   */
  router.post('/', zValidator('json', batchCheckSchema, validationErrorHook), async (c) => {
    const { domains } = c.req.valid('json');

    // Process all domains in parallel
    const results = await Promise.all(
      domains.map(async (domain): Promise<DomainCheckResult> => {
        // Validate domain format
        const validation = validateDomain(domain);
        if (!validation.valid) {
          return {
            domain,
            available: false,
            error: validation.error,
          };
        }

        const { tld } = validation;

        // Check if TLD is supported
        if (!tld || !isSupportedTld(tld)) {
          return {
            domain,
            available: false,
            error: 'Unsupported TLD',
          };
        }

        try {
          // Check availability with registrar
          const availability = await registrar.checkAvailability(domain);

          if (availability.available) {
            // Get pricing for available domains
            const pricing = getTldPricing(tld);

            if (!pricing) {
              return {
                domain,
                available: false,
                error: 'Pricing not available for this TLD',
              };
            }

            // Handle premium domains
            if (availability.isPremium) {
              return {
                domain,
                available: true,
                price: null,
                error: 'Premium domain - contact for pricing',
              };
            }

            // Return availability with USDC pricing
            return {
              domain,
              available: true,
              price: {
                registration: pricing.registrationPriceUsdc,
                renewal: pricing.renewalPriceUsdc,
                currency: 'USDC',
              },
            };
          } else {
            // Generate suggestions for unavailable domains
            const suggestions = generateSuggestions(domain, 5);

            return {
              domain,
              available: false,
              suggestions,
            };
          }
        } catch (error) {
          // Handle registrar errors
          if (error instanceof RegistrarUnavailable) {
            return {
              domain,
              available: false,
              error: 'Registrar temporarily unavailable',
            };
          }

          // Re-throw unknown errors to be caught by global error handler
          throw error;
        }
      })
    );

    return c.json({ results });
  });

  return router;
}
