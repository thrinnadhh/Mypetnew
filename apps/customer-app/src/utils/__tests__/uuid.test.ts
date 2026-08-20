import { isUuid } from '../uuid';

describe('UUID route identity validation', () => {
  it.each([
    '461baa50-337f-3482-5e30-983c03fa367f',
    '919d1226-20d4-6a9b-bf3d-fcd6944c8840',
    '123e4567-e89b-42d3-a456-426614174000',
  ])('accepts backend UUID identity %s regardless of version and variant bits', (value) => {
    expect(isUuid(value)).toBe(true);
  });

  it.each([
    '',
    'not-a-uuid',
    '461baa50-337f-3482-5e30-983c03fa367',
    '461baa50-337f-3482-5e30-983c03fa367f/slots',
    '461baa50-337f-3482-5e30-983c03fa367f?admin=true',
  ])('rejects malformed route identity %s', (value) => {
    expect(isUuid(value)).toBe(false);
  });
});
