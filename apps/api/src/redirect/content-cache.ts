import NodeCache from 'node-cache';

export interface CachedContent {
  body: Buffer;
  contentType: string;
  statusCode: number;
}

const MAX_ENTRY_SIZE = 512 * 1024; // 512KB

export class ContentCache {
  private cache: NodeCache;

  constructor(options?: { ttl?: number }) {
    this.cache = new NodeCache({
      stdTTL: options?.ttl ?? 300, // Default 5 minutes
      checkperiod: 60,
    });
  }

  get(key: string): CachedContent | null {
    const value = this.cache.get<CachedContent>(key);
    return value ?? null;
  }

  set(key: string, content: CachedContent): void {
    if (content.body.length <= MAX_ENTRY_SIZE) {
      this.cache.set(key, content);
    }
  }

  del(key: string): void {
    this.cache.del(key);
  }

  /** Delete all entries whose key starts with the given domain */
  delDomain(domain: string): void {
    const keys = this.cache.keys();
    for (const key of keys) {
      if (key === domain || key.startsWith(domain + '/')) {
        this.cache.del(key);
      }
    }
  }

  flush(): void {
    this.cache.flushAll();
  }
}
