import React, { useState, useEffect } from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

interface CachedImageProps {
  source: string;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
}

export default function CachedImage({ source, style, accessibilityLabel }: CachedImageProps) {
  const [localUri, setLocalUri] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadCache() {
      if (!source) return;

      // Extract a unique identifier from the image URL for the cache name
      const filename = source.split('/').pop()?.split('?')[0] || 'cached_img';
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;

      try {
        const metadata = await FileSystem.getInfoAsync(fileUri);
        if (metadata.exists) {
          if (active) setLocalUri(fileUri);
        } else {
          // Download image to local filesystem cache directory
          const { uri } = await FileSystem.downloadAsync(source, fileUri);
          if (active) setLocalUri(uri);
        }
      } catch (err) {
        console.log("CachedImage fallback: loading direct URL due to cache issue:", err);
        if (active) setLocalUri(source);
      }
    }

    loadCache();

    return () => {
      active = false;
    };
  }, [source]);

  if (!localUri) return null;

  return (
    <Image 
      source={{ uri: localUri }} 
      style={style} 
      accessibilityLabel={accessibilityLabel} 
    />
  );
}
