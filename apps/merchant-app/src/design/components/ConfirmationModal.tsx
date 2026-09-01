import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, radius, spacing, typography } from '../tokens';
import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';

export interface ConfirmationModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'destructive' | 'success';
  requireReason?: boolean;
  reasonPlaceholder?: string;
  reasonLabel?: string;
  loading?: boolean;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
  testID?: string;
}

export function ConfirmationModal({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  requireReason = false,
  reasonPlaceholder = 'Enter reason (required)…',
  reasonLabel = 'Reason for this action',
  loading = false,
  onConfirm,
  onCancel,
  testID,
}: ConfirmationModalProps) {
  const [reason, setReason] = useState('');
  const [validationError, setValidationError] = useState('');

  function handleConfirm() {
    if (requireReason && !reason.trim()) {
      setValidationError('Please enter a reason before proceeding.');
      return;
    }
    setValidationError('');
    onConfirm(reason.trim() ? reason.trim() : undefined);
  }

  function handleCancel() {
    setReason('');
    setValidationError('');
    onCancel();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
      testID={testID}
    >
      <Pressable style={styles.backdrop} onPress={handleCancel}>
        <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
          </View>

          <View style={styles.body}>
            <Text style={styles.message}>{message}</Text>

            {requireReason ? (
              <View style={styles.reasonContainer}>
                <Text style={styles.reasonLabel}>{reasonLabel}</Text>
                <TextInput
                  value={reason}
                  onChangeText={(text) => {
                    setReason(text);
                    if (validationError) setValidationError('');
                  }}
                  placeholder={reasonPlaceholder}
                  placeholderTextColor={colors.slate400}
                  multiline
                  maxLength={240}
                  accessibilityLabel={reasonLabel}
                  style={styles.reasonInput}
                  testID={testID ? `${testID}-reason-input` : undefined}
                />
                <View style={styles.reasonMeta}>
                  {validationError ? (
                    <Text accessibilityRole="alert" style={styles.errorText}>
                      {validationError}
                    </Text>
                  ) : <View />}
                  <Text style={styles.charCount}>{reason.length}/240</Text>
                </View>
              </View>
            ) : null}
          </View>

          <View style={styles.actions}>
            <SecondaryButton
              title={cancelLabel}
              onPress={handleCancel}
              disabled={loading}
              style={styles.actionBtn}
              testID={testID ? `${testID}-cancel-button` : undefined}
            />
            <PrimaryButton
              title={confirmLabel}
              onPress={handleConfirm}
              loading={loading}
              variant={variant}
              style={styles.actionBtn}
              testID={testID ? `${testID}-confirm-button` : undefined}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  modalContent: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    shadowColor: colors.slate900,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 10,
  },
  header: {
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    backgroundColor: colors.slate50,
  },
  title: {
    ...typography.headlineSm,
    color: colors.slate900,
  },
  body: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  message: {
    ...typography.bodyMd,
    color: colors.slate700,
    lineHeight: 22,
  },
  reasonContainer: {
    gap: spacing.xs,
  },
  reasonLabel: {
    ...typography.labelSm,
    color: colors.slate800,
    fontWeight: '700',
  },
  reasonInput: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    ...typography.bodyMd,
    color: colors.onSurface,
    textAlignVertical: 'top',
    backgroundColor: colors.surfaceDim,
  },
  reasonMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorText: {
    ...typography.bodySm,
    color: colors.error,
    fontWeight: '600',
  },
  charCount: {
    ...typography.bodySm,
    color: colors.slate400,
    fontSize: 11,
  },
  actions: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    backgroundColor: colors.slate50,
  },
  actionBtn: {
    flex: 1,
  },
});
