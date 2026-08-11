import { CameraView, type BarcodeScanningResult, useCameraPermissions } from 'expo-camera'
import { useRef, useState } from 'react'
import { Linking, Pressable, Text, TextInput, View } from 'react-native'
import { runtimeConfig } from '../src/runtime'
import { OfflineActionQueue, ScannerCaptureGate } from '../src/scanner'
import { styles } from '../src/styles'

export default function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions()
  const [manual, setManual] = useState('')
  const [paused, setPaused] = useState(false)
  const [status, setStatus] = useState('Scan a supported GTIN or use manual entry.')
  const gate = useRef(new ScannerCaptureGate(750)).current
  const queue = useRef(new OfflineActionQueue(25)).current

  const resolve = async (barcode: string) => {
    const candidate = barcode.trim()
    if (!candidate) return
    setPaused(true)
    setStatus('Checking this barcode with your outlet…')
    const idempotencyKey = globalThis.crypto.randomUUID()
    try {
      const response = await fetch(`${runtimeConfig.apiUrl}/api/v1/merchant/barcodes/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ barcode: candidate, barcodeType: inferType(candidate) })
      })
      setStatus(response.ok ? 'Barcode resolved. Review the server listing before continuing.' : 'This barcode could not be resolved for the active outlet.')
    } catch {
      queue.enqueue({ idempotencyKey, barcode: candidate, outletId: 'active-outlet' })
      setStatus('Offline. The authorized scan action is queued once and will require reconciliation.')
    }
  }

  const captured = (result: BarcodeScanningResult) => {
    if (gate.capture(result.data, Date.now())) void resolve(result.data)
  }

  if (permission === null) return <View style={styles.screen}><Text style={styles.status}>Checking camera permission…</Text></View>

  return (
    <View style={styles.screen}>
      <Text accessibilityRole="header" style={styles.title}>Scan outlet barcode</Text>
      {!permission.granted ? (
        <View style={styles.card}>
          <Text style={styles.subtitle}>Camera access is used only while scanning merchant products.</Text>
          <Pressable accessibilityRole="button" onPress={() => { void requestPermission() }} style={styles.button}><Text style={styles.buttonText}>Allow camera</Text></Pressable>
          {!permission.canAskAgain ? <Pressable accessibilityRole="button" onPress={() => { void Linking.openSettings() }} style={styles.secondaryButton}><Text>Open settings</Text></Pressable> : null}
        </View>
      ) : (
        <CameraView
          accessibilityLabel="Barcode camera preview"
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a'] }}
          onBarcodeScanned={paused ? undefined : captured}
          style={styles.camera}
        />
      )}
      <TextInput accessibilityLabel="Manual barcode" keyboardType="number-pad" onChangeText={setManual} placeholder="Enter barcode manually" style={styles.input} value={manual} />
      <Pressable accessibilityRole="button" onPress={() => { void resolve(manual) }} style={styles.button}><Text style={styles.buttonText}>Resolve manual code</Text></Pressable>
      {paused ? <Pressable accessibilityRole="button" onPress={() => { setPaused(false); setStatus('Ready for the next scan.') }} style={styles.secondaryButton}><Text>Scan another</Text></Pressable> : null}
      <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text>
    </View>
  )
}

function inferType(value: string): 'GTIN_8' | 'GTIN_12' | 'GTIN_13' | 'GTIN_14' | 'INTERNAL' {
  const digits = value.replace(/[ -]/g, '')
  if (digits.length === 8) return 'GTIN_8'
  if (digits.length === 12) return 'GTIN_12'
  if (digits.length === 13) return 'GTIN_13'
  if (digits.length === 14) return 'GTIN_14'
  return 'INTERNAL'
}

