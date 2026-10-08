import type { TokenCache } from '@laranex/myanmar-payments';

/** The parts of a `cache-manager` cache (v5 or later, TTL in milliseconds) this package uses. */
export interface CacheManagerLike {
  get(key: string): unknown;
  set(key: string, value: string, ttl?: number): unknown;
  del(key: string): unknown;
}

/**
 * A `TokenCache` backed by Nest's cache manager (`@nestjs/cache-manager`), so Yoma MMQR access
 * tokens are shared by every process using the same store, e.g. Redis.
 */
export class CacheManagerTokenCache implements TokenCache {
  constructor(private readonly cache: CacheManagerLike) {}

  /** Whether `value` looks like a cache manager. */
  static supports(value: unknown): value is CacheManagerLike {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const cache = value as Partial<Record<keyof CacheManagerLike, unknown>>;
    return (
      typeof cache.get === 'function' &&
      typeof cache.set === 'function' &&
      typeof cache.del === 'function'
    );
  }

  async get(key: string): Promise<string | undefined> {
    const value = await this.cache.get(key);
    return typeof value === 'string' ? value : undefined;
  }

  /** Stores `value` for `ttlSeconds`; `0` or less is passed as `0` (no expiry). */
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.cache.set(key, value, ttlSeconds > 0 ? ttlSeconds * 1000 : 0);
  }

  async delete(key: string): Promise<void> {
    await this.cache.del(key);
  }
}
