import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { runtimeConfig } from '../src/runtime'
import { styles } from '../src/styles'

export default function OtpScreen() {
  const [mobile, setMobile] = useState('+91')
  const [status, setStatus] = useState<string | null>(null)

  const requestCode = async () => {
    setStatus('Sending a verification code…')
    try {
      const response = await fetch(`${runtimeConfig.apiUrl}/api/v1/auth/otp/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mobile, purpose: 'LOGIN', deviceId: 'mobile-app' })
      })
      setStatus(response.ok ? 'If this number can receive messages, a code is on its way.' : 'We could not send a code. Try again later.')
    } catch {
      setStatus('You appear to be offline. Reconnect and try again.')
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
      {status ? <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text> : null}
    </View>
  )
}

