import 'reflect-metadata';

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { KbzPaySigner } from '@laranex/myanmar-payments';
import type { DynamicModule, INestApplication, Type } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

/** The HTTP adapters every HTTP test runs on. */
export const ADAPTERS = ['express', 'fastify'] as const;
export type AdapterName = (typeof ADAPTERS)[number];

/** Gateway settings with the variable names the SDK's `fromEnv` reads. */
export const ENV = {
  APP_URL: 'https://shop.test',
  MYANMAR_PAYMENTS_HTTP_TIMEOUT: '30',
  MYANMAR_PAYMENTS_FORM_TTL_MINUTES: '30',
  KBZ_PAY_APP_ID: 'kp123',
  KBZ_PAY_APP_KEY: 'kbz-secret',
  KBZ_PAY_MERCHANT_CODE: '100001',
  WAVE_MONEY_MERCHANT_ID: 'testmerchantID',
  WAVE_MONEY_SECRET_KEY: 'test-secret',
  WAVE_MONEY_MERCHANT_NAME: 'Shop',
  WAVE_MONEY_TIME_TO_LIVE_IN_SECONDS: '300',
  AYA_PAY_APP_KEY: 'aya-key',
  AYA_PAY_APP_SECRET: 'test-secret',
  YOMA_MMQR_MERCHANT_ID: 'M001',
  YOMA_MMQR_CLIENT_ID: 'client',
  YOMA_MMQR_CLIENT_SECRET: 'secret',
  YOMA_MMQR_WEBHOOK_HASHKEY: 'hash-key',
  YOMA_MMQR_API_VERSION: 'v1rc',
  CYBER_SOURCE_PROFILE_ID: 'profile',
  CYBER_SOURCE_ACCESS_KEY: 'access',
  CYBER_SOURCE_SECRET_KEY: 'cs-secret',
  MYANMAR_PAYMENTS_FORM_KEY: 'form-secret',
} as const;

export interface AppOptions {
  adapter: AdapterName;
  imports: (DynamicModule | Type)[];
  controllers?: Type[];
  /** Nest's `rawBody` option (default `true`). */
  rawBody?: boolean;
  globalPrefix?: string;
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
      ? moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
          rawBody,
          logger: false,
        })
      : moduleRef.createNestApplication({ rawBody, logger: false });
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

/** Signed callbacks per gateway, built with the SDK's signer and the SDK's test vectors. */
export const callbacks = {
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
      orderId: 'ORDER_1',
      acknowledgement: 'success',
    };
  },

  'wave-money'(tamper = false): SignedCallback {
    const vector = fixture<{
      hash_string: string;
      secret_key: string;
      payload: Record<string, unknown>;
    }>('wave-money-callback.json');
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
      orderId: '100',
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
      orderId: 'ORD-CS-1',
      acknowledgement: '',
    };
  },
} as const;

/** A fake `fetch` that answers by URL path suffix with JSON and records every call. */
export function fakeFetch(routes: Record<string, unknown>): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const fake = async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const path = new URL(url).pathname;
    const key = Object.keys(routes).find((suffix) => path.endsWith(suffix));
    return new Response(JSON.stringify(key === undefined ? { message: 'no fake' } : routes[key]), {
      status: key === undefined ? 500 : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return Object.assign(fake as typeof fetch, { calls });
}
