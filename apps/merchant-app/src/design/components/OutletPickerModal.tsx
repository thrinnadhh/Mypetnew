import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../tokens';

export interface OutletOption {
  id: string;
  name: string;
}

export interface OutletPickerModalProps {
  visible: boolean;
  onClose: () => void;
  outlets: OutletOption[];
  selectedOutletId?: string;
  onSelectOutlet: (outletId?: string) => void;
  businessName?: string;
}

export function OutletPickerModal({
  visible,
  onClose,
  outlets,
  selectedOutletId,
  onSelectOutlet,
  businessName = 'MyPet Merchant',
}: OutletPickerModalProps) {
  function handleSelect(id?: string) {
    onSelectOutlet(id);
    onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Select Active Outlet</Text>
              <Text style={styles.subtitle}>{businessName}</Text>
            </View>
            <Pressable
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close outlet picker"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            <Pressable
              onPress={() => handleSelect(undefined)}
              style={[
                styles.item,
                selectedOutletId === undefined && styles.itemSelected,
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: selectedOutletId === undefined }}
              accessibilityLabel="All Outlets (Consolidated View)"
            >
              <View style={styles.itemRadio}>
                {selectedOutletId === undefined && <View style={styles.itemRadioInner} />}
              </View>
              <View style={styles.itemInfo}>
                <Text style={[
                  styles.itemName,
                  selectedOutletId === undefined && styles.itemNameSelected,
                ]}>
                  All Outlets
                </Text>
                <Text style={styles.itemDetail}>Consolidated enterprise view across all locations</Text>
              </View>
            </Pressable>

            {outlets.map((outlet, index) => {
              const isSelected = outlet.id === selectedOutletId;
              return (
                <Pressable
                  key={outlet.id}
                  onPress={() => handleSelect(outlet.id)}
                  style={[styles.item, isSelected && styles.itemSelected]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${outlet.name} (Outlet ${index + 1})`}
                >
                  <View style={styles.itemRadio}>
                    {isSelected && <View style={styles.itemRadioInner} />}
                  </View>
                  <View style={styles.itemInfo}>
                    <Text style={[styles.itemName, isSelected && styles.itemNameSelected]}>
                      {outlet.name}
                    </Text>
                    <Text style={styles.itemDetail}>Outlet #{index + 1} · ID: {outlet.id}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  modalContent: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    shadowColor: colors.slate900,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    backgroundColor: colors.slate50,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.headlineSm,
    color: colors.slate900,
  },
  subtitle: {
    ...typography.bodySm,
    color: colors.slate600,
  },
  closeButton: {
    width: spacing.touchTargetMin,
    height: spacing.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  closeText: {
    fontSize: 18,
    color: colors.slate600,
    fontWeight: '700',
  },
  list: {
    maxHeight: 380,
  },
  listContent: {
    padding: spacing.md,
    gap: spacing.xs,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: colors.surface,
    gap: spacing.md,
    minHeight: spacing.touchTargetMin,
  },
  itemSelected: {
    backgroundColor: '#eff6ff',
    borderColor: colors.primaryLight,
  },
  itemRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  itemInfo: {
    flex: 1,
    gap: 2,
  },
  itemName: {
    ...typography.labelMd,
    color: colors.slate900,
  },
  itemNameSelected: {
    color: colors.primary,
    fontWeight: '800',
  },
  itemDetail: {
    ...typography.bodySm,
    color: colors.slate500,
    fontSize: 12,
  },
});
