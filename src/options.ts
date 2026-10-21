import type { CanActivate, Type } from '@nestjs/common';
import type {
  AyaPayConfig,
  AyaPayConfigOptions,
  CyberSourceConfig,
  CyberSourceConfigOptions,
  EnvSource,
  FetchFunction,
  HttpClient,
  KbzPayConfig,
  KbzPayConfigOptions,
  TokenCache,
  WavePayConfig,
  WavePayConfigOptions,
  WavePayMiniAppConfig,
  WavePayMiniAppConfigOptions,
  YomaMmqrConfig,
  YomaMmqrConfigOptions,
} from '@laranex/myanmar-payments';

/** Anything with a `get(key)`, such as `ConfigService` from `@nestjs/config`. */
export interface ConfigReader {
  get(key: string): unknown;
}

/** Any of a gateway's config options; `undefined` leaves the setting to the environment. */
export type GatewaySettings<T> = { [K in keyof T]?: T[K] | undefined };

/** Settings of the encrypted links {@link MyanmarPaymentsService.autoSubmitUrl} builds. */
export interface FormLinkOptions {
  /**
   * The secret links are encrypted with (AES-256-GCM, key derived with HKDF-SHA256). Defaults to
   * `MYANMAR_PAYMENTS_FORM_KEY`, then `APP_KEY`. A `base64:` prefix is decoded first.
   */
  secret?: string | Uint8Array | undefined;
  /**
   * How long a link stays valid, in minutes: a whole number greater than 0 (or its text).
   * Required to build links; defaults to `MYANMAR_PAYMENTS_FORM_TTL_MINUTES`.
   */
  ttlMinutes?: number | string | undefined;
  /** The scheme and host links start with. Defaults to `APP_URL`, then `http://localhost`. */
  baseUrl?: string | undefined;
}

/**
 * The module options. Each gateway is built the first time it is used, from its options merged
 * per setting with the environment the SDK's `fromEnv` reads (`KBZ_PAY_*`, `WAVE_PAY_*`,
 * `WAVE_PAY_MINI_APP_*`, `AYA_PAY_*`, `YOMA_MMQR_*`, `CYBER_SOURCE_*` and
 * `MYANMAR_PAYMENTS_HTTP_TIMEOUT`): a setting given here (not `undefined`) wins, every other one
 * comes from its variable. An SDK config instance
 * (e.g. `new KbzPayConfig(...)`) is used as it is.
 */
export interface MyanmarPaymentsModuleOptions {
  /** KBZ Pay settings; the rest come from `KBZ_PAY_*`. */
  kbzPay?: KbzPayConfig | GatewaySettings<KbzPayConfigOptions> | undefined;
  /** Wave Pay settings; the rest come from `WAVE_PAY_*`. */
  wavePay?: WavePayConfig | GatewaySettings<WavePayConfigOptions> | undefined;
  /** Wave Pay Mini App settings; the rest come from `WAVE_PAY_MINI_APP_*`. */
  wavePayMiniApp?: WavePayMiniAppConfig | GatewaySettings<WavePayMiniAppConfigOptions> | undefined;
  /** AYA Pay settings; the rest come from `AYA_PAY_*`. */
  ayaPay?: AyaPayConfig | GatewaySettings<AyaPayConfigOptions> | undefined;
  /** Yoma MMQR settings; the rest come from `YOMA_MMQR_*`. */
  yomaMmqr?: YomaMmqrConfig | GatewaySettings<YomaMmqrConfigOptions> | undefined;
  /** CyberSource settings; the rest come from `CYBER_SOURCE_*`. */
  cyberSource?: CyberSourceConfig | GatewaySettings<CyberSourceConfigOptions> | undefined;
  /** Where to read environment variables: `process.env` (default), a record or a `ConfigService`. */
  env?: EnvSource | ConfigReader | undefined;
  /** The `fetch` gateways call, e.g. a fake one in tests. */
  fetch?: FetchFunction | undefined;
  /**
   * Sends gateway requests, with its own timeout; takes precedence over `fetch`. Without one,
   * each gateway uses the SDK's fetch client with its config's `timeoutSeconds` (the option, else
   * `MYANMAR_PAYMENTS_HTTP_TIMEOUT`, else 30 seconds).
   */
  httpClient?: HttpClient | undefined;
  /**
   * Keeps the Yoma MMQR and Wave Pay Mini App access tokens. Defaults to Nest's cache manager when
   * present, else memory.
   */
  tokenCache?: TokenCache | undefined;
  /** Use the `CACHE_MANAGER` of `@nestjs/cache-manager` when it is available (default `true`). */
  useCacheManager?: boolean | undefined;
  /** The encrypted auto-submit form links. */
  formLink?: FormLinkOptions | undefined;
}

/** Whether and where the module registers the auto-submit form route. */
export interface FormRouteOptions {
  /** Register `GET <path>` (default `true`). */
  enabled?: boolean | undefined;
  /** The route path (default `myanmar-payments/form`); the app's global prefix applies. */
  path?: string | undefined;
  /**
   * Guards for the route, as classes or instances, e.g. a `ThrottlerGuard`. Don't add
   * authentication: the customer may arrive from a gateway or another device.
   */
  guards?: (CanActivate | Type<CanActivate>)[] | undefined;
  /**
   * Returns the Content Security Policy nonce for the page's inline script, from the request and
   * response Nest passes to the route. Defaults to `res.locals.cspNonce` (Express, the usual
   * helmet setup) or `reply.cspNonce.script` (`@fastify/helmet`) when one is set.
   */
  nonce?: FormNonceResolver | undefined;
}

/** Reads a CSP nonce for the form page from the route's request and response. */
export type FormNonceResolver = (request: unknown, response: unknown) => string | undefined;

/** Options given to `forRoot()` / `forRootAsync()` directly, never through a factory. */
export interface MyanmarPaymentsModuleExtras {
  /** Register the module globally (default `false`). */
  isGlobal?: boolean | undefined;
  /** The auto-submit form route. */
  formRoute?: FormRouteOptions | undefined;
}

/** The resolved form route. @internal */
export interface ResolvedFormRoute {
  enabled: boolean;
  path: string;
  guards: (CanActivate | Type<CanActivate>)[];
  nonce?: FormNonceResolver | undefined;
}
