import {
  Acknowledgement,
  PaymentCallback,
  SignatureVerificationError,
  type CallbackRequest,
} from '@laranex/myanmar-payments';
import { Controller, Inject, Param, Post, Req, Res, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AcknowledgeCallback,
  acknowledge,
  callbackUrlFrom,
  GATEWAY_NAMES,
  MyanmarPaymentsModule,
  MyanmarPaymentsService,
  RawCallback,
  VerifiedCallback,
  type FastifyReplyLike,
  type GatewayName,
  type NestRequestLike,
} from '../src/index.js';
import {
  ADAPTERS,
  CALLBACK_HOST,
  callbacks,
  createApp,
  ENV,
  miniAppCallbackBody,
} from './helpers.js';

const received: PaymentCallback[] = [];

@Controller('payments/callback')
class CallbackController {
  constructor(@Inject(MyanmarPaymentsService) private readonly payments: MyanmarPaymentsService) {}

  @Post('kbz-pay')
  @AcknowledgeCallback()
  kbzPay(@VerifiedCallback('kbz-pay') callback: PaymentCallback): PaymentCallback {
    received.push(callback);
    return callback;
  }

  @Post('wave-pay')
  @AcknowledgeCallback()
  wavePay(@VerifiedCallback('wave-pay') callback: PaymentCallback): PaymentCallback {
    received.push(callback);
    return callback;
  }

  @Post('wave-pay-mini-app')
  @AcknowledgeCallback()
  wavePayMiniApp(
    @VerifiedCallback('wave-pay-mini-app') callback: PaymentCallback,
  ): PaymentCallback {
    received.push(callback);
    return callback;
  }

  /** The service verifies against the request URL. */
  @Post('mini-app/service')
  async miniAppService(@Req() req: NestRequestLike): Promise<PaymentCallback> {
    return this.payments.handleCallback('wave-pay-mini-app', req);
  }

  /** The gateway verifies against an explicit callback URL. */
  @Post('mini-app/explicit')
  explicit(@RawCallback() raw: CallbackRequest): PaymentCallback {
    return this.payments
      .wavePayMiniApp()
      .handleCallback(raw, `https://${CALLBACK_HOST}/registered/callback`);
  }

  /** A CallbackRequest has no URL to verify a mini app callback against. */
  @Post('mini-app/raw')
  async miniAppRaw(@RawCallback() raw: CallbackRequest): Promise<PaymentCallback> {
    return this.payments.handleCallback('wave-pay-mini-app', raw);
  }

  @Post('aya-pay')
  @AcknowledgeCallback()
  ayaPay(@VerifiedCallback('aya-pay') callback: PaymentCallback): PaymentCallback {
    received.push(callback);
    return callback;
  }

  @Post('yoma-mmqr')
  @AcknowledgeCallback()
  yomaMmqr(@VerifiedCallback('yoma-mmqr') callback: PaymentCallback): PaymentCallback {
    received.push(callback);
    return callback;
  }

  @Post('cyber-source')
  @AcknowledgeCallback()
  cyberSource(@VerifiedCallback('cyber-source') callback: PaymentCallback): PaymentCallback {
    received.push(callback);
    return callback;
  }

  /** An acknowledgement with its own status: the interceptor answers with it. */
  @Post('accepted')
  @AcknowledgeCallback()
  accepted(): Pick<PaymentCallback, 'orderId' | 'acknowledgement'> {
    return {
      orderId: 'ORDER_1',
      acknowledgement: new Acknowledgement({ status: 202, body: 'queued' }),
    };
  }

  /** Not a callback: the interceptor passes other values through. */
  @Post('echo')
  @AcknowledgeCallback()
  echo(): { ok: boolean } {
    return { ok: true };
  }

  /** The manual style: raw request, verify with the service, acknowledge with `@Res()`. */
  @Post('manual/:gateway')
  async manual(
    @Param('gateway') gateway: GatewayName,
    @RawCallback() raw: CallbackRequest,
    @Req() req: NestRequestLike,
    @Res() res: FastifyReplyLike,
  ): Promise<void> {
    try {
      const callback =
        gateway === 'wave-pay-mini-app'
          ? this.payments.wavePayMiniApp().handleCallback(raw, callbackUrlFrom(req))
          : await this.payments.handleCallback(gateway, raw);
      // The request object works too.
      const again = await this.payments.handleCallback(gateway, req);
      expect(again.orderId).toBe(callback.orderId);
      received.push(callback);
      acknowledge(res, callback);
    } catch (error) {
      if (!(error instanceof SignatureVerificationError)) {
        throw error;
      }
      acknowledge(res, {
        acknowledgement: new Acknowledgement({ status: 400, body: 'invalid signature' }),
      });
    }
  }
}

/** The gateways whose callbacks are forms, which verify without `rawBody: true` too. */
const FORM_GATEWAYS = GATEWAY_NAMES.filter((name) =>
  callbacks[name]().contentType.includes('form'),
);
const JSON_GATEWAYS = GATEWAY_NAMES.filter((name) => !FORM_GATEWAYS.includes(name));

