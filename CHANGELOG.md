# Changelog

All notable changes to `@laranex/nestjs-myanmar-payments` (nestjs-myanmar-payments) will be documented in this file.

## v4.0.0 - Unreleased

Initial release. The version number matches the other Laranex Myanmar payments packages. Every gateway feature comes from [Node Myanmar Payments](https://github.com/laranex/node-myanmar-payments) (`@laranex/myanmar-payments`); this package only wires it into NestJS, like `laravel-myanmar-payments` and `goravel-myanmar-payments` do for their frameworks.

### Added
- `MyanmarPaymentsModule.forRoot()` and `forRootAsync()` (`useFactory`, `useClass`, `useExisting`, `imports`, `inject`), with `isGlobal` and `formRoute` extras. Without options every gateway reads the SDK's environment variables (`KBZ_PAY_*`, `WAVE_MONEY_*`, `AYA_PAY_*`, `YOMA_MMQR_*`, `CYBER_SOURCE_*`) on first use; `env` also takes a record or a `ConfigService`.
- `MyanmarPaymentsService` with `kbzPay()`, `waveMoney()`, `ayaPay()`, `yomaMmqr()`, `cyberSource()` and `gateway(name)`, returning the SDK's gateways, built lazily and reused; `@InjectKbzPay()`, `@InjectWaveMoney()`, `@InjectAyaPay()`, `@InjectYomaMmqr()` and `@InjectCyberSource()` inject one gateway.
- Callbacks on the Express and Fastify adapters: `@VerifiedCallback(gateway)` injects a verified `PaymentCallback` and answers 400 to a bad signature (413 to a body over 64 KiB), `@AcknowledgeCallback()` turns the returned callback into the gateway's acknowledgement (status, headers and body), `@RawCallback()`, `handleCallback()`, `callbackRequestFrom()` and `acknowledge()` cover handlers that store the call first. Works best with `rawBody: true`.
- Optional `GET /myanmar-payments/form` route and `autoSubmitUrl(form)` for AYA Pay and CyberSource form payments: the form travels in an AES-256-GCM encrypted, expiring link (`formLink.ttlMinutes` or `MYANMAR_PAYMENTS_FORM_TTL_MINUTES`, required); a tampered or expired link answers 410. `formRoute.guards` puts guards (e.g. a `ThrottlerGuard`) on the route. The form link secret must be at least 32 bytes; the page sends `Referrer-Policy: strict-origin` and adds a CSP nonce (helmet's, or `formRoute.nonce`).
- Settings follow `@laranex/myanmar-payments`: every setting of a gateway you use is required and has no default, except each gateway's `timeoutSeconds` (`MYANMAR_PAYMENTS_HTTP_TIMEOUT`, 30 seconds by default; an `httpClient` you pass keeps its own). That includes every gateway URL (`KBZ_PAY_BASE_URL`, `KBZ_PAY_PWA_BASE_REDIRECT_URL`, `WAVE_MONEY_BASE_URL`, `WAVE_MONEY_BASE_REDIRECT_URL`, `AYA_PAY_BASE_URL`, `YOMA_MMQR_BASE_URL`, `CYBER_SOURCE_BASE_URL`; production's or the gateway's UAT URLs), `KBZ_PAY_TIME_TO_LIVE_IN_MINUTES` (1 to 120) and `WAVE_MONEY_TIME_TO_LIVE_IN_SECONDS` (a payment's own time to live overrides them) and `YOMA_MMQR_WEBHOOK_SECRET` (every Yoma callback must carry it in `X-Webhook-Secret`); a missing or invalid one throws the SDK's `ConfigurationError`.
- Yoma MMQR access tokens are kept in the `@nestjs/cache-manager` cache when it is registered (`CacheManagerTokenCache`), in memory otherwise.
- NestJS 10, 11 and 12 (rxjs 7.1 or later), Node.js 20+, ES modules and CommonJS with type declarations; CI also runs the lowest accepted versions.
- Agent skill in `skills/nestjs-myanmar-payments`; install it with `npx skills add laranex/nestjs-myanmar-payments`.
