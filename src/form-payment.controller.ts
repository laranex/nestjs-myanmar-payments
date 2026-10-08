import {
  Controller,
  Get,
  GoneException,
  Inject,
  Query,
  Res,
  VERSION_NEUTRAL,
  type Type,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

import { MyanmarPaymentsService } from './myanmar-payments.service.js';

/**
 * Serves an auto-submit form link: the SDK's `FormPayment.toHtml()` page, which posts the signed
 * form to the gateway as soon as it loads. A tampered or expired link answers `410 Gone`. The
 * module registers it at `formRoute.path`.
 */
export class FormPaymentController {
  constructor(
    @Inject(MyanmarPaymentsService) private readonly payments: MyanmarPaymentsService,
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
  ) {}

  @Get()
  show(@Query('payload') payload: unknown, @Res({ passthrough: true }) response: unknown): string {
    const form =
      typeof payload === 'string' ? this.payments.resolveFormPayment(payload) : undefined;
    if (form === undefined) {
      throw new GoneException('This payment link is invalid or has expired.');
    }
    const adapter = this.adapterHost.httpAdapter;
    adapter.setHeader(response, 'Content-Type', 'text/html; charset=utf-8');
    adapter.setHeader(response, 'Cache-Control', 'no-store');
    adapter.setHeader(response, 'Referrer-Policy', 'no-referrer-when-downgrade');
    return form.toHtml();
  }
}

/** A {@link FormPaymentController} mounted at `path`. @internal */
export function formPaymentController(path: string): Type<FormPaymentController> {
  class MyanmarPaymentsFormController extends FormPaymentController {}
  Controller({ path, version: VERSION_NEUTRAL })(MyanmarPaymentsFormController);
  return MyanmarPaymentsFormController;
}
