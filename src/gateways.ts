import { Inject } from '@nestjs/common';

import { AYA_PAY, CYBER_SOURCE, KBZ_PAY, WAVE_MONEY, YOMA_MMQR } from './constants.js';

/** The gateway names used in callback routes and {@link MyanmarPaymentsService.gateway}. */
export type GatewayName = 'kbz-pay' | 'wave-money' | 'aya-pay' | 'yoma-mmqr' | 'cyber-source';

/** Every {@link GatewayName}. */
export const GATEWAY_NAMES: readonly GatewayName[] = Object.freeze([
  'kbz-pay',
  'wave-money',
  'aya-pay',
  'yoma-mmqr',
  'cyber-source',
]);

/** Injects the SDK's `KbzPay` gateway, built on first use. */
export const InjectKbzPay = (): PropertyDecorator & ParameterDecorator => Inject(KBZ_PAY);
/** Injects the SDK's `WaveMoney` gateway, built on first use. */
export const InjectWaveMoney = (): PropertyDecorator & ParameterDecorator => Inject(WAVE_MONEY);
/** Injects the SDK's `AyaPay` gateway, built on first use. */
export const InjectAyaPay = (): PropertyDecorator & ParameterDecorator => Inject(AYA_PAY);
/** Injects the SDK's `YomaMmqr` gateway, built on first use. */
export const InjectYomaMmqr = (): PropertyDecorator & ParameterDecorator => Inject(YOMA_MMQR);
/** Injects the SDK's `CyberSource` gateway, built on first use. */
export const InjectCyberSource = (): PropertyDecorator & ParameterDecorator => Inject(CYBER_SOURCE);

/** Public instance fields of the SDK gateways, read from the built gateway. */
const INSTANCE_FIELDS = new Set(['config', 'signer']);

/**
 * A stand-in for a gateway that builds it on first use, so injecting an unconfigured gateway
 * doesn't fail at startup. `instanceof` works; methods are forwarded to the built gateway, and
 * properties Nest probes for (lifecycle hooks, `then`) read as `undefined` until it is built.
 *
 * @internal
 */
export function lazyGateway<T extends object>(
  type: abstract new (...args: never[]) => T,
  resolve: () => T,
): T {
  let instance: T | undefined;
  const target = (): T => (instance ??= resolve());
  const methods = new Map<string, (...args: unknown[]) => unknown>();

  return new Proxy(Object.create(type.prototype as object) as T, {
    get(_proxy, property) {
      if (property === 'constructor') {
        return type;
      }
      if (typeof property === 'string' && isPrototypeMethod(type.prototype as object, property)) {
        let method = methods.get(property);
        if (method === undefined) {
          method = (...args: unknown[]): unknown => {
            const gateway = target() as Record<string, (...values: unknown[]) => unknown>;
            return (gateway[property] as (...values: unknown[]) => unknown).apply(gateway, args);
          };
          methods.set(property, method);
        }
        return method;
      }
      if (
        instance === undefined &&
        !(typeof property === 'string' && INSTANCE_FIELDS.has(property))
      ) {
        return undefined;
      }
      const gateway = target();
      return Reflect.get(gateway, property, gateway);
    },
  });
}

function isPrototypeMethod(prototype: object, property: string): boolean {
  for (
    let current: object | null = prototype;
    current !== null && current !== Object.prototype;
    current = Object.getPrototypeOf(current) as object | null
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property);
    if (descriptor !== undefined) {
      return typeof descriptor.value === 'function';
    }
  }
  return false;
}
