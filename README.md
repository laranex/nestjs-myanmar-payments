# NestJS Myanmar Payments

[![npm](https://img.shields.io/npm/v/@laranex/nestjs-myanmar-payments.svg?style=flat-square)](https://www.npmjs.com/package/@laranex/nestjs-myanmar-payments)
[![Tests](https://github.com/laranex/nestjs-myanmar-payments/actions/workflows/tests.yml/badge.svg)](https://github.com/laranex/nestjs-myanmar-payments/actions/workflows/tests.yml)
[![License](https://img.shields.io/npm/l/@laranex/nestjs-myanmar-payments.svg?style=flat-square)](LICENSE.md)

NestJS integration for Myanmar payment gateways: KBZ Pay, Wave Money, AYA Pay, Yoma MMQR and CyberSource. Built on Node Myanmar Payments. Injectable module, verified callbacks and test fakes. Built for humans and AI agents.

## Why NestJS Myanmar Payments

Every Myanmar payment gateway signs, sends and acknowledges payments its own way, with its own rules for amounts. NestJS Myanmar Payments puts KBZ Pay, Wave Money, AYA Pay, Yoma MMQR and CyberSource behind one injectable service. All gateway logic lives in [Node Myanmar Payments](https://laranex.vercel.app/node-myanmar-payments/introduction); this package wires it into NestJS.

- **One module, every gateway.** `MyanmarPaymentsModule.forRoot()` or `forRootAsync()` provides `MyanmarPaymentsService` with `kbzPay()`, `waveMoney()`, `ayaPay()`, `yomaMmqr()` and `cyberSource()`, configured from environment variables or module options. Endpoints default to production.
- **A typed result for each flow.** Every payment returns a `RedirectPayment`, `FormPayment`, `QrPayment` or `AppPayment`, so you always know what to do next. See [Payment Flows](https://laranex.vercel.app/nestjs-myanmar-payments/payment-flows).
- **Exact amounts.** Whole numbers or `Amount` values, never floats, checked against each gateway's documented rules before any request is sent.
- **Verified callbacks.** `@VerifiedCallback()` checks the gateway's signature against the exact body it sent and injects a `PaymentCallback` whose status is one `PaymentStatus`; `@AcknowledgeCallback()` sends the response the gateway expects.
- **NestJS all the way down.** Injectable gateways (`@InjectKbzPay()` and the rest), Express or Fastify, `@nestjs/config` for settings, `@nestjs/cache-manager` for shared Yoma MMQR tokens, and AYA Pay and CyberSource checkout forms that open from an encrypted link.
- **Easy to test.** A fake `fetch` sees every gateway call, `MyanmarPaymentsService` can be overridden, and signed callbacks can be posted to your own routes. See [Testing](https://laranex.vercel.app/nestjs-myanmar-payments/testing).
- **Your webhooks, your storage.** The package never stores webhooks; the docs show the recommended store, acknowledge and process-once flow as sample code. See [Handling Webhooks](https://laranex.vercel.app/nestjs-myanmar-payments/webhooks).
- **Ready for AI agents.** An agent skill, installed with `npx skills add`, teaches coding agents to use the package correctly.

## Installation

> **Requires** Node.js 20+ and NestJS 10 to 12, on the Express (`@nestjs/platform-express`) or Fastify (`@nestjs/platform-fastify`) adapter.

```bash
npm install @laranex/nestjs-myanmar-payments@next
```

Until v4.0.0 is released the package ships `4.0.0-dev.*` pre-releases, so install the `next` tag.

## Documentation

The full documentation lives at **[laranex.vercel.app/nestjs-myanmar-payments](https://laranex.vercel.app/nestjs-myanmar-payments)**:

- [Introduction](https://laranex.vercel.app/nestjs-myanmar-payments/introduction): what NestJS Myanmar Payments does and why to use it
- [Installation](https://laranex.vercel.app/nestjs-myanmar-payments/installation): registering the module, keeping the raw body and what the package exports
- [AI Agent Skill](https://laranex.vercel.app/nestjs-myanmar-payments/ai-agent-skill): installing the agent skill with `npx skills add`
- [Configuration](https://laranex.vercel.app/nestjs-myanmar-payments/configuration): environment variables, endpoints, UAT testing, the HTTP client, the auto-submit form route and the cache
- [Amounts](https://laranex.vercel.app/nestjs-myanmar-payments/amounts): exact amounts and each gateway's rules for decimals and minimums
- [Payment Flows](https://laranex.vercel.app/nestjs-myanmar-payments/payment-flows): redirect, form, QR and app payments and the typed result each returns
- [Callbacks & Status](https://laranex.vercel.app/nestjs-myanmar-payments/callbacks): verifying callbacks, `PaymentStatus`, acknowledging and status checks
- [Handling Webhooks](https://laranex.vercel.app/nestjs-myanmar-payments/webhooks): the recommended verify, store, acknowledge and process-once flow
- [Testing](https://laranex.vercel.app/nestjs-myanmar-payments/testing): a fake `fetch`, signed callbacks with supertest, overriding the service and following form links
- [KBZ Pay](https://laranex.vercel.app/nestjs-myanmar-payments/drivers/kbz-pay): PWA redirect, QR and in-app payments, status checks and callbacks
- [Wave Money](https://laranex.vercel.app/nestjs-myanmar-payments/drivers/wave-money): redirect payments with line items and callbacks
- [AYA Pay](https://laranex.vercel.app/nestjs-myanmar-payments/drivers/aya-pay): the AYA Payment Gateway hosted checkout, channel discovery, status checks and callbacks
- [Yoma MMQR](https://laranex.vercel.app/nestjs-myanmar-payments/drivers/yoma-mmqr): QR images, QR renewal, status checks and callbacks
- [CyberSource](https://laranex.vercel.app/nestjs-myanmar-payments/drivers/cyber-source): Secure Acceptance card payments with a signed hosted checkout form
- [Results](https://laranex.vercel.app/nestjs-myanmar-payments/references/results): every field of `RedirectPayment`, `FormPayment`, `QrPayment` and `AppPayment`
- [PaymentCallback & Status](https://laranex.vercel.app/nestjs-myanmar-payments/references/payment-callback): every field of `PaymentCallback`, `PaymentStatusResult` and `PaymentStatus`
- [Errors](https://laranex.vercel.app/nestjs-myanmar-payments/references/errors): validation, API, signature and configuration errors

## License

MIT. See [LICENSE.md](LICENSE.md).
