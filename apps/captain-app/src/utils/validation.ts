/**
 * Validation utilities for phone numbers, OTPs, and Indian documents/PIN codes.
 */

export function sanitizeIndianMobile(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length === 12) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  return input.trim();
}

export function isValidIndianMobile(input: string): boolean {
  const digits = input.replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length === 12) {
    const rawTen = digits.slice(2);
    return /^[6-9]\d{9}$/.test(rawTen);
  }
  return /^[6-9]\d{9}$/.test(digits);
}

export function isValidPinCode(pincode: string): boolean {
  const digits = pincode.replace(/\D/g, '');
  return /^\d{6}$/.test(digits);
}

export function isValidIfsc(ifsc: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase());
}
