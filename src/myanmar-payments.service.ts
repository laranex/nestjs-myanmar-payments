import {
  AyaPayConfig,
  ConfigurationError,
  CyberSourceConfig,
  KbzPayConfig,
  MemoryTokenCache,
  MyanmarPayments,
  WavePayConfig,
  WavePayMiniAppConfig,
  YomaMmqrConfig,
  type AyaPay,
  type CallbackRequest,
  type CyberSource,
  type EnvSource,
  type FormPayment,
  type KbzPay,
  type MyanmarPaymentsConfig,
  type MyanmarPaymentsOptions,
  type PaymentCallback,
  type TokenCache,
  type WavePay,
  type WavePayMiniApp,
  type YomaMmqr,
} from '@laranex/myanmar-payments';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ApplicationConfig } from '@nestjs/core';

import {
  CACHE_MANAGER,
  DEFAULT_FORM_PATH,
  MYANMAR_PAYMENTS_FORM_ROUTE,
  MYANMAR_PAYMENTS_OPTIONS,
} from './constants.js';
import { envSource, envValue } from './env.js';
import { FormLinkCipher } from './form-link.js';
import { GATEWAY_NAMES, type GatewayName } from './gateways.js';
import type { MyanmarPaymentsModuleOptions, ResolvedFormRoute } from './options.js';
import {
  callbackRequestFrom,
  callbackUrlFrom,
  isCallbackRequest,
  type NestRequestLike,
} from './request.js';
import { CacheManagerTokenCache } from './token-cache.js';

/** Any gateway; each one verifies callbacks with `handleCallback`. */
export type MyanmarPaymentsGateway =
  KbzPay | WavePay | WavePayMiniApp | AyaPay | YomaMmqr | CyberSource;

type GatewayKey = keyof Required<MyanmarPaymentsConfig>;

/** Each gateway's SDK config class, whose `optionsFromEnv` reads its environment variables. */
const CONFIG_TYPES = {
  kbzPay: KbzPayConfig,
  wavePay: WavePayConfig,
  wavePayMiniApp: WavePayMiniAppConfig,
  ayaPay: AyaPayConfig,
  yomaMmqr: YomaMmqrConfig,
  cyberSource: CyberSourceConfig,
} as const;

/**
 * The SDK's gateways, built on first use from the module options merged per setting with the
 * environment and reused, plus the helpers for callbacks and auto-submit form links.
 */
@Injectable()
export class MyanmarPaymentsService {
  /** The cache that keeps the Yoma MMQR and Wave Pay Mini App access tokens. */
  readonly tokenCache: TokenCache;
  private readonly env: EnvSource;
  private readonly gatewayOptions: MyanmarPaymentsOptions;
  private readonly facades: Partial<Record<GatewayKey, MyanmarPayments>> = {};
  private readonly formRoute: ResolvedFormRoute;
  private cipher: FormLinkCipher | undefined;

  constructor(
    @Inject(MYANMAR_PAYMENTS_OPTIONS) private readonly options: MyanmarPaymentsModuleOptions,
    @Optional() @Inject(MYANMAR_PAYMENTS_FORM_ROUTE) formRoute?: ResolvedFormRoute,
    @Optional() @Inject(CACHE_MANAGER) cacheManager?: unknown,
    @Optional() @Inject(ApplicationConfig) private readonly appConfig?: ApplicationConfig,
  ) {
    this.env = envSource(options.env);
    this.formRoute = formRoute ?? { enabled: true, path: DEFAULT_FORM_PATH, guards: [] };
    this.tokenCache =
      options.tokenCache ??
      (options.useCacheManager !== false && CacheManagerTokenCache.supports(cacheManager)
        ? new CacheManagerTokenCache(cacheManager)
        : new MemoryTokenCache());

    this.gatewayOptions = {
      fetch: options.fetch,
      httpClient: options.httpClient,
      tokenCache: this.tokenCache,
    };
  }

  /** The KBZ Pay gateway. Throws a `ConfigurationError` when it is not configured. */
  kbzPay(): KbzPay {
    return this.source('kbzPay').kbzPay();
  }

  /** The Wave Pay gateway. Throws a `ConfigurationError` when it is not configured. */
  wavePay(): WavePay {
    return this.source('wavePay').wavePay();
  }

  /**
   * The Wave Pay Mini App gateway. Throws a `ConfigurationError` when it is not configured. Its
   * access tokens are kept in {@link tokenCache}.
   */
  wavePayMiniApp(): WavePayMiniApp {
    return this.source('wavePayMiniApp').wavePayMiniApp();
  }

  /** The AYA Payment Gateway. Throws a `ConfigurationError` when it is not configured. */
  ayaPay(): AyaPay {
    return this.source('ayaPay').ayaPay();
  }

  /** The Yoma MMQR gateway. Throws a `ConfigurationError` when it is not configured. */
  yomaMmqr(): YomaMmqr {
    return this.source('yomaMmqr').yomaMmqr();
  }

  /** The CyberSource gateway. Throws a `ConfigurationError` when it is not configured. */
  cyberSource(): CyberSource {
    return this.source('cyberSource').cyberSource();
  }

  /** The gateway for a callback route name such as `kbz-pay`. */
  gateway(name: GatewayName): MyanmarPaymentsGateway {
    switch (name) {
      case 'kbz-pay':
        return this.kbzPay();
      case 'wave-pay':
        return this.wavePay();
      case 'wave-pay-mini-app':
        return this.wavePayMiniApp();
      case 'aya-pay':
        return this.ayaPay();
      case 'yoma-mmqr':
        return this.yomaMmqr();
      case 'cyber-source':
        return this.cyberSource();
      default:
        throw new Error(
          `Unknown payment gateway [${String(name)}]; use one of ${GATEWAY_NAMES.join(', ')}.`,
        );
    }
  }

