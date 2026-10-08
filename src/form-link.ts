import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

import { FormPayment } from '@laranex/myanmar-payments';

const INFO = 'laranex/nestjs-myanmar-payments form link v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

interface SealedForm {
  o: string;
  a: string;
  f: [string, string][];
  e: string;
  x: number;
}

/**
 * Encrypts a {@link FormPayment} into a URL-safe token with AES-256-GCM, and back. The token
 * carries its expiry, so a tampered, foreign or expired token opens to `undefined`.
 *
 * @internal
 */
export class FormLinkCipher {
  private readonly key: Buffer;

  constructor(secret: string | Uint8Array) {
    const material = typeof secret === 'string' ? decodeSecret(secret) : Buffer.from(secret);
    this.key = Buffer.from(hkdfSync('sha256', material, Buffer.alloc(0), INFO, 32));
  }

  /** Encrypts `form`, valid until `expiresAt` (unix seconds). */
  seal(form: FormPayment, expiresAt: number): string {
    const sealed: SealedForm = {
      o: form.orderId,
      a: form.action,
      f: form.fields.map((field) => [field.name, field.value]),
      e: form.enctype,
      x: expiresAt,
    };
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(sealed), 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString('base64url');
  }

  /** The form behind `token`, or `undefined` when it is invalid or expired at `now` (unix seconds). */
  open(token: string, now: number): FormPayment | undefined {
    const data = Buffer.from(token, 'base64url');
    if (data.length <= IV_BYTES + TAG_BYTES) {
      return undefined;
    }
    let sealed: unknown;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, IV_BYTES));
      decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
      const json = Buffer.concat([
        decipher.update(data.subarray(IV_BYTES, data.length - TAG_BYTES)),
        decipher.final(),
      ]).toString('utf8');
      sealed = JSON.parse(json);
    } catch {
      return undefined;
    }
    if (!isSealedForm(sealed) || sealed.x < now) {
      return undefined;
    }
    return new FormPayment({
      orderId: sealed.o,
      action: sealed.a,
      fields: sealed.f.map(([name, value]) => ({ name, value })),
      enctype: sealed.e,
    });
  }
}

function decodeSecret(secret: string): Buffer {
  return secret.startsWith('base64:')
    ? Buffer.from(secret.slice('base64:'.length), 'base64')
    : Buffer.from(secret, 'utf8');
}

function isSealedForm(value: unknown): value is SealedForm {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const form = value as Record<string, unknown>;
  return (
    typeof form.o === 'string' &&
    typeof form.a === 'string' &&
    typeof form.e === 'string' &&
    typeof form.x === 'number' &&
    Array.isArray(form.f) &&
    form.f.every(
      (field) =>
        Array.isArray(field) &&
        field.length === 2 &&
        typeof field[0] === 'string' &&
        typeof field[1] === 'string',
    )
  );
}
