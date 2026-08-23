import { sanitizeAddress, sanitizeCoordinates, sanitizePhone } from '../../../utils/privacy';

describe('Level 1: Privacy & Data Minimization Utility Tests', () => {
  it('masks coordinates to 2 decimal places in logs to protect captain privacy', () => {
    const masked = sanitizeCoordinates(13.628841, 79.419284);
    expect(masked).toBe('(lat: 13.62***, lon: 79.41***)');
    expect(masked).not.toContain('8841');
    expect(masked).not.toContain('9284');

    expect(sanitizeCoordinates(null, null)).toBe('[no coordinates]');
    expect(sanitizeCoordinates(undefined, undefined)).toBe('[no coordinates]');
  });

  it('masks customer phone numbers preserving country code and last 2 digits', () => {
    const phone = '+919876543210';
    const masked = sanitizePhone(phone);
    expect(masked).toBe('+919******10');
    expect(masked).not.toContain('8765432');

    expect(sanitizePhone('')).toBe('[no phone]');
    expect(sanitizePhone(null)).toBe('[no phone]');
  });

  it('masks customer address details preserving only the city and state context', () => {
    const address = 'Flat 402, Sunset Heights, 12th Main, Koramangala, Bengaluru';
    const masked = sanitizeAddress(address);
    expect(masked).toBe('***, Bengaluru');
    expect(masked).not.toContain('Flat 402');
    expect(masked).not.toContain('Sunset Heights');

    expect(sanitizeAddress('')).toBe('[no address]');
    expect(sanitizeAddress(null)).toBe('[no address]');
  });
});
