import NodeCache from 'node-cache';

export class DomainCache {
  private cache: NodeCache;

  constructor(options?: { ttl?: number }) {
    this.cache = new NodeCache({
      stdTTL: options?.ttl ?? 300, // Default 5 minutes
      checkperiod: 60, // Check for expired keys every 60 seconds
    });
  }

  get(domain: string): string | null {
    const value = this.cache.get<string>(domain);
    return value ?? null;
  }

  set(domain: string, targetUrl: string): void {
    this.cache.set(domain, targetUrl);
  }

  del(domain: string): void {
    this.cache.del(domain);
  }

  flush(): void {
    this.cache.flushAll();
  }
}
