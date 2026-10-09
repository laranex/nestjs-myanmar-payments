import type { CanActivate, Type } from '@nestjs/common';
import type {
  EnvSource,
  FetchFunction,
  HttpClient,
  MyanmarPaymentsConfig,
  TokenCache,
} from '@laranex/myanmar-payments';

/** Anything with a `get(key)`, such as `ConfigService` from `@nestjs/config`. */
export interface ConfigReader {
  get(key: string): unknown;
}

/** Settings of the encrypted links {@link MyanmarPaymentsService.autoSubmitUrl} builds. */
export interface FormLinkOptions {
  /**
   * The secret links are encrypted with (AES-256-GCM, key derived with HKDF-SHA256). Defaults to
   * `MYANMAR_PAYMENTS_FORM_KEY`, then `APP_KEY`. A `base64:` prefix is decoded first.
   */
  secret?: string | Uint8Array | undefined;
  /** How long a link stays valid, in minutes (default 30); must be positive. */
  ttlMinutes?: number | undefined;
  /** The scheme and host links start with. Defaults to `APP_URL`; without it links are relative. */
  baseUrl?: string | undefined;
}

/**
 * The module options. Every gateway left out is read from the environment with the SDK's
 * `fromEnv` (`KBZ_PAY_*`, `WAVE_MONEY_*`, `AYA_PAY_*`, `YOMA_MMQR_*`, `CYBER_SOURCE_*`) the first
 * time it is used.
 */
export interface MyanmarPaymentsModuleOptions extends MyanmarPaymentsConfig {
  /** Where to read environment variables: `process.env` (default), a record or a `ConfigService`. */
  env?: EnvSource | ConfigReader | undefined;
  /** The `fetch` gateways call, e.g. a fake one in tests. */
  fetch?: FetchFunction | undefined;
  /** Sends gateway requests; takes precedence over `fetch` and `timeoutMs`. */
  httpClient?: HttpClient | undefined;
  /** Milliseconds before a gateway call is aborted. Defaults to `MYANMAR_PAYMENTS_HTTP_TIMEOUT` seconds, then 30 s. */
  timeoutMs?: number | undefined;
  /** Keeps Yoma MMQR's access token. Defaults to Nest's cache manager when present, else memory. */
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
}

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
}
