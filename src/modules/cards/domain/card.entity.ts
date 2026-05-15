import { CardBrand } from './brand';

/**
 * Plain domain representation of a saved card. No Prisma types, no Nest
 * imports - this is what the service layer consumes.
 */
export interface Card {
  id: string;
  userId: string;
  token: string;
  brand: CardBrand;
  last4: string;
  expMonth: number;
  expYear: number;
  cardholderName: string;
  createdAt: Date;
  deletedAt: Date | null;
}

export function isExpired(
  card: Pick<Card, 'expMonth' | 'expYear'>,
  now: Date = new Date(),
): boolean {
  const yearNow = now.getUTCFullYear();
  const monthNow = now.getUTCMonth() + 1;
  if (card.expYear < yearNow) return true;
  if (card.expYear === yearNow && card.expMonth < monthNow) return true;
  return false;
}
