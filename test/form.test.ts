import { createCipheriv, hkdfSync, randomBytes } from 'node:crypto';

import { Amount, ConfigurationError, FormPayment } from '@laranex/myanmar-payments';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_FORM_PATH,
  DEFAULT_FORM_TTL_MINUTES,
  MyanmarPaymentsModule,
  MyanmarPaymentsService,
} from '../src/index.js';
import { FormLinkCipher } from '../src/form-link.js';
import { ADAPTERS, createApp, ENV } from './helpers.js';

const form = new FormPayment({
  orderId: 'ORD-1',
  action: 'https://testsecureacceptance.cybersource.com/pay',
  fields: [
    { name: 'amount', value: '10.50' },
    { name: 'signature', value: 'a+b/c=' },
  ],
});

function payloadOf(url: string): string {
  return new URL(url, 'https://example.test').searchParams.get('payload') ?? '';
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(ADAPTERS)('form route on %s', (adapter) => {
  let app: INestApplication;
  let payments: MyanmarPaymentsService;

  beforeAll(async () => {
    app = await createApp({ adapter, imports: [MyanmarPaymentsModule.forRoot({ env: ENV })] });
    payments = app.get(MyanmarPaymentsService);
  });
  afterAll(async () => {
    await app.close();
  });

  it('serves an auto-submitting page for a signed link', async () => {
    const url = payments.autoSubmitUrl(form);
    expect(url).toMatch(/^https:\/\/shop\.test\/myanmar-payments\/form\?payload=[\w-]+$/);

    const response = await request(app.getHttpServer()).get(url.replace('https://shop.test', ''));
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.text).toBe(form.toHtml());
    expect(response.text).toContain('action="https://testsecureacceptance.cybersource.com/pay"');
  });

  it('answers 410 to a tampered link', async () => {
    const payload = payloadOf(payments.autoSubmitUrl(form));
    const tampered = `${payload.slice(0, 20)}${payload[20] === 'A' ? 'B' : 'A'}${payload.slice(21)}`;
    const response = await request(app.getHttpServer()).get(
      `/${DEFAULT_FORM_PATH}?payload=${tampered}`,
    );
    expect(response.status).toBe(410);
    expect(response.body.message).toBe('This payment link is invalid or has expired.');
  });

  it('answers 410 to an expired link', async () => {
    const payload = payloadOf(payments.autoSubmitUrl(form));
    const later = Date.now() + (DEFAULT_FORM_TTL_MINUTES * 60 + 5) * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    const response = await request(app.getHttpServer()).get(
      `/${DEFAULT_FORM_PATH}?payload=${payload}`,
    );
    expect(response.status).toBe(410);
  });

  it.each(['', '?payload=', '?payload=a&payload=b', '?payload=short'])(
    'answers 410 to %j',
    async (query) => {
      const response = await request(app.getHttpServer()).get(`/${DEFAULT_FORM_PATH}${query}`);
      expect(response.status).toBe(410);
    },
  );
});

