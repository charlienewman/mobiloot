import * as Haptics from 'expo-haptics'
import { ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  View,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, radius, space, type } from '@/constants/theme'

type Variant = keyof typeof type

export function Text({
  variant = 'body',
  color,
  style,
  ...props
}: TextProps & { variant?: Variant; color?: string }) {
  return <RNText {...props} style={[type[variant] as TextStyle, { color: color ?? colors.text }, style]} />
}

export function Screen({
  children,
  scroll = true,
  header,
  refreshControl,
}: {
  children: ReactNode
  scroll?: boolean
  header?: ReactNode
  refreshControl?: React.ComponentProps<typeof ScrollView>['refreshControl']
}) {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      {header}
      {scroll ? (
        <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl} showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, { flex: 1 }]}>{children}</View>
      )}
    </SafeAreaView>
  )
}

export function Card({ children, style, tone = 'default' }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: 'default' | 'lime' | 'raised' }) {
  return (
    <View
      style={[
        styles.card,
        tone === 'lime' && { backgroundColor: colors.lime, borderColor: colors.lime },
        tone === 'raised' && { backgroundColor: colors.surfaceRaised },
        style,
      ]}
    >
      {children}
    </View>
  )
}

export function Row({ children, style, gap = space.md, ...rest }: ViewProps & { gap?: number }) {
  return (
    <View {...rest} style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>
      {children}
    </View>
  )
}

export function Stack({ children, style, gap = space.md }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ gap }, style]}>{children}</View>
}

export function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
}

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  loading,
  icon,
  accessibilityHint,
  style,
}: {
  title: string
  onPress?: () => void
  kind?: ButtonKind
  disabled?: boolean
  loading?: boolean
  icon?: ReactNode
  accessibilityHint?: string
  style?: StyleProp<ViewStyle>
}) {
  const inactive = disabled || loading
  const palette = {
    primary: { bg: colors.lime, fg: colors.limeInk, border: colors.lime },
    secondary: { bg: colors.surfaceRaised, fg: colors.text, border: colors.border },
    ghost: { bg: 'transparent', fg: colors.text, border: colors.border },
    danger: { bg: colors.dangerSoft, fg: colors.danger, border: colors.dangerSoft },
  }[kind]
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      accessibilityHint={accessibilityHint}
      disabled={inactive}
      onPress={() => {
        void Haptics.selectionAsync()
        onPress?.()
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: inactive ? 0.45 : pressed ? 0.85 : 1 },
        pressed && { transform: [{ scale: 0.985 }] },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={palette.fg} /> : icon}
      <Text variant="heading" color={palette.fg}>
        {title}
      </Text>
    </Pressable>
  )
}

type ChipTone = 'neutral' | 'lime' | 'warn' | 'info' | 'danger'

export function Chip({ label, tone = 'neutral', icon }: { label: string; tone?: ChipTone; icon?: ReactNode }) {
  const palette = {
    neutral: { bg: colors.surfaceRaised, fg: colors.textMuted },
    lime: { bg: colors.limeSoft, fg: colors.lime },
    warn: { bg: colors.warnSoft, fg: colors.warn },
    info: { bg: colors.infoSoft, fg: colors.info },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
  }[tone]
  return (
    <View style={[styles.chip, { backgroundColor: palette.bg }]}>
      {icon}
      <Text variant="label" color={palette.fg} style={{ fontSize: 11 }}>
        {label}
      </Text>
    </View>
  )
}

export function Stat({ label, value, sub, align = 'left' }: { label: string; value: string; sub?: string; align?: 'left' | 'right' }) {
  return (
    <View style={{ gap: 2, alignItems: align === 'right' ? 'flex-end' : 'flex-start', flex: 1 }}>
      <Text variant="label" color={colors.textMuted}>
        {label}
      </Text>
      <Text variant="title" style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </Text>
      {sub ? (
        <Text variant="small" color={colors.textMuted}>
          {sub}
        </Text>
      ) : null}
    </View>
  )
}

export function KeyValue({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <Text variant="small" color={colors.textMuted}>
        {label}
      </Text>
      {typeof value === 'string' ? (
        <Text variant={mono ? 'mono' : 'small'} style={{ flexShrink: 1, textAlign: 'right' }} numberOfLines={1}>
          {value}
        </Text>
      ) : (
        value
      )}
    </Row>
  )
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'danger' }) {
  const palette = {
    info: { bg: colors.infoSoft, fg: colors.info },
    warn: { bg: colors.warnSoft, fg: colors.warn },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
  }[tone]
  return (
    <View style={[styles.notice, { backgroundColor: palette.bg }]}>
      <Text variant="small" color={palette.fg}>
        {children}
      </Text>
    </View>
  )
}

export function ProgressBar({ value, color = colors.lime }: { value: number; color?: string }) {
  return (
    <View style={styles.progressTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}>
      <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(1, value)) * 100}%`, backgroundColor: color }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingBottom: space.xxl * 2, gap: space.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
  },
  button: {
    minHeight: 56,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  notice: { borderRadius: radius.md, padding: space.md },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4 },
})
