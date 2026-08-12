import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { FilterChip, PrimaryAction, StateView } from '@/components/foundation/primitives';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/components/ui/primary-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { apiErrorMessage } from '@/contracts/api-error';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { radii, shadows, spacing, touchTarget, typography } from '@/design/tokens';
import { useAppointments } from '@/hooks/use-appointments';
import { useTheme } from '@/hooks/use-theme';
import {
  fetchMedicalDocuments,
  getMedicalDocumentLink,
  uploadMedicalDocument,
  type MedicalDocument,
} from '@/services/medical-documents';

type ReportFilter = 'ALL' | 'PROVIDER' | 'UPLOADED';

type ProviderReport = {
  kind: 'provider';
  id: string;
  appointmentId: string;
  petName: string;
  title: string;
  clinicName: string;
  createdAt: string;
  documentUrl: string;
};

type UploadedReport = {
  kind: 'uploaded';
  id: string;
  appointmentId: string;
  petName: string;
  title: string;
  clinicName: string;
  createdAt: string;
  document: MedicalDocument;
};

type ReportItem = ProviderReport | UploadedReport;

function formatReportDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

function fileNameForAsset(uri: string, fileName?: string | null): string {
  return fileName?.trim() || uri.split('/').pop() || `medical-report-${Date.now()}.jpg`;
}

