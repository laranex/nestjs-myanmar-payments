import {
  ConfigurationError,
  MemoryTokenCache,
  MyanmarPayments,
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
  type WaveMoney,
  type YomaMmqr,
} from '@laranex/myanmar-payments';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ApplicationConfig } from '@nestjs/core';

import {
  CACHE_MANAGER,
  DEFAULT_FORM_PATH,
  DEFAULT_FORM_TTL_MINUTES,
  MYANMAR_PAYMENTS_FORM_ROUTE,
  MYANMAR_PAYMENTS_OPTIONS,
} from './constants.js';
import { envSource, envValue } from './env.js';
import { FormLinkCipher } from './form-link.js';
import { GATEWAY_NAMES, type GatewayName } from './gateways.js';
import type { MyanmarPaymentsModuleOptions, ResolvedFormRoute } from './options.js';
import { callbackRequestFrom, type NestRequestLike } from './request.js';
import { CacheManagerTokenCache } from './token-cache.js';

/** Any gateway; each one verifies callbacks with `handleCallback`. */
export type MyanmarPaymentsGateway = KbzPay | WaveMoney | AyaPay | YomaMmqr | CyberSource;

const GATEWAY_KEYS = ['kbzPay', 'waveMoney', 'ayaPay', 'yomaMmqr', 'cyberSource'] as const;

/**
 * The SDK's gateways, built from the module options or the environment on first use and reused,
 * plus the helpers for callbacks and auto-submit form links.
 */
@Injectable()
export class MyanmarPaymentsService {
  /** The cache that keeps Yoma MMQR's access token. */
  readonly tokenCache: TokenCache;
  private readonly env: EnvSource;
  private readonly configured: MyanmarPayments;
  private readonly fromEnv: MyanmarPayments;
  private readonly formRoute: ResolvedFormRoute;
  private cipher: FormLinkCipher | undefined;

  constructor(
    @Inject(MYANMAR_PAYMENTS_OPTIONS) private readonly options: MyanmarPaymentsModuleOptions,
    @Optional() @Inject(MYANMAR_PAYMENTS_FORM_ROUTE) formRoute?: ResolvedFormRoute,
    @Optional() @Inject(CACHE_MANAGER) cacheManager?: unknown,
    @Optional() @Inject(ApplicationConfig) private readonly appConfig?: ApplicationConfig,
  ) {
    this.env = envSource(options.env);
    this.formRoute = formRoute ?? { enabled: true, path: DEFAULT_FORM_PATH };
    this.tokenCache =
      options.tokenCache ??
      (options.useCacheManager !== false && CacheManagerTokenCache.supports(cacheManager)
        ? new CacheManagerTokenCache(cacheManager)
        : new MemoryTokenCache());

    const gatewayOptions: MyanmarPaymentsOptions = {
      fetch: options.fetch,
      httpClient: options.httpClient,
      timeoutMs: options.timeoutMs ?? envTimeoutMs(this.env),
      tokenCache: this.tokenCache,
    };
    const config: MyanmarPaymentsConfig = {};
    for (const key of GATEWAY_KEYS) {
      if (options[key] !== undefined) {
        Object.assign(config, { [key]: options[key] });
      }
    }
    this.configured = new MyanmarPayments(config, gatewayOptions);
    this.fromEnv = MyanmarPayments.fromEnv(this.env, gatewayOptions);
  }

  /** The KBZ Pay gateway. Throws a `ConfigurationError` when it is not configured. */
  kbzPay(): KbzPay {
    return this.source('kbzPay').kbzPay();
  }

  /** The Wave Money gateway. Throws a `ConfigurationError` when it is not configured. */
  waveMoney(): WaveMoney {
    return this.source('waveMoney').waveMoney();
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
      case 'wave-money':
        return this.waveMoney();
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
   */
  async handleCallback(
    name: GatewayName,
    request: CallbackRequest | NestRequestLike,
  ): Promise<PaymentCallback> {
    const gateway = this.gateway(name);
    return gateway.handleCallback(await callbackRequestFrom(request));
  }

  /**
   * A link to the module's form route that posts `form` (AYA Pay, CyberSource) from the customer's
   * browser, so a handler can simply redirect to it. The form is encrypted with AES-256-GCM and
   * the link expires after `formLink.ttlMinutes` (30 by default).
   */
  autoSubmitUrl(form: FormPayment): string {
    if (!this.formRoute.enabled) {
      throw new Error(
        'The Myanmar payments form route is disabled (formRoute.enabled is false); serve form.toHtml() yourself.',
      );
    }
    const ttlMinutes = this.options.formLink?.ttlMinutes ?? DEFAULT_FORM_TTL_MINUTES;
    if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) {
      throw new RangeError(
        `formLink.ttlMinutes must be a positive number of minutes, got ${String(ttlMinutes)}.`,
      );
    }
    const payload = this.formCipher(true).seal(form, nowSeconds() + Math.round(ttlMinutes * 60));
    const baseUrl = (this.options.formLink?.baseUrl ?? envValue(this.env, 'APP_URL') ?? '').replace(
      /\/+$/,
      '',
    );
    return `${baseUrl}${this.formPath()}?payload=${payload}`;
  }

  /** The form behind an auto-submit link's `payload`, or `undefined` when it is invalid or expired. */
  resolveFormPayment(payload: string): FormPayment | undefined {
    return this.formCipher(false)?.open(payload, nowSeconds());
  }

  private source(key: (typeof GATEWAY_KEYS)[number]): MyanmarPayments {
    return this.options[key] === undefined ? this.fromEnv : this.configured;
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
      const secret =
        this.options.formLink?.secret ??
        envValue(this.env, 'MYANMAR_PAYMENTS_FORM_KEY') ??
        envValue(this.env, 'APP_KEY');
      if (secret === undefined || secret.length === 0) {
        if (required) {
          throw new ConfigurationError('myanmar_payments', 'formLink.secret');
        }
        return undefined;
      }
      this.cipher = new FormLinkCipher(secret);
    }
    return this.cipher;
  }
}

function envTimeoutMs(env: EnvSource): number | undefined {
  const value = envValue(env, 'MYANMAR_PAYMENTS_HTTP_TIMEOUT');
  return value !== undefined && /^\d+$/.test(value) ? Number(value) * 1000 : undefined;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
