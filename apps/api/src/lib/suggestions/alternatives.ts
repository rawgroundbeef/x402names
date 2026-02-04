import { parse } from 'tldts';
import { isSupportedTld } from '../../config/tlds';

/**
 * Generate alternative domain suggestions for unavailable domains
 *
 * Strategies:
 * 1. Common prefixes (get, my, the, try, use)
 * 2. Common suffixes (app, hq, now, hub, pro)
 * 3. Alternative TLDs (.com, .io, .co, .net, .org, .app, .dev)
 * 4. Hyphenated variations
 *
 * @param domain - The original domain that was unavailable
 * @param count - Number of suggestions to return (default 5)
 * @returns Array of suggested domain names
 */
export function generateSuggestions(domain: string, count: number = 5): string[] {
  const parsed = parse(domain);
  const sld = parsed.domainWithoutSuffix || '';
  const tld = parsed.publicSuffix || 'com';

  if (!sld || !tld) {
    return [];
  }

  const suggestions: string[] = [];

  // Strategy 1: Common prefixes
  const prefixes = ['get', 'my', 'the', 'try', 'use'];
  for (const prefix of prefixes) {
    suggestions.push(`${prefix}${sld}.${tld}`);
  }

  // Strategy 2: Common suffixes
  const suffixes = ['app', 'hq', 'now', 'hub', 'pro'];
  for (const suffix of suffixes) {
    suggestions.push(`${sld}${suffix}.${tld}`);
  }

  // Strategy 3: Alternative TLDs (only supported ones, skip original)
  const alternativeTlds = ['com', 'io', 'co', 'net', 'org', 'app', 'dev'];
  for (const altTld of alternativeTlds) {
    if (altTld !== tld && isSupportedTld(altTld)) {
      suggestions.push(`${sld}.${altTld}`);
    }
  }

  // Strategy 4: Hyphenated variations (if no hyphen exists)
  if (!sld.includes('-')) {
    suggestions.push(`get-${sld}.${tld}`);
    suggestions.push(`${sld}-app.${tld}`);
  }

  // Deduplicate and filter out original domain
  const uniqueSuggestions = [...new Set(suggestions)].filter(
    (s) => s.toLowerCase() !== domain.toLowerCase()
  );

  // Shuffle for variety
  const shuffled = uniqueSuggestions.sort(() => Math.random() - 0.5);

  // Return first `count` results
  return shuffled.slice(0, count);
}
