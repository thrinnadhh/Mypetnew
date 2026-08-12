export type FoodForm = 'DRY' | 'WET';
export type PetLifeStage = 'PUPPY' | 'ADULT' | 'SENIOR';

export interface ProductVariant {
  id: string;
  name: string; // e.g. "3kg", "10kg", "Salmon Flavor"
  price: number;
  originalPrice?: number;
  inStock: boolean;
  stockCount: number;
}

export interface CommerceProduct {
  id: string;
  name: string;
  brand: string;
  category: string; // 'food', 'furniture', 'toys', 'travel', 'treats', 'waste', 'grooming', 'hospitals', 'vaccinations'
  foodForm?: FoodForm;
  lifeStages?: PetLifeStage[];
  price: number;
  originalPrice?: number;
  rating: string;
  reviewCount: number;
  deliveryTime: string;
  inStock: boolean;
  stockCount: number;
  imageUrl: string;
  galleryImages: string[];
  description: string;
  createdAt: string;
  isNewArrival: boolean;
  providerId: string;
  providerName: string;
  variants: ProductVariant[];
  specifications: Record<string, string>;
  ingredients?: string[];
  suitability: string[];
  sellerInfo: {
    id: string;
    name: string;
    address: string;
    verified: boolean;
    rating: string;
  };
  deliveryEstimate: string;
  returnPolicy: string;
}

export interface ShopProfileData {
  id: string;
  name: string;
  tagline: string;
  address: string;
  city: string;
  pincode: string;
  rating: string;
  reviewCount: number;
  deliveryEta: string;
  isVerified: boolean;
  heroImageUrl: string;
  openingHours: string;
  contactPhone: string;
  categories: string[];
  products: CommerceProduct[];
}

export const FEATURES = {
  ALLOW_LOYALTY: false,
};

