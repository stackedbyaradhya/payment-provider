import { isExpired } from './card.entity';

describe('isExpired', () => {
  const now = new Date('2026-05-15T00:00:00Z');

  it('treats a previous year as expired', () => {
    expect(isExpired({ expMonth: 12, expYear: 2025 }, now)).toBe(true);
  });
  it('treats a future year as not expired', () => {
    expect(isExpired({ expMonth: 1, expYear: 2027 }, now)).toBe(false);
  });
  it('treats current year + previous month as expired', () => {
    expect(isExpired({ expMonth: 4, expYear: 2026 }, now)).toBe(true);
  });
  it('treats current month / year as not expired', () => {
    expect(isExpired({ expMonth: 5, expYear: 2026 }, now)).toBe(false);
  });
});
