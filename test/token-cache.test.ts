import { MemoryTokenCache, type TokenCache } from '@laranex/myanmar-payments';
import { CACHE_MANAGER, CacheModule } from '@nestjs/cache-manager';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import {
  CacheManagerTokenCache,
  MyanmarPaymentsModule,
  MyanmarPaymentsService,
  type CacheManagerLike,
} from '../src/index.js';
import { ENV, fakeFetch } from './helpers.js';

const yomaRoutes = {
  '/token': { access_token: 'yoma-token', expires_in: 3600 },
  '/payment/check-status': { refLabel: 'REF1', paymentStatus: 'SUCCESS', errorCode: null },
};

async function compile(imports: Parameters<typeof Test.createTestingModule>[0]['imports']) {
  return Test.createTestingModule({ imports: imports ?? [] }).compile();
}

describe('Yoma MMQR token cache', () => {
  it('uses the Nest cache manager when CacheModule is global', async () => {
    const fetch = fakeFetch(yomaRoutes);
    const moduleRef = await compile([
      CacheModule.register({ isGlobal: true }),
      MyanmarPaymentsModule.forRoot({ env: ENV, fetch }),
    ]);
    const payments = moduleRef.get(MyanmarPaymentsService);
    expect(payments.tokenCache).toBeInstanceOf(CacheManagerTokenCache);

    await payments.yomaMmqr().status('REF1');
    await payments.yomaMmqr().status('REF1');
    expect(fetch.calls.filter((url) => url.endsWith('/token'))).toHaveLength(1);

    const cache = moduleRef.get<CacheManagerLike>(CACHE_MANAGER);
    const key = 'node-myanmar-payments.yoma-mmqr.token.';
    // The SDK keys the token by base URL and client id; find it through the token cache API.
    expect(await payments.tokenCache.get('missing')).toBeUndefined();
    const set = vi.spyOn(cache, 'set');
    await payments.yomaMmqr().forgetToken();
    await payments.yomaMmqr().status('REF1');
    expect(set).toHaveBeenCalledWith(expect.stringContaining(key), 'yoma-token', 3540 * 1000);
    expect(fetch.calls.filter((url) => url.endsWith('/token'))).toHaveLength(2);
  });

  it('uses a cache manager imported through forRootAsync', async () => {
    const moduleRef = await compile([
      MyanmarPaymentsModule.forRootAsync({
        imports: [CacheModule.register()],
        useFactory: () => ({ env: ENV }),
      }),
    ]);
    expect(moduleRef.get(MyanmarPaymentsService).tokenCache).toBeInstanceOf(CacheManagerTokenCache);
  });

  it('keeps tokens in memory without a cache manager or when told to', async () => {
    const plain = await compile([MyanmarPaymentsModule.forRoot({ env: ENV })]);
    expect(plain.get(MyanmarPaymentsService).tokenCache).toBeInstanceOf(MemoryTokenCache);

    const optedOut = await compile([
      CacheModule.register({ isGlobal: true }),
      MyanmarPaymentsModule.forRoot({ env: ENV, useCacheManager: false }),
    ]);
    expect(optedOut.get(MyanmarPaymentsService).tokenCache).toBeInstanceOf(MemoryTokenCache);
  });

  it('prefers an explicit token cache', async () => {
    const tokenCache: TokenCache = new MemoryTokenCache();
    const moduleRef = await compile([
      CacheModule.register({ isGlobal: true }),
      MyanmarPaymentsModule.forRoot({ env: ENV, tokenCache }),
    ]);
    expect(moduleRef.get(MyanmarPaymentsService).tokenCache).toBe(tokenCache);
  });
});

describe('CacheManagerTokenCache', () => {
  function fakeCache(): CacheManagerLike & { items: Map<string, unknown>; ttls: unknown[] } {
    const items = new Map<string, unknown>();
    const ttls: unknown[] = [];
    return {
      items,
      ttls,
      get: (key) => items.get(key),
      set: (key, value, ttl) => {
        ttls.push(ttl);
        items.set(key, value);
      },
      del: (key) => items.delete(key),
    };
  }

  it('stores strings with the TTL in milliseconds', async () => {
    const cache = fakeCache();
    const tokens = new CacheManagerTokenCache(cache);
    await tokens.set('a', 'token', 60);
    await tokens.set('b', 'forever', 0);
    expect(cache.ttls).toEqual([60_000, 0]);
    expect(await tokens.get('a')).toBe('token');
    await tokens.delete('a');
    expect(await tokens.get('a')).toBeUndefined();
  });

  it('ignores values that are not strings', async () => {
    const cache = fakeCache();
    cache.items.set('n', 5);
    expect(await new CacheManagerTokenCache(cache).get('n')).toBeUndefined();
  });

  it.each([
    [null, false],
    ['cache', false],
    [{ get() {}, set() {} }, false],
    [{ get() {}, set() {}, del() {} }, true],
  ])('recognizes %j as a cache manager: %s', (value, expected) => {
    expect(CacheManagerTokenCache.supports(value)).toBe(expected);
  });
});
