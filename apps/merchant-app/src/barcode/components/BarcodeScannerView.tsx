import { useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../../design/tokens/colors';
import { typography } from '../../design/tokens/typography';
import { spacing } from '../../design/tokens/spacing';
import { radius } from '../../design/tokens/radius';
import { scannerPermissionNotice, type ScannerPermissionState } from '../model';

export type BarcodeScannerViewProps = {
  permission: ScannerPermissionState;
  onRequestPermission: () => Promise<void>;
  onManualEntryPress: () => void;
  rapidScanMode: boolean;
  onToggleRapidScan: () => void;
  torchOn?: boolean;
  onToggleTorch?: () => void;
  active?: boolean;
  lastScannedCode?: string | null;
};

export function BarcodeScannerView({
  permission,
  onRequestPermission,
  onManualEntryPress,
  rapidScanMode,
  onToggleRapidScan,
  torchOn = false,
  onToggleTorch,
  active = true,
  lastScannedCode,
}: BarcodeScannerViewProps) {
  const [requesting, setRequesting] = useState(false);

  async function handleRequest() {
    setRequesting(true);
    try {
      await onRequestPermission();
    } finally {
      setRequesting(false);
    }
  }

  async function handleOpenSettings() {
    if (Platform.OS !== 'web') {
      await Linking.openSettings().catch(() => {});
    }
  }

  if (permission === 'REQUESTING' || requesting) {
    return (
      <View style={styles.centerContainer} testID="scanner-requesting">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.stateTitle}>Accessing camera…</Text>
        <Text style={styles.stateBody}>Please grant camera permission to scan barcodes.</Text>
      </View>
    );
  }

  if (permission === 'DENIED') {
    return (
      <View style={styles.centerContainer} testID="scanner-denied">
        <Text style={styles.stateTitle}>Camera Access Denied</Text>
        <Text style={styles.stateBody}>
          {scannerPermissionNotice('DENIED')}
        </Text>
        <View style={styles.buttonRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Grant camera permission"
            onPress={() => void handleRequest()}
            style={[styles.actionButton, styles.primaryButton]}
          >
            <Text style={styles.primaryButtonText}>Grant Permission</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enter barcode manually"
            onPress={onManualEntryPress}
            style={[styles.actionButton, styles.secondaryButton]}
          >
            <Text style={styles.secondaryButtonText}>Manual Barcode</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (permission === 'BLOCKED') {
    return (
      <View style={styles.centerContainer} testID="scanner-blocked">
        <Text style={styles.stateTitle}>Camera Blocked</Text>
        <Text style={styles.stateBody}>
          {scannerPermissionNotice('BLOCKED')}
        </Text>
        <View style={styles.buttonRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open settings to enable camera"
            onPress={() => void handleOpenSettings()}
            style={[styles.actionButton, styles.primaryButton]}
          >
            <Text style={styles.primaryButtonText}>Open Settings</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enter barcode manually"
            onPress={onManualEntryPress}
            style={[styles.actionButton, styles.secondaryButton]}
          >
            <Text style={styles.secondaryButtonText}>Manual Barcode</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (permission === 'UNAVAILABLE') {
    return (
      <View style={styles.centerContainer} testID="scanner-unavailable">
        <Text style={styles.stateTitle}>Camera Unavailable</Text>
        <Text style={styles.stateBody}>
          {scannerPermissionNotice('UNAVAILABLE')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Enter barcode manually"
          onPress={onManualEntryPress}
          style={[styles.actionButton, styles.primaryButton]}
        >
          <Text style={styles.primaryButtonText}>Manual Barcode Entry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.viewfinderContainer} testID="scanner-viewfinder">
      {/* Top Overlay Controls */}
      <View style={styles.topControlBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={torchOn ? 'Turn torch off' : 'Turn torch on'}
          onPress={onToggleTorch}
          style={[styles.controlChip, torchOn ? styles.controlChipActive : null]}
        >
          <Text style={torchOn ? styles.controlTextActive : styles.controlText}>
            Torch: {torchOn ? 'ON' : 'OFF'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={rapidScanMode ? 'Disable rapid scan mode' : 'Enable rapid scan mode'}
          onPress={onToggleRapidScan}
          style={[styles.controlChip, rapidScanMode ? styles.controlChipActive : null]}
        >
          <Text style={rapidScanMode ? styles.controlTextActive : styles.controlText}>
            Rapid Scan: {rapidScanMode ? 'ON' : 'OFF'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch to manual barcode entry"
          onPress={onManualEntryPress}
          style={styles.controlChip}
        >
          <Text style={styles.controlText}>Manual Entry</Text>
        </Pressable>
      </View>

      {/* Target Reticle */}
      <View style={styles.reticleFrame}>
        <View style={[styles.cornerBracket, styles.topLeftBracket]} />
        <View style={[styles.cornerBracket, styles.topRightBracket]} />
        <View style={[styles.cornerBracket, styles.bottomLeftBracket]} />
        <View style={[styles.cornerBracket, styles.bottomRightBracket]} />
        {active ? <View style={styles.laserLine} /> : null}
      </View>

      {/* Bottom status */}
      <View style={styles.bottomStatusOverlay}>
        <Text style={styles.statusHelperText}>
          {active
            ? 'Align barcode inside the frame to scan'
            : 'Scanner paused'}
        </Text>
        {lastScannedCode ? (
          <View style={styles.scannedBadge}>
            <Text style={styles.scannedText}>Last: {lastScannedCode}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  viewfinderContainer: {
    height: 280,
    backgroundColor: '#0f172a',
    borderRadius: radius.md,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
  },
  centerContainer: {
    minHeight: 220,
    backgroundColor: colors.surfaceDim,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  stateTitle: {
    ...typography.headlineMd,
    color: colors.onSurface,
    textAlign: 'center',
  },
  stateBody: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    maxWidth: 320,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  actionButton: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
  primaryButtonText: {
    ...typography.labelLg,
    color: colors.onPrimary,
  },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: {
    ...typography.labelLg,
    color: colors.onSurface,
  },
  topControlBar: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.xs,
    zIndex: 10,
  },
  controlChip: {
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryContainer,
  },
  controlText: {
    ...typography.codeSm,
    color: '#ffffff',
    fontSize: 11,
  },
  controlTextActive: {
    ...typography.codeSm,
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 11,
  },
  reticleFrame: {
    width: 220,
    height: 130,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cornerBracket: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: colors.primary,
  },
  topLeftBracket: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  topRightBracket: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  bottomLeftBracket: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  bottomRightBracket: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  laserLine: {
    width: '90%',
    height: 2,
    backgroundColor: '#ef4444',
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  bottomStatusOverlay: {
    alignItems: 'center',
    gap: 4,
  },
  statusHelperText: {
    ...typography.bodyMd,
    color: '#94a3b8',
    fontSize: 12,
  },
  scannedBadge: {
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: '#334155',
  },
  scannedText: {
    ...typography.codeSm,
    color: '#38bdf8',
    fontSize: 11,
  },
});