export const SAMPLE_PRODUCTS: CommerceProduct[] = [
  // --- Food & Nutrition ---
  {
    id: 'p-food-1',
    name: 'Royal Canin Maxi Adult Dry Dog Food',
    brand: 'Royal Canin',
    category: 'food',
    foodForm: 'DRY',
    lifeStages: ['ADULT'],
    price: 2199,
    originalPrice: 2499,
    rating: '4.9 ★',
    reviewCount: 340,
    deliveryTime: '15-25 mins',
    inStock: true,
    stockCount: 45,
    imageUrl: 'https://images.unsplash.com/photo-1589924691995-400dc9ecc119?w=600&auto=format&fit=crop&q=80',
    galleryImages: [
      'https://images.unsplash.com/photo-1589924691995-400dc9ecc119?w=600&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1568640347023-a616a30bc3bd?w=600&auto=format&fit=crop&q=80',
    ],
    description: 'Tailored nutrition for large breed adult dogs (26-44kg). Supports joint health, optimal digestibility, and bone strength with enriched Omega-3 EPA/DHA.',
    createdAt: '2026-07-28T10:00:00Z',
    isNewArrival: true,
    providerId: 'the-healthy-hound',
    providerName: 'The Healthy Hound Nutrition Hub',
    variants: [
      { id: 'v-3kg', name: '3 kg Pack', price: 2199, originalPrice: 2499, inStock: true, stockCount: 30 },
      { id: 'v-10kg', name: '10 kg Value Pack', price: 5899, originalPrice: 6499, inStock: true, stockCount: 15 },
    ],
    specifications: {
      'Pet Type': 'Dog',
      'Life Stage': 'Adult (15 months - 5 years)',
      'Breed Size': 'Large (26kg - 44kg)',
      'Food Form': 'Dry Kibble',
    },
    ingredients: ['Dehydrated Poultry Protein', 'Maize', 'Maize Flour', 'Animal Fats', 'Wheat', 'Dehydrated Pork Protein', 'Hydrolysed Animal Proteins'],
    suitability: ['Adult Dogs', 'Large Breeds', 'Joint Support Needs'],
    sellerInfo: {
      id: 'the-healthy-hound',
      name: 'The Healthy Hound Nutrition Hub',
      address: 'Korlagunta Main Road, Tirupati',
      verified: true,
      rating: '4.9 ★',
    },
    deliveryEstimate: '15-25 mins in Tirupati',
    returnPolicy: '7 Days Replacement Policy for sealed unopened packages.',
  },
  {
    id: 'p-food-2',
    name: 'Farmina N&D Grain Free Pumpkin & Chicken',
    brand: 'Farmina',
    category: 'food',
    foodForm: 'DRY',
    lifeStages: ['PUPPY', 'ADULT'],
    price: 2890,
    originalPrice: 3200,
    rating: '4.8 ★',
    reviewCount: 180,
    deliveryTime: '15-25 mins',
    inStock: true,
    stockCount: 20,
    imageUrl: 'https://images.unsplash.com/photo-1568640347023-a616a30bc3bd?w=600&auto=format&fit=crop&q=80',
    galleryImages: [
      'https://images.unsplash.com/photo-1568640347023-a616a30bc3bd?w=600&auto=format&fit=crop&q=80',
    ],
    description: 'Grain-free complete formula with 96% protein from animal origin. Enriched with pumpkin, chicken, and pomegranate for sensitive digestive systems.',
    createdAt: '2026-07-29T14:30:00Z',
    isNewArrival: true,
    providerId: 'the-healthy-hound',
    providerName: 'The Healthy Hound Nutrition Hub',
    variants: [
      { id: 'v-f-2.5', name: '2.5 kg Pack', price: 2890, originalPrice: 3200, inStock: true, stockCount: 12 },
      { id: 'v-f-7', name: '7 kg Pack', price: 6990, originalPrice: 7500, inStock: true, stockCount: 8 },
    ],
    specifications: {
      'Pet Type': 'Dog',
      'Life Stage': 'All Life Stages',
      'Special Diet': 'Grain Free, Sensitive Stomach',
    },
    ingredients: ['Fresh Boneless Chicken', 'Dehydrated Chicken', 'Pea Starch', 'Pumpkin', 'Dehydrated Whole Eggs', 'Fresh Herring'],
    suitability: ['Puppies & Adult Dogs', 'Sensitive Digestive Tracts'],
    sellerInfo: {
      id: 'the-healthy-hound',
      name: 'The Healthy Hound Nutrition Hub',
      address: 'Korlagunta Main Road, Tirupati',
      verified: true,
      rating: '4.9 ★',
    },
    deliveryEstimate: '15-25 mins in Tirupati',
    returnPolicy: '7 Days Replacement Policy.',
  },

  {
    id: 'p-food-wet-1',
    name: 'Chicken & Vegetables Puppy Wet Food Loaf',
    brand: 'PawBowl',
    category: 'food',
    foodForm: 'WET',
    lifeStages: ['PUPPY'],
    price: 189,
    originalPrice: 220,
    rating: '4.7 ★',
    reviewCount: 86,
    deliveryTime: '15-25 mins',
    inStock: true,
    stockCount: 36,
    imageUrl: 'https://images.unsplash.com/photo-1589924691995-400dc9ecc119?w=600&auto=format&fit=crop&q=80',
    galleryImages: ['https://images.unsplash.com/photo-1589924691995-400dc9ecc119?w=600&auto=format&fit=crop&q=80'],
    description: 'Complete wet puppy meal with a soft texture and balanced nutrition for growing dogs.',
    createdAt: '2026-08-01T09:00:00Z',
    isNewArrival: true,
    providerId: 'the-healthy-hound',
    providerName: 'The Healthy Hound Nutrition Hub',
    variants: [
      { id: 'v-wet-puppy-150', name: '150 g Tray', price: 189, originalPrice: 220, inStock: true, stockCount: 24 },
      { id: 'v-wet-puppy-6', name: 'Pack of 6', price: 999, originalPrice: 1140, inStock: true, stockCount: 12 },
    ],
    specifications: { 'Pet Type': 'Dog', 'Life Stage': 'Puppy', 'Food Form': 'Wet Food' },
    ingredients: ['Chicken', 'Vegetables', 'Rice', 'Minerals', 'Vitamins'],
    suitability: ['Puppies', 'Soft Food Diets', 'Growing Dogs'],
    sellerInfo: {
      id: 'the-healthy-hound',
      name: 'The Healthy Hound Nutrition Hub',
      address: 'Korlagunta Main Road, Tirupati',
      verified: true,
      rating: '4.9 ★',
    },
    deliveryEstimate: '15-25 mins in Tirupati',
    returnPolicy: 'No returns after opening. Damaged sealed packs are replaceable.',
  },
  {
    id: 'p-food-senior-1',
    name: 'Senior 8+ Joint Support Dry Dog Food',
    brand: 'PawBowl',
    category: 'food',
    foodForm: 'DRY',
    lifeStages: ['SENIOR'],
    price: 2399,
    originalPrice: 2699,
    rating: '4.8 ★',
    reviewCount: 124,
    deliveryTime: '15-25 mins',
    inStock: true,
    stockCount: 18,
    imageUrl: 'https://images.unsplash.com/photo-1568640347023-a616a30bc3bd?w=600&auto=format&fit=crop&q=80',
    galleryImages: ['https://images.unsplash.com/photo-1568640347023-a616a30bc3bd?w=600&auto=format&fit=crop&q=80'],
    description: 'Dry senior-dog nutrition with controlled calories, joint support, and digestible protein.',
    createdAt: '2026-07-31T12:00:00Z',
    isNewArrival: true,
    providerId: 'the-healthy-hound',
    providerName: 'The Healthy Hound Nutrition Hub',
    variants: [
      { id: 'v-senior-3kg', name: '3 kg Pack', price: 2399, originalPrice: 2699, inStock: true, stockCount: 12 },
      { id: 'v-senior-7kg', name: '7 kg Pack', price: 4999, originalPrice: 5499, inStock: true, stockCount: 6 },
    ],
    specifications: { 'Pet Type': 'Dog', 'Life Stage': 'Senior (8+ years)', 'Food Form': 'Dry Kibble' },
    ingredients: ['Chicken Protein', 'Rice', 'Animal Fats', 'Fish Oil', 'Glucosamine'],
    suitability: ['Senior Dogs', 'Joint Support Needs', 'Weight Management'],
    sellerInfo: {
      id: 'the-healthy-hound',
      name: 'The Healthy Hound Nutrition Hub',
      address: 'Korlagunta Main Road, Tirupati',
      verified: true,
      rating: '4.9 ★',
    },
    deliveryEstimate: '15-25 mins in Tirupati',
    returnPolicy: '7 Days Replacement Policy for sealed unopened packages.',
  },

  // --- Furniture & Sleep ---
  {
    id: 'p-furn-1',
    name: 'Orthopedic Memory Foam Bolster Pet Bed (L)',
    brand: 'PawsComfort',
    category: 'furniture',
    price: 3499,
    originalPrice: 4290,
    rating: '4.9 ★',
    reviewCount: 95,
    deliveryTime: '20-30 mins',
    inStock: true,
    stockCount: 12,
    imageUrl: 'https://images.unsplash.com/photo-1541599540903-216a46ca1dc0?w=600&auto=format&fit=crop&q=80',
    galleryImages: [
      'https://images.unsplash.com/photo-1541599540903-216a46ca1dc0?w=600&auto=format&fit=crop&q=80',
    ],
    description: 'High-density memory foam base with plush supportive bolsters. Removable, machine-washable waterproof velvet cover.',
    createdAt: '2026-07-27T08:00:00Z',
    isNewArrival: false,
    providerId: 'the-posh-paws',
    providerName: 'The Posh Paws Superstore',
    variants: [
      { id: 'v-bed-m', name: 'Medium (75x60cm)', price: 2999, originalPrice: 3500, inStock: true, stockCount: 5 },
      { id: 'v-bed-l', name: 'Large (90x70cm)', price: 3499, originalPrice: 4290, inStock: true, stockCount: 7 },
    ],
    specifications: {
      'Material': 'Memory Foam + Velvet Cover',
      'Washable': 'Yes, Machine Washable',
      'Waterproof': 'Internal Waterproof Liner',
    },
    suitability: ['Senior Dogs', 'Arthritic Pets', 'Large Breeds'],
    sellerInfo: {
      id: 'the-posh-paws',
      name: 'The Posh Paws Superstore',
      address: 'Air Bypass Road, Tirupati',
      verified: true,
      rating: '4.8 ★',
    },
    deliveryEstimate: '20-30 mins in Tirupati',
    returnPolicy: '10 Days Return Policy.',
  },

  // --- Toys & Enrichment ---
  {
    id: 'p-toy-1',
    name: 'KONG Classic Rubber Chew Toy (Large)',
    brand: 'KONG',
    category: 'toys',
    price: 899,
    originalPrice: 1050,
    rating: '4.9 ★',
    reviewCount: 420,
    deliveryTime: '15-25 mins',
    inStock: true,
    stockCount: 50,
    imageUrl: 'https://images.unsplash.com/photo-1576201836106-db1758fd1c97?w=600&auto=format&fit=crop&q=80',
    galleryImages: [
      'https://images.unsplash.com/photo-1576201836106-db1758fd1c97?w=600&auto=format&fit=crop&q=80',
    ],
    description: 'Ultra-durable natural red rubber toy. Unpredictable bounce for games of fetch and stuffable with peanut butter or treats.',
    createdAt: '2026-07-29T11:00:00Z',
    isNewArrival: true,
    providerId: 'the-posh-paws',
    providerName: 'The Posh Paws Superstore',
    variants: [
      { id: 'v-kong-m', name: 'Medium Size', price: 749, originalPrice: 850, inStock: true, stockCount: 25 },
      { id: 'v-kong-l', name: 'Large Size', price: 899, originalPrice: 1050, inStock: true, stockCount: 25 },
    ],
    specifications: {
      'Material': 'Natural Rubber',
      'Bite Rating': 'Heavy Chewer',
      'Dishwasher Safe': 'Top Rack Safe',
    },
    suitability: ['Teething Puppies', 'Power Chewers', 'Anxiety Relief'],
    sellerInfo: {
      id: 'the-posh-paws',
      name: 'The Posh Paws Superstore',
      address: 'Air Bypass Road, Tirupati',
      verified: true,
      rating: '4.8 ★',
    },
    deliveryEstimate: '15-25 mins in Tirupati',
    returnPolicy: '7 Days Replacement for defective items.',
  },

  // --- Travel & Apparel ---
  {
    id: 'p-travel-1',
    name: 'Airline Approved Soft-Sided Pet Carrier',
    brand: 'Sherpa',
    category: 'travel',
    price: 2499,
    originalPrice: 2899,
    rating: '4.7 ★',
    reviewCount: 75,
    deliveryTime: '20-30 mins',
    inStock: true,
    stockCount: 8,
    imageUrl: 'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?w=600&auto=format&fit=crop&q=80',
    galleryImages: [
      'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?w=600&auto=format&fit=crop&q=80',
    ],
    description: 'Breathable mesh ventilation windows, padded shoulder strap, and seatbelt safety strap for car & cabin travel.',
    createdAt: '2026-07-25T16:00:00Z',
    isNewArrival: false,
    providerId: 'the-posh-paws',
    providerName: 'The Posh Paws Superstore',
    variants: [
      { id: 'v-carrier-s', name: 'Small (up to 5kg)', price: 1999, originalPrice: 2399, inStock: true, stockCount: 3 },
      { id: 'v-carrier-m', name: 'Medium (up to 10kg)', price: 2499, originalPrice: 2899, inStock: true, stockCount: 5 },
    ],
    specifications: {
      'Dimensions': '44cm x 28cm x 28cm',
      'Max Weight': '10 kg',
      'Frame': 'Spring Wire Frame',
    },
    suitability: ['Cats', 'Small Dog Breeds', 'Cabin Flight Travel'],
    sellerInfo: {
      id: 'the-posh-paws',
      name: 'The Posh Paws Superstore',
      address: 'Air Bypass Road, Tirupati',
      verified: true,
      rating: '4.8 ★',
    },
    deliveryEstimate: '20-30 mins in Tirupati',
    returnPolicy: '7 Days Return Policy.',
  },

  // --- Treats & Chews ---
  {
    id: 'p-treat-1',
    name: 'Jerky High-Protein Chicken Sticks (150g)',
    brand: 'Chip Chop',
    category: 'treats',
    price: 299,
    originalPrice: 349,
    rating: '4.8 ★',
    reviewCount: 210,
    deliveryTime: '15 mins',
    inStock: true,
    stockCount: 60,
    imageUrl: 'https://images.unsplash.com/photo-1582798358481-d199fb7347bb?w=600&auto=format&fit=crop&q=80',
    galleryImages: [
      'https://images.unsplash.com/photo-1582798358481-d199fb7347bb?w=600&auto=format&fit=crop&q=80',
    ],
    description: 'Made from real fresh chicken breast meat. Easily digestible, low fat, high protein training reward sticks.',
    createdAt: '2026-07-29T16:00:00Z',
    isNewArrival: true,
    providerId: 'petcare-pharmacy',
    providerName: 'PetCare Pharmacy & Supplies',
    variants: [
      { id: 'v-treat-150', name: '150g Pouch', price: 299, originalPrice: 349, inStock: true, stockCount: 40 },
      { id: 'v-treat-400', name: '400g Mega Pack', price: 699, originalPrice: 799, inStock: true, stockCount: 20 },
    ],
    specifications: {
      'Flavor': 'Real Chicken',
      'Treat Type': 'Jerky Strips',
      'Grain Free': 'Yes',
    },
    ingredients: ['Chicken Breast 85%', 'Vegetable Glycerin', 'Plant Protein', 'Salt'],
    suitability: ['Dogs & Puppies', 'Daily Rewards & Training'],
    sellerInfo: {
      id: 'petcare-pharmacy',
      name: 'PetCare Pharmacy & Supplies',
      address: 'MR Palli Circle, Tirupati',
      verified: true,
      rating: '4.9 ★',
    },
    deliveryEstimate: '15 mins in Tirupati',
    returnPolicy: 'No Returns once opened.',
  },

  // --- Waste Management ---
  {
    id: 'p-waste-1',
    name: 'Biodegradable Lavender Scented Poop Bags (8 Rolls)',
    brand: 'EarthRated',
    category: 'waste',
    price: 499,
    originalPrice: 599,
    rating: '4.9 ★',
    reviewCount: 150,
    deliveryTime: '15-25 mins',
    inStock: true,
    stockCount: 30,
    imageUrl: 'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?w=600&auto=format&fit=crop&q=80',
    galleryImages: [
      'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?w=600&auto=format&fit=crop&q=80',
    ],
    description: 'Extra thick, 100% leakproof waste bags with refreshing lavender scent. Fits all standard leash dispensers.',
    createdAt: '2026-07-26T12:00:00Z',
    isNewArrival: false,
    providerId: 'petcare-pharmacy',
    providerName: 'PetCare Pharmacy & Supplies',
    variants: [
      { id: 'v-waste-8', name: '8 Rolls (120 Bags)', price: 499, originalPrice: 599, inStock: true, stockCount: 20 },
      { id: 'v-waste-18', name: '18 Rolls (270 Bags)', price: 999, originalPrice: 1199, inStock: true, stockCount: 10 },
    ],
    specifications: {
      'Count': '120 Bags',
      'Feature': '100% Leak-Proof',
      'Eco-Friendly': 'EPI Biodegradable',
    },
    suitability: ['Daily Dog Walks', 'Litter Cleanup'],
    sellerInfo: {
      id: 'petcare-pharmacy',
      name: 'PetCare Pharmacy & Supplies',
      address: 'MR Palli Circle, Tirupati',
      verified: true,
      rating: '4.9 ★',
    },
    deliveryEstimate: '15-25 mins in Tirupati',
    returnPolicy: '7 Days Replacement.',
  },
];

