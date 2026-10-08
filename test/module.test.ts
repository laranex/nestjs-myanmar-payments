import {
  Amount,
  AyaPay,
  ConfigurationError,
  CyberSource,
  KbzPay,
  KbzPayConfig,
  MemoryTokenCache,
  WaveMoney,
  YomaMmqr,
} from '@laranex/myanmar-payments';
import { Inject, Injectable, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GATEWAY_NAMES,
  InjectAyaPay,
  InjectCyberSource,
  InjectKbzPay,
  InjectWaveMoney,
  InjectYomaMmqr,
  KBZ_PAY,
  MYANMAR_PAYMENTS_OPTIONS,
  MyanmarPaymentsModule,
  MyanmarPaymentsService,
  type GatewayName,
  type MyanmarPaymentsModuleOptions,
  type MyanmarPaymentsOptionsFactory,
} from '../src/index.js';
import { ENV, fakeFetch } from './helpers.js';

async function service(
  module: Parameters<typeof Test.createTestingModule>[0]['imports'],
): Promise<MyanmarPaymentsService> {
  const moduleRef = await Test.createTestingModule({ imports: module ?? [] }).compile();
  return moduleRef.get(MyanmarPaymentsService);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('MyanmarPaymentsModule.forRoot', () => {
  it('builds every gateway from the environment record', async () => {
    const payments = await service([MyanmarPaymentsModule.forRoot({ env: ENV })]);

    expect(payments.kbzPay()).toBeInstanceOf(KbzPay);
    expect(payments.waveMoney()).toBeInstanceOf(WaveMoney);
    expect(payments.ayaPay()).toBeInstanceOf(AyaPay);
    expect(payments.yomaMmqr()).toBeInstanceOf(YomaMmqr);
    expect(payments.cyberSource()).toBeInstanceOf(CyberSource);
    expect(payments.kbzPay().config.appId).toBe('kp123');
    expect(payments.kbzPay().config.sandbox).toBe(true);
  });

  it('reuses each gateway', async () => {
    const payments = await service([MyanmarPaymentsModule.forRoot({ env: ENV })]);
    expect(payments.kbzPay()).toBe(payments.kbzPay());
    expect(payments.yomaMmqr()).toBe(payments.yomaMmqr());
  });

  it('reads process.env by default', async () => {
    vi.stubEnv('KBZ_PAY_APP_ID', 'from-process');
    vi.stubEnv('KBZ_PAY_APP_KEY', 'key');
    vi.stubEnv('KBZ_PAY_MERCHANT_CODE', 'code');
    vi.stubEnv('KBZ_PAY_SANDBOX', 'false');
    const payments = await service([MyanmarPaymentsModule.forRoot()]);
    expect(payments.kbzPay().config.appId).toBe('from-process');
    expect(payments.kbzPay().config.sandbox).toBe(false);
  });

  it('prefers explicit gateway options over the environment', async () => {
    const payments = await service([
      MyanmarPaymentsModule.forRoot({
        env: ENV,
        kbzPay: { appId: 'explicit', appKey: 'key', merchantCode: 'code', sandbox: false },
        waveMoney: undefined,
      }),
    ]);
    expect(payments.kbzPay().config.appId).toBe('explicit');
    expect(payments.kbzPay().config.sandbox).toBe(false);
    expect(payments.waveMoney().config.merchantId).toBe('testmerchantID');
  });

  it('accepts SDK config instances', async () => {
    const config = new KbzPayConfig({ appId: 'instance', appKey: 'key', merchantCode: 'code' });
    const payments = await service([MyanmarPaymentsModule.forRoot({ kbzPay: config, env: {} })]);
    expect(payments.kbzPay().config).toBe(config);
  });

  it('boots without credentials and names the missing one on first use', async () => {
    const payments = await service([MyanmarPaymentsModule.forRoot({ env: {} })]);
    for (const name of GATEWAY_NAMES) {
      expect(() => payments.gateway(name)).toThrow(ConfigurationError);
    }
    expect(() => payments.kbzPay()).toThrow('The kbz_pay configuration is missing [app_id].');
  });

  it('maps gateway names and rejects unknown ones', async () => {
    const payments = await service([MyanmarPaymentsModule.forRoot({ env: ENV })]);
    expect(payments.gateway('kbz-pay')).toBe(payments.kbzPay());
    expect(payments.gateway('wave-money')).toBe(payments.waveMoney());
    expect(payments.gateway('aya-pay')).toBe(payments.ayaPay());
    expect(payments.gateway('yoma-mmqr')).toBe(payments.yomaMmqr());
    expect(payments.gateway('cyber-source')).toBe(payments.cyberSource());
    expect(() => payments.gateway('paypal' as GatewayName)).toThrow(
      'Unknown payment gateway [paypal]; use one of kbz-pay, wave-money, aya-pay, yoma-mmqr, cyber-source.',
    );
  });

  it('passes fetch to the gateways', async () => {
    const fetch = fakeFetch({
      '/precreate': {
        Response: { result: 'SUCCESS', code: '0', prepay_id: 'P1', qrCode: 'kbzpay://qr' },
      },
    });
    const payments = await service([MyanmarPaymentsModule.forRoot({ env: ENV, fetch })]);
    const qr = await payments.kbzPay().qr({
      orderId: 'ORDER_1',
      amount: Amount.kyat(1000),
      callbackUrl: 'https://shop.test/cb',
    });
    expect(qr.qrString).toBe('kbzpay://qr');
    expect(fetch.calls).toHaveLength(1);
  });

  it.each([
    [{ timeoutMs: 1500 }, {}, 1500],
    [{}, { MYANMAR_PAYMENTS_HTTP_TIMEOUT: '7' }, 7000],
    [{}, { MYANMAR_PAYMENTS_HTTP_TIMEOUT: 'soon' }, 30000],
  ])('sets the timeout from %j and %j', async (options, env, expected) => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetch = fakeFetch({ '/precreate': { Response: { result: 'SUCCESS', code: '0' } } });
    const payments = await service([
      MyanmarPaymentsModule.forRoot({ ...options, env: { ...ENV, ...env }, fetch }),
    ]);
    await payments
      .kbzPay()
      .qr({ orderId: 'ORDER_1', amount: 1000, callbackUrl: 'https://shop.test/cb' })
      .catch(() => undefined);
    expect(timeout).toHaveBeenCalledWith(expected);
  });

  it('exposes the options under MYANMAR_PAYMENTS_OPTIONS', async () => {
    const options: MyanmarPaymentsModuleOptions = { env: ENV };
    const moduleRef = await Test.createTestingModule({
      imports: [MyanmarPaymentsModule.forRoot(options)],
    }).compile();
    expect(moduleRef.get(MYANMAR_PAYMENTS_OPTIONS)).toEqual(options);
  });

  it('treats undefined extras as their defaults', async () => {
    const module = MyanmarPaymentsModule.forRoot({
      env: ENV,
      isGlobal: undefined,
      formRoute: undefined,
    });
    expect(module.global).toBe(false);
    expect(module.controllers).toHaveLength(1);
  });

  it('is visible everywhere with isGlobal', async () => {
    @Injectable()
    class Checkout {
      constructor(@Inject(MyanmarPaymentsService) readonly payments: MyanmarPaymentsService) {}
    }
    @Module({ providers: [Checkout] })
    class ShopModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [MyanmarPaymentsModule.forRoot({ env: ENV, isGlobal: true }), ShopModule],
    }).compile();
    expect(moduleRef.get(Checkout).payments.kbzPay()).toBeInstanceOf(KbzPay);
  });
});

