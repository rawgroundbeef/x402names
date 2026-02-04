import tldConfig from './tlds.json';
import { env } from './env';

/**
 * TLD pricing entry from static config
 */
export interface TldEntry {
  tld: string;
  registrationPrice: number;
  renewalPrice: number;
}

/**
 * TLD pricing with markup applied (in USDC)
 */
export interface TldPricing {
  tld: string;
  registrationPriceUsdc: number;
  renewalPriceUsdc: number;
}

/**
 * Apply markup to a base price
 */
function applyMarkup(basePrice: number): number {
  const markup = env.DOMAIN_MARKUP_PERCENT / 100;
  const priceWithMarkup = basePrice * (1 + markup);
  return Number(priceWithMarkup.toFixed(2));
}

/**
 * Get pricing for a specific TLD with markup applied
 *
 * @param tld - TLD to look up (e.g., "com", "io")
 * @returns Pricing with markup or null if TLD not found
 */
export function getTldPricing(tld: string): TldPricing | null {
  const normalizedTld = tld.toLowerCase().replace(/^\./, ''); // Remove leading dot if present
  const entry = tldConfig.tlds.find((t) => t.tld === normalizedTld);

  if (!entry) {
    return null;
  }

  return {
    tld: entry.tld,
    registrationPriceUsdc: applyMarkup(entry.registrationPrice),
    renewalPriceUsdc: applyMarkup(entry.renewalPrice),
  };
}

/**
 * Get all supported TLDs with markup-applied pricing
 *
 * @returns Array of all TLDs with USDC pricing
 */
export function getAllTlds(): TldPricing[] {
  return tldConfig.tlds.map((entry) => ({
    tld: entry.tld,
    registrationPriceUsdc: applyMarkup(entry.registrationPrice),
    renewalPriceUsdc: applyMarkup(entry.renewalPrice),
  }));
}

/**
 * Check if a TLD is supported
 *
 * @param tld - TLD to check
 * @returns true if TLD is supported
 */
export function isSupportedTld(tld: string): boolean {
  const normalizedTld = tld.toLowerCase().replace(/^\./, '');
  return tldConfig.tlds.some((t) => t.tld === normalizedTld);
}

// Export raw config for testing
export { tldConfig };