  /**
   * Verifies a callback with the named gateway. Throws the SDK's `SignatureVerificationError`
   * when the signature does not match.
   *
   * `wave-pay-mini-app` verifies against the URL the callback was posted to
   * ({@link callbackUrlFrom}), so it needs the Nest request rather than a `CallbackRequest`. When
   * that is not the URL the payment was signed with (e.g. a proxy the app does not trust), call
   * `wavePayMiniApp().handleCallback(request, callbackUrl)` instead.
   */
  async handleCallback(
    name: GatewayName,
    request: CallbackRequest | NestRequestLike,
  ): Promise<PaymentCallback> {
    const gateway = this.gateway(name);
    if (name === 'wave-pay-mini-app') {
      if (isCallbackRequest(request)) {
        throw new Error(
          'Wave Pay Mini App callbacks are verified against the request URL: pass the Nest request, or call wavePayMiniApp().handleCallback(request, callbackUrl).',
        );
      }
      const callbackUrl = callbackUrlFrom(request);
      return (gateway as WavePayMiniApp).handleCallback(
        await callbackRequestFrom(request),
        callbackUrl,
      );
    }
    return (gateway as Exclude<MyanmarPaymentsGateway, WavePayMiniApp>).handleCallback(
      await callbackRequestFrom(request),
    );
  }

  /**
   * A link to the module's form route that posts `form` (AYA Pay, CyberSource) from the customer's
   * browser, so a handler can simply redirect to it. The form is encrypted with AES-256-GCM and
   * the link expires after `formLink.ttlMinutes` (`MYANMAR_PAYMENTS_FORM_TTL_MINUTES`), which is
   * required.
   */
  autoSubmitUrl(form: FormPayment): string {
    if (!this.formRoute.enabled) {
      throw new Error('The form route is disabled (formRoute.enabled is false).');
    }
    const ttlMinutes = wholeMinutes(
      this.options.formLink?.ttlMinutes ?? envValue(this.env, 'MYANMAR_PAYMENTS_FORM_TTL_MINUTES'),
    );
    const payload = this.formCipher(true).seal(form, nowSeconds() + ttlMinutes * 60);
    const baseUrl = (
      this.options.formLink?.baseUrl ??
      envValue(this.env, 'APP_URL') ??
      'http://localhost'
    ).replace(/\/+$/, '');
    return `${baseUrl}${this.formPath()}?payload=${payload}`;
  }

  /** The form behind an auto-submit link's `payload`, or `undefined` when it is invalid or expired. */
  resolveFormPayment(payload: string): FormPayment | undefined {
    return this.formCipher(false)?.open(payload, nowSeconds());
  }

  /**
   * The SDK facade holding the `key` gateway, built on first use. Each setting is the module
   * option when it is given, else its environment variable (`MYANMAR_PAYMENTS_HTTP_TIMEOUT` for
   * the timeout of every gateway but CyberSource); an SDK config instance is used as it is.
   */
  private source(key: GatewayKey): MyanmarPayments {
    let facade = this.facades[key];
    if (facade === undefined) {
      const option = this.options[key];
      const type = CONFIG_TYPES[key] as unknown as GatewayConfigType;
      const config =
        option instanceof type
          ? option
          : new type({ ...type.optionsFromEnv(this.env), ...definedOnly(option ?? {}) });
      facade = new MyanmarPayments({ [key]: config }, this.gatewayOptions);
      this.facades[key] = facade;
    }
    return facade;
  }

  private formPath(): string {
    const segments = [this.appConfig?.getGlobalPrefix() ?? '', this.formRoute.path]
      .map((segment) => segment.replace(/^\/+|\/+$/g, ''))
      .filter((segment) => segment !== '');
    return `/${segments.join('/')}`;
  }

  private formCipher(required: true): FormLinkCipher;
  private formCipher(required: false): FormLinkCipher | undefined;
  private formCipher(required: boolean): FormLinkCipher | undefined {
    if (this.cipher === undefined) {
      const sources: [string, string | Uint8Array | undefined][] = [
        ['formLink.secret', this.options.formLink?.secret],
        ['MYANMAR_PAYMENTS_FORM_KEY', envValue(this.env, 'MYANMAR_PAYMENTS_FORM_KEY')],
        ['APP_KEY', envValue(this.env, 'APP_KEY')],
      ];
      const [key, secret] = sources.find(([, value]) => value !== undefined) ?? ['', undefined];
      if (secret === undefined || secret.length === 0) {
        if (required) {
          throw new ConfigurationError('myanmar_payments', 'formLink.secret');
        }
        return undefined;
      }
      this.cipher = new FormLinkCipher(secret, key);
    }
    return this.cipher;
  }
}

/**
 * The form link lifetime: a whole number of minutes greater than 0, or its text. Unset or blank
 * throws the missing `ConfigurationError`; anything else throws the invalid one.
 */
function wholeMinutes(value: number | string | undefined): number {
  if (value === undefined || (typeof value === 'string' && value.trim() === '')) {
    throw new ConfigurationError('form_route', 'ttl_minutes');
  }
  const minutes =
    typeof value === 'number'
      ? value
      : /^[+-]?\d+$/.test(value.trim())
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;
  if (!Number.isSafeInteger(minutes) || minutes <= 0) {
    throw new ConfigurationError('form_route', 'ttl_minutes', true);
  }
  return minutes;
}

/** A gateway config class, typed loosely so the six can be built the same way. */
interface GatewayConfigType {
  new (options: Record<string, unknown>): object;
  optionsFromEnv(env: EnvSource): Record<string, unknown>;
}

/** `options` without its `undefined` values, so they don't hide the environment's. */
function definedOnly(options: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