export default function MedicalReportsScreen() {
  const theme = useTheme();
  const { requireAuth } = useAuthIntent();
  const { user, session, appointments, state, reload } = useAppointments();
  const [activeFilter, setActiveFilter] = useState<ReportFilter>('ALL');
  const [uploadVisible, setUploadVisible] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [uploadedDocuments, setUploadedDocuments] = useState<MedicalDocument[]>([]);
  const [documentLoading, setDocumentLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [documentError, setDocumentError] = useState<unknown>(null);

  const loadDocuments = useCallback(async () => {
    if (!session) {
      setDocumentLoading(false);
      return;
    }
    setDocumentError(null);
    try {
      setUploadedDocuments(await fetchMedicalDocuments(session.access_token));
    } catch (error) {
      setDocumentError(error);
    } finally {
      setDocumentLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const uploadAppointments = useMemo(
    () => appointments.filter((appointment) => appointment.status !== 'CANCELLED'),
    [appointments],
  );

  useEffect(() => {
    if (!selectedAppointmentId && uploadAppointments.length > 0) {
      setSelectedAppointmentId(uploadAppointments[0].id);
    }
  }, [selectedAppointmentId, uploadAppointments]);

  const reports = useMemo<ReportItem[]>(() => {
    const appointmentMap = new Map(appointments.map((appointment) => [appointment.id, appointment]));
    const providerReports: ProviderReport[] = appointments
      .filter((appointment) => Boolean(appointment.prescriptionDocUrl))
      .map((appointment) => ({
        kind: 'provider',
        id: `provider-${appointment.id}`,
        appointmentId: appointment.id,
        petName: appointment.petName,
        title: `${appointment.serviceName} prescription`,
        clinicName: appointment.providerName,
        createdAt: appointment.slotStartsAt,
        documentUrl: appointment.prescriptionDocUrl as string,
      }));
    const customerReports: UploadedReport[] = uploadedDocuments.map((document) => {
      const appointment = appointmentMap.get(document.appointmentId);
      return {
        kind: 'uploaded',
        id: document.documentId,
        appointmentId: document.appointmentId,
        petName: appointment?.petName ?? 'Your pet',
        title: document.originalFilename,
        clinicName: appointment?.providerName ?? 'Customer upload',
        createdAt: document.createdAt,
        document,
      };
    });
    return [...providerReports, ...customerReports]
      .filter((report) => activeFilter === 'ALL' || (activeFilter === 'PROVIDER' ? report.kind === 'provider' : report.kind === 'uploaded'))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [activeFilter, appointments, uploadedDocuments]);

  const openReport = useCallback(async (report: ReportItem, disposition: 'inline' | 'attachment' = 'inline') => {
    if (!session) return;
    try {
      const url = report.kind === 'uploaded'
        ? await getMedicalDocumentLink(report.document.documentId, session.access_token, disposition)
        : report.documentUrl;
      const supported = await Linking.canOpenURL(url);
      if (!supported) throw new Error('This report cannot be opened on this device.');
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert('Could not open report', apiErrorMessage(error, 'Request a fresh private report link.'));
    }
  }, [session]);

  const chooseAndUpload = useCallback(async () => {
    if (!session || !selectedAppointmentId) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo permission required', 'Allow photo access to upload a scanned prescription or medical report.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const uploaded = await uploadMedicalDocument(
        selectedAppointmentId,
        {
          uri: asset.uri,
          name: fileNameForAsset(asset.uri, asset.fileName),
          mimeType: asset.mimeType ?? 'image/jpeg',
        },
        session.access_token,
      );
      setUploadedDocuments((current) => [uploaded, ...current]);
      setUploadVisible(false);
      Alert.alert('Medical document uploaded', 'The file is private. MyPet issues a new five-minute link for every view or download.');
    } catch (error) {
      Alert.alert('Upload failed', apiErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }, [selectedAppointmentId, session]);

  if (!user || !session) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <ScreenHeader title="Medical reports" subtitle="Private health documents for your appointments" />
        <StateView
          kind="unauthenticated"
          title="Sign in to view reports"
          message="Medical documents are available only to the pet parent and authorized provider."
          actionLabel="Sign in"
          onAction={() => void requireAuth({ action: 'ORDER_HISTORY', returnTo: '/health/reports' })}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScreenHeader
        title="Medical reports"
        subtitle="Private, appointment-scoped documents"
        trailing={
          <Pressable
            onPress={() => setUploadVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Upload a medical report"
            style={({ pressed }) => [styles.uploadButton, { backgroundColor: theme.primary }, pressed && styles.pressed]}
          >
            <AppIcon name="upload" color="#FFFFFF" size={21} />
          </Pressable>
        }
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
        <FilterChip label="All" selected={activeFilter === 'ALL'} onPress={() => setActiveFilter('ALL')} />
        <FilterChip label="Provider issued" selected={activeFilter === 'PROVIDER'} onPress={() => setActiveFilter('PROVIDER')} />
        <FilterChip label="My uploads" selected={activeFilter === 'UPLOADED'} onPress={() => setActiveFilter('UPLOADED')} />
      </ScrollView>

      {documentError ? (
        <StateView kind="error" title="Private documents unavailable" message={apiErrorMessage(documentError)} actionLabel="Retry" onAction={() => void loadDocuments()} />
      ) : state === 'idle' || state === 'loading' || documentLoading ? (
        <StateView kind="loading" title="Loading reports" message="Requesting current appointment and private-document metadata." />
      ) : state === 'offline' ? (
        <StateView kind="offline" title="You are offline" message="Reconnect to request short-lived private report links." actionLabel="Retry" onAction={() => void reload()} />
      ) : state === 'error' ? (
        <StateView kind="error" title="Reports unavailable" message="We could not load your appointment documents." actionLabel="Retry" onAction={() => void reload()} />
      ) : reports.length === 0 ? (
        <StateView kind="empty" title="No medical reports yet" message="Upload a scanned report or wait for a verified provider to issue a prescription." />
      ) : (
        <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {reports.map((report) => (
            <View key={report.id} style={[styles.reportCard, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <View style={[styles.documentIcon, { backgroundColor: theme.primarySoft }]}>
                <AppIcon name="document" color={theme.primary} size={28} />
              </View>
              <View style={styles.reportBody}>
                <View style={styles.reportHeader}>
                  <View style={styles.flex}>
                    <ThemedText style={styles.reportTitle} numberOfLines={2}>{report.title}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{report.clinicName}</ThemedText>
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">{formatReportDate(report.createdAt)}</ThemedText>
                </View>
                <View style={styles.metaRow}>
                  <StatusBadge label={report.petName} color={theme.success} />
                  <StatusBadge label={report.kind === 'uploaded' ? 'Private signed access' : 'Provider issued'} color={theme.primary} />
                </View>
                <View style={styles.actionRow}>
                  <Pressable onPress={() => void openReport(report)} accessibilityRole="button" style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}>
                    <AppIcon name="eye" color={theme.primary} size={20} />
                    <ThemedText type="smallBold" style={{ color: theme.primary }}>View</ThemedText>
                  </Pressable>
                  {report.kind === 'uploaded' ? (
                    <Pressable onPress={() => void openReport(report, 'attachment')} accessibilityRole="button" style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}>
                      <AppIcon name="download" color={theme.textSecondary} size={20} />
                      <ThemedText type="smallBold" themeColor="textSecondary">Download</ThemedText>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={uploadVisible} transparent animationType="slide" onRequestClose={() => setUploadVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, shadows.raised, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]} accessibilityViewIsModal>
            <View style={[styles.modalIcon, { backgroundColor: theme.primarySoft }]}>
              <AppIcon name="shield" color={theme.primary} size={28} />
            </View>
            <ThemedText type="title">Upload a private report</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              Choose the appointment this document belongs to. Images are limited to 10 MB and stored under an opaque private key.
            </ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
              {uploadAppointments.map((appointment) => (
                <FilterChip
                  key={appointment.id}
                  label={`${appointment.petName} · ${formatReportDate(appointment.slotStartsAt)}`}
                  selected={selectedAppointmentId === appointment.id}
                  onPress={() => setSelectedAppointmentId(appointment.id)}
                />
              ))}
            </ScrollView>
            {uploadAppointments.length === 0 ? (
              <StateView kind="empty" title="No appointment available" message="Book an appointment before attaching a medical document." />
            ) : (
              <PrimaryAction label="Choose scanned report" loading={uploading} onPress={() => void chooseAndUpload()} />
            )}
            <PrimaryButton label="Cancel" variant="secondary" onPress={() => setUploadVisible(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.x4, paddingTop: spacing.x2 },
  flex: { flex: 1 },
  uploadButton: { width: touchTarget, height: touchTarget, borderRadius: radii.compact, alignItems: 'center', justifyContent: 'center' },
  tabRow: { gap: spacing.x2, paddingRight: spacing.x4, paddingBottom: spacing.x3 },
  listContent: { gap: spacing.x3, paddingBottom: spacing.x8 },
  reportCard: { minHeight: 152, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x4, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.x3 },
  documentIcon: { width: 56, height: 56, borderRadius: radii.compact, alignItems: 'center', justifyContent: 'center' },
  reportBody: { flex: 1, gap: spacing.x3 },
  reportHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.x3 },
  reportTitle: { ...typography.title, fontSize: 17, lineHeight: 23 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x4 },
  textAction: { minHeight: touchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.x2, paddingHorizontal: spacing.x2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(11,28,48,0.52)', justifyContent: 'center', padding: spacing.x4 },
  modalCard: { width: '100%', maxWidth: 620, maxHeight: '88%', alignSelf: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.feature, padding: spacing.x6, alignItems: 'center', gap: spacing.x3 },
  modalIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  pressed: { opacity: 0.82 },
});
