import { AyaPay, CyberSource, KbzPay, WaveMoney, YomaMmqr } from '@laranex/myanmar-payments';
import {
  ConfigurableModuleBuilder,
  Module,
  type DynamicModule,
  type Provider,
} from '@nestjs/common';

import { AcknowledgementInterceptor, VerifiedCallbackPipe } from './callback.js';
import {
  AYA_PAY,
  CYBER_SOURCE,
  DEFAULT_FORM_PATH,
  KBZ_PAY,
  MYANMAR_PAYMENTS_FORM_ROUTE,
  MYANMAR_PAYMENTS_OPTIONS,
  WAVE_MONEY,
  YOMA_MMQR,
} from './constants.js';
import { formPaymentController } from './form-payment.controller.js';
import { lazyGateway } from './gateways.js';
import { MyanmarPaymentsService } from './myanmar-payments.service.js';
import type {
  MyanmarPaymentsModuleExtras,
  MyanmarPaymentsModuleOptions,
  ResolvedFormRoute,
} from './options.js';

// OPTIONS_TYPE and ASYNC_OPTIONS_TYPE only carry types (Nest's documented pattern).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { ConfigurableModuleClass, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } =
  new ConfigurableModuleBuilder<MyanmarPaymentsModuleOptions>({
    moduleName: 'MyanmarPayments',
    optionsInjectionToken: MYANMAR_PAYMENTS_OPTIONS,
  })
    .setClassMethodName('forRoot')
    .setFactoryMethodName('createMyanmarPaymentsOptions')
    .setExtras<MyanmarPaymentsModuleExtras>(
      { isGlobal: false, formRoute: {} },
      (definition, extras) => {
        const formRoute: ResolvedFormRoute = {
          enabled: extras.formRoute?.enabled ?? true,
          path: extras.formRoute?.path ?? DEFAULT_FORM_PATH,
          guards: extras.formRoute?.guards ?? [],
        };
        return {
          ...definition,
          global: extras.isGlobal === true,
          controllers: formRoute.enabled
            ? [formPaymentController(formRoute.path, formRoute.guards)]
            : [],
          providers: [
            // forRoot() and forRootAsync() always fill in the options providers.
            ...(definition.providers as Provider[]),
            { provide: MYANMAR_PAYMENTS_FORM_ROUTE, useValue: formRoute },
          ],
        };
      },
    )
    .build();

/** What `MyanmarPaymentsModule.forRoot()` takes: the options plus `isGlobal` and `formRoute`. */
export type MyanmarPaymentsModuleRootOptions = typeof OPTIONS_TYPE;

/**
 * What `MyanmarPaymentsModule.forRootAsync()` takes: `imports`, `inject` and `useFactory` (or
 * `useClass`/`useExisting`), plus `isGlobal` and `formRoute`.
 */
export type MyanmarPaymentsModuleAsyncOptions = typeof ASYNC_OPTIONS_TYPE;

/** A class `forRootAsync({ useClass })` can use. */
export interface MyanmarPaymentsOptionsFactory {
  createMyanmarPaymentsOptions():
    MyanmarPaymentsModuleOptions | Promise<MyanmarPaymentsModuleOptions>;
}

function gatewayProvider<T extends object>(
  token: string,
  type: abstract new (...args: never[]) => T,
  build: (payments: MyanmarPaymentsService) => T,
): Provider {
  return {
    provide: token,
    inject: [MyanmarPaymentsService],
    useFactory: (payments: MyanmarPaymentsService): T => lazyGateway(type, () => build(payments)),
  };
}

const gatewayProviders: Provider[] = [
  gatewayProvider(KBZ_PAY, KbzPay, (payments) => payments.kbzPay()),
  gatewayProvider(WAVE_MONEY, WaveMoney, (payments) => payments.waveMoney()),
  gatewayProvider(AYA_PAY, AyaPay, (payments) => payments.ayaPay()),
  gatewayProvider(YOMA_MMQR, YomaMmqr, (payments) => payments.yomaMmqr()),
  gatewayProvider(CYBER_SOURCE, CyberSource, (payments) => payments.cyberSource()),
];

const exported = [
  MyanmarPaymentsService,
  VerifiedCallbackPipe,
  AcknowledgementInterceptor,
  KBZ_PAY,
  WAVE_MONEY,
  AYA_PAY,
  YOMA_MMQR,
  CYBER_SOURCE,
];

/**
 * Myanmar payments for NestJS: `MyanmarPaymentsModule.forRoot(options)` or
 * `forRootAsync({ imports, inject, useFactory })`, then inject {@link MyanmarPaymentsService} or a
 * single gateway with `@InjectKbzPay()` and friends.
 */
@Module({
  providers: [
    MyanmarPaymentsService,
    VerifiedCallbackPipe,
    AcknowledgementInterceptor,
    ...gatewayProviders,
  ],
  exports: exported,
})
export class MyanmarPaymentsModule extends ConfigurableModuleClass {
  /** Registers the module; without options every gateway is read from `process.env`. */
  static override forRoot(options: MyanmarPaymentsModuleRootOptions = {}): DynamicModule {
    return super.forRoot(options);
  }
}
