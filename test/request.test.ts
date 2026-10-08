import { Readable } from 'node:stream';

import { Acknowledgement, CallbackRequest } from '@laranex/myanmar-payments';
import { describe, expect, it } from 'vitest';

import { acknowledge, callbackRequestFrom, type FastifyReplyLike } from '../src/index.js';

describe('callbackRequestFrom', () => {
  it('returns a CallbackRequest unchanged', async () => {
    const request = CallbackRequest.from({ body: '{}' });
    expect(await callbackRequestFrom(request)).toBe(request);
  });

  it('copies a CallbackRequest from the other module format', async () => {
    const original = CallbackRequest.from({
      body: 'a=1',
      headers: { 'X-Test': 'yes' },
      query: 'page=2',
    });
    const foreign = {
      body: original.body,
      headers: original.headers,
      query: original.query,
      parsedBody: () => ({}),
    };
    const copy = await callbackRequestFrom(foreign as never);
    expect(copy).toBeInstanceOf(CallbackRequest);
    expect(copy).toMatchObject({ body: 'a=1', headers: { 'x-test': 'yes' }, query: { page: '2' } });
  });

  it('prefers the raw body Nest keeps', async () => {
    const request = await callbackRequestFrom({
      headers: { 'content-type': 'application/json' },
      originalUrl: '/api/callback?x=1',
      url: '/callback',
      rawBody: Buffer.from('{"amount":1000.50}'),
      body: { amount: 1000.5 },
    });
    expect(request.body).toBe('{"amount":1000.50}');
    expect(request.query).toEqual({ x: '1' });
  });

  it('accepts a raw body string', async () => {
    const request = await callbackRequestFrom({ headers: {}, rawBody: 'text' });
    expect(request.body).toBe('text');
  });

  it('reads an unread Node request stream', async () => {
    const stream = Object.assign(Readable.from([Buffer.from('a=1&b=2')]), {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      url: '/cb?y=2',
    });
    const request = await callbackRequestFrom(stream);
    expect(request.body).toBe('a=1&b=2');
    expect(request.query).toEqual({ y: '2' });
  });

  it('encodes a parsed body again when the stream is gone', async () => {
    const json = await callbackRequestFrom({
      headers: { 'content-type': 'application/json' },
      body: { orderId: 'A', amount: '10' },
    });
    expect(json.body).toBe('{"orderId":"A","amount":"10"}');

    const form = await callbackRequestFrom({
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: { a: '1', b: ['2', '3'] },
    });
    expect(form.body).toBe('a=1&b=2&b=3');
    expect(form.query).toEqual({});
  });
});

describe('acknowledge', () => {
  it('writes to a Node or Express response', () => {
    const headers: Record<string, string> = {};
    const response = {
      statusCode: 0,
      body: undefined as string | undefined,
      setHeader: (name: string, value: string) => (headers[name] = value),
      end(body?: string) {
        this.body = body;
      },
    };
    acknowledge(response, { acknowledgement: new Acknowledgement({ body: 'success' }) });
    expect(response).toMatchObject({ statusCode: 200, body: 'success' });
    expect(headers).toEqual({ 'Content-Type': 'text/plain' });
  });

  it('writes to a Fastify reply, with an empty 200 by default', () => {
    const calls: unknown[][] = [];
    const reply: FastifyReplyLike = {
      raw: {},
      code: (status) => calls.push(['code', status]),
      header: (name, value) => calls.push(['header', name, value]),
      send: (body) => calls.push(['send', body]),
    };
    acknowledge(reply);
    expect(calls).toEqual([
      ['code', 200],
      ['header', 'Content-Type', 'text/plain'],
      ['send', ''],
    ]);
  });
});
