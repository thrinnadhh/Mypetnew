import { isUuid } from '../../utils/uuid';

describe('route UUID validation', () => {
  it('accepts canonical UUID values and rejects malformed external route parameters', () => {
    expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isUuid('../another-captain/job')).toBe(false);
    expect(isUuid('job-123')).toBe(false);
    expect(isUuid(['550e8400-e29b-41d4-a716-446655440000'])).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
