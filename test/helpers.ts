import 'reflect-metadata';

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { KbzPaySigner } from '@laranex/myanmar-payments';
import type { DynamicModule, INestApplication, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import type { GatewayName } from '../src/index.js';

/** The HTTP adapters every HTTP test runs on. */
export const ADAPTERS = ['express', 'fastify'] as const;
export type AdapterName = (typeof ADAPTERS)[number];

/** Gateway settings with the variable names the SDK's `fromEnv` reads. */
export const ENV = {
  APP_URL: 'https://shop.test',
  MYANMAR_PAYMENTS_HTTP_TIMEOUT: '30',
  MYANMAR_PAYMENTS_FORM_TTL_MINUTES: '30',
  KBZ_PAY_APP_ID: 'kp123',
  KBZ_PAY_TIME_TO_LIVE_IN_MINUTES: '30',
  KBZ_PAY_APP_KEY: 'kbz-secret',
  KBZ_PAY_MERCHANT_CODE: '100001',
  KBZ_PAY_BASE_URL: 'https://api.kbzpay.com/payment/gateway',
  KBZ_PAY_PWA_BASE_REDIRECT_URL: 'https://static.kbzpay.com/pgw/pwa/#/',
  WAVE_PAY_MERCHANT_ID: 'testmerchantID',
  WAVE_PAY_SECRET_KEY: 'test-secret',
  WAVE_PAY_MERCHANT_NAME: 'Shop',
  WAVE_PAY_TIME_TO_LIVE_IN_SECONDS: '300',
  WAVE_PAY_BASE_URL: 'https://payments.wavemoney.io',
  WAVE_PAY_BASE_REDIRECT_URL: 'https://payments.wavemoney.io',
  WAVE_PAY_MINI_APP_CLIENT_ID: 'mini-client',
  WAVE_PAY_MINI_APP_CLIENT_SECRET: 'mini-secret',
  WAVE_PAY_MINI_APP_MINI_APP_ID: 'MINI456',
  WAVE_PAY_MINI_APP_SECRET_KEY: 'mini-hash-secret',
  WAVE_PAY_MINI_APP_BASE_URL: 'https://wave-mini.test',
  AYA_PAY_APP_KEY: 'aya-key',
  AYA_PAY_APP_SECRET: 'test-secret',
  AYA_PAY_BASE_URL: 'https://api.ayapay.com',
  YOMA_MMQR_MERCHANT_ID: 'M001',
  YOMA_MMQR_CLIENT_ID: 'client',
  YOMA_MMQR_CLIENT_SECRET: 'secret',
  YOMA_MMQR_WEBHOOK_HASHKEY: 'hash-key',
  YOMA_MMQR_API_VERSION: 'v1rc',
  YOMA_MMQR_WEBHOOK_SECRET: 'webhook-secret',
  YOMA_MMQR_BASE_URL: 'https://api.yomabank.com',
  CYBER_SOURCE_PROFILE_ID: 'profile',
  CYBER_SOURCE_ACCESS_KEY: 'access',
  CYBER_SOURCE_SECRET_KEY: 'cs-secret',
  CYBER_SOURCE_BASE_URL: 'https://secureacceptance.cybersource.com',
  MYANMAR_PAYMENTS_FORM_KEY: 'form-secret-of-at-least-32-bytes',
} as const;

export interface AppOptions {
  adapter: AdapterName;
  imports: (DynamicModule | Type)[];
  controllers?: Type[];
  /** Nest's `rawBody` option (default `true`). */
  rawBody?: boolean;
  globalPrefix?: string;
  /** Trust `X-Forwarded-*` headers (Express `trust proxy`, Fastify `trustProxy`). */
  trustProxy?: boolean;
}

/** Starts a Nest app on the Express or Fastify adapter. */
export async function createApp(options: AppOptions): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: options.imports,
    controllers: options.controllers ?? [],
  }).compile();
  const rawBody = options.rawBody ?? true;
  const app =
    options.adapter === 'fastify'
      ? moduleRef.createNestApplication<NestFastifyApplication>(
          new FastifyAdapter({ trustProxy: options.trustProxy === true }),
          { rawBody, logger: false },
        )
      : moduleRef.createNestApplication<NestExpressApplication>({ rawBody, logger: false });
  if (options.adapter === 'express' && options.trustProxy === true) {
    (app as NestExpressApplication).set('trust proxy', true);
  }
  if (options.globalPrefix !== undefined) {
    app.setGlobalPrefix(options.globalPrefix);
  }
  await app.init();
  if (options.adapter === 'fastify') {
    await (app as NestFastifyApplication).getHttpAdapter().getInstance().ready();
  }
  return app;
}

/** A signed callback request: its body and content type. */
export interface SignedCallback {
  body: string;
  contentType: string;
  /** Headers the gateway sends besides the content type. */
  headers: Record<string, string>;
  orderId: string;
  /** The acknowledgement body the gateway expects. */
  acknowledgement: string;
}

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')) as T;
}

function hmacHex(key: string, message: string): string {
  return createHmac('sha256', key).update(message).digest('hex');
}

/** The host the test callbacks are posted to (sent as the `Host` header). */
export const CALLBACK_HOST = 'shop.test';

