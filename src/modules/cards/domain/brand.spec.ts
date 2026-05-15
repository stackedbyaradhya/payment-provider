import { detectBrand, isPlausibleLength } from './brand';

describe('detectBrand', () => {
  it('detects Visa (16 digits)', () => {
    expect(detectBrand('4242424242424242')).toBe('VISA');
  });
  it('detects Mastercard (5x range)', () => {
    expect(detectBrand('5555555555554444')).toBe('MASTERCARD');
  });
  it('detects Mastercard (2x range, 2221-2720)', () => {
    expect(detectBrand('2223000048400011')).toBe('MASTERCARD');
  });
  it('detects Amex (15 digits, 34/37)', () => {
    expect(detectBrand('378282246310005')).toBe('AMEX');
  });
  it('detects Discover', () => {
    expect(detectBrand('6011111111111117')).toBe('DISCOVER');
  });
  it('returns UNKNOWN when nothing matches', () => {
    expect(detectBrand('1234567812345670')).toBe('UNKNOWN');
  });
  it('returns UNKNOWN when length is wrong for the brand', () => {
    expect(detectBrand('424242424242')).toBe('UNKNOWN');
  });
});

describe('isPlausibleLength', () => {
  it('accepts 12-19 digit inputs', () => {
    expect(isPlausibleLength('123456789012')).toBe(true);
    expect(isPlausibleLength('1234567890123456789')).toBe(true);
  });
  it('rejects too-short or too-long', () => {
    expect(isPlausibleLength('12345678901')).toBe(false);
    expect(isPlausibleLength('12345678901234567890')).toBe(false);
  });
});
