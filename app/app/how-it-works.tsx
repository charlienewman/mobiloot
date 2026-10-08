import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'
import { Card, Row, Screen, Stack, Text } from '@/components/ui'
import { colors, space } from '@/constants/theme'
import { useMobiloot } from '@/features/config'
import { usd } from '@/features/format'

export default function HowItWorks() {
  const router = useRouter()
  const { config } = useMobiloot()
  return (
    <Screen
      header={
        <Row style={{ justifyContent: 'space-between', padding: space.lg }}>
          <Text variant="title">How Mobiloot works</Text>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12}>
            <Feather name="x" size={24} color={colors.text} />
          </Pressable>
        </Row>
      }
    >
      <Section n="1" title="You stake SOL, you keep lootSOL">
        Your SOL goes into the Mobiloot stake pool, which delegates it to Solana validators. You get lootSOL back in
        your own wallet. It is your claim on that SOL, and you can redeem it whenever you like with no fee.
      </Section>
      <Section n="2" title="The rewards pay for your plan">
        The pool is set up so 100% of its staking rewards go to the Mobiloot treasury. That is how you pay: with the
        yield, not the principal. 1 lootSOL stays worth about 1 SOL.
      </Section>
      <Section n="3" title="Your stake unlocks the plan on-chain">
        Each billing period, the Mobiloot program checks that your wallet holds enough lootSOL and records your
        entitlement on Solana. Nothing personal goes on-chain: no phone number, no SIM details.
      </Section>
      <Section n="4" title="Your eSIM is provisioned">
        Mobiloot&apos;s service checks your on-chain entitlement, then orders your eSIM from the eSIM provider. Install
        it in Android settings and you&apos;re connected, with no card and no monthly bill.
      </Section>
      <Card tone="raised">
        <Text variant="heading">The honest maths</Text>
        <Text color={colors.textMuted}>
          {config.plan.name} costs Mobiloot about {usd(config.plan.monthlyCostUsd, 0)} a month. Your stake funds it
          fully when its yearly rewards cover twelve months of that. Yield and SOL&apos;s price change, so the stake
          needed changes too, and the app always shows today&apos;s figure. Staking carries risks, including validator
          performance and smart-contract risk.
        </Text>
      </Card>
      {config.cluster !== 'mainnet-beta' ? (
        <Card tone="raised">
          <Text variant="heading">This is a {config.cluster} demo</Text>
          <Text color={colors.textMuted}>
            Test SOL has no value and the unlock threshold is lowered so anyone can try it. Most wallets get a mock
            eSIM; invited testers get a real one on Shaka&apos;s UK network. The staking, the pool, the rewards to the
            treasury and the on-chain entitlement are all real transactions on {config.cluster}.
          </Text>
        </Card>
      ) : null}
    </Screen>
  )
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <Row style={{ alignItems: 'flex-start' }} gap={space.lg}>
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: colors.lime,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text variant="heading" color={colors.limeInk}>
          {n}
        </Text>
      </View>
      <Stack gap={4} style={{ flex: 1 }}>
        <Text variant="heading">{title}</Text>
        <Text color={colors.textMuted}>{children}</Text>
      </Stack>
    </Row>
  )
}
