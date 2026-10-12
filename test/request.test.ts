import { Readable } from 'node:stream';

import { Acknowledgement, CallbackRequest, PaymentError } from '@laranex/myanmar-payments';
import { PayloadTooLargeException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { acknowledge, callbackRequestFrom, type FastifyReplyLike } from '../src/index.js';
import { MAX_CALLBACK_BODY_BYTES } from '../src/request.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('callbackRequestFrom body limit', () => {
  const tooLarge = `The callback request body is larger than ${MAX_CALLBACK_BODY_BYTES} bytes.`;
  const big = 'a'.repeat(MAX_CALLBACK_BODY_BYTES + 1);

  it('is 64 KiB and accepts a body of exactly that size', async () => {
    expect(MAX_CALLBACK_BODY_BYTES).toBe(65536);
    const exact = await callbackRequestFrom({ headers: {}, rawBody: big.slice(1) });
    expect(exact.rawBody.length).toBe(MAX_CALLBACK_BODY_BYTES);
  });

  it('rejects an oversized raw body, declared length and parsed body with 413', async () => {
    for (const request of [
      { headers: {}, rawBody: Buffer.from(big) },
      { headers: { 'content-length': String(MAX_CALLBACK_BODY_BYTES + 1) }, body: {} },
      { headers: { 'content-type': 'application/json' }, body: { note: big } },
    ]) {
      const error = await callbackRequestFrom(request).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PayloadTooLargeException);
      expect((error as Error).message).toBe(tooLarge);
    }
  });

  it('stops reading a stream once it passes the limit', async () => {
    let pulled = 0;
    const stream = Object.assign(
      Readable.from(
        (function* () {
          for (;;) {
            pulled++;
            yield pulled % 2 === 0 ? 'a'.repeat(16 * 1024) : Buffer.alloc(16 * 1024);
          }
        })(),
      ),
      { headers: {}, url: '/' },
    );
    await expect(callbackRequestFrom(stream)).rejects.toThrow(PayloadTooLargeException);
    expect(pulled).toBeLessThan(10);
  });

  it("maps a newer SDK's own size error to 413 and passes other errors through", async () => {
    const spy = vi.spyOn(CallbackRequest, 'fromNodeRequest');
    spy.mockRejectedValueOnce(
      new PaymentError('The callback request body is larger than 1 bytes.'),
    );
    await expect(callbackRequestFrom({ headers: {}, body: {} })).rejects.toThrow(
      PayloadTooLargeException,
    );
    const failure = new Error('stream failed');
    spy.mockRejectedValueOnce(failure);
    await expect(callbackRequestFrom({ headers: {}, body: {} })).rejects.toBe(failure);
  });
});

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
    expect(copy.rawBody).toEqual(new TextEncoder().encode('a=1'));
  });

  it('keeps the exact bytes of a CallbackRequest from the other module format', async () => {
    const bytes = new Uint8Array([0x61, 0x3d, 0xff]);
    const original = CallbackRequest.from({ body: bytes });
    const foreign = {
      body: original.body,
      rawBody: original.rawBody,
      headers: original.headers,
      query: original.query,
      parsedBody: () => ({}),
    };
    const copy = await callbackRequestFrom(foreign as never);
    expect(copy.rawBody).toEqual(bytes);
    expect(copy.body).toBe(original.body);
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
    expect(request.rawBody).toEqual(new TextEncoder().encode('{"amount":1000.50}'));
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
