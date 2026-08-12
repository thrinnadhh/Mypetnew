import { Image, StyleSheet, Text, View } from 'react-native'
import { images } from '../src/designData'
import { Badge, InfoCard, Page, PrimaryButton } from '../src/ui'
import { metrics, palette, text } from '../src/theme'

export default function GuideScreen() {
  return (
    <Page showBack title="Puppy Growth (2–12 mo)">
      <View style={styles.hero}>
        <Image source={{ uri: images.pet1 }} style={styles.heroImage} />
        <View style={styles.overlay}><Badge label="HEALTH GUIDE" tone="amber" /><Text style={styles.heroTitle}>Your complete guide to navigating the critical first year</Text></View>
      </View>
      <InfoCard title="Milestone Tracking">
        <Text style={text.muted}>Monitor your puppy’s development closely. Rapid growth happens in the first months.</Text>
        <View style={styles.metrics}><Metric label="Avg. Weight Gain" value="1–2 lbs/wk" /><Metric label="Height Growth" value="Steady" /></View>
      </InfoCard>
      <InfoCard tone="red" title="Health Watch"><Bullet>Watch for signs of Parvovirus: lethargy, vomiting.</Bullet><Bullet>Ensure core vaccinations are completed by 16 weeks.</Bullet><Bullet>Monitor teething and provide safe chew toys.</Bullet></InfoCard>
      <InfoCard tone="blue" title="Socialization"><Text style={text.body}>The critical window closes around 16 weeks. Introduce them to varied sounds, surfaces, people and other pets positively.</Text><Check>Meet 100 new people</Check><Check>Explore 5 different environments</Check></InfoCard>
      <InfoCard title="Checklist for Success"><Check>Schedule 12-week vaccinations</Check><Check>Start basic obedience training</Check><Check>Switch to high-quality puppy food</Check><Check>Purchase appropriate-size crate</Check></InfoCard>
      <View style={styles.consult}><Text style={styles.consultTitle}>Need Professional Advice?</Text><Text style={styles.consultText}>Provider booking is deferred, but the CTA sizing and visual hierarchy are ready for later API binding.</Text><PrimaryButton disabled label="Book consultation — deferred" /></View>
    </Page>
  )
}
function Metric({ label, value }: { label: string; value: string }) { return <View style={styles.metric}><Text style={text.tiny}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View> }
function Bullet({ children }: { children: string }) { return <View style={styles.line}><Text style={styles.bullet}>⚠</Text><Text style={[text.body, styles.lineText]}>{children}</Text></View> }
function Check({ children }: { children: string }) { return <View style={styles.line}><View style={styles.checkbox} /><Text style={[text.body, styles.lineText]}>{children}</Text></View> }
const styles = StyleSheet.create({
  hero: { borderRadius: metrics.radiusLg, height: 220, overflow: 'hidden', position: 'relative' },
  heroImage: { height: '100%', width: '100%' },
  overlay: { backgroundColor: 'rgba(8,20,35,0.58)', bottom: 0, gap: 8, left: 0, padding: 18, position: 'absolute', right: 0 },
  heroTitle: { color: '#FFFFFF', fontSize: 19, fontWeight: '900', lineHeight: 24 },
  metrics: { flexDirection: 'row', gap: 10 },
  metric: { alignItems: 'center', backgroundColor: palette.surfaceSoft, borderRadius: 9, flex: 1, gap: 3, padding: 10 },
  metricValue: { color: palette.text, fontSize: 13, fontWeight: '900' },
  line: { alignItems: 'flex-start', flexDirection: 'row', gap: 8 },
  lineText: { flex: 1 },
  bullet: { color: palette.danger },
  checkbox: { borderColor: palette.border, borderRadius: 3, borderWidth: 1, height: 18, marginTop: 2, width: 18 },
  consult: { backgroundColor: palette.primaryBright, borderRadius: metrics.radiusLg, gap: 10, padding: 18 },
  consultTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  consultText: { color: '#EAF1FF', fontSize: 13, lineHeight: 19 }
})
