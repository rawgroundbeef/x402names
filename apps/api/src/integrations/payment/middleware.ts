import { paymentMiddleware } from '@x402/hono';
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { registerExactEvmScheme } from '@x402/evm/exact/server';
import type { RoutesConfig } from '@x402/core/server';
import type { Network } from '@x402/core/types';

export interface PaymentMiddlewareConfig {
  facilitatorUrl: string;
  network: Network;
}

export interface PaymentRouteConfig {
  path: string;
  price: string;
}

/**
 * Creates a configured x402 payment middleware for Hono routes.
 *
 * This factory sets up the x402 resource server with EVM exact payment scheme
 * and returns middleware that can be applied to protect routes with payment requirements.
 *
 * Note: The receiving address (payTo) is specified per-route in the route config,
 * not globally in the middleware config.
 *
 * @param config - Payment middleware configuration
 * @returns Hono middleware handler configured for x402 payments
 *
 * @example
 * ```typescript
 * const middleware = createPaymentMiddleware({
 *   facilitatorUrl: env.X402_FACILITATOR_URL,
 *   network: env.X402_NETWORK,
 * });
 *
 * app.use('/api/register', middleware({
 *   'POST /api/register': {
 *     accepts: {
 *       scheme: 'exact',
 *       payTo: env.X402_RECEIVING_ADDRESS,
 *       price: '5.00',
 *       network: env.X402_NETWORK,
 *     }
 *   }
 * }));
 * ```
 */
export function createPaymentMiddleware(config: PaymentMiddlewareConfig) {
  const { facilitatorUrl, network } = config;

  // Create HTTP facilitator client
  const facilitatorClient = new HTTPFacilitatorClient({
    url: facilitatorUrl,
  });

  // Create resource server and register EVM exact scheme
  const server = new x402ResourceServer(facilitatorClient);
  registerExactEvmScheme(server, { networks: [network] });

  // Return configured middleware factory
  return (routes: RoutesConfig) => {
    return paymentMiddleware(routes, server);
  };
}
