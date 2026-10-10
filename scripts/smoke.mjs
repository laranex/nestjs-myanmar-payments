// Loads the built ES module entry point and builds a gateway, proving the import path works.
import 'reflect-metadata';
import assert from 'node:assert';
import { KbzPay } from '@laranex/myanmar-payments';
import {
  MyanmarPaymentsModule,
  MyanmarPaymentsService,
  VerifiedCallback,
} from '@laranex/nestjs-myanmar-payments';

assert.strictEqual(typeof MyanmarPaymentsModule.forRoot, 'function');
assert.strictEqual(typeof MyanmarPaymentsModule.forRootAsync, 'function');
assert.strictEqual(typeof VerifiedCallback('kbz-pay'), 'function');
const payments = new MyanmarPaymentsService({
  env: {
    KBZ_PAY_APP_ID: 'a',
    KBZ_PAY_APP_KEY: 'k',
    KBZ_PAY_MERCHANT_CODE: 'm',
    MYANMAR_PAYMENTS_HTTP_TIMEOUT: '30',
  },
});
assert.ok(payments.kbzPay() instanceof KbzPay);
console.log('ES modules OK');
