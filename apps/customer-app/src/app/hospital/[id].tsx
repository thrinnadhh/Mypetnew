import { useLocalSearchParams } from 'expo-router';
import React, { useMemo } from 'react';

import { ProviderCompositionTemplate, type ProviderCompositionData } from '@/components/care/ProviderCompositionTemplate';

const HOSPITALS_DATA: Record<string, ProviderCompositionData> = {
  'city-pet-hospital': {
    id: 'city-pet-hospital',
    name: 'City Pet Hospital Tirupati',
    type: 'VET_HOSPITAL',
    tagline: '24/7 Emergency & Advanced Veterinary ICU',
    address: 'AIR Bypass Road, Near Rama Chandra Nagar, Tirupati, AP',
    phone: '08772244888',
    rating: '4.9 ★ (180+ reviews)',
    reviewCount: 184,
    heroImageUrl: 'https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?auto=format&fit=crop&w=800&q=80',
    distanceKm: 1.8,
    operatingHours: '24 Hours Open (Emergency ICU)',
    emergencyCare: true,
    services: [
      { name: 'General OPD Consultation', desc: 'Comprehensive health checkup, physical exam & diagnosis', fee: 499, duration: '20 mins' },
      { name: 'Emergency Trauma & ICU Care', desc: 'Critical care, oxygen support, IV fluids & monitoring', fee: 799, duration: 'Immediate' },
      { name: 'Pet Vaccination & Deworming', desc: 'Core DHPPi/Rabies vaccine administration & deworming', fee: 350, duration: '15 mins' },
      { name: 'Blood Diagnostic & Ultrasound Lab', desc: 'Complete blood count, organ profile & digital X-ray', fee: 1200, duration: '45 mins' },
    ],
    facilities: ['24/7 Emergency ICU', 'In-house Pathology Lab', 'Pet Pharmacy', 'Digital X-Ray & Ultrasound', 'Surgical Operation Theater'],
    staffRoster: [
      { name: 'Dr. K. Srinivas, DVM', role: 'Chief Veterinary Surgeon', experience: '12+ Yrs Exp' },
      { name: 'Dr. Ananya Rao, MVSc', role: 'Pet Dermatologist & Physician', experience: '8+ Yrs Exp' },
    ],
  },
  'petcare-wellness': {
    id: 'petcare-wellness',
    name: 'PetCare & Wellness Hospital',
    type: 'VET_HOSPITAL',
    tagline: 'Multi-Specialty Veterinary Clinic & Surgery',
    address: 'KT Road, Near Royal Nagar, Tirupati, AP',
    phone: '08772255999',
    rating: '4.8 ★ (120+ reviews)',
    reviewCount: 124,
    heroImageUrl: 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=800&q=80',
    distanceKm: 3.2,
    operatingHours: '08:00 AM - 09:00 PM (Mon - Sun)',
    emergencyCare: false,
    services: [
      { name: 'General OPD Consultation', desc: 'Routine health examination & prescription', fee: 450, duration: '20 mins' },
      { name: 'Dental Cleaning & Polishing', desc: 'Ultrasonic tartar removal & oral hygiene', fee: 999, duration: '40 mins' },
      { name: 'Microchipping & Pet Passport', desc: 'ISO standard microchip injection & record card', fee: 650, duration: '15 mins' },
    ],
    facilities: ['Outpatient Clinic', 'Pet Dental Unit', 'Isolation Ward', 'Vaccine Storage'],
    staffRoster: [
      { name: 'Dr. M. V. Reddy, DVM', role: 'Senior Veterinary Officer', experience: '15+ Yrs Exp' },
      { name: 'Dr. Priya Sharma, MVSc', role: 'Feline Specialist', experience: '6+ Yrs Exp' },
    ],
  },
};

export default function HospitalProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const provider = useMemo(() => {
    const key = id ?? 'city-pet-hospital';
    return HOSPITALS_DATA[key] ?? HOSPITALS_DATA['city-pet-hospital'];
  }, [id]);

  return <ProviderCompositionTemplate provider={provider} />;
}
