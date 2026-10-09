import {
  SignatureVerificationError,
  type CallbackRequest,
  type PaymentCallback,
} from '@laranex/myanmar-payments';
import {
  applyDecorators,
  BadRequestException,
  createParamDecorator,
  HttpCode,
  Inject,
  Injectable,
  UseInterceptors,
  type ArgumentMetadata,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  type PipeTransform,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Observable } from 'rxjs';
// `rxjs/operators` rather than the `rxjs` root, which exports operators only since 7.2.
import { map } from 'rxjs/operators';

import type { GatewayName } from './gateways.js';
import { MyanmarPaymentsService } from './myanmar-payments.service.js';
import { callbackRequestFrom, isPaymentCallback, type NestRequestLike } from './request.js';

const callbackRequestParam = createParamDecorator(
  (_gateway: unknown, context: ExecutionContext): Promise<CallbackRequest> =>
    callbackRequestFrom(context.switchToHttp().getRequest<NestRequestLike>()),
);

/**
 * Injects the incoming request as the SDK's (unverified) `CallbackRequest`, e.g. to store it
 * before verifying it yourself.
 */
export function RawCallback(): ParameterDecorator {
  return callbackRequestParam(undefined, CallbackRequestPipe);
}

/**
 * Resolves the `CallbackRequest` of {@link RawCallback}: reading the body is asynchronous, and Nest
 * does not await custom parameter factories itself.
 */
@Injectable()
export class CallbackRequestPipe implements PipeTransform<
  Promise<CallbackRequest>,
  Promise<CallbackRequest>
> {
  transform(value: Promise<CallbackRequest>): Promise<CallbackRequest> {
    return Promise.resolve(value);
  }
}

/**
 * Injects the callback verified by the named gateway as the SDK's `PaymentCallback`. A bad
 * signature answers `400 Bad Request` before the handler runs.
 *
 * ```ts
 * @Post('callback/kbz-pay')
 * @AcknowledgeCallback()
 * handle(@VerifiedCallback('kbz-pay') callback: PaymentCallback) { ... return callback; }
 * ```
 */
export function VerifiedCallback(gateway: GatewayName): ParameterDecorator {
  return callbackRequestParam(gateway, VerifiedCallbackPipe);
}

/** Verifies the `CallbackRequest` of {@link VerifiedCallback} with the gateway in its data. */
@Injectable()
export class VerifiedCallbackPipe implements PipeTransform<
  Promise<CallbackRequest> | CallbackRequest,
  Promise<PaymentCallback>
> {
  constructor(@Inject(MyanmarPaymentsService) private readonly payments: MyanmarPaymentsService) {}

  async transform(
    value: Promise<CallbackRequest> | CallbackRequest,
    metadata: ArgumentMetadata,
  ): Promise<PaymentCallback> {
    try {
      return await this.payments.handleCallback(metadata.data as GatewayName, await value);
    } catch (error) {
      if (error instanceof SignatureVerificationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}

/**
 * Turns a `PaymentCallback` returned by a handler into the acknowledgement the gateway expects:
 * its body and headers with status 200. Other values pass through unchanged.
 */
@Injectable()
export class AcknowledgementInterceptor implements NestInterceptor {
  constructor(@Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value: unknown) => {
        if (!isPaymentCallback(value)) {
          return value;
        }
        const response: unknown = context.switchToHttp().getResponse();
        const adapter = this.adapterHost.httpAdapter;
        for (const [name, header] of Object.entries(value.acknowledgement.headers)) {
          adapter.setHeader(response, name, header);
        }
        return value.acknowledgement.body;
      }),
    );
  }
}

/**
 * Answers with the gateway's acknowledgement when the handler returns the `PaymentCallback`:
 * `@HttpCode(200)` plus the {@link AcknowledgementInterceptor}. Every gateway acknowledges with
 * 200.
 */
export function AcknowledgeCallback(): MethodDecorator & ClassDecorator {
  return applyDecorators(HttpCode(200), UseInterceptors(AcknowledgementInterceptor));
}
