import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ResilientRemoteImage } from '@/components/ui/resilient-remote-image';
import { PROMO_BANNERS, type PromoBanner } from '@/constants/content';
import { Radius, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DEMO_BANNER_IMAGES, DEMO_MEDIA } from '@/services/demo-customer-data';

export function BannerCarousel({
  banners = PROMO_BANNERS,
  onPress,
}: {
  banners?: PromoBanner[];
  onPress?: (banner: PromoBanner) => void;
}) {
  const router = useRouter();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const pageWidth = Math.max(280, width - Spacing.three * 2);
  const listRef = useRef<FlatList<PromoBanner>>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [index, setIndex] = useState(0);
  const safeBanners = useMemo(() => (banners.length > 0 ? banners : PROMO_BANNERS), [banners]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleNext = useCallback(() => {
    clearTimer();
    if (safeBanners.length < 2) return;

    const active = safeBanners[index];
    const delay = Math.max(3, active?.durationSec ?? 5) * 1000;
    timerRef.current = setTimeout(() => {
      const next = (index + 1) % safeBanners.length;
      listRef.current?.scrollToOffset({ offset: next * pageWidth, animated: true });
      setIndex(next);
    }, delay);
  }, [clearTimer, index, pageWidth, safeBanners]);

  useEffect(() => {
    scheduleNext();
    return clearTimer;
  }, [clearTimer, scheduleNext]);

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(0, safeBanners.length - 1)));
  }, [safeBanners.length]);

  const handleMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nextIndex = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
      setIndex(Math.max(0, Math.min(nextIndex, safeBanners.length - 1)));
    },
    [pageWidth, safeBanners.length],
  );

  const handleBannerPress = useCallback((banner: PromoBanner) => {
    const target = banner.targetValue?.trim();
    if (!target || banner.targetType === 'NONE') {
      onPress?.(banner);
      return;
    }

    switch (banner.targetType) {
      case 'PRODUCT':
        router.push({ pathname: '/commerce/product-detail', params: { id: target } } as never);
        return;
      case 'STORE':
        router.push(`/shop/${encodeURIComponent(target)}` as never);
        return;
      case 'CATEGORY':
        router.push(`/category/${encodeURIComponent(target)}` as never);
        return;
      case 'ROUTE':
        if (target.startsWith('/') && !target.startsWith('//') && !target.includes('://')) {
          router.push(target as never);
          return;
        }
        onPress?.(banner);
        return;
      default:
        onPress?.(banner);
    }
  }, [onPress, router]);

  return (
    <View style={styles.wrap}>
      <FlatList
        ref={listRef}
        data={safeBanners}
        horizontal
        pagingEnabled
        bounces={false}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        getItemLayout={(_, itemIndex) => ({ length: pageWidth, offset: pageWidth * itemIndex, index: itemIndex })}
        onScrollBeginDrag={clearTimer}
        onMomentumScrollEnd={handleMomentumEnd}
        onScrollToIndexFailed={({ index: failedIndex }) => {
          listRef.current?.scrollToOffset({ offset: failedIndex * pageWidth, animated: true });
        }}
        renderItem={({ item, index: itemIndex }) => (
          <View style={{ width: pageWidth }}>
            <Pressable
              onPress={() => handleBannerPress(item)}
              style={({ pressed }) => [styles.banner, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}. ${item.subtitle}`}
            >
              <ResilientRemoteImage
                uri={item.imageUrl || DEMO_BANNER_IMAGES[itemIndex % DEMO_BANNER_IMAGES.length]}
                fallbackUri={DEMO_MEDIA.store}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
              />
              <View style={styles.overlay} />
              <View style={styles.copy}>
                <ThemedText style={styles.eyebrow}>{itemIndex === 1 ? 'NEW ARRIVALS' : 'PET ESSENTIALS'}</ThemedText>
                <ThemedText style={styles.title} numberOfLines={2}>{item.title}</ThemedText>
                <ThemedText style={styles.subtitle} numberOfLines={2}>{item.subtitle}</ThemedText>
                <View style={[styles.cta, { backgroundColor: theme.primary }]}>
                  <ThemedText style={styles.ctaLabel}>{itemIndex === 1 ? 'Explore' : 'Shop now'}</ThemedText>
                </View>
              </View>
            </Pressable>
          </View>
        )}
      />

      <View style={styles.dots}>
        {safeBanners.map((banner, dotIndex) => (
          <View
            key={banner.id}
            style={[
              styles.dot,
              {
                backgroundColor: dotIndex === index ? theme.primary : theme.border,
                width: dotIndex === index ? 18 : 6,
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, overflow: 'hidden' },
  banner: {
    height: 166,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    justifyContent: 'center',
    ...Shadows.card,
  },
  pressed: { opacity: 0.94 },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(8, 18, 33, 0.48)',
  },
  copy: {
    width: '72%',
    paddingHorizontal: Spacing.four,
    gap: 4,
  },
  eyebrow: {
    color: '#6EE7D8',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 21,
    lineHeight: 25,
    fontWeight: '900',
  },
  subtitle: {
    color: '#F4F7FB',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  cta: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    marginTop: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  ctaLabel: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  dots: {
    minHeight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  dot: { height: 6, borderRadius: 999 },
});
