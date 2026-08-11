import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { runtimeConfig } from '../src/runtime'
import { Page } from '../src/ui'
import { metrics, palette, text } from '../src/theme'

export default function OtpScreen() {
  const [mobile, setMobile] = useState('+91')
  const [status, setStatus] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const requestCode = async () => {
    if (sending) return
    setSending(true)
    setStatus('Sending verification code…')
    try {
      const response = await fetch(`${runtimeConfig.apiUrl}/api/v1/auth/otp/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mobile, purpose: 'LOGIN', deviceId: 'mobile-app' })
      })
      setStatus(response.ok ? 'If this number can receive messages, a code is on its way.' : 'We could not send a code. Try again later.')
    } catch {
      setStatus('You appear to be offline. Reconnect and try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <Page bottomNav={false} showBack title="Verify mobile">
      <View style={styles.hero}><View style={styles.logo}><Text style={styles.logoText}>🐾</Text></View><Text style={text.title}>Welcome to MyPetNow</Text><Text style={styles.center}>Verify your mobile only when you are ready to order or use account features.</Text></View>
      <View style={styles.form}>
        <Text style={styles.label}>Indian mobile number</Text>
        <TextInput accessibilityLabel="Indian mobile number" keyboardType="phone-pad" onChangeText={setMobile} placeholder="+91 98765 43210" placeholderTextColor={palette.muted} style={styles.input} value={mobile} />
        <Pressable accessibilityRole="button" disabled={sending} onPress={() => { void requestCode() }} style={[styles.button, sending && styles.disabled]}><Text style={styles.buttonText}>{sending ? 'Sending…' : 'Send verification code'}</Text></Pressable>
        {status ? <View style={styles.status}><Text accessibilityLiveRegion="polite" style={text.muted}>{status}</Text></View> : null}
      </View>
      <Text style={styles.privacy}>We intentionally do not reveal whether this phone number already has an account.</Text>
    </Page>
  )
}
const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 9, paddingTop: 18 },
  logo: { alignItems: 'center', backgroundColor: palette.primarySoft, borderRadius: 36, height: 72, justifyContent: 'center', width: 72 },
  logoText: { fontSize: 30 },
  center: { color: palette.muted, fontSize: 14, lineHeight: 21, maxWidth: 320, textAlign: 'center' },
  form: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusLg, borderWidth: 1, gap: 9, padding: 16 },
  label: { color: palette.text, fontSize: 12, fontWeight: '800' },
  input: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusSm, borderWidth: 1, color: palette.text, fontSize: 16, minHeight: 52, paddingHorizontal: 14 },
  button: { alignItems: 'center', backgroundColor: palette.primaryBright, borderRadius: metrics.radiusSm, justifyContent: 'center', marginTop: 4, minHeight: 50 },
  buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  disabled: { opacity: 0.6 },
  status: { backgroundColor: palette.surfaceSoft, borderRadius: 8, padding: 10 },
  privacy: { color: palette.muted, fontSize: 11, lineHeight: 16, textAlign: 'center' }
})
