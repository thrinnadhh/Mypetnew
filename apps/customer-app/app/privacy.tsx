import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import {
  createPrivacyGrievance,
  createPrivacyRequest,
  deleteCustomerAccount,
  grantConsent,
  loadPrivacySummary,
  updatePrivacyProfile,
  withdrawConsent,
  type ConsentPurpose,
  type PersonalDataSummary
} from '../src/privacy'
import { runtimeConfig } from '../src/runtime'
import { loadAccessToken, logoutCustomer } from '../src/session'
import { styles } from '../src/styles'

const optionalPurposes: ReadonlyArray<{
  purpose: ConsentPurpose
  title: string
  notice: string
}> = [
  { purpose: 'LOCATION', title: 'Location', notice: 'Use foreground location to help select a delivery address. Precise location is not required for browsing.' },
  { purpose: 'NOTIFICATIONS', title: 'Notifications', notice: 'Register this device with Firebase to receive minimal order and loyalty updates.' },
  { purpose: 'MARKETING', title: 'Marketing', notice: 'Receive optional MyPet offers. This is not required to use checkout.' },
  { purpose: 'PRODUCT_ANALYTICS', title: 'Product analytics', notice: 'Use pseudonymous interaction events to improve the app. Restricted fields are excluded.' },
  { purpose: 'PERSONALISATION', title: 'Personalisation', notice: 'Use your MyPet activity to personalise in-app content. This is optional.' },
  { purpose: 'RECURRING_ORDER_REMINDERS', title: 'Recurring reminders', notice: 'Remind you to confirm a repeat order. MyPet will not create an automatic purchase.' }
]

export default function PrivacyCentreScreen() {
  const [token, setToken] = useState<string | null>(null)
  const [summary, setSummary] = useState<PersonalDataSummary | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [grievance, setGrievance] = useState('')
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  const reload = useCallback(async (accessToken: string) => {
    const data = await loadPrivacySummary(runtimeConfig, accessToken)
    setSummary(data)
    setDisplayName(data.profile.displayName ?? '')
    setEmail(data.profile.email ?? '')
  }, [])

  useEffect(() => {
    void loadAccessToken().then(async (accessToken) => {
      setToken(accessToken)
      if (accessToken) await reload(accessToken).catch(() => { setStatus('Privacy information is temporarily unavailable.') })
    })
  }, [reload])

  const run = async (action: (accessToken: string) => Promise<void>, success: string, reloadAfter = true) => {
    if (!token) {
      setStatus('Sign in to use the Privacy Centre.')
      return
    }
    try {
      await action(token)
      setStatus(success)
      if (reloadAfter) await reload(token)
    } catch {
      setStatus('The privacy request could not be completed. Try again later.')
    }
  }

  const active = new Set(summary?.activeConsents.map((consent) => consent.purpose) ?? [])

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text accessibilityRole="header" style={styles.title}>Privacy Centre</Text>
      <Text style={styles.subtitle}>Review your data, control optional purposes, exercise privacy rights, or delete your account.</Text>

      {summary ? <View style={styles.card}>
        <Text style={{ fontWeight: '700' }}>Your account data</Text>
        <Text>Mobile: {summary.mobileE164}</Text>
        <Text>Account reference: {summary.customerId}</Text>
        <TextInput accessibilityLabel="Display name" onChangeText={setDisplayName} placeholder="Display name" style={styles.input} value={displayName} />
        <TextInput accessibilityLabel="Email" autoCapitalize="none" keyboardType="email-address" onChangeText={setEmail} placeholder="Email (optional)" style={styles.input} value={email} />
        <Pressable accessibilityRole="button" onPress={() => { void run((accessToken) => updatePrivacyProfile(runtimeConfig, accessToken, displayName, email), 'Profile updated.') }} style={styles.button}>
          <Text style={styles.buttonText}>Correct or update profile</Text>
        </Pressable>
      </View> : null}

      <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: '700' }}>Optional purposes</Text>
      {optionalPurposes.map(({ purpose, title, notice }) => (
        <View key={purpose} style={styles.card}>
          <Text style={{ fontWeight: '700' }}>{title}</Text>
          <Text>{notice}</Text>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: active.has(purpose) }}
            onPress={() => {
              const action = active.has(purpose) ? withdrawConsent : grantConsent
              void run((accessToken) => action(runtimeConfig, accessToken, purpose).then(() => undefined), active.has(purpose) ? 'Consent withdrawn.' : 'Consent recorded.')
            }}
            style={styles.button}
          >
            <Text style={styles.buttonText}>{active.has(purpose) ? 'Withdraw' : 'Allow'}</Text>
          </Pressable>
        </View>
      ))}

      <View style={styles.card}>
        <Text style={{ fontWeight: '700' }}>Rights requests</Text>
        <Pressable accessibilityRole="button" onPress={() => { void run((accessToken) => createPrivacyRequest(runtimeConfig, accessToken, 'ACCESS'), 'Access request recorded.') }} style={styles.button}>
          <Text style={styles.buttonText}>Request access summary</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => { void run((accessToken) => createPrivacyRequest(runtimeConfig, accessToken, 'ERASURE'), 'Erasure request recorded for review.') }} style={styles.button}>
          <Text style={styles.buttonText}>Request selective erasure</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => { void run((accessToken) => createPrivacyRequest(runtimeConfig, accessToken, 'NOMINATION'), 'Nomination request recorded for review.') }} style={styles.button}>
          <Text style={styles.buttonText}>Start nomination request</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={{ fontWeight: '700' }}>Privacy grievance</Text>
        <TextInput accessibilityLabel="Privacy grievance" multiline onChangeText={setGrievance} placeholder="Describe the privacy issue without including passwords, OTPs or payment credentials." style={styles.input} value={grievance} />
        <Pressable accessibilityRole="button" onPress={() => { void run((accessToken) => createPrivacyGrievance(runtimeConfig, accessToken, grievance), 'Grievance recorded.'); setGrievance('') }} style={styles.button}>
          <Text style={styles.buttonText}>Raise grievance</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={{ fontWeight: '700' }}>Delete account</Text>
        <Text>Deletion signs you out everywhere, revokes notification delivery, deletes profile and cart data, and pseudonymises legally retained order, loyalty, audit and financial references.</Text>
        <TextInput accessibilityLabel="Type DELETE to confirm" autoCapitalize="characters" onChangeText={setDeleteConfirmation} placeholder="Type DELETE" style={styles.input} value={deleteConfirmation} />
        <Pressable
          accessibilityRole="button"
          disabled={deleteConfirmation !== 'DELETE'}
          onPress={() => {
            void run(async (accessToken) => {
              await deleteCustomerAccount(runtimeConfig, accessToken)
              await logoutCustomer(runtimeConfig)
              setToken(null)
              setSummary(null)
            }, 'Account deleted and local session cleared.', false)
          }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Delete my account</Text>
        </Pressable>
      </View>

      {status ? <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text> : null}
    </ScrollView>
  )
}
