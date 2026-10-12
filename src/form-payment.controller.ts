import {
  Controller,
  Get,
  GoneException,
  Inject,
  Query,
  Req,
  Res,
  UseGuards,
  VERSION_NEUTRAL,
  type CanActivate,
  type Type,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

import { MyanmarPaymentsService } from './myanmar-payments.service.js';
import type { FormNonceResolver } from './options.js';

/**
 * Serves an auto-submit form link: the SDK's `FormPayment.toHtml()` page, which posts the signed
 * form to the gateway as soon as it loads. A tampered or expired link answers `410 Gone`. The
 * module registers it at `formRoute.path`. The page sends `Referrer-Policy: strict-origin`, so the
 * gateway never sees the link's encrypted payload, and gives its inline script the CSP nonce of
 * `formRoute.nonce` (by default helmet's `res.locals.cspNonce` or `reply.cspNonce.script`).
 */
export class FormPaymentController {
  /** Reads the CSP nonce; set by the module from `formRoute.nonce`. */
  protected readonly nonce: FormNonceResolver = defaultNonce;

  constructor(
    @Inject(MyanmarPaymentsService) private readonly payments: MyanmarPaymentsService,
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
  ) {}

  @Get()
  show(
    @Query('payload') payload: unknown,
    @Req() request: unknown,
    @Res({ passthrough: true }) response: unknown,
  ): string {
    const form =
      typeof payload === 'string' ? this.payments.resolveFormPayment(payload) : undefined;
    if (form === undefined) {
      throw new GoneException('This payment link is invalid or has expired.');
    }
    const adapter = this.adapterHost.httpAdapter;
    adapter.setHeader(response, 'Content-Type', 'text/html; charset=utf-8');
    adapter.setHeader(response, 'Cache-Control', 'no-store');
    adapter.setHeader(response, 'Referrer-Policy', 'strict-origin');
    return withNonce(form.toHtml(), this.nonce(request, response));
  }
}

/** A {@link FormPaymentController} mounted at `path`, behind `guards`. @internal */
export function formPaymentController(
  path: string,
  guards: (CanActivate | Type<CanActivate>)[] = [],
  nonce: FormNonceResolver = defaultNonce,
): Type<FormPaymentController> {
  class MyanmarPaymentsFormController extends FormPaymentController {
    protected override readonly nonce = nonce;
  }
  Controller({ path, version: VERSION_NEUTRAL })(MyanmarPaymentsFormController);
  if (guards.length > 0) {
    UseGuards(...guards)(MyanmarPaymentsFormController);
  }
  return MyanmarPaymentsFormController;
}

/** helmet's nonce: `res.locals.cspNonce` on Express, `reply.cspNonce.script` on Fastify. @internal */
export function defaultNonce(_request: unknown, response: unknown): string | undefined {
  const reply = response as {
    locals?: { cspNonce?: unknown };
    cspNonce?: { script?: unknown };
  } | null;
  const nonce = reply?.locals?.cspNonce ?? reply?.cspNonce?.script;
  return typeof nonce === 'string' ? nonce : undefined;
}

/**
 * Adds `nonce` to the page's one inline `<script>` (every form value is escaped, so it is the only
 * one). Equivalent to the SDK's `toHtml(nonce)`, which older SDK versions lack.
 */
function withNonce(html: string, nonce: string | undefined): string {
  if (!nonce) {
    return html;
  }
  const escaped = nonce.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] as string);
  return html.replace('<script>', `<script nonce="${escaped}">`);
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&#34;',
  "'": '&#39;',
};
