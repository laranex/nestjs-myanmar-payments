---
name: nestjs-myanmar-payments
description: >
  Integrate Myanmar payment gateways (KBZ Pay, Wave Money, AYA Pay, Yoma MMQR, CyberSource) in a NestJS app with @laranex/nestjs-myanmar-payments.
license: MIT
metadata:
  author: Nay Thu Khant
---

# NestJS Myanmar Payments

## When to use

Use this skill when a NestJS application starts a payment, handles a gateway callback or checks a payment status with KBZ Pay, Wave Money, AYA Payment Gateway, Yoma MMQR or CyberSource. Start payments and verify callbacks with the package's typed API; never build gateway signatures by hand. The package wraps the Node SDK `@laranex/myanmar-payments`: gateways, payment data, results, statuses and errors are the SDK's classes, imported from `@laranex/myanmar-payments`.

## Install

```bash
npm install @laranex/nestjs-myanmar-payments@next
```

Requires Node.js 20+ and NestJS 10, 11 or 12, on `@nestjs/platform-express` or `@nestjs/platform-fastify`; ESM and CommonJS builds are included. Register the module, and create the app with `rawBody: true` so signatures are checked against the exact bytes:

```ts
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MyanmarPaymentsModule } from '@laranex/nestjs-myanmar-payments';

@Module({ imports: [MyanmarPaymentsModule.forRoot({ isGlobal: true })] })
export class AppModule {}

const app = await NestFactory.create(AppModule, { rawBody: true });
```

Gateway calls go through `fetch`, Yoma MMQR tokens through `@nestjs/cache-manager` when it is registered, and auto-submit form links are encrypted with `formLink.secret`, `MYANMAR_PAYMENTS_FORM_KEY` or `APP_KEY`.

## Configure

Set only the env keys of the gateways you use. Every gateway runs against its sandbox until `<PREFIX>_SANDBOX=false`.

- KBZ Pay: `KBZ_PAY_APP_ID`, `KBZ_PAY_APP_KEY`, `KBZ_PAY_MERCHANT_CODE`, `KBZ_PAY_SANDBOX`
- Wave Money: `WAVE_MONEY_MERCHANT_ID`, `WAVE_MONEY_SECRET_KEY`, `WAVE_MONEY_MERCHANT_NAME` (defaults to `APP_NAME`), `WAVE_MONEY_TIME_TO_LIVE_IN_SECONDS`, `WAVE_MONEY_SANDBOX`
- AYA Pay: `AYA_PAY_APP_KEY`, `AYA_PAY_APP_SECRET`, `AYA_PAY_SANDBOX` (`AYA_PGW_*` also read)
- Yoma MMQR: `YOMA_MMQR_MERCHANT_ID`, `YOMA_MMQR_CLIENT_ID`, `YOMA_MMQR_CLIENT_SECRET`, `YOMA_MMQR_WEBHOOK_HASHKEY`, optional `YOMA_MMQR_WEBHOOK_SECRET`, `YOMA_MMQR_SANDBOX`
- CyberSource: `CYBER_SOURCE_PROFILE_ID`, `CYBER_SOURCE_ACCESS_KEY`, `CYBER_SOURCE_SECRET_KEY`, `CYBER_SOURCE_SANDBOX`
- Shared: `MYANMAR_PAYMENTS_HTTP_TIMEOUT` (seconds, default 30), `APP_URL` (base of form links), `MYANMAR_PAYMENTS_FORM_KEY` or `APP_KEY` (form link secret)

Pass module options only to change them: `env` (`process.env`, a record or a `ConfigService`), per-gateway config (`kbzPay`, `waveMoney`, `ayaPay`, `yomaMmqr`, `cyberSource`; these win over the environment), `fetch`, `httpClient`, `timeoutMs`, `tokenCache`, `useCacheManager`, `formLink` (`secret`, `ttlMinutes`, `baseUrl`), and the extras `isGlobal` and `formRoute` (`enabled`, `path`, `guards`). With `@nestjs/config`: `MyanmarPaymentsModule.forRootAsync({ imports: [ConfigModule], inject: [ConfigService], useFactory: (config: ConfigService) => ({ env: config }) })`.

An unconfigured gateway throws the SDK's `ConfigurationError` naming the missing key when first used, not at startup.

## Use

Every gateway is reached through the injected `MyanmarPaymentsService`: `kbzPay()`, `waveMoney()`, `ayaPay()`, `yomaMmqr()` and `cyberSource()`, or `gateway('kbz-pay')` by name (`GATEWAY_NAMES` lists `kbz-pay`, `wave-money`, `aya-pay`, `yoma-mmqr`, `cyber-source`). Each gateway is built once and reused. To inject one gateway: `@InjectKbzPay()`, `@InjectWaveMoney()`, `@InjectAyaPay()`, `@InjectYomaMmqr()`, `@InjectCyberSource()`.

### Amounts

Pass an `Amount` (`Amount.kyat(10000)`, `Amount.parse('10000.50')`) or a whole number, never a float. Only KBZ Pay (up to 2 decimals) and CyberSource accept decimals. Invalid data throws `InvalidPaymentDataError`; read the messages from its `errors`.

### Start a payment

