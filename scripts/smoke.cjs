// Loads the built CommonJS entry point and builds a gateway, proving the require() path works.
require('reflect-metadata');
const assert = require('node:assert');
const { KbzPay } = require('@laranex/myanmar-payments');
const {
  MyanmarPaymentsModule,
  MyanmarPaymentsService,
  VerifiedCallback,
} = require('@laranex/nestjs-myanmar-payments');

assert.strictEqual(typeof MyanmarPaymentsModule.forRoot, 'function');
assert.strictEqual(typeof MyanmarPaymentsModule.forRootAsync, 'function');
assert.strictEqual(typeof VerifiedCallback('kbz-pay'), 'function');
const payments = new MyanmarPaymentsService({
  env: {
    KBZ_PAY_APP_ID: 'a',
    KBZ_PAY_APP_KEY: 'k',
    KBZ_PAY_MERCHANT_CODE: 'm',
    KBZ_PAY_BASE_URL: 'https://api.kbzpay.com/payment/gateway',
    KBZ_PAY_PWA_BASE_REDIRECT_URL: 'https://static.kbzpay.com/pgw/pwa/#/',
    KBZ_PAY_TIME_TO_LIVE_IN_MINUTES: '30',
    MYANMAR_PAYMENTS_HTTP_TIMEOUT: '30',
  },
});
assert.ok(payments.kbzPay() instanceof KbzPay);
console.log('CommonJS OK');
