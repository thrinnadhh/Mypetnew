import { SymbolView } from 'expo-symbols';
import { Text, type StyleProp, type ViewStyle } from 'react-native';

export type AppIconName =
  | 'cart' | 'calendar' | 'check' | 'clock' | 'location' | 'paw' | 'store' | 'medical'
  | 'sparkle' | 'star' | 'history' | 'message' | 'support' | 'shield' | 'groom' | 'card'
  | 'home' | 'search' | 'profile' | 'offline' | 'warning' | 'chevron' | 'heart' | 'close'
  | 'phone' | 'document' | 'eye' | 'share' | 'upload' | 'download';

const SYMBOLS: Record<AppIconName, { ios: string; android: string; fallback: string }> = {
  cart: { ios: 'cart.fill', android: 'shopping_cart', fallback: 'C' },
  calendar: { ios: 'calendar', android: 'calendar_month', fallback: 'D' },
  clock: { ios: 'clock.fill', android: 'schedule', fallback: 'T' },
  location: { ios: 'location.fill', android: 'location_on', fallback: 'L' },
  paw: { ios: 'pawprint.fill', android: 'pets', fallback: 'P' },
  store: { ios: 'storefront.fill', android: 'storefront', fallback: 'S' },
  medical: { ios: 'cross.case.fill', android: 'medical_services', fallback: 'M' },
  sparkle: { ios: 'sparkles', android: 'auto_awesome', fallback: '*' },
  star: { ios: 'star.fill', android: 'star', fallback: 'R' },
  history: { ios: 'clock.arrow.circlepath', android: 'history', fallback: 'H' },
  message: { ios: 'message.fill', android: 'chat', fallback: 'M' },
  support: { ios: 'headphones', android: 'support_agent', fallback: 'A' },
  shield: { ios: 'shield.lefthalf.filled', android: 'verified_user', fallback: 'S' },
  groom: { ios: 'scissors', android: 'content_cut', fallback: 'G' },
  check: { ios: 'checkmark.circle.fill', android: 'check_circle', fallback: '✓' },
  card: { ios: 'creditcard.fill', android: 'credit_card', fallback: '₹' },
  home: { ios: 'house.fill', android: 'home', fallback: 'H' },
  search: { ios: 'magnifyingglass', android: 'search', fallback: '?' },
  profile: { ios: 'person.crop.circle.fill', android: 'person', fallback: 'U' },
  offline: { ios: 'wifi.slash', android: 'wifi_off', fallback: '!' },
  warning: { ios: 'exclamationmark.triangle.fill', android: 'warning', fallback: '!' },
  chevron: { ios: 'chevron.right', android: 'chevron_right', fallback: '>' },
  heart: { ios: 'heart.fill', android: 'favorite', fallback: '♥' },
  close: { ios: 'xmark', android: 'close', fallback: '×' },
  phone: { ios: 'phone.fill', android: 'call', fallback: 'P' },
  document: { ios: 'doc.text.fill', android: 'description', fallback: 'D' },
  eye: { ios: 'eye.fill', android: 'visibility', fallback: 'V' },
  share: { ios: 'square.and.arrow.up', android: 'share', fallback: 'S' },
  upload: { ios: 'arrow.up.doc.fill', android: 'upload_file', fallback: 'U' },
  download: { ios: 'arrow.down.doc.fill', android: 'download', fallback: 'D' },
};

export function AppIcon({ name, color, size = 18, style }: { name: AppIconName; color: string; size?: number; style?: StyleProp<ViewStyle> }) {
  const symbol = SYMBOLS[name];
  return (
    <SymbolView
      name={{ ios: symbol.ios as never, android: symbol.android as never, web: symbol.android as never }}
      size={size}
      tintColor={color}
      style={style}
      fallback={<Text style={{ color, fontSize: size * 0.8, fontWeight: '800' }}>{symbol.fallback}</Text>}
    />
  );
}
