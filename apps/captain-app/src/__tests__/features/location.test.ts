import {
  getCurrentCaptainLocation,
  isValidCoordinate,
} from '../../features/location/location-service';

describe('Location Service and Validation', () => {
  it('validates correct latitude and longitude ranges', () => {
    expect(isValidCoordinate(13.6288, 79.4192)).toBe(true);
    expect(isValidCoordinate(0, 0)).toBe(true);
    expect(isValidCoordinate(90, 180)).toBe(true);
    expect(isValidCoordinate(-90, -180)).toBe(true);
  });

  it('rejects invalid or out of range coordinates', () => {
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(-91, 0)).toBe(false);
    expect(isValidCoordinate(0, 181)).toBe(false);
    expect(isValidCoordinate(0, -181)).toBe(false);
    expect(isValidCoordinate(NaN as any, 50)).toBe(false);
    expect(isValidCoordinate(50, NaN as any)).toBe(false);
  });

  it('retrieves current location from native Location mock', async () => {
    const loc = await getCurrentCaptainLocation();
    expect(loc.latitude).toBeDefined();
    expect(loc.longitude).toBeDefined();
    expect(isValidCoordinate(loc.latitude, loc.longitude)).toBe(true);
  });
});
