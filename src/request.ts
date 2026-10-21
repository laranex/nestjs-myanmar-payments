import {
  Acknowledgement,
  CallbackRequest,
  PaymentError,
  type NodeRequestLike,
  type PaymentCallback,
  type ServerResponseLike,
} from '@laranex/myanmar-payments';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

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
  /**
   * `http` or `https`, as the framework resolves it: `X-Forwarded-Proto` counts only from a proxy
   * the app trusts (Express `trust proxy`, Fastify `trustProxy`).
   */
  protocol?: string | undefined;
  /**
   * The host name, as the framework resolves it: `X-Forwarded-Host` counts only from a proxy the
   * app trusts.
   */
  hostname?: string | undefined;
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
 * The body is, in order: the exact bytes Nest kept with `rawBody: true` (required for JSON
 * callbacks), the stream when no body parser read it (Express), or a parsed form body encoded
 * again (CyberSource). A parsed JSON body is never encoded again, since that would rewrite its
 * number text and break the signature: it answers `400 Bad Request` asking for `rawBody: true` in
 * `NestFactory.create()`. A body over {@link MAX_CALLBACK_BODY_BYTES} answers
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
  let streamed = 0;
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
        streamed = size;
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
  if (streamed === 0 && isParsedJson(request.body, parsed.headers['content-type'])) {
    throw new BadRequestException(
      'Enable rawBody: true in NestFactory.create() to verify JSON callbacks.',
    );
  }
  return limited(CallbackRequest.from({ body: parsed.body, headers: parsed.headers, query }));
}

/**
 * The URL a request was sent to, without its query string: the protocol and host name the framework
 * resolves (so `X-Forwarded-Proto` and `X-Forwarded-Host` count only from a proxy the app trusts:
 * Express `trust proxy`, Fastify `trustProxy`), the port of the matching `Host` (or trusted
 * `X-Forwarded-Host`) value, and the path as received (Express `originalUrl`, so a mounted app keeps
 * its mount path). Wave Pay Mini App callbacks are verified against it. Throws when the request has
 * no host.
 */
export function callbackUrlFrom(request: NestRequestLike): string {
  const hostname = typeof request.hostname === 'string' ? request.hostname.trim() : '';
  if (hostname === '') {
    throw new Error(
      'The request has no host to build the callback URL from; pass the callback URL to the gateway yourself.',
    );
  }
  const protocol =
    typeof request.protocol === 'string' && request.protocol.trim() !== ''
      ? request.protocol.trim().toLowerCase().replace(/:$/, '')
      : 'http';
  return `${protocol}://${authority(request, hostname)}${requestPath(request)}`;
}

/**
 * The host name with its port. Fastify 4 keeps the port in `hostname`; Express and Fastify 5 drop
 * it, so it comes from the `Host` value the host name was read from, else from the matching
 * `X-Forwarded-Host` entry (only used when the framework trusted it, since the host name differs).
 */
function authority(request: NestRequestLike, hostname: string): string {
  if (hostPort(hostname) !== '') {
    return hostname;
  }
  const forwarded = request.headers['x-forwarded-host'];
  const candidates = [
    ...headerValues(request.headers.host),
    ...headerValues(forwarded).flatMap((value) => value.split(',')),
  ]
    .map((value) => value.trim())
    .filter((value) => value !== '');
  const wanted = hostname.toLowerCase();
  const match = candidates.find((value) => hostPart(value).toLowerCase() === wanted);
  return match === undefined ? hostname : `${hostname}${hostPort(match)}`;
}

/** The host part of `host[:port]`, keeping an IPv6 literal's brackets. */
function hostPart(value: string): string {
  if (value.startsWith('[')) {
    return value.slice(0, value.indexOf(']') + 1);
  }
  const index = value.indexOf(':');
  return index === -1 ? value : value.slice(0, index);
}

/** The `:port` of `host[:port]`, or `''`. */
function hostPort(value: string): string {
  return /(:\d+)$/.exec(value.slice(hostPart(value).length))?.[1] ?? '';
}

function headerValues(value: string | readonly string[] | undefined): string[] {
  return value === undefined ? [] : typeof value === 'string' ? [value] : [...value];
}

/** The request path as received, without the query string or fragment. */
function requestPath(request: NestRequestLike): string {
  const target = request.originalUrl ?? request.url ?? '/';
  const path = target.replace(/[?#][^]*$/, '');
  if (path.startsWith('/')) {
    return path;
  }
  // An absolute-form request target (`http://host/path`).
  try {
    return new URL(path).pathname;
  } catch {
    return '/';
  }
}

/** Whether `request` is the SDK's `CallbackRequest` (also across ESM and CommonJS copies). @internal */
export function isCallbackRequest(
  request: CallbackRequest | NestRequestLike,
): request is CallbackRequest {
  return request instanceof CallbackRequest || isCallbackRequestLike(request);
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

/**
 * Whether the SDK encoded `body` again as JSON: a parsed object sent as JSON, or a non-empty one
 * of any type but a form (forms are encoded again as a form, which keeps every value's text).
 */
function isParsedJson(body: unknown, contentType: string | undefined): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return false;
  }
  const type = (contentType ?? '').toLowerCase();
  return type.includes('json') || (!type.includes('urlencoded') && Object.keys(body).length > 0);
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
