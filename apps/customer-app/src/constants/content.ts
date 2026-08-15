export type GuideCategory = 'puppy-kitten' | 'skin' | 'ticks-odor';

export interface GuideArticle {
  id: string;
  category: GuideCategory;
  title: string;
  summary: string;
  readMinutes: number;
  authorName: string;
  companyName: string;
  likeCount: number;
}

export type BannerTargetType = 'NONE' | 'PRODUCT' | 'STORE' | 'CATEGORY' | 'ROUTE';

export interface PromoBanner {
  id: string;
  title: string;
  subtitle: string;
  accent: string;
  /** Display duration in seconds (auction-style: 5→1) */
  durationSec: number;
  sortOrder?: number;
  active?: boolean;
  imageUrl?: string | null;
  targetType: BannerTargetType;
  targetValue?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
}

export const PROMO_BANNERS: PromoBanner[] = [
  { id: 'b1', title: 'Free delivery today', subtitle: 'On orders above ₹499 from nearby stores', accent: '#F97316', durationSec: 5, targetType: 'CATEGORY', targetValue: 'food' },
  { id: 'b2', title: 'Grooming week', subtitle: 'Book a spa slot and get 10% off', accent: '#2563EB', durationSec: 4, targetType: 'ROUTE', targetValue: '/groom' },
  { id: 'b3', title: 'Vet checkup drive', subtitle: 'Annual wellness packages from ₹799', accent: '#14B8A6', durationSec: 3, targetType: 'ROUTE', targetValue: '/vet' },
  { id: 'b4', title: 'New puppy guide', subtitle: 'Read age-wise care tips in Guides', accent: '#B45309', durationSec: 2, targetType: 'ROUTE', targetValue: '/guides' },
  { id: 'b5', title: 'Tick season alert', subtitle: 'Prevention tips for monsoon months', accent: '#B91C1C', durationSec: 1, targetType: 'CATEGORY', targetValue: 'treats' },
];

export const GUIDE_CATEGORIES: { id: GuideCategory; label: string; description: string }[] = [
  { id: 'puppy-kitten', label: '1–2 months', description: 'Feeding, sleep, and first vet visits for new pets' },
  { id: 'skin', label: 'Skin issues', description: 'Rashes, dryness, and when to see a vet' },
  { id: 'ticks-odor', label: 'Ticks & odor', description: 'Prevention, grooming, and home care' },
];

export const GUIDE_ARTICLES: GuideArticle[] = [
  {
    id: 'g1',
    category: 'puppy-kitten',
    title: 'First 8 weeks at home',
    summary: 'Set a feeding routine and safe sleep zone.',
    readMinutes: 4,
    authorName: 'Dr. Ananya Rao',
    companyName: 'City Pet Hospital',
    likeCount: 128,
  },
  {
    id: 'g2',
    category: 'puppy-kitten',
    title: 'Core vaccines timeline',
    summary: 'DHPP and rabies schedule for puppies.',
    readMinutes: 5,
    authorName: 'Dr. Vivek Sharma',
    companyName: 'PetCare Wellness Center',
    likeCount: 94,
  },
  {
    id: 'g3',
    category: 'skin',
    title: 'Itchy skin checklist',
    summary: 'Food, fleas, or allergies — what to check first.',
    readMinutes: 3,
    authorName: 'Dr. Ananya Rao',
    companyName: 'City Pet Hospital',
    likeCount: 83,
  },
  {
    id: 'g4',
    category: 'skin',
    title: 'When to book a vet',
    summary: 'Red flags that need same-day attention.',
    readMinutes: 2,
    authorName: 'Dr. Vivek Sharma',
    companyName: 'PetCare Wellness Center',
    likeCount: 77,
  },
  {
    id: 'g5',
    category: 'ticks-odor',
    title: 'Tick prevention 101',
    summary: 'Spot-on, collars, and yard hygiene.',
    readMinutes: 4,
    authorName: 'Meera Reddy',
    companyName: 'Paws & Bubbles Spa',
    likeCount: 65,
  },
  {
    id: 'g6',
    category: 'ticks-odor',
    title: 'Managing pet odor',
    summary: 'Bath frequency and ear cleaning tips.',
    readMinutes: 3,
    authorName: 'Meera Reddy',
    companyName: 'Paws & Bubbles Spa',
    likeCount: 58,
  },
];

/** Legacy visual steps retained for older surfaces. New order reads expose the canonical lifecycle step. */
export const ORDER_FLOW_STEPS = [
  { id: 'placed', label: 'Order placed' },
  { id: 'assigned', label: 'Partner assigned' },
  { id: 'packed', label: 'Shop packed' },
  { id: 'picked', label: 'Picked up' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'completed', label: 'Completed' },
] as const;

export type OrderFlowStepId =
  | (typeof ORDER_FLOW_STEPS)[number]['id']
  | 'accepted'
  | 'preparing'
  | 'ready_for_pickup'
  | 'picked_up'
  | 'rejected'
  | 'cancelled';

export const LANGUAGES = [
  { id: 'en', label: 'English', region: 'Default' },
  { id: 'hi', label: 'हिन्दी', region: 'North & Central India' },
  { id: 'te', label: 'తెలుగు', region: 'Telangana & Andhra' },
] as const;

export type LanguageId = (typeof LANGUAGES)[number]['id'];
