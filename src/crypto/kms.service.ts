import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { AppConfig, CONFIG_TOKEN } from '@/config/configuration';

export interface EncryptedBlob {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

/**
 * Application-level envelope encryption seam.
 *
 * In production this would be a thin adapter over AWS KMS / GCP KMS /
 * HashiCorp Vault Transit / an HSM-backed gateway; the encryption key would
 * never live in process memory and PCI scope would shrink to whatever the
 * KMS provider attests. The interface stays the same.
 */
export abstract class KmsService {
  abstract encrypt(plaintext: string): EncryptedBlob;
  abstract decrypt(blob: EncryptedBlob): string;
  abstract get keyVersion(): number;
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

@Injectable()
export class EnvKmsService extends KmsService {
  private readonly key: Buffer;
  readonly keyVersion: number;

  constructor(@Inject(CONFIG_TOKEN) config: AppConfig) {
    super();
    this.key = Buffer.from(config.cardEncryption.keyBase64, 'base64');
    if (this.key.length !== 32) {
      throw new Error('CARD_ENCRYPTION_KEY must be 32 bytes (AES-256)');
    }
    this.keyVersion = config.cardEncryption.keyVersion;
  }

  encrypt(plaintext: string): EncryptedBlob {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return { ciphertext, iv, authTag, keyVersion: this.keyVersion };
  }

  decrypt(blob: EncryptedBlob): string {
    if (blob.keyVersion !== this.keyVersion) {
      throw new Error(
        `Key version mismatch: blob=${blob.keyVersion} current=${this.keyVersion}. Add a key-rotation registry to support multiple versions.`,
      );
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, blob.iv);
    decipher.setAuthTag(blob.authTag);
    const plaintext = Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  }
}
