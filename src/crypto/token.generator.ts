import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

/**
 * Opaque, unguessable identifiers for things we hand out to clients.
 * Tokens are intentionally not derived from PAN: there is no way to recover
 * the underlying card material from a token.
 */
@Injectable()
export class TokenGenerator {
  cardToken(): string {
    return `tok_${urlSafe(32)}`;
  }
  refreshToken(): string {
    return urlSafe(48);
  }
}

function urlSafe(byteLength: number): string {
  return randomBytes(byteLength)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
