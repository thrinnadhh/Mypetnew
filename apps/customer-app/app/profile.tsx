import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { images } from '../src/designData'
import { Badge, InfoCard, Page } from '../src/ui'
import { metrics, palette, text } from '../src/theme'

export default function ProfileScreen() {
  return (
    <Page title="MyPetNow">
      <View style={styles.profileCard}>
        <Image source={{ uri: images.profile }} style={styles.avatar} />
        <View style={styles.flex}><Text style={text.section}>Alex Johnson</Text><Text style={text.muted}>Joined Sep 2026</Text><View style={styles.badgeWrap}><Badge label="Premium Member" tone="amber" /></View></View>
      </View>

      <InfoCard title="My Pets">
        <View style={styles.pets}><Pet image={images.pet1} name="Bella" type="Dog" /><Pet image={images.pet2} name="Buddy" type="Cat" /><Pressable style={styles.addPet}><Text style={styles.addPetIcon}>＋</Text><Text style={styles.addPetText}>Add Pet</Text></Pressable></View>
      </InfoCard>

      <InfoCard title="Active Reminders">
        <Reminder icon="💉" title="Bella: Rabies Booster" detail="Due: Oct 12 · Dr. Smith Clinic" />
        <Reminder icon="✂️" title="Buddy: Grooming Appt" detail="Tomorrow, 10:00 AM · Paws & Claws" />
      </InfoCard>

      <InfoCard title="Saved Addresses">
        <Address icon="⌂" title="Home" detail="123 Pet Lane, Tirupati, Andhra Pradesh" />
        <Address icon="▣" title="Work" detail="SV University Road, Tirupati" />
      </InfoCard>

      <View style={styles.menu}>
        {['Edit Profile', 'Notifications', 'Support & FAQ'].map((item) => <Pressable key={item} style={styles.menuRow}><Text style={styles.menuText}>{item}</Text><Text style={styles.chevron}>›</Text></Pressable>)}
        <Pressable style={styles.menuRow}><Text style={styles.logout}>Logout</Text><Text style={styles.chevron}>›</Text></Pressable>
      </View>
    </Page>
  )
}

function Pet({ image, name, type }: { image: string; name: string; type: string }) {
  return <View style={styles.pet}><Image source={{ uri: image }} style={styles.petImage} /><Text style={styles.petName}>{name}</Text><Text style={text.tiny}>{type}</Text></View>
}
function Reminder({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return <View style={styles.reminder}><View style={styles.reminderIcon}><Text>{icon}</Text></View><View style={styles.flex}><Text style={styles.reminderTitle}>{title}</Text><Text style={text.tiny}>{detail}</Text></View><Text style={styles.kebab}>⋮</Text></View>
}
function Address({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return <View style={styles.address}><Text style={styles.addressIcon}>{icon}</Text><View style={styles.flex}><Text style={styles.reminderTitle}>{title}</Text><Text style={text.tiny}>{detail}</Text></View></View>
}

const styles = StyleSheet.create({
  profileCard: { alignItems: 'center', backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusLg, borderWidth: 1, flexDirection: 'row', gap: 14, padding: 16 },
  avatar: { borderRadius: 34, height: 68, width: 68 },
  flex: { flex: 1 },
  badgeWrap: { marginTop: 7 },
  pets: { alignItems: 'flex-start', flexDirection: 'row', gap: 18 },
  pet: { alignItems: 'center', gap: 2 },
  petImage: { borderRadius: 26, height: 52, width: 52 },
  petName: { color: palette.text, fontSize: 12, fontWeight: '800' },
  addPet: { alignItems: 'center', justifyContent: 'center', minHeight: 70, minWidth: 64 },
  addPetIcon: { color: palette.primary, fontSize: 25 },
  addPetText: { color: palette.primary, fontSize: 11, fontWeight: '800' },
  reminder: { alignItems: 'center', backgroundColor: palette.surfaceSoft, borderRadius: 10, flexDirection: 'row', gap: 10, minHeight: 62, padding: 10 },
  reminderIcon: { alignItems: 'center', backgroundColor: '#FFE7ED', borderRadius: 8, height: 38, justifyContent: 'center', width: 38 },
  reminderTitle: { color: palette.text, fontSize: 12, fontWeight: '800' },
  kebab: { color: palette.primary, fontSize: 20 },
  address: { alignItems: 'flex-start', flexDirection: 'row', gap: 10, paddingVertical: 4 },
  addressIcon: { color: palette.primary, fontSize: 20 },
  menu: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusMd, borderWidth: 1, overflow: 'hidden' },
  menuRow: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 54, paddingHorizontal: 16 },
  menuText: { color: palette.text, flex: 1, fontSize: 13, fontWeight: '700' },
  logout: { color: palette.danger, flex: 1, fontSize: 13, fontWeight: '800' },
  chevron: { color: palette.muted, fontSize: 23 }
})
