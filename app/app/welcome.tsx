import { Feather } from '@expo/vector-icons'
import { Redirect, useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { BrandMark } from '@/components/brand'
import { Button, Chip, Notice, Row, Stack, Text } from '@/components/ui'
import { colors, radius, space } from '@/constants/theme'
import { useMobiloot } from '@/features/config'
import { useSession } from '@/features/session'

const STEPS = [
  {
    icon: 'layers',
    title: 'Stake SOL for lootSOL',
    body: 'Your SOL goes into the Mobiloot stake pool. You keep lootSOL in your own wallet and can withdraw any time.',
  },
  {
    icon: 'zap',
    title: 'Your yield pays for your plan',
    body: 'Staking rewards go to the Mobiloot treasury to cover your plan. Your principal stays yours.',
  },
  {
    icon: 'smartphone',
    title: 'Activate your eSIM',
    body: 'Unlock the plan on-chain and install your eSIM, with no card and no monthly bill.',
  },
] as const

export default function Welcome() {
  const { address, connect, busy, error } = useSession()
  const { config } = useMobiloot()
  const router = useRouter()
  if (address) return <Redirect href="/(tabs)" />

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1, padding: space.xl, justifyContent: 'space-between' }}>
        <Stack gap={space.xl}>
          <Row style={{ justifyContent: 'space-between' }}>
            <BrandMark size={56} />
            {config.cluster !== 'mainnet-beta' ? <Chip label={`${config.cluster} demo`} tone="warn" /> : null}
          </Row>
          <Stack gap={space.sm}>
            <Text variant="hero">
              Your stake.{'\n'}
              <Text variant="hero" color={colors.lime}>
                Your signal.
              </Text>
            </Text>
            <Text color={colors.textMuted}>A mobile plan paid for by your staking yield.</Text>
          </Stack>
          <Stack gap={space.lg}>
            {STEPS.map((s, i) => (
              <Row key={s.title} style={{ alignItems: 'flex-start' }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: radius.sm,
                    backgroundColor: colors.surfaceRaised,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Feather name={s.icon} size={18} color={colors.lime} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="heading">
                    {i + 1}. {s.title}
                  </Text>
                  <Text variant="small" color={colors.textMuted}>
                    {s.body}
                  </Text>
                </View>
              </Row>
            ))}
          </Stack>
        </Stack>
        <Stack>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button
            title={busy ? 'Waiting for wallet…' : 'Connect wallet'}
            loading={busy}
            onPress={connect}
            icon={busy ? undefined : <Feather name="link" size={18} color={colors.limeInk} />}
            accessibilityHint="Opens your Solana wallet to connect and sign in"
          />
          <Pressable
            onPress={() => router.push('/how-it-works')}
            accessibilityRole="link"
            style={{ alignSelf: 'center', padding: space.sm }}
          >
            <Text variant="small" color={colors.textMuted}>
              How does this work?
            </Text>
          </Pressable>
        </Stack>
      </View>
    </SafeAreaView>
  )
}
