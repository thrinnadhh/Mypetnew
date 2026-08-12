import { Image, type ImageContentFit } from 'expo-image';
import React, { useEffect, useState } from 'react';
import type { ImageStyle, StyleProp } from 'react-native';

import { DEMO_MEDIA } from '@/services/demo-customer-data';

export function ResilientRemoteImage({
  uri,
  fallbackUri = DEMO_MEDIA.store,
  style,
  contentFit = 'cover',
}: {
  uri?: string | null;
  fallbackUri?: string;
  style?: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
}) {
  const primary = uri?.trim() || fallbackUri;
  const [sourceUri, setSourceUri] = useState(primary);

  useEffect(() => {
    setSourceUri(primary);
  }, [primary]);

  return (
    <Image
      source={{ uri: sourceUri }}
      style={style}
      contentFit={contentFit}
      transition={160}
      onError={() => {
        if (sourceUri !== fallbackUri) setSourceUri(fallbackUri);
      }}
    />
  );
}
