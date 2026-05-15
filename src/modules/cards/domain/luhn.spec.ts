import { isLuhnValid } from './luhn';

describe('isLuhnValid', () => {
  const validPans = [
    '4242424242424242', // Stripe test Visa
    '4000056655665556', // Stripe test Visa debit
    '5555555555554444', // Stripe test Mastercard
    '378282246310005', // Amex 15 digits
    '6011111111111117', // Discover
    '371449635398431', // Amex
  ];

  it.each(validPans)('accepts a known-good PAN: %s', (pan) => {
    expect(isLuhnValid(pan)).toBe(true);
  });

  it.each([
    '4242424242424243', // last digit off by one
    '0000000000000001',
    '1234567812345678',
  ])('rejects a known-bad PAN: %s', (pan) => {
    expect(isLuhnValid(pan)).toBe(false);
  });

  // A single '0' technically satisfies the Luhn checksum (sum is 0). The
  // separate `isPlausibleLength` check is what catches absurdly short input.
  it('treats a single "0" as Luhn-valid (length is enforced separately)', () => {
    expect(isLuhnValid('0')).toBe(true);
  });

  it.each(['', 'abcd1234abcd1234', '4242 4242 4242 4242', '4242-4242-4242-4242'])(
    'rejects non-digit input: %s',
    (input) => {
      expect(isLuhnValid(input)).toBe(false);
    },
  );
});
