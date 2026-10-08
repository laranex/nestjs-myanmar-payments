---
name: nestjs-myanmar-payments
description: >
  Accept KBZ Pay, Wave Money, AYA Pay, Yoma MMQR and CyberSource payments in a NestJS app with @laranex/nestjs-myanmar-payments: module, injectable service, verified callbacks on Express or Fastify, the auto-submit form route and fakes in tests.
license: MIT
metadata:
  author: Nay Thu Khant
---

# NestJS Myanmar Payments

## When to use

Use this skill when NestJS code starts a payment, handles a gateway callback or checks a payment status with KBZ Pay, Wave Money, AYA Payment Gateway, Yoma MMQR or CyberSource. The package wraps the Node SDK `@laranex/myanmar-payments`: gateways, payment data, results, statuses and errors are the SDK's classes, imported from `@laranex/myanmar-payments`.

## Install

```bash
npm install @laranex/nestjs-myanmar-payments@next
```

Requires Node.js 20+ and NestJS 10, 11 or 12, on `@nestjs/platform-express` or `@nestjs/platform-fastify`. The SDK is installed with it. ESM and CommonJS builds are included.

## Configure

```ts
import { MyanmarPaymentsModule } from '@laranex/nestjs-myanmar-payments';

@Module({ imports: [MyanmarPaymentsModule.forRoot({ isGlobal: true })] })
export class AppModule {}
```

- Without options every gateway reads the SDK's environment variables on first use: `KBZ_PAY_*`, `WAVE_MONEY_*`, `AYA_PAY_*` (or `AYA_PGW_*`), `YOMA_MMQR_*`, `CYBER_SOURCE_*`; `<PREFIX>_SANDBOX` defaults to `true`, set it to `false` in production.
- With `@nestjs/config`: `MyanmarPaymentsModule.forRootAsync({ imports: [ConfigModule], inject: [ConfigService], useFactory: (config: ConfigService) => ({ env: config }) })`. `useClass` with a `MyanmarPaymentsOptionsFactory` works too.
- Options: `env`, per-gateway config (`kbzPay`, `waveMoney`, `ayaPay`, `yomaMmqr`, `cyberSource`; these win over the environment), `fetch`, `httpClient`, `timeoutMs` (or `MYANMAR_PAYMENTS_HTTP_TIMEOUT` seconds), `tokenCache`, `useCacheManager`, `formLink` (`secret`, `ttlMinutes`, `baseUrl`). Extras: `isGlobal`, `formRoute` (`enabled`, `path`).
- Yoma MMQR access tokens go to the `@nestjs/cache-manager` cache when `CacheModule` is registered globally (or passed in `forRootAsync` `imports`); otherwise they stay in memory.
- An unconfigured gateway throws the SDK's `ConfigurationError` when first used, not at startup.

## Use

### Start a payment

```ts
import { Amount } from '@laranex/myanmar-payments';
import { MyanmarPaymentsService } from '@laranex/nestjs-myanmar-payments';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly payments: MyanmarPaymentsService) {}

  @Get('kbz-pay')
  @Redirect()
  async kbzPay() {
    const payment = await this.payments.kbzPay().pwa({
      orderId: 'ORDER_1',
      amount: Amount.kyat(1000),
      callbackUrl: 'https://shop.test/payments/callback/kbz-pay',
    });
    return { url: payment.url };
  }
}
```

- Accessors: `kbzPay()`, `waveMoney()`, `ayaPay()`, `yomaMmqr()`, `cyberSource()`, or `gateway('kbz-pay')` by name (`GATEWAY_NAMES`). Each returns the SDK gateway, built once.
- Or inject one gateway: `@InjectKbzPay() kbz: KbzPay`, `@InjectWaveMoney()`, `@InjectAyaPay()`, `@InjectYomaMmqr()`, `@InjectCyberSource()`.
- Amounts are `Amount.kyat(1000)`, `Amount.parse('1000.50')` or whole numbers; never floats.

### Form payments (AYA Pay, CyberSource)

`ayaPay().initiate(data)` and `cyberSource().initiate(data)` return a `FormPayment` the browser must POST. Either send `payment.toHtml()`, or redirect to `this.payments.autoSubmitUrl(payment)`: a link to the module's `GET /myanmar-payments/form` route, encrypted with AES-256-GCM and valid for 30 minutes (a tampered or expired link answers 410). The link needs `formLink.secret`, `MYANMAR_PAYMENTS_FORM_KEY` or `APP_KEY`, and uses `APP_URL` as its base.

### Handle the callback

Create the app with `rawBody: true` so signatures are checked against the exact bytes:

```ts
const app = await NestFactory.create(AppModule, { rawBody: true }); // also with new FastifyAdapter()
```

```ts
import { PaymentCallback } from '@laranex/myanmar-payments';
import { AcknowledgeCallback, VerifiedCallback } from '@laranex/nestjs-myanmar-payments';

@Post('payments/callback/kbz-pay')
@AcknowledgeCallback()
handle(@VerifiedCallback('kbz-pay') callback: PaymentCallback): PaymentCallback {
  if (callback.isSuccessful()) {
    // compare callback.amount with the order, then fulfill callback.orderId once
  }
  return callback; // answers with the gateway's acknowledgement (KBZ Pay: "success")
}
```

- A bad signature answers 400 before the handler runs.
- Manual style: `@RawCallback() request: CallbackRequest`, then `await this.payments.handleCallback('kbz-pay', request)` (throws `SignatureVerificationError`), and `acknowledge(res, callback)` with `@Res()` on Express or Fastify.
- `callbackRequestFrom(req)` turns a Nest request into the SDK's `CallbackRequest`, e.g. for `ayaPay().verifyRedirect(request)` on AYA's return page.
- For production, store the verified call, acknowledge immediately and process it once in the background; the docs show this flow as app code (the package stores nothing).

### Status checks and errors

- `kbzPay().status(orderId)`, `ayaPay().status(orderId)` and `yomaMmqr().status(reference)` return a `PaymentStatusResult`; Wave Money and CyberSource have no status API.
- Statuses: `PaymentStatus.Successful`, `Pending`, `Failed`, `Cancelled`, `Expired`, `Unknown`.
- Gateway failures throw `ApiError`; invalid data throws `InvalidPaymentDataError` with `errors` per field.

## Test your app

- Pass a fake `fetch` in the options: `MyanmarPaymentsModule.forRoot({ env: testEnv, fetch: fakeFetch })` and answer with `new Response(JSON.stringify(...))`.
- Post signed callbacks with supertest; build them with the SDK (for KBZ Pay `new KbzPaySigner(appKey).sign(fields)`) and create the test app with `rawBody: true`.
- To test fulfillment code alone, build `new PaymentCallback({ orderId: 'ORDER_1', status: 'successful', gatewayStatus: 'PAY_SUCCESS' })`.

## Avoid

- Fulfilling orders from return pages or query strings; fulfill only from a verified callback or a status check.
- Treating `pending` or `unknown` as paid, or skipping the amount check.
- Forgetting `rawBody: true`: re-encoded JSON can change numbers and break signatures.
- Putting authentication guards on callback routes or the form route; gateways and redirected browsers have no session.
- Calling Yoma `initiate()` twice for one order (use `renewQr()`), or reusing a Wave `merchantReferenceId`.
