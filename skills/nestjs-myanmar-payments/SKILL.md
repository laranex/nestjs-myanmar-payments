---
name: nestjs-myanmar-payments
description: >
  Integrate Myanmar payment gateways (KBZ Pay, Wave Pay, AYA Pay, Yoma MMQR, CyberSource) in a NestJS app with @laranex/nestjs-myanmar-payments.
license: MIT
metadata:
  author: Nay Thu Khant
---

# NestJS Myanmar Payments

## When to use

Use this skill when a NestJS application starts a payment, handles a gateway callback or checks a payment status with KBZ Pay, Wave Pay, AYA Payment Gateway, Yoma MMQR or CyberSource. Start payments and verify callbacks with the package's typed API; never build gateway signatures by hand. The package wraps the Node SDK `@laranex/myanmar-payments`: gateways, payment data, results, statuses and errors are the SDK's classes, imported from `@laranex/myanmar-payments`.

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

Set the env keys of the gateways you use. Every setting of those gateways is required and has no default, URLs included: set production's URLs, or the gateway's UAT URLs to test. Only the HTTP timeout is optional.

- KBZ Pay: `KBZ_PAY_APP_ID`, `KBZ_PAY_APP_KEY`, `KBZ_PAY_MERCHANT_CODE`, `KBZ_PAY_BASE_URL`, `KBZ_PAY_PWA_BASE_REDIRECT_URL`, `KBZ_PAY_TIME_TO_LIVE_IN_MINUTES` (1 to 120; a payment's `timeToLiveMinutes` overrides it)
- Wave Pay: `WAVE_PAY_MERCHANT_ID`, `WAVE_PAY_SECRET_KEY`, `WAVE_PAY_MERCHANT_NAME`, `WAVE_PAY_BASE_URL` (payments are requested at its `/payment`), `WAVE_PAY_BASE_REDIRECT_URL` (the customer is sent to its `/authenticate`), `WAVE_PAY_TIME_TO_LIVE_IN_SECONDS` (greater than 0; a payment's `timeToLiveSeconds` overrides it)
- AYA Pay: `AYA_PAY_APP_KEY`, `AYA_PAY_APP_SECRET`, `AYA_PAY_BASE_URL`
- Yoma MMQR: `YOMA_MMQR_MERCHANT_ID`, `YOMA_MMQR_CLIENT_ID`, `YOMA_MMQR_CLIENT_SECRET`, `YOMA_MMQR_WEBHOOK_HASHKEY`, `YOMA_MMQR_API_VERSION` (e.g. `v1rc`), `YOMA_MMQR_WEBHOOK_SECRET` (every callback must carry it in the `x-webhook-secret` header), `YOMA_MMQR_BASE_URL`
- CyberSource: `CYBER_SOURCE_PROFILE_ID`, `CYBER_SOURCE_ACCESS_KEY`, `CYBER_SOURCE_SECRET_KEY`, `CYBER_SOURCE_BASE_URL`
- Shared: `MYANMAR_PAYMENTS_HTTP_TIMEOUT` (seconds, for every gateway except CyberSource; optional, defaults to 30), `MYANMAR_PAYMENTS_FORM_TTL_MINUTES` (form link lifetime), `APP_URL` (base of form links; `http://localhost` when unset), `MYANMAR_PAYMENTS_FORM_KEY` or `APP_KEY` (form link secret, at least 32 bytes, e.g. `base64:` followed by 32 random bytes in base64)

Module options: `env` (`process.env`, a record or a `ConfigService`), per-gateway config (`kbzPay`, `wavePay`, `ayaPay`, `yomaMmqr`, `cyberSource`; merged with the environment per setting: a setting given here wins, every other one is read from its variable, e.g. `kbzPay: { appId }` still reads `KBZ_PAY_APP_KEY` and the rest; `timeoutSeconds` falls back to `MYANMAR_PAYMENTS_HTTP_TIMEOUT`, then 30; an SDK config instance such as `new KbzPayConfig(...)` is used as it is), `fetch`, `httpClient` (keeps its own timeout), `tokenCache`, `useCacheManager`, `formLink` (`secret`, `ttlMinutes`, `baseUrl`), and the extras `isGlobal` and `formRoute` (`enabled`, `path`, `guards`, `nonce`). With `@nestjs/config`: `MyanmarPaymentsModule.forRootAsync({ imports: [ConfigModule], inject: [ConfigService], useFactory: (config: ConfigService) => ({ env: config }) })`.

A gateway with a missing setting throws the SDK's `ConfigurationError` naming the key when first used, not at startup; a time setting that is not a whole number greater than 0 throws it too.

## Use

Every gateway is reached through the injected `MyanmarPaymentsService`: `kbzPay()`, `wavePay()`, `ayaPay()`, `yomaMmqr()` and `cyberSource()`, or `gateway('kbz-pay')` by name (`GATEWAY_NAMES` lists `kbz-pay`, `wave-pay`, `aya-pay`, `yoma-mmqr`, `cyber-source`). Each gateway is built once and reused. To inject one gateway: `@InjectKbzPay()`, `@InjectWavePay()`, `@InjectAyaPay()`, `@InjectYomaMmqr()`, `@InjectCyberSource()`.

### Amounts

Pass an `Amount` (`Amount.kyat(10000)`, `Amount.parse('10000.50')`) or a whole number, never a float. Only KBZ Pay (up to 2 decimals) and CyberSource accept decimals. Invalid data throws `InvalidPaymentDataError`; read the messages from its `errors`.

- Compare a gateway's amount by value with `amount.equals(callback.amount)`: `'01000'`, `'1000'` and `'1000.00'` equal `Amount.kyat(1000)`; text that is not plain digits never does.

### Start a payment

```ts
import { Amount } from '@laranex/myanmar-payments';
import { MyanmarPaymentsService } from '@laranex/nestjs-myanmar-payments';
import { Controller, Get, Param, Redirect } from '@nestjs/common';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly payments: MyanmarPaymentsService) {}

  @Get(':id/kbz-pay')
  @Redirect()
  async kbzPay(@Param('id') id: string): Promise<{ url: string }> {
    const payment = await this.payments.kbzPay().pwa({
      orderId: `ORDER_${id}`,
      amount: Amount.kyat(10000),
      callbackUrl: 'https://shop.test/payments/kbz/callback',
    });
    return { url: payment.url };
  }
}
```

- `RedirectPayment` from `kbzPay().pwa()` and `wavePay().initiate()`: redirect to `payment.url`. For Wave, store `data.merchantReferenceId` with the order; Wave's `orderId` and `merchantReferenceId` take only letters, digits, `_` and `-` (at most 100 characters), and `callbackUrl`, `returnUrl` and `description` take at most 255 (lengths count UTF-8 bytes). Pass `merchantName` or `timeToLiveSeconds` in Wave's payment data to override the configured `WAVE_PAY_MERCHANT_NAME` or `WAVE_PAY_TIME_TO_LIVE_IN_SECONDS` for that one payment (the merchant name setting stays required), and `additionalField3` to `additionalField5` (at most 50 characters each) for extra information Wave echoes in the callback.
- `QrPayment` from `kbzPay().qr()` (encode `qrString`) and `yomaMmqr().initiate()` (`qrImage` as base64, `qrImageDataUri()`, `expiresAt`, `reference`). Renew an expired Yoma QR with `yomaMmqr().renewQr(orderId)`.
- `AppPayment` from `kbzPay().app()`: return it as JSON to the mobile app.

### Form payments (AYA Pay, CyberSource)

`ayaPay().initiate()` and `cyberSource().initiate()` return a `FormPayment` the customer's browser must POST. Redirect to `this.payments.autoSubmitUrl(payment)`: a link to the module's `GET myanmar-payments/form` route, encrypted with AES-256-GCM and valid for `formLink.ttlMinutes` minutes (required); a tampered or expired link answers 410. With `formRoute.enabled: false` it throws "The form route is disabled (formRoute.enabled is false)." and without a TTL a `ConfigurationError` (`initiate()` needs neither). Or send `payment.toHtml()` yourself.

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

`autoSubmitUrl()` throws when `formRoute.enabled` is `false`, and a `ConfigurationError` without a secret or a lifetime, or with a secret shorter than 32 bytes (the error names the setting). The form page sends only its origin as the referrer; under a Content Security Policy its inline script takes helmet's nonce (`res.locals.cspNonce` on Express, `reply.cspNonce.script` on Fastify) or the one `formRoute.nonce: (req, res) => string` returns.

CyberSource has no payment defaults: pass `currency` (e.g. `'MMK'`), `transactionType` (e.g. `CyberSourceTransactionType.Sale`) and `locale` (e.g. `'en-us'`) on every `cyberSource().initiate(data)`.

### Handle the callback

Register a POST route without authentication guards. `@VerifiedCallback()` verifies the signature and injects a `PaymentCallback`; a bad signature answers 400 before the handler runs, and a body over 64 KiB answers 413:

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

- `kbzPay().status(orderId)`, `ayaPay().status(orderId)` and `yomaMmqr().status(reference)` return a `PaymentStatusResult` with `status` and `isSuccessful()`. Wave Pay and CyberSource have no status API.
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
- Forgetting `rawBody: true`: JSON callbacks then answer 400 "Enable rawBody: true in NestFactory.create() to verify JSON callbacks." (only CyberSource's form callbacks verify without it).
