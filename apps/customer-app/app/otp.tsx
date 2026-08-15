import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { runtimeConfig } from '../src/runtime'
import { saveCustomerSession } from '../src/session'
import { styles } from '../src/styles'
import { getNativeInstallationId } from '@mypet/mobile-notifications'

export default function OtpScreen() {
  const [mobile, setMobile] = useState('+91')
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [adultEligible, setAdultEligible] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const requestCode = async () => {
    setStatus('Sending a verification code…')
    try {
      const deviceId = await getNativeInstallationId()
      const response = await fetch(`${runtimeConfig.apiUrl}/api/v1/auth/otp/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mobile, purpose: 'LOGIN', deviceId })
      })
      if (!response.ok) throw new Error('OTP request failed')
      const body = await response.json() as { challengeId: string }
      setChallengeId(body.challengeId)
      setStatus('If this number can receive messages, a code is on its way.')
    } catch {
      setStatus('You appear to be offline. Reconnect and try again.')
    }
  }

  const verifyCode = async () => {
    if (!challengeId || !adultEligible) {
      setStatus('Confirm that the account holder is at least 18 before continuing.')
      return
    }
    setStatus('Verifying…')
    try {
      const response = await fetch(`${runtimeConfig.apiUrl}/api/v1/auth/otp/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          challengeId,
          mobile,
          purpose: 'LOGIN',
          code,
          adultEligibilityAttested: true
        })
      })
      if (!response.ok) throw new Error('OTP verification failed')
      const session = await response.json() as { accessToken: string; refreshToken: string }
      await saveCustomerSession(session)
      setCode('')
      setStatus('Mobile verified. Your session is stored in protected device storage.')
    } catch {
      setStatus('The verification code is invalid or expired.')
    }
  }

  return (
    <View style={styles.screen}>
      <Text accessibilityRole="header" style={styles.title}>Verify your mobile</Text>
      <Text style={styles.subtitle}>We never reveal whether a mobile number already has an account.</Text>
      <TextInput
        accessibilityLabel="Indian mobile number"
        keyboardType="phone-pad"
        onChangeText={setMobile}
        style={styles.input}
        value={mobile}
      />
      <Pressable accessibilityRole="button" onPress={() => { void requestCode() }} style={styles.button}>
        <Text style={styles.buttonText}>Send code</Text>
      </Pressable>
      {challengeId ? <>
        <TextInput
          accessibilityLabel="Six digit verification code"
          keyboardType="number-pad"
          maxLength={6}
          onChangeText={setCode}
          style={styles.input}
          value={code}
        />
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: adultEligible }} onPress={() => { setAdultEligible(!adultEligible) }}>
          <Text style={styles.status}>{adultEligible ? '☑' : '☐'} I confirm the account holder is at least 18.</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => { void verifyCode() }} style={styles.button}>
          <Text style={styles.buttonText}>Verify and sign in</Text>
        </Pressable>
      </> : null}
      {status ? <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text> : null}
    </View>
  )
}
