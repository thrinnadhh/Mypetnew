import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { runtimeConfig } from '../src/runtime'
import { saveCustomerSession } from '../src/session'
import { Page } from '../src/ui'
import { metrics, palette, text } from '../src/theme'

interface OtpChallengeResponse {
  readonly challengeId: string
  readonly message: string
  readonly expiresAt: string
}

interface OtpSessionPayload {
  readonly accessToken: string
  readonly refreshToken: string
  readonly tokenType: string
  readonly accessTokenExpiresAt: string
  readonly refreshTokenExpiresAt: string
  readonly role: string
}

export default function OtpScreen() {
  const params = useLocalSearchParams<{ returnTo?: string }>()
  const [mobile, setMobile] = useState('+91')
  const [code, setCode] = useState('')
  const [challenge, setChallenge] = useState<OtpChallengeResponse | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)

  const requestCode = async () => {
    if (sending) return
    const normalizedMobile = normalizeIndianMobile(mobile)
    setMobile(normalizedMobile)
    setSending(true)
    setStatus('Sending verification code…')
    try {
      const response = await fetch(`${runtimeConfig.apiUrl}/api/v1/auth/otp/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mobile: normalizedMobile, purpose: 'LOGIN', deviceId: 'customer-mobile-app' })
      })
      if (!response.ok) {
        setChallenge(null)
        setStatus(response.status === 429 ? 'Too many attempts. Try again later.' : 'Enter a valid Indian mobile number and try again.')
        return
      }
      const body = await response.json() as OtpChallengeResponse
      setChallenge(body)
      setCode('')
      setStatus(body.message)
    } catch {
      setStatus('You appear to be offline. Reconnect and try again.')
    } finally {
      setSending(false)
    }
  }

  const verifyCode = async () => {
    if (challenge === null || verifying || code.length !== 6) return
    setVerifying(true)
    setStatus('Verifying code…')
    try {
      const response = await fetch(`${runtimeConfig.apiUrl}/api/v1/auth/otp/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          mobile,
          purpose: 'LOGIN',
          code
        })
      })
      if (!response.ok) {
        setStatus('The verification code is invalid or expired.')
        return
      }
      const payload = await response.json() as OtpSessionPayload
      await saveCustomerSession(payload, mobile)
      setStatus('Mobile verified successfully.')
      const returnTo = params.returnTo === '/checkout' ? '/checkout' : '/profile'
      router.replace(returnTo)
    } catch {
      setStatus('Verification could not be completed. Check your connection and try again.')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <Page bottomNav={false} showBack title="Verify mobile">
      <View style={styles.hero}><View style={styles.logo}><Text style={styles.logoText}>🐾</Text></View><Text style={text.title}>Welcome to MyPetNow</Text><Text style={styles.center}>Verify your mobile only when you are ready to order or use account features.</Text></View>
      <View style={styles.form}>
        <Text style={styles.label}>Indian mobile number</Text>
        <TextInput accessibilityLabel="Indian mobile number" editable={challenge === null} keyboardType="phone-pad" onChangeText={setMobile} placeholder="+91 98765 43210" placeholderTextColor={palette.muted} style={[styles.input, challenge !== null && styles.inputLocked]} value={mobile} />
        {challenge === null ? (
          <Pressable accessibilityRole="button" disabled={sending} onPress={() => { void requestCode() }} style={[styles.button, sending && styles.disabled]}><Text style={styles.buttonText}>{sending ? 'Sending…' : 'Send verification code'}</Text></Pressable>
        ) : (
          <>
            <Text style={styles.label}>6-digit verification code</Text>
            <TextInput accessibilityLabel="6-digit verification code" autoFocus keyboardType="number-pad" maxLength={6} onChangeText={(value) => { setCode(value.replace(/\D/g, '').slice(0, 6)) }} placeholder="000000" placeholderTextColor={palette.muted} style={[styles.input, styles.codeInput]} value={code} />
            <Pressable accessibilityRole="button" disabled={verifying || code.length !== 6} onPress={() => { void verifyCode() }} style={[styles.button, (verifying || code.length !== 6) && styles.disabled]}><Text style={styles.buttonText}>{verifying ? 'Verifying…' : 'Verify and continue'}</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={sending} onPress={() => { setChallenge(null); setCode(''); setStatus(null) }} style={styles.secondary}><Text style={styles.secondaryText}>Change number / resend</Text></Pressable>
            <Text style={styles.expiry}>Code expires at {new Date(challenge.expiresAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</Text>
          </>
        )}
        {status !== null ? <View style={styles.status}><Text accessibilityLiveRegion="polite" style={text.muted}>{status}</Text></View> : null}
      </View>
      <Text style={styles.privacy}>We intentionally do not reveal whether this phone number already has an account.</Text>
    </Page>
  )
}

function normalizeIndianMobile(input: string): string {
  const digits = input.replace(/\D/g, '')
  if (digits.length === 10) return `+91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  return input.trim().replace(/\s/g, '')
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 9, paddingTop: 18 },
  logo: { alignItems: 'center', backgroundColor: palette.primarySoft, borderRadius: 36, height: 72, justifyContent: 'center', width: 72 },
  logoText: { fontSize: 30 },
  center: { color: palette.muted, fontSize: 14, lineHeight: 21, maxWidth: 320, textAlign: 'center' },
  form: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusLg, borderWidth: 1, gap: 9, padding: 16 },
  label: { color: palette.text, fontSize: 12, fontWeight: '800' },
  input: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: metrics.radiusSm, borderWidth: 1, color: palette.text, fontSize: 16, minHeight: 52, paddingHorizontal: 14 },
  inputLocked: { backgroundColor: palette.surfaceSoft, color: palette.muted },
  codeInput: { fontSize: 24, fontWeight: '800', letterSpacing: 8, textAlign: 'center' },
  button: { alignItems: 'center', backgroundColor: palette.primaryBright, borderRadius: metrics.radiusSm, justifyContent: 'center', marginTop: 4, minHeight: 50 },
  buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  secondary: { alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  secondaryText: { color: palette.primary, fontSize: 13, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  status: { backgroundColor: palette.surfaceSoft, borderRadius: 8, padding: 10 },
  expiry: { color: palette.muted, fontSize: 11, textAlign: 'center' },
  privacy: { color: palette.muted, fontSize: 11, lineHeight: 16, textAlign: 'center' }
})
