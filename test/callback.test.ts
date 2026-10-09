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
  GATEWAY_NAMES,
  MyanmarPaymentsModule,
  MyanmarPaymentsService,
  RawCallback,
  VerifiedCallback,
  type FastifyReplyLike,
  type GatewayName,
  type NestRequestLike,
} from '../src/index.js';
import { ADAPTERS, callbacks, createApp, ENV } from './helpers.js';

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

  @Post('wave-money')
  @AcknowledgeCallback()
  waveMoney(@VerifiedCallback('wave-money') callback: PaymentCallback): PaymentCallback {
    received.push(callback);
    return callback;
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
      const callback = await this.payments.handleCallback(gateway, raw);
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

describe.each(ADAPTERS)('callbacks on %s', (adapter) => {
  describe.each([true, false])('rawBody: %s', (rawBody) => {
    let app: INestApplication;

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

    it.each(GATEWAY_NAMES)('verifies and acknowledges a %s callback', async (gateway) => {
      const signed = callbacks[gateway]();
      received.length = 0;
      const response = await request(app.getHttpServer())
        .post(`/payments/callback/${gateway}`)
        .set('Content-Type', signed.contentType)
        .send(signed.body);

      expect(response.status).toBe(200);
      expect(response.text).toBe(signed.acknowledgement);
      expect(response.headers['content-type']).toMatch(/^text\/plain/);
      expect(received).toHaveLength(1);
      expect(received[0]).toBeInstanceOf(PaymentCallback);
      expect(received[0]).toMatchObject({ orderId: signed.orderId, status: 'successful' });
    });

    it.each(GATEWAY_NAMES)('answers 400 to a tampered %s callback', async (gateway) => {
      const signed = callbacks[gateway](true);
      received.length = 0;
      const response = await request(app.getHttpServer())
        .post(`/payments/callback/${gateway}`)
        .set('Content-Type', signed.contentType)
        .send(signed.body);

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ statusCode: 400 });
      expect(String(response.body.message)).toMatch(/verification failed/);
      expect(received).toHaveLength(0);
    });

    it.each(GATEWAY_NAMES)('acknowledges a %s callback through @Res()', async (gateway) => {
      const signed = callbacks[gateway]();
      const response = await request(app.getHttpServer())
        .post(`/payments/callback/manual/${gateway}`)
        .set('Content-Type', signed.contentType)
        .send(signed.body);
      expect(response.status).toBe(200);
      expect(response.text).toBe(signed.acknowledgement);

      const tampered = callbacks[gateway](true);
      const rejected = await request(app.getHttpServer())
        .post(`/payments/callback/manual/${gateway}`)
        .set('Content-Type', tampered.contentType)
        .send(tampered.body);
      expect(rejected.status).toBe(400);
      expect(rejected.text).toBe('invalid signature');
    });

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
        .send(signed.body);
      expect(response.status).toBe(500);
    } finally {
      await app.close();
    }
  });
});
