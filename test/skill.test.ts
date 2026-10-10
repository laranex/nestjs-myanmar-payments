import { readFileSync } from 'node:fs';

import * as sdk from '@laranex/myanmar-payments';
import * as nestCacheManager from '@nestjs/cache-manager';
import * as nestCommon from '@nestjs/common';
import * as nestConfig from '@nestjs/config';
import * as nestCore from '@nestjs/core';
import * as nestFastify from '@nestjs/platform-fastify';
import { describe, expect, it } from 'vitest';

import * as pkg from '../src/index.js';

const skill = readFileSync(
  new URL('../skills/nestjs-myanmar-payments/SKILL.md', import.meta.url),
  'utf8',
);

/** Inline code spans and fenced code blocks: where the skill names APIs. */
const code = [
  ...skill.matchAll(/```[a-z]*\n([\s\S]*?)```/g),
  ...skill.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`]+)`/g),
].map((match) => match[1]!);

const modules: Record<string, unknown>[] = [
  pkg,
  sdk,
  nestCommon,
  nestCore,
  nestConfig,
  nestFastify,
  nestCacheManager,
];
const exported = new Set(modules.flatMap((module) => Object.keys(module)));
// Type-only exports of this package, read from its entry point.
const entry = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
for (const match of entry.matchAll(/\btype (\w+)/g)) {
  exported.add(match[1]!);
}

/** Every static and prototype member of every exported class. */
const members = new Set<string>();
for (const module of modules.slice(0, 2)) {
  for (const value of Object.values(module)) {
    if (typeof value === 'object' && value !== null) {
      Object.keys(value).forEach((name) => members.add(name));
      continue;
    }
    if (typeof value !== 'function') {
      continue;
    }
    for (let target: object | null = value; target && target !== Function.prototype;) {
      Object.getOwnPropertyNames(target).forEach((name) => members.add(name));
      target = Object.getPrototypeOf(target) as object | null;
    }
    const prototype = (value as { prototype?: object }).prototype;
    for (let target: object | null = prototype ?? null; target && target !== Object.prototype;) {
      Object.getOwnPropertyNames(target).forEach((name) => members.add(name));
      target = Object.getPrototypeOf(target) as object | null;
    }
  }
}

/** Names from the app's own code in the examples, and platform globals. */
const local = new Set([
  'AppModule',
  'CheckoutController',
  'PaymentCallbackController',
  'Promise',
  'NestFactory',
  'Response',
  'JSON',
  'ORDER_1',
  'PAY_SUCCESS',
  // Gateway names in comments.
  'KBZ',
  'Pay',
]);
const platform = new Set(['create', 'stringify', 'isSuccessful', 'url', 'sign']);

describe('the agent skill', () => {
  it('has front matter naming the package', () => {
    expect(skill).toMatch(/^---\nname: nestjs-myanmar-payments\n/);
  });

  it('only names classes, functions and constants that exist', () => {
    const names = new Set(code.flatMap((text) => text.match(/\b[A-Z][A-Za-z0-9_]*\b/g) ?? []));
    const missing = [...names].filter(
      (name) =>
        !exported.has(name) &&
        !local.has(name) &&
        !members.has(name) &&
        // Environment variables and HTTP verbs in prose.
        !/^[A-Z0-9]+(_[A-Z0-9*]+)*_?$/.test(name) &&
        !['ESM', 'GET', 'POST'].includes(name),
    );
    expect(missing).toEqual([]);
  });

  it('only names decorators that exist', () => {
    const decorators = code.flatMap((text) =>
      [...text.matchAll(/@([A-Za-z]+)\(/g)].map((match) => match[1]!),
    );
    expect(decorators.length).toBeGreaterThan(5);
    expect(decorators.filter((name) => !exported.has(name))).toEqual([]);
  });

  it('only names methods that exist', () => {
    const methods = code.flatMap((text) =>
      [...text.matchAll(/(?:^|[.\s(])([a-z][A-Za-z]+)\(/g)].map((match) => match[1]!),
    );
    expect(methods).toContain('autoSubmitUrl');
    const missing = methods.filter(
      (name) =>
        !members.has(name) &&
        !exported.has(name) &&
        !platform.has(name) &&
        // Arrow functions and constructors in examples.
        !['handle', 'kbzPay', 'useFactory', 'fakeFetch'].includes(name),
    );
    expect(missing).toEqual([]);
  });

  it('names every module option that exists', () => {
    const options: (
      keyof pkg.MyanmarPaymentsModuleOptions | keyof pkg.MyanmarPaymentsModuleExtras
    )[] = [
      'env',
      'kbzPay',
      'waveMoney',
      'ayaPay',
      'yomaMmqr',
      'cyberSource',
      'fetch',
      'httpClient',
      'tokenCache',
      'useCacheManager',
      'formLink',
      'isGlobal',
      'formRoute',
    ];
    for (const option of options) {
      expect(skill).toContain(`\`${option}\``);
    }
  });
});
