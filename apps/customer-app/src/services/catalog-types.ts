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
  brand?: string;
  category: string;
  foodForm?: FoodForm;
  lifeStages?: PetLifeStage[];
  price: number;
  originalPrice?: number;
  mrpPaise?: number;
  sellingPricePaise?: number;
  rating?: string;
  reviewCount?: number;
  deliveryTime?: string;
  inStock: boolean;
  stockCount: number;
  availableQuantity?: number;
  imageUrl?: string;
  galleryImages: string[];
  description?: string;
  createdAt: string;
  isNewArrival: boolean;
  providerId: string;
  providerName: string;
  organizationId?: string;
  outletId?: string;
  kind?: 'PRODUCT' | 'MEDICINE' | string;
  commerceMode?: 'COMMERCE' | 'VIEW_ONLY' | string;
  pickupEnabled?: boolean;
  sku?: string;
  packLabel?: string;
  variants: ProductVariant[];
  specifications: Record<string, string>;
  ingredients?: string[];
  suitability: string[];
  sellerInfo?: {
    id: string;
    name: string;
    address?: string;
    verified?: boolean;
    rating?: string;
    pickupEnabled?: boolean;
  };
  deliveryEstimate?: string;
  returnPolicy?: string;
}

export interface ShopProfileData {
  id: string;
  name: string;
  tagline?: string;
  address?: string;
  city?: string;
  pincode?: string;
  rating?: string;
  reviewCount?: number;
  deliveryEta?: string;
  isVerified?: boolean;
  heroImageUrl?: string;
  openingHours?: string;
  contactPhone?: string;
  pickupEnabled?: boolean;
  organizationId?: string;
  categories: string[];
  products: CommerceProduct[];
}
