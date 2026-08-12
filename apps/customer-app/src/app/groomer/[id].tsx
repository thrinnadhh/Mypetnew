import { useLocalSearchParams } from 'expo-router';
import React, { useMemo } from 'react';

import { ProviderCompositionTemplate, type ProviderCompositionData } from '@/components/care/ProviderCompositionTemplate';

const GROOMERS_DATA: Record<string, ProviderCompositionData> = {
  'paws-bubbles-spa': {
    id: 'paws-bubbles-spa',
    name: 'Paws & Bubbles Spa',
    type: 'GROOMING_CENTER',
    tagline: 'Luxury Pet Spa & Grooming Salon',
    address: 'Tilak Road, Near Mahati Auditorium, Tirupati, AP',
    phone: '08772277111',
    rating: '4.9 ★ (145+ reviews)',
    reviewCount: 145,
    heroImageUrl: 'https://images.unsplash.com/photo-1516734212186-a967f81ad0d7?auto=format&fit=crop&w=800&q=80',
    distanceKm: 2.1,
    operatingHours: '09:00 AM - 07:30 PM (Tue - Sun)',
    emergencyCare: false,
    services: [
      { name: 'Full Grooming & Spa Bath Package', desc: 'Warm bath, blow dry, haircut, nail trimming, ear cleaning & paw balm', fee: 1299, duration: '60 mins' },
      { name: 'Basic Hygiene Bath & Trim', desc: 'Anti-tick bath, sanitary trim, paw massage & nail buffing', fee: 699, duration: '40 mins' },
      { name: 'Puppy First Bath Experience', desc: 'Gentle tearless bath, fluff dry, paw balm & treat cup', fee: 499, duration: '30 mins' },
    ],
    facilities: ['Hydromassage Tubs', 'Breed Styling Specialists', 'Stress-free Quiet Drying', 'Medicated Skin Therapy Baths'],
    staffRoster: [
      { name: 'Maya R.', role: 'Senior Master Groomer', experience: '7+ Yrs Exp' },
      { name: 'Suresh K.', role: 'Certified Pet Stylist', experience: '5+ Yrs Exp' },
    ],
  },
  'fluffy-tails': {
    id: 'fluffy-tails',
    name: 'Fluffy Tails Grooming Salon',
    type: 'GROOMING_CENTER',
    tagline: 'Professional Pet Styling & Medicated Baths',
    address: 'Gandhi Road, Opposite Municipal Office, Tirupati, AP',
    phone: '08772288222',
    rating: '4.7 ★ (98+ reviews)',
    reviewCount: 98,
    heroImageUrl: 'https://images.unsplash.com/photo-1535294435445-d7249524ef2e?auto=format&fit=crop&w=800&q=80',
    distanceKm: 4.0,
    operatingHours: '09:30 AM - 08:00 PM (Daily)',
    emergencyCare: false,
    services: [
      { name: 'De-Shedding & Undercoat Furminator', desc: 'Deep coat de-shedding treatment reducing 90% loose fur', fee: 899, duration: '45 mins' },
      { name: 'Cat Grooming & Lion Cut Package', desc: 'Waterless dry bath, dematting, nail clipping & lion cut', fee: 1199, duration: '50 mins' },
    ],
    facilities: ['Sanitized Grooming Tables', 'Organic Shampoos', 'Cat-Friendly Private Studio'],
    staffRoster: [
      { name: 'Rohan V.', role: 'Feline & Canine Stylist', experience: '6+ Yrs Exp' },
    ],
  },
};

export default function GroomerProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const provider = useMemo(() => {
    const key = id ?? 'paws-bubbles-spa';
    return GROOMERS_DATA[key] ?? GROOMERS_DATA['paws-bubbles-spa'];
  }, [id]);

  return <ProviderCompositionTemplate provider={provider} />;
}
