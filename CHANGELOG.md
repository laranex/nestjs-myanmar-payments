# Changelog

All notable changes to `@laranex/nestjs-myanmar-payments` (nestjs-myanmar-payments) will be documented in this file.

## v4.0.0 - Unreleased

Initial release. The version number matches the other Laranex Myanmar payments packages. Every gateway feature comes from [Node Myanmar Payments](https://github.com/laranex/node-myanmar-payments) (`@laranex/myanmar-payments`); this package only wires it into NestJS, like `laravel-myanmar-payments` and `goravel-myanmar-payments` do for their frameworks.

### Added
- `MyanmarPaymentsModule.forRoot()` and `forRootAsync()` (`useFactory`, `useClass`, `useExisting`, `imports`, `inject`), with `isGlobal` and `formRoute` extras. Without options every gateway reads the SDK's environment variables (`KBZ_PAY_*`, `WAVE_MONEY_*`, `AYA_PAY_*`, `YOMA_MMQR_*`, `CYBER_SOURCE_*`) on first use; `env` also takes a record or a `ConfigService`.
- `MyanmarPaymentsService` with `kbzPay()`, `waveMoney()`, `ayaPay()`, `yomaMmqr()`, `cyberSource()` and `gateway(name)`, returning the SDK's gateways, built lazily and reused; `@InjectKbzPay()`, `@InjectWaveMoney()`, `@InjectAyaPay()`, `@InjectYomaMmqr()` and `@InjectCyberSource()` inject one gateway.
- Callbacks on the Express and Fastify adapters: `@VerifiedCallback(gateway)` injects a verified `PaymentCallback` and answers 400 to a bad signature, `@AcknowledgeCallback()` turns the returned callback into the gateway's acknowledgement (status, headers and body), `@RawCallback()`, `handleCallback()`, `callbackRequestFrom()` and `acknowledge()` cover handlers that store the call first. Works best with `rawBody: true`.
- Optional `GET /myanmar-payments/form` route and `autoSubmitUrl(form)` for AYA Pay and CyberSource form payments: the form travels in an AES-256-GCM encrypted, expiring link (`formLink.ttlMinutes` or `MYANMAR_PAYMENTS_FORM_TTL_MINUTES`, required); a tampered or expired link answers 410. `formRoute.guards` puts guards (e.g. a `ThrottlerGuard`) on the route, like the `middleware` setting of the Laravel and Goravel packages. The form link secret must be at least 32 bytes; the page sends `Referrer-Policy: strict-origin` and adds a CSP nonce (helmet's, or `formRoute.nonce`); callback bodies over 64 KiB answer 413.
- Settings follow `@laranex/myanmar-payments`: every gateway uses its production endpoints (the URL settings are optional overrides); each gateway's `timeoutSeconds` (`MYANMAR_PAYMENTS_HTTP_TIMEOUT`) defaults to 30 seconds, and an `httpClient` you pass keeps its own; `KBZ_PAY_TIME_TO_LIVE_IN_MINUTES` (1 to 120) and `WAVE_MONEY_TIME_TO_LIVE_IN_SECONDS` are optional defaults that a payment's own time to live overrides, and a payment with neither throws `InvalidPaymentDataError` before any request. Every other setting of a gateway you use is required; a missing or invalid one throws the SDK's `ConfigurationError`.
- Yoma MMQR access tokens are kept in the `@nestjs/cache-manager` cache when it is registered (`CacheManagerTokenCache`), in memory otherwise.
- NestJS 10, 11 and 12 (rxjs 7.1 or later), Node.js 20+, ES modules and CommonJS with type declarations; CI also runs the lowest accepted versions.
- Agent skill in `skills/nestjs-myanmar-payments`; install it with `npx skills add laranex/nestjs-myanmar-payments`.
