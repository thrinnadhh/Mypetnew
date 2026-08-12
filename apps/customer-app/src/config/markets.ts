export interface LaunchMarket {
  id: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  discoveryRadiusKm: number;
}

export const LAUNCH_MARKETS: readonly LaunchMarket[] = [
  { id: 'tirupati-ap', city: 'Tirupati', state: 'Andhra Pradesh', latitude: 13.6288, longitude: 79.4192, discoveryRadiusKm: 10 },
];

export const INITIAL_MARKET = LAUNCH_MARKETS[0];
