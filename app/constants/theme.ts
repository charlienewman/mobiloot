export const colors = {
  bg: '#0B0B0C',
  surface: '#151517',
  surfaceRaised: '#1D1D20',
  border: '#2A2A2E',
  text: '#F4F1EA',
  textMuted: '#9A978F',
  textFaint: '#5E5C58',
  lime: '#C6FF3D',
  limeInk: '#0B0B0C',
  limeSoft: 'rgba(198, 255, 61, 0.12)',
  danger: '#FF6B5E',
  dangerSoft: 'rgba(255, 107, 94, 0.12)',
  warn: '#FFC247',
  warnSoft: 'rgba(255, 194, 71, 0.12)',
  info: '#8AB4FF',
  infoSoft: 'rgba(138, 180, 255, 0.12)',
} as const

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const
export const radius = { sm: 10, md: 16, lg: 24, pill: 999 } as const

export const type = {
  hero: { fontSize: 40, lineHeight: 44, fontWeight: '800', letterSpacing: -1.2 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.4 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  number: { fontSize: 56, lineHeight: 60, fontWeight: '800', letterSpacing: -2, fontVariant: ['tabular-nums'] },
  mono: { fontSize: 13, lineHeight: 18, fontFamily: 'monospace' },
} as const