export const SHOPS_DATA: Record<string, ShopProfileData> = {
  'petcare-pharmacy': {
    id: 'petcare-pharmacy',
    name: 'PetCare Pharmacy & Supplies',
    tagline: 'Verified Veterinary Medicines & Wellness Supplies',
    address: 'MR Palli Circle, Near Veterinary Hospital, Tirupati, AP 517502',
    city: 'Tirupati',
    pincode: '517502',
    rating: '4.9 ★',
    reviewCount: 310,
    deliveryEta: '15-25 mins',
    isVerified: true,
    heroImageUrl: 'https://images.unsplash.com/photo-1576201836106-db1758fd1c97?w=800&auto=format&fit=crop&q=80',
    openingHours: '8:00 AM - 10:00 PM (Mon-Sun)',
    contactPhone: '+91 98765 43210',
    categories: ['Treats & Chews', 'Waste Management', 'Prescription Diets', 'Veterinary Supplements'],
    products: SAMPLE_PRODUCTS.filter((p) => p.providerId === 'petcare-pharmacy'),
  },
  'the-healthy-hound': {
    id: 'the-healthy-hound',
    name: 'The Healthy Hound Nutrition Hub',
    tagline: 'Premium Natural Pet Food & Dietary Health',
    address: 'Korlagunta Main Road, Tirupati, AP 517501',
    city: 'Tirupati',
    pincode: '517501',
    rating: '4.9 ★',
    reviewCount: 220,
    deliveryEta: '15-25 mins',
    isVerified: true,
    heroImageUrl: 'https://images.unsplash.com/photo-1589924691995-400dc9ecc119?w=800&auto=format&fit=crop&q=80',
    openingHours: '9:00 AM - 9:30 PM (Mon-Sat)',
    contactPhone: '+91 98765 12345',
    categories: ['Dry & Wet Food', 'Grain Free Diet', 'Puppy Nutrition', 'Senior Care'],
    products: SAMPLE_PRODUCTS.filter((p) => p.providerId === 'the-healthy-hound'),
  },
  'the-posh-paws': {
    id: 'the-posh-paws',
    name: 'The Posh Paws Superstore',
    tagline: 'Luxury Furniture, Toys, Apparel & Accessories',
    address: 'Air Bypass Road, Tirupati, AP 517507',
    city: 'Tirupati',
    pincode: '517507',
    rating: '4.8 ★',
    reviewCount: 185,
    deliveryEta: '20-30 mins',
    isVerified: true,
    heroImageUrl: 'https://images.unsplash.com/photo-1541599540903-216a46ca1dc0?w=800&auto=format&fit=crop&q=80',
    openingHours: '10:00 AM - 10:00 PM (Mon-Sun)',
    contactPhone: '+91 98765 67890',
    categories: ['Furniture & Beds', 'Chew & Plush Toys', 'Travel Carriers', 'Grooming Tools'],
    products: SAMPLE_PRODUCTS.filter((p) => p.providerId === 'the-posh-paws'),
  },
};
