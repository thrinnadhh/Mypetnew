import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { images } from '../src/designData'
import { authenticatedFetch, clearCustomerSession, loadCustomerSession } from '../src/session'
import type { CustomerSession } from '../src/session'
import { Badge, InfoCard, Page } from '../src/ui'
import { metrics, palette, text } from '../src/theme'

export default function ProfileScreen() {
  const [session, setSession] = useState<CustomerSession | null>(null)
  const [loadingSession, setLoadingSession] = useState(true)

  useEffect(() => {
    void loadCustomerSession().then((value) => {
      setSession(value)
      setLoadingSession(false)
    })
  }, [])

  const logout = async () => {
    try {
      if (session !== null) {
        await authenticatedFetch('/api/v1/auth/sessions/current', { method: 'DELETE' })
      }
    } catch {
      // Local logout must still succeed if the network/session is already unavailable.
    } finally {
      await clearCustomerSession()
      setSession(null)
      router.replace('/')
    }
  }

  return (
    <Page title="MyPetNow">
      <View style={styles.profileCard}>
        <Image source={{ uri: images.profile }} style={styles.avatar} />
        <View style={styles.flex}>
          <Text style={text.section}>{session === null ? 'Guest customer' : 'Verified customer'}</Text>
          <Text style={text.muted}>{loadingSession ? 'Checking session…' : session?.mobile ?? 'Browse freely; verify only when you need account features.'}</Text>
          <View style={styles.badgeWrap}><Badge label={session === null ? 'GUEST' : 'VERIFIED'} tone={session === null ? 'blue' : 'green'} /></View>
        </View>
      </View>

      {session === null && !loadingSession ? (
        <Pressable accessibilityRole="button" onPress={() => { router.push('/otp') }} style={styles.signIn}><Text style={styles.signInText}>Verify mobile / Sign in</Text></Pressable>
      ) : null}

      <InfoCard title="My Pets · design preview">
        <View style={styles.pets}><Pet image={images.pet1} name="Bella" type="Dog" /><Pet image={images.pet2} name="Buddy" type="Cat" /><Pressable accessibilityRole="button" disabled style={[styles.addPet, styles.disabled]}><Text style={styles.addPetIcon}>＋</Text><Text style={styles.addPetText}>Add later</Text></Pressable></View>
        <Text style={text.tiny}>Pet-profile persistence is not part of the active Sprint 1 backend, so these cards are visual placeholders only.</Text>
      </InfoCard>

      <InfoCard title="Active Reminders · preview">
        <Reminder icon="💉" title="Bella: Rabies Booster" detail="Sample reminder · backend deferred" />
        <Reminder icon="✂️" title="Buddy: Grooming" detail="Sample reminder · booking deferred" />
      </InfoCard>

      <InfoCard title="Saved Addresses · preview">
        <Address icon="⌂" title="Home" detail="Address-book persistence is deferred" />
        <Address icon="▣" title="Work" detail="Address-book persistence is deferred" />
      </InfoCard>

      <View style={styles.menu}>
        <MenuRow disabled label="Edit Profile · deferred" />
        <MenuRow label="Notifications" onPress={() => { router.push('/inbox') }} />
        <MenuRow disabled label="Support & FAQ · deferred" />
        <Pressable accessibilityRole="button" onPress={() => { void logout() }} style={styles.menuRow}><Text style={styles.logout}>{session === null ? 'Return home' : 'Logout'}</Text><Text style={styles.chevron}>›</Text></Pressable>
      </View>
    </Page>
  )
}

function MenuRow({ label, disabled = false, onPress }: { readonly label: string; readonly disabled?: boolean; readonly onPress?: () => void }) {
  const inactive = disabled || onPress === undefined
  return <Pressable accessibilityRole="button" disabled={inactive} onPress={onPress} style={[styles.menuRow, inactive && styles.disabled]}><Text style={styles.menuText}>{label}</Text><Text style={styles.chevron}>›</Text></Pressable>
}
function Pet({ image, name, type }: { readonly image: string; readonly name: string; readonly type: string }) {
  return <View style={styles.pet}><Image source={{ uri: image }} style={styles.petImage} /><Text style={styles.petName}>{name}</Text><Text style={text.tiny}>{type}</Text></View>
}
function Reminder({ icon, title, detail }: { readonly icon: string; readonly title: string; readonly detail: string }) {
  return <View style={styles.reminder}><View style={styles.reminderIcon}><Text>{icon}</Text></View><View style={styles.flex}><Text style={styles.reminderTitle}>{title}</Text><Text style={text.tiny}>{detail}</Text></View></View>
}
function Address({ icon, title, detail }: { readonly icon: string; readonly title: string; readonly detail: string }) {
  return <View style={styles.address}><Text style={styles.addressIcon}>{icon}</Text><View style={styles.flex}><Text style={styles.reminderTitle}>{title}</Text><Text style={text.tiny}>{detail}</Text></View></View>
}

const styles = StyleSheet.create({
  profileCard: { alignItems: 'center', backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusLg, borderWidth: 1, flexDirection: 'row', gap: 14, padding: 16 },
  avatar: { borderRadius: 34, height: 68, width: 68 },
  flex: { flex: 1 },
  badgeWrap: { marginTop: 7 },
  signIn: { alignItems: 'center', backgroundColor: palette.primaryBright, borderRadius: metrics.radiusSm, justifyContent: 'center', minHeight: 48, paddingHorizontal: 16 },
  signInText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
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
  address: { alignItems: 'flex-start', flexDirection: 'row', gap: 10, paddingVertical: 4 },
  addressIcon: { color: palette.primary, fontSize: 20 },
  menu: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusMd, borderWidth: 1, overflow: 'hidden' },
  menuRow: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 54, paddingHorizontal: 16 },
  menuText: { color: palette.text, flex: 1, fontSize: 13, fontWeight: '700' },
  logout: { color: palette.danger, flex: 1, fontSize: 13, fontWeight: '800' },
  chevron: { color: palette.muted, fontSize: 23 },
  disabled: { opacity: 0.48 }
})
