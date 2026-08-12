import { StyleSheet } from 'react-native'

export const palette = {
  background: '#F8F9FF',
  surface: '#FFFFFF',
  surfaceSoft: '#EFF4FF',
  surfaceBlue: '#E5EEFF',
  primary: '#004AC6',
  primaryBright: '#2563EB',
  primarySoft: '#DBEAFE',
  text: '#0B1C30',
  muted: '#5C667A',
  border: '#DCE3EE',
  amber: '#F59E0B',
  amberSoft: '#FFF3D6',
  success: '#087A55',
  successSoft: '#E7F7EF',
  danger: '#BA1A1A',
  dangerSoft: '#FFF0EE',
  shadow: '#13233A'
} as const

export const metrics = {
  pageGutter: 16,
  sectionGap: 24,
  cardGap: 12,
  touch: 48,
  input: 52,
  button: 48,
  radiusSm: 8,
  radiusMd: 12,
  radiusLg: 16,
  radiusXl: 24,
  contentMax: 760
} as const

export const text = StyleSheet.create({
  display: { color: palette.text, fontSize: 28, fontWeight: '800', lineHeight: 34 },
  title: { color: palette.text, fontSize: 22, fontWeight: '800', lineHeight: 28 },
  section: { color: palette.text, fontSize: 18, fontWeight: '800', lineHeight: 24 },
  body: { color: palette.text, fontSize: 15, lineHeight: 22 },
  muted: { color: palette.muted, fontSize: 13, lineHeight: 18 },
  label: { color: palette.text, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  tiny: { color: palette.muted, fontSize: 11, lineHeight: 15 }
})
