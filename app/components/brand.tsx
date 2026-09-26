import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg'
import { View } from 'react-native'
import { colors } from '@/constants/theme'
import { Text } from './ui'

/** The Zero mark: a "0" drawn as a SIM card outline with its cut corner. */
export function ZeroMark({ size = 40, color = colors.lime }: { size?: number; color?: string }) {
  const w = size * 0.72
  return (
    <Svg width={w} height={size} viewBox="0 0 72 100" accessibilityLabel="Zero Mobile">
      <Path
        d="M20 6 H50 L66 22 V78 A16 16 0 0 1 50 94 H22 A16 16 0 0 1 6 78 V20 A14 14 0 0 1 20 6 Z"
        fill="none"
        stroke={color}
        strokeWidth={10}
        strokeLinejoin="round"
      />
      <Rect x={23} y={40} width={26} height={30} rx={5} fill={color} />
      <Path d="M36 40 V52 M23 55 H49 M36 58 V70" stroke={colors.bg} strokeWidth={3} />
    </Svg>
  )
}

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <ZeroMark size={size * 1.35} />
      <View>
        <Text style={{ fontSize: size, lineHeight: size * 1.1, fontWeight: '800', letterSpacing: -0.6 }}>Zero</Text>
        <Text variant="label" color={colors.textMuted} style={{ fontSize: 10, lineHeight: 12 }}>
          by Shaka
        </Text>
      </View>
    </View>
  )
}

/** Circular gauge: how much of the plan's cost the user's stake currently covers. */
export function CoverageRing({
  value,
  size = 220,
  children,
}: {
  value: number
  size?: number
  children?: React.ReactNode
}) {
  const stroke = 16
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const shown = Math.max(0, Math.min(1, value))
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.lime} />
            <Stop offset="1" stopColor="#7DDB2B" />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surfaceRaised} strokeWidth={stroke} fill="none" />
        {shown > 0.005 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke="url(#ring)"
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${c * shown} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      {children}
    </View>
  )
}