```ts
import { Amount } from '@laranex/myanmar-payments';
import { MyanmarPaymentsService } from '@laranex/nestjs-myanmar-payments';
import { Controller, Get, Redirect } from '@nestjs/common';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly payments: MyanmarPaymentsService) {}

  @Get('kbz-pay')
  @Redirect()
  async kbzPay(): Promise<{ url: string }> {
    const payment = await this.payments.kbzPay().pwa({
      orderId: `ORDER_${order.id}`,
      amount: Amount.kyat(10000),
      callbackUrl: 'https://shop.test/payments/kbz/callback',
    });
    return { url: payment.url };
  }
}
```

- `RedirectPayment` from `kbzPay().pwa()` and `waveMoney().initiate()`: redirect to `payment.url`. For Wave, store `data.merchantReferenceId` with the order.
- `QrPayment` from `kbzPay().qr()` (encode `qrString`) and `yomaMmqr().initiate()` (`qrImage` as base64, `qrImageDataUri()`, `expiresAt`, `reference`). Renew an expired Yoma QR with `yomaMmqr().renewQr(orderId)`.
- `AppPayment` from `kbzPay().app()`: return it as JSON to the mobile app.

### Form payments (AYA Pay, CyberSource)

`ayaPay().initiate()` and `cyberSource().initiate()` return a `FormPayment` the customer's browser must POST. Redirect to `this.payments.autoSubmitUrl(payment)`: a link to the module's `GET myanmar-payments/form` route, encrypted with AES-256-GCM and valid for `formLink.ttlMinutes` (30); a tampered or expired link answers 410. Or send `payment.toHtml()` yourself.

AYA Pay needs a channel: list them with `await this.payments.ayaPay().services()`, then:

```ts
import { Amount, AyaPayMethod } from '@laranex/myanmar-payments';

const payment = this.payments.ayaPay().initiate({
  orderId: `ORDER_${order.id}`,
  amount: Amount.kyat(10000),
  channel: 'kbz_pay',
  method: AyaPayMethod.Qr,
});
return { url: this.payments.autoSubmitUrl(payment) };
```

`autoSubmitUrl()` throws when `formRoute.enabled` is `false` and a `ConfigurationError` without a secret.

### Handle the callback

Register a POST route without authentication guards. `@VerifiedCallback()` verifies the signature and injects a `PaymentCallback`; a bad signature answers 400 before the handler runs:

```ts
import { PaymentCallback } from '@laranex/myanmar-payments';
import { AcknowledgeCallback, VerifiedCallback } from '@laranex/nestjs-myanmar-payments';
import { Controller, Post } from '@nestjs/common';

@Controller('payments')
export class PaymentCallbackController {
  @Post('kbz/callback')
  @AcknowledgeCallback()
  handle(@VerifiedCallback('kbz-pay') callback: PaymentCallback): PaymentCallback {
    if (callback.isSuccessful()) {
      // compare callback.amount with the order, then fulfill callback.orderId once
    }
    return callback; // KBZ Pay: plain "success"
  }
}
```

- `@AcknowledgeCallback()` answers with the reply each gateway expects so it stops retrying; by hand, `acknowledge(res, callback)` with `@Res()` (without a callback, an empty 200).
- One route for every gateway: `@RawCallback() request: CallbackRequest`, then `await this.payments.handleCallback(gateway, request)` (throws `SignatureVerificationError`).
- Check AYA's browser return with `ayaPay().verifyRedirect(await callbackRequestFrom(req))`; it is never proof of payment.
- For production, store the verified call, acknowledge immediately and process it once in the background; the docs show this flow as app code (the package stores nothing).

### Check status and handle errors

- `kbzPay().status(orderId)`, `ayaPay().status(orderId)` and `yomaMmqr().status(reference)` return a `PaymentStatusResult` with `status` and `isSuccessful()`. Wave Money and CyberSource have no status API.
- Statuses are `PaymentStatus` values: `PaymentStatus.Successful`, `Pending`, `Failed`, `Canceled`, `Expired`, `Unknown`.
- Gateway errors throw `ApiError` (`gatewayCode`, `gatewayMessage`, `httpStatus`, `raw`); catch `PaymentError` for every package error.

## Test your app

- Gateway calls go through `fetch`: pass a fake one in the options, `MyanmarPaymentsModule.forRoot({ env: testEnv, fetch: fakeFetch })`, answering with `new Response(JSON.stringify(...))`, so nothing reaches a real gateway.
- Post correctly signed payloads to your callback route with supertest, signed with the secret from your test configuration as each gateway page describes (`new KbzPaySigner(appKey).sign(fields)` signs KBZ Pay fields), on an app created with `rawBody: true`.
- To test your own handling without signed payloads, build a `new PaymentCallback({ orderId: 'ORDER_1', status: PaymentStatus.Successful, gatewayStatus: 'PAY_SUCCESS' })` yourself.
- Follow the `autoSubmitUrl()` link with a GET to assert the auto-submitting form; tampered or expired links answer 410.

## Avoid

- Fulfilling orders from return pages or query strings; fulfill only from a verified callback or a status check.
- Treating `Pending` or `Unknown` as paid, or skipping the amount check.
- Passing floats as amounts.
- Calling Yoma `initiate()` twice for one order (use `renewQr()`), or reusing a Wave `merchantReferenceId`.
- Putting authentication guards on callback routes or the form route; gateways and redirected browsers have no session.
- Forgetting `rawBody: true`: re-encoded JSON can change numbers and break signatures.
