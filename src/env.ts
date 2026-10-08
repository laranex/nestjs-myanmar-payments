import type { EnvSource } from '@laranex/myanmar-payments';

import type { ConfigReader } from './options.js';

/** Turns `process.env`, a record or a `ConfigService` into the record the SDK reads. @internal */
export function envSource(env: EnvSource | ConfigReader | undefined): EnvSource {
  if (env === undefined) {
    return process.env;
  }
  if (isConfigReader(env)) {
    return new Proxy<EnvSource>(
      {},
      {
        get: (_target, key) => (typeof key === 'string' ? stringValue(env.get(key)) : undefined),
      },
    );
  }
  return env;
}

/** A trimmed, non-empty value of `key`, or `undefined`. @internal */
export function envValue(env: EnvSource, key: string): string | undefined {
  const value = env[key]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function isConfigReader(env: EnvSource | ConfigReader): env is ConfigReader {
  return typeof (env as Partial<ConfigReader>).get === 'function';
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return undefined;
}
