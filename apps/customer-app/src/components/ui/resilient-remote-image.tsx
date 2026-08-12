import { Image, type ImageContentFit } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { useTheme } from '@/hooks/use-theme';
import { DEMO_MEDIA } from '@/services/demo-customer-data';
import { appConfig } from '@/utils/app-config';

export function ResilientRemoteImage({
  uri,
  fallbackUri,
  style,
  contentFit = 'cover',
}: {
  uri?: string | null;
  fallbackUri?: string;
  style?: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
}) {
  const theme = useTheme();
  const effectiveFallback = appConfig.allowDemoMode
    ? (fallbackUri ?? DEMO_MEDIA.store)
    : undefined;

  const primary = uri?.trim() || effectiveFallback;
  const [sourceUri, setSourceUri] = useState<string | undefined>(primary);
  const [failed, setFailed] = useState(!primary);

  useEffect(() => {
    const nextUri = uri?.trim() || effectiveFallback;
    setSourceUri(nextUri);
    setFailed(!nextUri);
  }, [uri, effectiveFallback]);

  if (failed || !sourceUri) {
    return (
      <View style={[style, styles.placeholder, { backgroundColor: theme.muted }]}>
        <AppIcon name="store" color={theme.textSecondary} size={28} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri: sourceUri }}
      style={style}
      contentFit={contentFit}
      transition={160}
      onError={() => {
        if (sourceUri !== effectiveFallback && effectiveFallback) {
          setSourceUri(effectiveFallback);
        } else {
          setFailed(true);
        }
      }}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
