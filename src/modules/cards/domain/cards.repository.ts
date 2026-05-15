import { EncryptedBlob } from '@/crypto/kms.service';

import { CardBrand } from './brand';
import { Card } from './card.entity';

export interface NewCardInput {
  userId: string;
  token: string;
  brand: CardBrand;
  last4: string;
  expMonth: number;
  expYear: number;
  cardholderName: string;
  vault: EncryptedBlob;
}

export abstract class CardsRepository {
  abstract create(input: NewCardInput): Promise<Card>;
  abstract findByTokenForUser(userId: string, token: string): Promise<Card | null>;
  abstract listForUser(userId: string): Promise<Card[]>;
  abstract softDelete(userId: string, token: string): Promise<boolean>;
  /**
   * Returns the encrypted PAN blob for a card owned by the user. The cleartext
   * never crosses this boundary - callers decrypt via `KmsService`.
   * Returns `null` if the card does not exist or is soft-deleted.
   */
  abstract getVaultBlobForUser(userId: string, cardId: string): Promise<EncryptedBlob | null>;
}
