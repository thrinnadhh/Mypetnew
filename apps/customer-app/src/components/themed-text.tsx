import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { fontFamilies } from '@/design/tokens';
import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, maxFontSizeMultiplier = 2, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  return (
    <Text
      allowFontScaling
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  small: { fontFamily: fontFamilies.medium, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  smallBold: { fontFamily: fontFamilies.bold, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  default: { fontFamily: fontFamilies.medium, fontSize: 16, lineHeight: 24, fontWeight: '500' },
  title: { fontFamily: fontFamilies.bold, fontSize: 34, fontWeight: '700', lineHeight: 40 },
  subtitle: { fontFamily: fontFamilies.bold, fontSize: 22, lineHeight: 30, fontWeight: '700' },
  link: { fontFamily: fontFamilies.medium, lineHeight: 30, fontSize: 14 },
  linkPrimary: { fontFamily: fontFamilies.medium, lineHeight: 30, fontSize: 14, color: '#004AC6' },
  code: { fontFamily: Fonts.mono, fontWeight: Platform.select({ android: '700' }) ?? '500', fontSize: 12 },
});