describe('MyanmarPaymentsModule.forRootAsync', () => {
  it('reads the environment through ConfigService', async () => {
    const payments = await service([
      MyanmarPaymentsModule.forRootAsync({
        imports: [ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ ...ENV })] })],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({ env: config }),
      }),
    ]);
    expect(payments.kbzPay().config.appId).toBe('kp123');
    expect(payments.yomaMmqr().config.merchantId).toBe('M001');
  });

  it('turns non-string ConfigService values into strings', async () => {
    const payments = await service([
      MyanmarPaymentsModule.forRootAsync({
        imports: [
          ConfigModule.forRoot({
            ignoreEnvFile: true,
            load: [
              () => ({
                ...ENV,
                KBZ_PAY_SANDBOX: false,
                MYANMAR_PAYMENTS_HTTP_TIMEOUT: 5,
                KBZ_PAY_BASE_URL: { nested: true },
              }),
            ],
          }),
        ],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({ env: config }),
      }),
    ]);
    expect(payments.kbzPay().config.sandbox).toBe(false);
    expect(payments.kbzPay().config.apiUrl).toBe(KbzPayConfig.PRODUCTION_API_URL);
  });

  it('lets tests override the options', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MyanmarPaymentsModule.forRootAsync({ useFactory: () => ({ env: {} }) })],
    })
      .overrideProvider(MYANMAR_PAYMENTS_OPTIONS)
      .useValue({ env: ENV })
      .compile();
    expect(moduleRef.get(MyanmarPaymentsService).kbzPay().config.appId).toBe('kp123');
  });

  it('builds the options with an async factory', async () => {
    const payments = await service([
      MyanmarPaymentsModule.forRootAsync({
        useFactory: async () => {
          await Promise.resolve();
          return { env: {}, ayaPay: { appKey: 'async-key', appSecret: 'secret' } };
        },
      }),
    ]);
    expect(payments.ayaPay().config.appKey).toBe('async-key');
  });

  it('builds the options with an options factory class', async () => {
    @Injectable()
    class PaymentsConfig implements MyanmarPaymentsOptionsFactory {
      createMyanmarPaymentsOptions(): MyanmarPaymentsModuleOptions {
        return { env: ENV, cyberSource: { profileId: 'p', accessKey: 'a', secretKey: 's' } };
      }
    }
    const payments = await service([
      MyanmarPaymentsModule.forRootAsync({ useClass: PaymentsConfig }),
    ]);
    expect(payments.cyberSource().config.profileId).toBe('p');
  });
});

