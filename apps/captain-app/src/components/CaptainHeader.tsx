import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, spacing, typography } from '../design/tokens';
import { StatusBadge } from './StatusBadge';

export interface CaptainHeaderProps {
  name?: string;
  online: boolean;
}

export const CaptainHeader: React.FC<CaptainHeaderProps> = ({ name, online }) => {
  const getGreeting = () => {
    const hours = new Date().getHours();
    if (hours < 12) return 'Good morning';
    if (hours < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <View style={styles.header}>
      <View style={styles.info}>
        <Text style={styles.greeting}>{getGreeting()}</Text>
        <Text style={styles.name}>{name || 'Captain'}</Text>
      </View>
      <StatusBadge
        label={online ? 'ONLINE' : 'OFFLINE'}
        variant={online ? 'online' : 'offline'}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: palette.white,
    borderBottomWidth: 1,
    borderBottomColor: palette.outlineSoft,
  },
  info: {
    flex: 1,
  },
  greeting: {
    ...typography.caption,
    color: palette.inkMuted,
    textTransform: 'uppercase',
  },
  name: {
    ...typography.title,
    color: palette.ink,
    fontSize: 18,
  },
});