/** A Wave Pay Mini App callback body, signed over `amount . orderId . miniAppId . ref . url`. */
export function miniAppCallbackBody(
  callbackUrl: string,
  fields: Record<string, unknown> = {},
): string {
  const body: Record<string, unknown> = {
    merchantRefId: 'ref-001',
    orderId: 'ORDER_MINI_1',
    amount: 5000,
    msisdn: '9790000000',
    transactionId: 'T1',
    transactionStatus: 'successful',
    ...fields,
  };
  body.hashValue ??= hmacHex(
    ENV.WAVE_PAY_MINI_APP_SECRET_KEY,
    `${String(body.amount)}${String(body.orderId)}${ENV.WAVE_PAY_MINI_APP_MINI_APP_ID}${String(body.merchantRefId)}${callbackUrl}`,
  );
  return JSON.stringify(body);
}

/**
 * Signed callbacks per gateway, built with the SDK's signer and the SDK's test vectors. `path` is
 * the route a Wave Pay Mini App callback is posted to, whose URL it is signed with.
 */
export const callbacks: Readonly<
  Record<GatewayName, (tamper?: boolean, path?: string) => SignedCallback>
> = {
  'kbz-pay'(tamper = false): SignedCallback {
    const fields: Record<string, string> = {
      merch_order_id: 'ORDER_1',
      mm_order_id: 'MM1',
      total_amount: '1000.00',
      trade_status: 'PAY_SUCCESS',
      sign_type: 'SHA256',
    };
    fields.sign = new KbzPaySigner(ENV.KBZ_PAY_APP_KEY).sign(fields);
    if (tamper) {
      fields.total_amount = '1';
    }
    return {
      body: JSON.stringify({ Request: fields }),
      contentType: 'application/json',
      headers: {},
      orderId: 'ORDER_1',
      acknowledgement: 'success',
    };
  },

  'wave-pay'(tamper = false): SignedCallback {
    const vector = fixture<{
      hash_string: string;
      secret_key: string;
      payload: Record<string, unknown>;
    }>('wave-pay-callback.json');
    const payload: Record<string, unknown> = {
      ...vector.payload,
      hashValue: hmacHex(vector.secret_key, vector.hash_string),
    };
    if (tamper) {
      payload.amount = '1';
    }
    return {
      body: JSON.stringify(payload),
      contentType: 'application/json',
      headers: {},
      orderId: '100',
      acknowledgement: '',
    };
  },

  'wave-pay-mini-app'(
    tamper = false,
    path = '/payments/callback/wave-pay-mini-app',
  ): SignedCallback {
    const body = miniAppCallbackBody(`http://${CALLBACK_HOST}${path}`);
    return {
      body: tamper ? body.replace('"amount":5000', '"amount":1') : body,
      contentType: 'application/json',
      headers: { Host: CALLBACK_HOST },
      orderId: 'ORDER_MINI_1',
      acknowledgement: '',
    };
  },

  'aya-pay'(tamper = false): SignedCallback {
    const vector = fixture<{
      app_secret: string;
      checksum_string: string;
      payload: Record<string, unknown>;
    }>('aya-pay-callback.json');
    const payload = { ...vector.payload };
    const checkSum = hmacHex(vector.app_secret, vector.checksum_string);
    if (tamper) {
      payload.amount = '1';
    }
    return {
      body: new URLSearchParams({
        payload: Buffer.from(JSON.stringify(payload)).toString('base64'),
        checkSum,
      }).toString(),
      contentType: 'application/x-www-form-urlencoded',
      headers: {},
      orderId: 'ORD123456',
      acknowledgement: '',
    };
  },

  'yoma-mmqr'(tamper = false): SignedCallback {
    const orderNumber = 'ORD-1';
    const hashValue = hmacHex(
      orderNumber + ENV.YOMA_MMQR_WEBHOOK_HASHKEY,
      `orderNumber=${orderNumber}&status=success`,
    );
    return {
      body: JSON.stringify({ orderNumber, status: tamper ? 'fail' : 'success', hashValue }),
      contentType: 'application/json',
      headers: { 'X-Webhook-Secret': ENV.YOMA_MMQR_WEBHOOK_SECRET },
      orderId: orderNumber,
      acknowledgement: '',
    };
  },

  'cyber-source'(tamper = false): SignedCallback {
    const fields: Record<string, string> = {
      decision: 'ACCEPT',
      req_reference_number: 'ORD-CS-1',
      transaction_id: 'TX-1',
      auth_amount: '10.50',
      signed_field_names:
        'decision,req_reference_number,transaction_id,auth_amount,signed_field_names',
    };
    const message = fields
      .signed_field_names!.split(',')
      .map((name) => `${name}=${fields[name]!}`)
      .join(',');
    fields.signature = createHmac('sha256', ENV.CYBER_SOURCE_SECRET_KEY)
      .update(message)
      .digest('base64');
    if (tamper) {
      fields.auth_amount = '1.00';
    }
    return {
      body: new URLSearchParams(fields).toString(),
      contentType: 'application/x-www-form-urlencoded',
      headers: {},
      orderId: 'ORD-CS-1',
      acknowledgement: '',
    };
  },
};

/** A request the fake `fetch` received. */
export interface FakeRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

/** A fake `fetch` that answers by URL path suffix with JSON and records every call. */
export function fakeFetch(
  routes: Record<string, unknown>,
): typeof fetch & { calls: string[]; requests: FakeRequest[] } {
  const calls: string[] = [];
  const requests: FakeRequest[] = [];
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    requests.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : String(init?.body ?? ''),
    });
    const path = new URL(url).pathname;
    const key = Object.keys(routes).find((suffix) => path.endsWith(suffix));
    return new Response(JSON.stringify(key === undefined ? { message: 'no fake' } : routes[key]), {
      status: key === undefined ? 500 : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return Object.assign(fake as typeof fetch, { calls, requests });
}