describe('gateway injection', () => {
  @Injectable()
  class Gateways {
    constructor(
      @InjectKbzPay() readonly kbzPay: KbzPay,
      @InjectWaveMoney() readonly waveMoney: WaveMoney,
      @InjectAyaPay() readonly ayaPay: AyaPay,
      @InjectYomaMmqr() readonly yomaMmqr: YomaMmqr,
      @InjectCyberSource() readonly cyberSource: CyberSource,
    ) {}
  }

  async function gateways(options: MyanmarPaymentsModuleOptions): Promise<Gateways> {
    const moduleRef = await Test.createTestingModule({
      imports: [MyanmarPaymentsModule.forRoot(options)],
      providers: [Gateways],
    }).compile();
    await moduleRef.init();
    return moduleRef.get(Gateways);
  }

  it('injects the SDK gateways', async () => {
    const injected = await gateways({ env: ENV });
    expect(injected.kbzPay).toBeInstanceOf(KbzPay);
    expect(injected.waveMoney).toBeInstanceOf(WaveMoney);
    expect(injected.ayaPay).toBeInstanceOf(AyaPay);
    expect(injected.yomaMmqr).toBeInstanceOf(YomaMmqr);
    expect(injected.cyberSource).toBeInstanceOf(CyberSource);
    expect(injected.kbzPay.constructor).toBe(KbzPay);
    expect(injected.kbzPay.config.appId).toBe('kp123');
    expect(injected.waveMoney.config.merchantId).toBe('testmerchantID');
    expect(injected.ayaPay.config.appKey).toBe('aya-key');
    expect(injected.yomaMmqr.config.merchantId).toBe('M001');
    expect(injected.cyberSource.config.profileId).toBe('profile');
  });

  it('forwards methods and fields to the gateway the service builds', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MyanmarPaymentsModule.forRoot({ env: ENV })],
    }).compile();
    const kbz = moduleRef.get<KbzPay>(KBZ_PAY);
    const service = moduleRef.get(MyanmarPaymentsService);

    expect(kbz.config).toBe(service.kbzPay().config);
    expect(kbz.signer).toBe(service.kbzPay().signer);
    expect(kbz.handleCallback).toBe(kbz.handleCallback);
    const payment = kbz.app.bind(kbz);
    expect(typeof payment).toBe('function');
    const form = (moduleRef.get(MyanmarPaymentsService).cyberSource() as CyberSource).initiate({
      orderId: 'ORD-1',
      amount: Amount.parse('10.50'),
      callbackUrl: 'https://shop.test/cb',
    });
    expect(form.fields.length).toBeGreaterThan(0);
  });

  it('builds the gateway on first use, so unconfigured gateways do not fail at startup', async () => {
    const injected = await gateways({ env: {} });
    expect(injected.kbzPay).toBeInstanceOf(KbzPay);
    expect((injected.kbzPay as unknown as { then?: unknown }).then).toBeUndefined();
    expect(() => injected.kbzPay.handleCallback(undefined as never)).toThrow(ConfigurationError);
    expect(() => injected.kbzPay.config).toThrow(ConfigurationError);
  });

  it('reads other properties once the gateway is built', async () => {
    const injected = await gateways({ env: ENV });
    expect((injected.yomaMmqr as unknown as { cache?: unknown }).cache).toBeUndefined();
    injected.yomaMmqr.handleCallback.bind(injected.yomaMmqr);
    await injected.yomaMmqr.forgetToken();
    expect((injected.yomaMmqr as unknown as { cache?: unknown }).cache).toBeInstanceOf(
      MemoryTokenCache,
    );
  });
});
