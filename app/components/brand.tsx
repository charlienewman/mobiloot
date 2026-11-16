import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg'
import { View } from 'react-native'
import { colors, loopStops } from '@/constants/theme'
import { LETTERS_PATH, LOOP_BOX, LOOP_PATH, WORD_BOX } from './brand-paths'

function LoopGradient({ id }: { id: string }) {
  return (
    <Defs>
      <LinearGradient id={id} gradientUnits="userSpaceOnUse" x1={LOOP_BOX.x} y1={0} x2={LOOP_BOX.x + LOOP_BOX.w} y2={0}>
        {loopStops.map((s) => (
          <Stop key={s.offset} offset={s.offset} stopColor={s.color} />
        ))}
      </LinearGradient>
    </Defs>
  )
}

/** The Mobiloot mark: the gradient loop from the logo. `size` is its height. */
export function BrandMark({ size = 40 }: { size?: number }) {
  const b = LOOP_BOX
  return (
    <Svg
      width={(size * b.w) / b.h}
      height={size}
      viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`}
      accessibilityLabel="Mobiloot"
    >
      <LoopGradient id="brandLoop" />
      <Path d={LOOP_PATH} fill="url(#brandLoop)" />
    </Svg>
  )
}

/** The full "mobiloot" logotype. `size` is roughly the letter height. */
export function Wordmark({ size = 22 }: { size?: number }) {
  const b = WORD_BOX
  const height = size * 1.3
  return (
    <Svg
      width={(height * b.w) / b.h}
      height={height}
      viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`}
      accessibilityLabel="Mobiloot"
    >
      <LoopGradient id="wordLoop" />
      <Path d={LETTERS_PATH} fill={colors.text} />
      <Path d={LOOP_PATH} fill="url(#wordLoop)" />
    </Svg>
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
          {/* The ring is drawn rotated a quarter turn, so this runs lime to violet clockwise from the top. */}
          <LinearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            {loopStops.map((s) => (
              <Stop key={s.offset} offset={s.offset} stopColor={s.color} />
            ))}
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
