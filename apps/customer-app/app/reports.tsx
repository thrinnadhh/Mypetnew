import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { InfoCard, Page, PrimaryButton } from '../src/ui'
import { metrics, palette, text } from '../src/theme'

export default function ReportsScreen() {
  const [details, setDetails] = useState('')
  return (
    <Page showBack title="Medical Reports">
      <View style={styles.intro}><Text style={text.title}>Bella’s History</Text><Text style={text.muted}>Keep track of medical records in one place.</Text></View>
      <InfoCard title="New Medical Entry">
        <Text style={text.muted}>This is a frontend-only form while medical persistence remains deferred.</Text>
        <Field label="Date of Visit" placeholder="dd/mm/yyyy" />
        <Field label="Event Type" placeholder="Select an option" />
        <Field label="Clinic / Provider (Optional)" placeholder="e.g. VetCare Clinic" />
        <View style={styles.field}><Text style={styles.label}>Detailed Description</Text><TextInput multiline onChangeText={setDetails} placeholder="Describe the visit, diagnosis, medications, or instructions..." placeholderTextColor={palette.muted} style={[styles.input, styles.textArea]} value={details} /></View>
        <PrimaryButton disabled label="Save record — deferred" />
      </InfoCard>
      <Record date="Oct 12, 2026" title="Annual Vaccination" detail="Rabies and DHPP boosters. Bella was well-behaved." doctor="Dr. Smith · VetCare Clinic" />
      <Record date="Jul 05, 2026" title="General Checkup" detail="Weight stable. Coat healthy. Routine adjustment recommended." doctor="Dr. Adams · VetCare Clinic" />
      <Record date="Mar 15, 2026" title="Skin Issue Assessment" detail="Mild dermatitis noted on lower abdomen." doctor="Dr. Smith · VetCare Clinic" />
    </Page>
  )
}
function Field({ label, placeholder }: { label: string; placeholder: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput editable={false} placeholder={placeholder} placeholderTextColor={palette.muted} style={styles.input} /></View>
}
function Record({ date, title, detail, doctor }: { date: string; title: string; detail: string; doctor: string }) {
  return <Pressable style={styles.record}><View style={styles.dateChip}><Text style={styles.dateText}>{date}</Text></View><Text style={styles.recordTitle}>{title}</Text><Text style={text.muted}>{detail}</Text><Text style={styles.doctor}>{doctor}</Text><Text style={styles.arrow}>›</Text></Pressable>
}
const styles = StyleSheet.create({
  intro: { gap: 4 },
  field: { gap: 6 },
  label: { color: palette.text, fontSize: 12, fontWeight: '800' },
  input: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusSm, borderWidth: 1, color: palette.text, fontSize: 14, minHeight: 48, paddingHorizontal: 12 },
  textArea: { minHeight: 110, paddingTop: 12, textAlignVertical: 'top' },
  record: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusMd, borderWidth: 1, gap: 6, padding: 16, position: 'relative' },
  dateChip: { alignSelf: 'flex-end', backgroundColor: palette.surfaceSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  dateText: { color: palette.muted, fontSize: 9, fontWeight: '700' },
  recordTitle: { color: palette.text, fontSize: 15, fontWeight: '900' },
  doctor: { color: '#8A6500', fontSize: 10, fontWeight: '800' },
  arrow: { bottom: 12, color: palette.primary, fontSize: 28, position: 'absolute', right: 14 }
})
