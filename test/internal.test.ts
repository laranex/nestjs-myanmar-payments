import { Acknowledgement, PaymentCallback } from '@laranex/myanmar-payments';
import { describe, expect, it } from 'vitest';

import { envSource } from '../src/env.js';
import { MyanmarPaymentsService } from '../src/index.js';
import { isPaymentCallback } from '../src/request.js';
import { ENV } from './helpers.js';

describe('envSource', () => {
  it('reads string keys through a ConfigService and ignores symbols', () => {
    const env = envSource({ get: (key: string) => (key === 'A' ? 'value' : undefined) });
    expect(env.A).toBe('value');
    expect(env.B).toBeUndefined();
    expect((env as Record<symbol, unknown>)[Symbol.iterator]).toBeUndefined();
  });
});

describe('MyanmarPaymentsService outside the module', () => {
  it('uses the default form route without a global prefix', () => {
    const payments = new MyanmarPaymentsService({ env: ENV });
    const form = payments.cyberSource().initiate({
      orderId: 'ORD-1',
      amount: 1,
      callbackUrl: 'https://shop.test/cb',
    });
    expect(payments.autoSubmitUrl(form)).toMatch(
      /^https:\/\/shop\.test\/myanmar-payments\/form\?payload=/,
    );
  });
});

describe('isPaymentCallback', () => {
  it.each([
    [null, false],
    ['text', false],
    [{ orderId: 'A' }, false],
    [{ orderId: 'A', acknowledgement: null }, false],
    [{ orderId: 'A', acknowledgement: { status: '200', body: '' } }, false],
    [{ orderId: 'A', acknowledgement: new Acknowledgement() }, true],
    [
      new PaymentCallback({ orderId: 'A', status: 'successful', gatewayStatus: 'PAY_SUCCESS' }),
      true,
    ],
  ])('recognizes %j: %s', (value, expected) => {
    expect(isPaymentCallback(value)).toBe(expected);
  });
});
