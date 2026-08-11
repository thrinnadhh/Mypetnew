import { Image, StyleSheet, Text, View } from 'react-native'
import { images } from '../src/designData'
import { Badge, InfoCard, Page, PrimaryButton } from '../src/ui'
import { metrics, palette, text } from '../src/theme'

export default function HospitalScreen() {
  return (
    <Page showBack title="City Pet Hospital">
      <View style={styles.hero}><Image source={{ uri: images.groom2 }} style={styles.heroImage} /><View style={styles.heroTags}><Badge label="Emergency Care" tone="blue" /><Badge label="General Care" tone="green" /></View></View>
      <View style={styles.stats}><View style={styles.stat}><Text style={styles.statValue}>★ 4.9</Text><Text style={text.tiny}>128 reviews</Text></View><View style={styles.stat}><Text style={styles.statValue}>1.2 km</Text><Text style={text.tiny}>Distance</Text></View><View style={styles.stat}><Text style={styles.statValue}>24/7</Text><Text style={text.tiny}>Open now</Text></View></View>
      <InfoCard title="Select a date"><View style={styles.dates}>{['Mon 12', 'Tue 13', 'Wed 14', 'Thu 15', 'Fri 16'].map((day, index) => <View key={day} style={[styles.date, index === 3 && styles.dateActive]}><Text style={[styles.dateText, index === 3 && styles.dateTextActive]}>{day.replace(' ', '\n')}</Text></View>)}</View><View style={styles.legend}><Text style={text.tiny}>● Available</Text><Text style={text.tiny}>● Limited</Text><Text style={text.tiny}>● Full</Text></View></InfoCard>
      <InfoCard title="Doctor information"><Text style={styles.doctor}>Dr. Smith</Text><Text style={styles.current}>● Currently in</Text><Text style={text.muted}>Senior veterinarian with experience in small-animal surgery and preventive care.</Text><PrimaryButton compact disabled label="Call later" /></InfoCard>
      <InfoCard tone="blue" title="Design preview"><Text style={text.muted}>Veterinary appointment booking is deferred. This screen only establishes the approved frontend hierarchy, controls and responsive dimensions.</Text></InfoCard>
      <PrimaryButton disabled label="Book appointment — deferred" />
    </Page>
  )
}

const styles = StyleSheet.create({
  hero: { borderRadius: metrics.radiusLg, height: 210, overflow: 'hidden', position: 'relative' },
  heroImage: { height: '100%', width: '100%' },
  heroTags: { bottom: 10, flexDirection: 'row', gap: 8, left: 10, position: 'absolute' },
  stats: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusMd, borderWidth: 1, flexDirection: 'row', paddingVertical: 14 },
  stat: { alignItems: 'center', borderRightColor: palette.border, borderRightWidth: StyleSheet.hairlineWidth, flex: 1, gap: 3 },
  statValue: { color: palette.text, fontSize: 15, fontWeight: '900' },
  dates: { flexDirection: 'row', gap: 8 },
  date: { alignItems: 'center', borderColor: palette.border, borderRadius: 10, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 62 },
  dateActive: { backgroundColor: palette.primarySoft, borderColor: palette.primary },
  dateText: { color: palette.text, fontSize: 11, fontWeight: '700', lineHeight: 18, textAlign: 'center' },
  dateTextActive: { color: palette.primary },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  doctor: { color: palette.text, fontSize: 16, fontWeight: '900' },
  current: { color: palette.success, fontSize: 12, fontWeight: '800' }
})
