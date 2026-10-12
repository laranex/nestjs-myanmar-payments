import {
  Acknowledgement,
  CallbackRequest,
  PaymentError,
  type NodeRequestLike,
  type PaymentCallback,
  type ServerResponseLike,
} from '@laranex/myanmar-payments';
import { PayloadTooLargeException } from '@nestjs/common';

/**
 * The most callback body bytes {@link callbackRequestFrom} accepts: 64 KiB, far above any gateway
 * callback (the SDK's own `fromNodeRequest` limit).
 */
export const MAX_CALLBACK_BODY_BYTES = 64 * 1024;

/**
 * The parts of an Express request or a Fastify request (as Nest passes them to `@Req()`) this
 * package reads.
 */
export interface NestRequestLike {
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  url?: string | undefined;
  /** Express's full URL, when the app is mounted under a path. */
  originalUrl?: string | undefined;
  /** The exact body bytes, set by Nest when the app is created with `rawBody: true`. */
  rawBody?: unknown;
  /** The body parsed by Express's or Fastify's body parser. */
  body?: unknown;
}

/** A Fastify reply, as Nest passes it to `@Res()`. */
export interface FastifyReplyLike {
  code(statusCode: number): unknown;
  header(name: string, value: string): unknown;
  send(payload?: string): unknown;
  /** The Node `ServerResponse` behind the reply. */
  raw: unknown;
}

/**
 * Builds the SDK's `CallbackRequest` from a Nest request on the Express or Fastify adapter.
 *
 * The body is, in order: the exact bytes Nest kept with `rawBody: true` (recommended), the stream
 * when no body parser read it (Express), or the parsed body encoded again as JSON or a form. The
 * last one verifies for every gateway but rewrites JSON numbers, so enable `rawBody: true` in
 * `NestFactory.create()` for callbacks. A body over {@link MAX_CALLBACK_BODY_BYTES} answers
 * `413 Payload Too Large`; the stream stops being read as soon as it passes the limit.
 */
export async function callbackRequestFrom(
  request: CallbackRequest | NestRequestLike,
): Promise<CallbackRequest> {
  if (request instanceof CallbackRequest) {
    return request;
  }
  if (isCallbackRequestLike(request)) {
    // A CallbackRequest from the other module format (ESM or CommonJS copy of the SDK). Its exact
    // bytes are carried across, so `rawBody` stays what the gateway sent.
    return CallbackRequest.from({
      body: request.rawBody instanceof Uint8Array ? request.rawBody : request.body,
      headers: request.headers,
      query: request.query,
    });
  }

  const query = new URL(request.originalUrl ?? request.url ?? '/', 'http://localhost').searchParams;
  const raw = rawBytes(request.rawBody);
  if (raw !== undefined) {
    return limited(CallbackRequest.from({ body: raw, headers: request.headers, query }));
  }

  // Express passes the Node request itself, whose stream is still unread when no body parser
  // matched. Fastify always reads the stream first, so only its parsed body is left.
  const declared = request.headers['content-length'];
  if (typeof declared === 'string' && Number(declared) > MAX_CALLBACK_BODY_BYTES) {
    throw tooLarge();
  }
  const stream = isAsyncIterable(request) ? request : undefined;
  const node: NodeRequestLike = {
    headers: request.headers,
    body: request.body,
    async *[Symbol.asyncIterator]() {
      // Without a stream, it was already consumed.
      let size = 0;
      for await (const chunk of stream ?? []) {
        size += typeof chunk === 'string' ? Buffer.byteLength(chunk) : (chunk as Uint8Array).length;
        if (size > MAX_CALLBACK_BODY_BYTES) {
          throw tooLarge();
        }
        yield chunk;
      }
    },
  };
  let parsed: CallbackRequest;
  try {
    parsed = await CallbackRequest.fromNodeRequest(node);
  } catch (error) {
    // Newer SDKs cap the body themselves; their only PaymentError here is an oversized body.
    throw error instanceof PaymentError ? tooLarge() : error;
  }
  return limited(CallbackRequest.from({ body: parsed.body, headers: parsed.headers, query }));
}

/**
 * Sends the response the gateway expects after delivering `callback` (e.g. KBZ Pay's plain
 * `success`), on an Express response or a Fastify reply injected with `@Res()`. Without a
 * callback it sends an empty `200`.
 */
export function acknowledge(
  response: FastifyReplyLike | ServerResponseLike,
  callback?: Pick<PaymentCallback, 'acknowledgement'>,
): void {
  const acknowledgement = callback?.acknowledgement ?? Acknowledgement.default();
  if (isFastifyReply(response)) {
    response.code(acknowledgement.status);
    for (const [name, value] of Object.entries(acknowledgement.headers)) {
      response.header(name, value);
    }
    response.send(acknowledgement.body);
    return;
  }
  acknowledgement.send(response);
}

/** Whether `value` is a verified `PaymentCallback` (also across ESM and CommonJS copies). @internal */
export function isPaymentCallback(value: unknown): value is PaymentCallback {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const callback = value as Partial<Record<keyof PaymentCallback, unknown>>;
  const acknowledgement = callback.acknowledgement as Partial<Acknowledgement> | null | undefined;
  return (
    typeof callback.orderId === 'string' &&
    typeof acknowledgement === 'object' &&
    acknowledgement !== null &&
    typeof acknowledgement.status === 'number' &&
    typeof acknowledgement.body === 'string'
  );
}

function isCallbackRequestLike(
  value: object,
): value is Pick<CallbackRequest, 'body' | 'headers' | 'query'> &
  Partial<Pick<CallbackRequest, 'rawBody'>> {
  const request = value as Partial<Record<keyof CallbackRequest, unknown>>;
  return (
    typeof request.body === 'string' &&
    typeof request.query === 'object' &&
    request.query !== null &&
    typeof request.parsedBody === 'function'
  );
}

function limited(request: CallbackRequest): CallbackRequest {
  if (request.rawBody.length > MAX_CALLBACK_BODY_BYTES) {
    throw tooLarge();
  }
  return request;
}

function tooLarge(): PayloadTooLargeException {
  return new PayloadTooLargeException(
    `The callback request body is larger than ${MAX_CALLBACK_BODY_BYTES} bytes.`,
  );
}

function rawBytes(value: unknown): string | Uint8Array | undefined {
  return typeof value === 'string' || value instanceof Uint8Array ? value : undefined;
}

function isAsyncIterable(value: object): value is NestRequestLike & NodeRequestLike {
  return Symbol.asyncIterator in value;
}

function isFastifyReply(value: FastifyReplyLike | ServerResponseLike): value is FastifyReplyLike {
  const reply = value as Partial<FastifyReplyLike>;
  return typeof reply.code === 'function' && typeof reply.send === 'function' && 'raw' in reply;
}
