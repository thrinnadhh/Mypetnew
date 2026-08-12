export interface DemoProviderFixture {
  id: string;
  name: string;
  description: string;
  distanceKm: number;
  rating: number;
  ratingCount: number;
}

export interface DemoAppointmentSlotFixture {
  id: string;
  providerId: string;
  offeringId: string;
  serviceName: string;
  startTime: string;
  endTime: string;
  price: number;
}

export const DEMO_MEDIA = {
  food: 'https://images.unsplash.com/photo-1589924691995-400dc9ecc119?w=900&auto=format&fit=crop&q=82',
  nutrition: 'https://images.unsplash.com/photo-1568640347023-a616a30bc3bd?w=900&auto=format&fit=crop&q=82',
  furniture: 'https://images.unsplash.com/photo-1541599540903-216a46ca1dc0?w=900&auto=format&fit=crop&q=82',
  toys: 'https://images.unsplash.com/photo-1576201836106-db1758fd1c97?w=900&auto=format&fit=crop&q=82',
  treats: 'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?w=900&auto=format&fit=crop&q=82',
  travel: 'https://images.unsplash.com/photo-1601758124510-52d02ddb7cbd?w=900&auto=format&fit=crop&q=82',
  grooming: 'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?w=1200&auto=format&fit=crop&q=82',
  hospital: 'https://images.unsplash.com/photo-1601758124510-52d02ddb7cbd?w=1200&auto=format&fit=crop&q=82',
  store: 'https://images.unsplash.com/photo-1601758124510-52d02ddb7cbd?w=1200&auto=format&fit=crop&q=82',
  guide: 'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?w=900&auto=format&fit=crop&q=82',
} as const;

export const DEMO_BANNER_IMAGES = [
  DEMO_MEDIA.food,
  DEMO_MEDIA.grooming,
  DEMO_MEDIA.hospital,
  DEMO_MEDIA.toys,
  DEMO_MEDIA.travel,
] as const;

export const DEMO_PROVIDER_FIXTURES = {
  PET_STORE: [
    {
      id: 'the-healthy-hound',
      name: 'The Healthy Hound Nutrition Hub',
      description: 'Premium dog and cat food, supplements and diet guidance · Korlagunta, Tirupati',
      distanceKm: 1.2,
      rating: 4.9,
      ratingCount: 340,
    },
    {
      id: 'the-posh-paws',
      name: 'The Posh Paws Superstore',
      description: 'Toys, beds, travel gear, treats and everyday pet essentials · Air Bypass Road, Tirupati',
      distanceKm: 2.1,
      rating: 4.8,
      ratingCount: 218,
    },
    {
      id: 'petcare-pharmacy',
      name: 'PetCare Pharmacy & Essentials',
      description: 'Wellness supplies, hygiene products and veterinarian-recommended essentials · Tirupati',
      distanceKm: 2.8,
      rating: 4.7,
      ratingCount: 154,
    },
  ],
  GROOMER: [
    {
      id: 'demo-groomer-paws-bubbles',
      name: 'Paws & Bubbles Spa',
      description: 'Full spa, breed styling, hygiene baths and de-shedding · Tirupati',
      distanceKm: 0.8,
      rating: 4.8,
      ratingCount: 196,
    },
    {
      id: 'demo-groomer-room',
      name: 'The Grooming Room',
      description: 'Professional grooming, puppy first-spa and coat care · Tirupati',
      distanceKm: 1.9,
      rating: 4.6,
      ratingCount: 126,
    },
  ],
  VET_HOSPITAL: [
    {
      id: 'demo-vet-city-pet',
      name: 'City Pet Hospital',
      description: 'General OPD, vaccinations, diagnostics and emergency pet care · Tirupati',
      distanceKm: 1.2,
      rating: 4.9,
      ratingCount: 412,
    },
    {
      id: 'demo-vet-wellness',
      name: 'PetCare Wellness Center',
      description: 'Preventive care, dermatology and senior-pet consultations · Tirupati',
      distanceKm: 2.5,
      rating: 4.7,
      ratingCount: 238,
    },
  ],
} as const;

function futureDate(daysAhead: number, hour: number, minute = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function formatSlot(date: Date): string {
  return date.toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatEnd(date: Date): string {
  return date.toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export function getDemoAppointmentSlots(providerId: string): DemoAppointmentSlotFixture[] {
  const grooming = providerId.includes('groomer');
  const definitions = grooming
    ? [
        ['Full Spa & Breed Haircut', 1299, 10, 60],
        ['Hygiene Bath & Tick Protection', 699, 14, 45],
        ['De-Shedding Treatment', 899, 17, 45],
      ] as const
    : [
        ['General OPD Consultation', 499, 10, 30],
        ['Vaccination Consultation', 399, 12, 30],
        ['Skin & Coat Consultation', 699, 16, 40],
      ] as const;

  return definitions.map(([serviceName, price, hour, duration], index) => {
    const start = futureDate(index + 1, hour);
    const end = new Date(start.getTime() + duration * 60_000);
    return {
      id: `demo-slot-${providerId}-${index + 1}`,
      providerId,
      offeringId: `demo-offering-${providerId}-${index + 1}`,
      serviceName,
      startTime: formatSlot(start),
      endTime: formatEnd(end),
      price,
    };
  });
}

export function demoShopImage(providerId: string): string {
  if (providerId === 'the-healthy-hound') return DEMO_MEDIA.food;
  if (providerId === 'the-posh-paws') return DEMO_MEDIA.toys;
  if (providerId === 'petcare-pharmacy') return DEMO_MEDIA.hospital;
  return DEMO_MEDIA.store;
}
