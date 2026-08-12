import {
  DEMO_BANNER_IMAGES,
  DEMO_MEDIA,
  DEMO_PROVIDER_FIXTURES,
  demoShopImage,
  getDemoAppointmentSlots,
} from '../demo-customer-data';

describe('demo customer marketplace fixtures', () => {
  it('keeps distinct media and providers for customer self-testing', () => {
    expect(DEMO_BANNER_IMAGES).toHaveLength(5);
    expect(new Set(DEMO_BANNER_IMAGES).size).toBeGreaterThan(2);
    expect(DEMO_PROVIDER_FIXTURES.PET_STORE).toHaveLength(3);
    expect(DEMO_PROVIDER_FIXTURES.GROOMER).toHaveLength(2);
    expect(DEMO_PROVIDER_FIXTURES.VET_HOSPITAL).toHaveLength(2);
    expect(DEMO_MEDIA.food).not.toBe(DEMO_MEDIA.toys);
    expect(DEMO_MEDIA.treats).not.toBe(DEMO_MEDIA.travel);
  });

  it('creates deterministic grooming and vet payment slots with positive prices', () => {
    const grooming = getDemoAppointmentSlots('demo-groomer-paws-bubbles');
    const vet = getDemoAppointmentSlots('demo-vet-city-pet');

    expect(grooming).toHaveLength(3);
    expect(grooming[0]).toMatchObject({
      serviceName: 'Full Spa & Breed Haircut',
      price: 1299,
    });
    expect(vet).toHaveLength(3);
    expect(vet[0]).toMatchObject({
      serviceName: 'General OPD Consultation',
      price: 499,
    });
    expect([...grooming, ...vet].every((slot) => slot.price > 0 && slot.startTime && slot.endTime)).toBe(true);
  });

  it('uses shop-specific images and a safe fallback', () => {
    expect(demoShopImage('the-healthy-hound')).toBe(DEMO_MEDIA.food);
    expect(demoShopImage('the-posh-paws')).toBe(DEMO_MEDIA.toys);
    expect(demoShopImage('petcare-pharmacy')).toBe(DEMO_MEDIA.hospital);
    expect(demoShopImage('unknown-store')).toBe(DEMO_MEDIA.store);
  });
});