describe.each(ADAPTERS)('callbacks on %s', (adapter) => {
  describe.each([true, false])('rawBody: %s', (rawBody) => {
    let app: INestApplication;
    const verifiable = rawBody ? GATEWAY_NAMES : FORM_GATEWAYS;

    beforeAll(async () => {
      app = await createApp({
        adapter,
        rawBody,
        imports: [MyanmarPaymentsModule.forRoot({ env: ENV })],
        controllers: [CallbackController],
      });
    });
    afterAll(async () => {
      await app.close();
    });

    it.each(verifiable)('verifies and acknowledges a %s callback', async (gateway) => {
      const signed = callbacks[gateway]();
      received.length = 0;
      const response = await request(app.getHttpServer())
        .post(`/payments/callback/${gateway}`)
        .set('Content-Type', signed.contentType)
        .set(signed.headers)
        .send(signed.body);

      expect(response.status).toBe(200);
      expect(response.text).toBe(signed.acknowledgement);
      expect(response.headers['content-type']).toMatch(/^text\/plain/);
      expect(received).toHaveLength(1);
      expect(received[0]).toBeInstanceOf(PaymentCallback);
      expect(received[0]).toMatchObject({ orderId: signed.orderId, status: 'successful' });
    });

    it.each(verifiable)('answers 400 to a tampered %s callback', async (gateway) => {
      const signed = callbacks[gateway](true);
      received.length = 0;
      const response = await request(app.getHttpServer())
        .post(`/payments/callback/${gateway}`)
        .set('Content-Type', signed.contentType)
        .set(signed.headers)
        .send(signed.body);

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ statusCode: 400 });
      expect(String(response.body.message)).toMatch(/verification failed/);
      expect(received).toHaveLength(0);
    });

    it.each(['', 'wrong-secret'])(
      'answers 400 to a yoma-mmqr callback with the webhook secret %j',
      async (secret) => {
        const signed = callbacks['yoma-mmqr']();
        received.length = 0;
        const response = await request(app.getHttpServer())
          .post('/payments/callback/yoma-mmqr')
          .set('Content-Type', signed.contentType)
          .set(secret === '' ? {} : { 'X-Webhook-Secret': secret })
          .send(signed.body);

        expect(response.status).toBe(400);
        expect(received).toHaveLength(0);
      },
    );

    it.each(verifiable)('acknowledges a %s callback through @Res()', async (gateway) => {
      const path = `/payments/callback/manual/${gateway}`;
      const signed = callbacks[gateway](false, path);
      const response = await request(app.getHttpServer())
        .post(`/payments/callback/manual/${gateway}`)
        .set('Content-Type', signed.contentType)
        .set(signed.headers)
        .send(signed.body);
      expect(response.status).toBe(200);
      expect(response.text).toBe(signed.acknowledgement);

      const tampered = callbacks[gateway](true, path);
      const rejected = await request(app.getHttpServer())
        .post(`/payments/callback/manual/${gateway}`)
        .set('Content-Type', tampered.contentType)
        .set(tampered.headers)
        .send(tampered.body);
      expect(rejected.status).toBe(400);
      expect(rejected.text).toBe('invalid signature');
    });

    it.runIf(!rawBody).each(JSON_GATEWAYS)(
      'asks for rawBody: true instead of verifying a parsed %s JSON body',
      async (gateway) => {
        const signed = callbacks[gateway]();
        received.length = 0;
        for (const path of [gateway, `manual/${gateway}`]) {
          const response = await request(app.getHttpServer())
            .post(`/payments/callback/${path}`)
            .set('Content-Type', signed.contentType)
            .set(signed.headers)
            .send(signed.body);
          expect(response.status).toBe(400);
          expect(response.body).toMatchObject({
            statusCode: 400,
            message: 'Enable rawBody: true in NestFactory.create() to verify JSON callbacks.',
          });
        }
        expect(received).toHaveLength(0);
      },
    );

    it("answers with the acknowledgement's own status", async () => {
      const response = await request(app.getHttpServer()).post('/payments/callback/accepted');
      expect(response.status).toBe(202);
      expect(response.text).toBe('queued');
      expect(response.headers['content-type']).toMatch(/^text\/plain/);
    });

    it('passes other return values through', async () => {
      const response = await request(app.getHttpServer()).post('/payments/callback/echo');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });
  });
});