describe('form route options', () => {
  it('follows the global prefix and a custom path', async () => {
    const app = await createApp({
      adapter: 'fastify',
      globalPrefix: '/api/',
      imports: [MyanmarPaymentsModule.forRoot({ env: ENV, formRoute: { path: '/pay/form' } })],
    });
    try {
      const url = app.get(MyanmarPaymentsService).autoSubmitUrl(form);
      expect(url).toMatch(/^https:\/\/shop\.test\/api\/pay\/form\?payload=/);
      const response = await request(app.getHttpServer()).get(url.replace('https://shop.test', ''));
      expect(response.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('takes the secret, lifetime and base URL from the options', async () => {
    const app = await createApp({
      adapter: 'express',
      imports: [
        MyanmarPaymentsModule.forRootAsync({
          useFactory: () => ({
            env: {},
            formLink: {
              secret: new Uint8Array(32).fill(7),
              ttlMinutes: 1,
              baseUrl: 'https://pay.example.com/',
            },
          }),
        }),
      ],
    });
    try {
      const payments = app.get(MyanmarPaymentsService);
      const url = payments.autoSubmitUrl(form);
      expect(url).toMatch(/^https:\/\/pay\.example\.com\/myanmar-payments\/form\?payload=/);
      const payload = payloadOf(url);
      expect(payments.resolveFormPayment(payload)).toEqual(form);

      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
      expect(payments.resolveFormPayment(payload)).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('falls back to APP_KEY (base64) and builds relative links without APP_URL', async () => {
    const app = await createApp({
      adapter: 'express',
      imports: [
        MyanmarPaymentsModule.forRoot({
          env: { APP_KEY: `base64:${randomBytes(32).toString('base64')}` },
        }),
      ],
    });
    try {
      const url = app.get(MyanmarPaymentsService).autoSubmitUrl(form);
      expect(url).toMatch(/^\/myanmar-payments\/form\?payload=/);
      expect((await request(app.getHttpServer()).get(url)).status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('needs a secret', async () => {
    const app = await createApp({
      adapter: 'express',
      imports: [MyanmarPaymentsModule.forRoot({ env: {} })],
    });
    try {
      const payments = app.get(MyanmarPaymentsService);
      expect(() => payments.autoSubmitUrl(form)).toThrow(ConfigurationError);
      expect(payments.resolveFormPayment('anything')).toBeUndefined();
      const response = await request(app.getHttpServer()).get(
        `/${DEFAULT_FORM_PATH}?payload=anything`,
      );
      expect(response.status).toBe(410);
    } finally {
      await app.close();
    }
  });

  it('can be disabled', async () => {
    const app = await createApp({
      adapter: 'express',
      imports: [MyanmarPaymentsModule.forRoot({ env: ENV, formRoute: { enabled: false } })],
    });
    try {
      expect(() => app.get(MyanmarPaymentsService).autoSubmitUrl(form)).toThrow(
        /form route is disabled/,
      );
      expect((await request(app.getHttpServer()).get(`/${DEFAULT_FORM_PATH}`)).status).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('round-trips a real CyberSource form', async () => {
    const app = await createApp({
      adapter: 'fastify',
      imports: [MyanmarPaymentsModule.forRoot({ env: ENV })],
    });
    try {
      const payments = app.get(MyanmarPaymentsService);
      const payment = payments.cyberSource().initiate({
        orderId: 'ORD-2',
        amount: Amount.parse('10.50'),
        callbackUrl: 'https://shop.test/payments/callback/cyber-source',
      });
      const url = payments.autoSubmitUrl(payment);
      const response = await request(app.getHttpServer()).get(url.replace('https://shop.test', ''));
      expect(response.text).toBe(payment.toHtml());
    } finally {
      await app.close();
    }
  });
});

describe('FormLinkCipher', () => {
  const cipher = new FormLinkCipher('secret');
  const now = 1_000_000;

  it('opens what it sealed until it expires', () => {
    const token = cipher.seal(form, now + 10);
    expect(cipher.open(token, now)).toEqual(form);
    expect(cipher.open(token, now + 10)).toEqual(form);
    expect(cipher.open(token, now + 11)).toBeUndefined();
  });

  it('rejects tokens sealed with another secret', () => {
    expect(new FormLinkCipher('other').open(cipher.seal(form, now + 10), now)).toBeUndefined();
  });

  /** Encrypts arbitrary JSON the way the cipher does, to test what it accepts. */
  function sealRaw(value: unknown): string {
    const key = Buffer.from(
      hkdfSync(
        'sha256',
        Buffer.from('secret'),
        Buffer.alloc(0),
        'laranex/nestjs-myanmar-payments form link v1',
        32,
      ),
    );
    const iv = randomBytes(12);
    const aes = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([aes.update(JSON.stringify(value), 'utf8'), aes.final()]);
    return Buffer.concat([iv, data, aes.getAuthTag()]).toString('base64url');
  }

  it.each([
    null,
    'text',
    { o: 'ORD', a: 'https://x', e: 'e', x: now + 10, f: 'fields' },
    { o: 'ORD', a: 'https://x', e: 'e', x: now + 10, f: [['only-name']] },
    { o: 'ORD', a: 'https://x', e: 'e', x: now + 10, f: [[1, 'value']] },
    { o: 'ORD', a: 'https://x', e: 'e', x: now + 10, f: [['name', 2]] },
    { o: 'ORD', a: 'https://x', e: 'e', x: 'later', f: [] },
    { o: 1, a: 'https://x', e: 'e', x: now + 10, f: [] },
  ])('rejects the decrypted payload %j', (value) => {
    expect(cipher.open(sealRaw(value), now)).toBeUndefined();
  });

  it('accepts a well-formed payload', () => {
    const value = { o: 'ORD', a: 'https://x', e: 'multipart/form-data', x: now + 10, f: [] };
    expect(cipher.open(sealRaw(value), now)).toMatchObject({
      orderId: 'ORD',
      action: 'https://x',
      enctype: 'multipart/form-data',
    });
  });
});
