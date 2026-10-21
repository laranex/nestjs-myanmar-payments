import {
  SignatureVerificationError,
  type CallbackRequest,
  type PaymentCallback,
  type WavePayMiniApp,
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
import {
  callbackRequestFrom,
  callbackUrlFrom,
  isPaymentCallback,
  type NestRequestLike,
} from './request.js';

/**
 * Reads the request's body when called, so the pipes decide when (and whether) it is read.
 * `callbackUrl` returns the URL the request was posted to ({@link callbackUrlFrom}).
 */
export type CallbackRequestReader = (() => Promise<CallbackRequest>) & {
  callbackUrl?: (() => string) | undefined;
};

const callbackRequestParam = createParamDecorator(
  (_gateway: unknown, context: ExecutionContext): CallbackRequestReader => {
    const request = context.switchToHttp().getRequest<NestRequestLike>();
    return Object.assign(() => callbackRequestFrom(request), {
      callbackUrl: () => callbackUrlFrom(request),
    });
  },
);

/**
 * Injects the incoming request as the SDK's (unverified) `CallbackRequest`, e.g. to store it
 * before verifying it yourself.
 */
export function RawCallback(): ParameterDecorator {
  return callbackRequestParam(undefined, CallbackRequestPipe);
}

/** Reads the `CallbackRequest` of {@link RawCallback}: reading the body is asynchronous. */
@Injectable()
export class CallbackRequestPipe implements PipeTransform<
  CallbackRequestReader,
  Promise<CallbackRequest>
> {
  transform(read: CallbackRequestReader): Promise<CallbackRequest> {
    return read();
  }
}

/**
 * Injects the callback verified by the named gateway as the SDK's `PaymentCallback`. A bad
 * signature answers `400 Bad Request` before the handler runs. `wave-pay-mini-app` verifies
 * against the URL the callback was posted to ({@link callbackUrlFrom}).
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
  CallbackRequestReader,
  Promise<PaymentCallback>
> {
  constructor(@Inject(MyanmarPaymentsService) private readonly payments: MyanmarPaymentsService) {}

  async transform(
    read: CallbackRequestReader,
    metadata: ArgumentMetadata,
  ): Promise<PaymentCallback> {
    try {
      // Resolve the gateway (unknown name, missing settings) before reading the body, like
      // handleCallback() and the other framework packages.
      const name = metadata.data as GatewayName;
      const gateway = this.payments.gateway(name);
      if (name === 'wave-pay-mini-app') {
        if (read.callbackUrl === undefined) {
          throw new Error('The callback request reader has no callback URL.');
        }
        const callbackUrl = read.callbackUrl();
        return (gateway as WavePayMiniApp).handleCallback(await read(), callbackUrl);
      }
      return await this.payments.handleCallback(name, await read());
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
 * its status, headers and body. Other values pass through unchanged.
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
        adapter.status(response, value.acknowledgement.status);
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
 * `@HttpCode(200)` for other return values, plus the {@link AcknowledgementInterceptor}, which
 * sets the acknowledgement's own status (200 for every gateway).
 */
export function AcknowledgeCallback(): MethodDecorator & ClassDecorator {
  return applyDecorators(HttpCode(200), UseInterceptors(AcknowledgementInterceptor));
}