describe.each(ADAPTERS)('Wave Pay Mini App callbacks on %s', (adapter) => {
  const post = (app: INestApplication, path: string, body: string, headers = {}) =>
    request(app.getHttpServer())
      .post(path)
      .set('Content-Type', 'application/json')
      .set({ Host: CALLBACK_HOST, ...headers })
      .send(body);

  describe('without a trusted proxy', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await createApp({
        adapter,
        imports: [MyanmarPaymentsModule.forRoot({ env: ENV })],
        controllers: [CallbackController],
      });
    });
    afterAll(async () => {
      await app.close();
    });

    it('verifies against the request URL without its query string', async () => {
      const path = '/payments/callback/wave-pay-mini-app';
      received.length = 0;
      const response = await post(
        app,
        `${path}?attempt=2`,
        miniAppCallbackBody(`http://${CALLBACK_HOST}${path}`, { transactionStatus: 'processing' }),
      );
      expect(response.status).toBe(200);
      expect(response.text).toBe('');
      expect(received[0]).toMatchObject({
        orderId: 'ORDER_MINI_1',
        status: 'pending',
        gatewayStatus: 'processing',
        gatewayReference: 'T1',
        amount: '5000',
      });
      expect(received[0]?.raw).toMatchObject({ merchantRefId: 'ref-001' });
    });

    it('keeps the port of the Host header', async () => {
      const path = '/payments/callback/wave-pay-mini-app';
      const response = await post(
        app,
        path,
        miniAppCallbackBody(`http://${CALLBACK_HOST}:8080${path}`),
        { Host: `${CALLBACK_HOST}:8080` },
      );
      expect(response.status).toBe(200);
    });

    it.each([
      ['another host', `http://other.test/payments/callback/wave-pay-mini-app`],
      ['another path', `http://${CALLBACK_HOST}/payments/callback/other`],
      ['https', `https://${CALLBACK_HOST}/payments/callback/wave-pay-mini-app`],
    ])('answers 400 to a callback signed for %s', async (_case, url) => {
      received.length = 0;
      const response = await post(
        app,
        '/payments/callback/wave-pay-mini-app',
        miniAppCallbackBody(url),
      );
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        statusCode: 400,
        message: 'Wave Pay Mini App callback hash verification failed.',
      });
      expect(received).toHaveLength(0);
    });

    it('ignores X-Forwarded headers from a proxy the app does not trust', async () => {
      const path = '/payments/callback/wave-pay-mini-app';
      const response = await post(app, path, miniAppCallbackBody(`https://pay.shop.test${path}`), {
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'pay.shop.test',
      });
      expect(response.status).toBe(400);
    });

    it('verifies through handleCallback() with the Nest request', async () => {
      const path = '/payments/callback/mini-app/service';
      const response = await post(app, path, miniAppCallbackBody(`http://${CALLBACK_HOST}${path}`));
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ orderId: 'ORDER_MINI_1', status: 'successful' });
    });

    it("verifies with an explicit callback URL through the gateway's handleCallback()", async () => {
      const response = await post(
        app,
        '/payments/callback/mini-app/explicit',
        miniAppCallbackBody(`https://${CALLBACK_HOST}/registered/callback`),
      );
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ orderId: 'ORDER_MINI_1' });
    });

    it('refuses a CallbackRequest in handleCallback(), which has no URL', async () => {
      const path = '/payments/callback/mini-app/raw';
      const response = await post(app, path, miniAppCallbackBody(`http://${CALLBACK_HOST}${path}`));
      expect(response.status).toBe(500);
    });
  });

  describe('behind a trusted proxy', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await createApp({
        adapter,
        trustProxy: true,
        imports: [MyanmarPaymentsModule.forRoot({ env: ENV })],
        controllers: [CallbackController],
      });
    });
    afterAll(async () => {
      await app.close();
    });

    it('verifies against the forwarded protocol and host', async () => {
      const path = '/payments/callback/wave-pay-mini-app';
      const response = await post(
        app,
        path,
        miniAppCallbackBody(`https://pay.shop.test:8443${path}`),
        { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'pay.shop.test:8443' },
      );
      expect(response.status).toBe(200);
      expect(response.text).toBe('');
    });
  });
});

describe('callbacks with an unconfigured gateway', () => {
  it('answers 500, not 400', async () => {
    const app = await createApp({
      adapter: 'express',
      imports: [MyanmarPaymentsModule.forRoot({ env: {} })],
      controllers: [CallbackController],
    });
    try {
      const signed = callbacks['kbz-pay']();
      const response = await request(app.getHttpServer())
        .post('/payments/callback/kbz-pay')
        .set('Content-Type', signed.contentType)
        .set(signed.headers)
        .send(signed.body);
      expect(response.status).toBe(500);
    } finally {
      await app.close();
    }
  });

  it('reports the gateway before an oversized body', async () => {
    const app = await createApp({
      adapter: 'express',
      imports: [MyanmarPaymentsModule.forRoot({ env: {} })],
      controllers: [CallbackController],
    });
    try {
      const response = await request(app.getHttpServer())
        .post('/payments/callback/kbz-pay')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ padding: 'x'.repeat(70_000) }));
      expect(response.status).toBe(500);
    } finally {
      await app.close();
    }
  });
});

describe.each(ADAPTERS)('an oversized callback on %s', (adapter) => {
  it.each([true, false])('answers 413 with rawBody: %s', async (rawBody) => {
    const app = await createApp({
      adapter,
      rawBody,
      imports: [MyanmarPaymentsModule.forRoot({ env: ENV })],
      controllers: [CallbackController],
    });
    try {
      const response = await request(app.getHttpServer())
        .post('/payments/callback/kbz-pay')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ Request: { note: 'a'.repeat(70 * 1024) } }));
      expect(response.status).toBe(413);
    } finally {
      await app.close();
    }
  });
});
