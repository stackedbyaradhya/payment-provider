export type CardBrand = 'VISA' | 'MASTERCARD' | 'AMEX' | 'DISCOVER' | 'UNKNOWN';

interface BrandRule {
  brand: CardBrand;
  pattern: RegExp;
  lengths: ReadonlySet<number>;
}

const RULES: ReadonlyArray<BrandRule> = [
  { brand: 'VISA', pattern: /^4/, lengths: new Set([13, 16, 19]) },
  { brand: 'MASTERCARD', pattern: /^(5[1-5]|2[2-7])/, lengths: new Set([16]) },
  { brand: 'AMEX', pattern: /^(34|37)/, lengths: new Set([15]) },
  { brand: 'DISCOVER', pattern: /^(6011|65|64[4-9]|622)/, lengths: new Set([16, 19]) },
];

export function detectBrand(pan: string): CardBrand {
  for (const rule of RULES) {
    if (rule.pattern.test(pan) && rule.lengths.has(pan.length)) {
      return rule.brand;
    }
  }
  return 'UNKNOWN';
}

export function isPlausibleLength(pan: string): boolean {
  return pan.length >= 12 && pan.length <= 19;
}
