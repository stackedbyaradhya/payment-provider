/**
 * Luhn checksum (ISO/IEC 7812). Pure function, no Nest or I/O imports.
 * Accepts the raw PAN as a string of digits. Length validation is done
 * separately to keep this single-responsibility.
 */
export function isLuhnValid(pan: string): boolean {
  if (!/^\d+$/.test(pan)) return false;
  let sum = 0;
  let alternate = false;
  for (let i = pan.length - 1; i >= 0; i--) {
    let digit = pan.charCodeAt(i) - 48;
    if (alternate) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}
