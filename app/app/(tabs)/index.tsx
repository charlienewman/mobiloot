import { Feather } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { RefreshControl, View } from 'react-native'
import { CoverageRing } from '@/components/brand'
import { Header } from '@/components/header'
import { Button, Card, Chip, Divider, KeyValue, Notice, ProgressBar, Row, Screen, Stack, Stat, Text } from '@/components/ui'
import { colors, space } from '@/constants/theme'
import { useZero } from '@/features/config'
import { useFunding, useMe, usePool, useUsage } from '@/features/data'
import { daysUntil, mb, pct, sol, usd } from '@/features/format'

export default function Home() {
  const { config } = useZero()
  const me = useMe()
  const pool = usePool()
  const queryClient = useQueryClient()
  const router = useRouter()

  const stakeLamports = Number(me.data?.holdings.stakeLamports ?? 0)
  const funding = useFunding(stakeLamports)
  const unlocked = stakeLamports >= Number(config.minStakeLamports)
  const active = Boolean(me.data?.entitlement)
  const esimReady = me.data?.esim?.status === 'ready'
  const usage = useUsage(esimReady)
  const renewsIn = daysUntil(config.period.end)

  return (
    <Screen
      header={<Header />}
      refreshControl={
        <RefreshControl
          refreshing={me.isRefetching}
          onRefresh={() => queryClient.invalidateQueries()}
          tintColor={colors.lime}
          colors={[colors.lime]}
          progressBackgroundColor={colors.surface}
        />
      }
    >
      <Card style={{ alignItems: 'center', paddingVertical: space.xl }}>
        <CoverageRing value={funding.fundedRatio}>
          <Text variant="number" accessibilityLabel={`${pct(funding.fundedRatio)} of your plan funded`}>
            {pct(Math.min(funding.fundedRatio, 9.99))}
          </Text>
          <Text variant="small" color={colors.textMuted}>
            of your plan funded
          </Text>
        </CoverageRing>
        <Text style={{ textAlign: 'center' }}>
          <Text variant="heading">{sol(stakeLamports)} SOL</Text>
          <Text color={colors.textMuted}> staked, paying ≈ </Text>
          <Text variant="heading">{usd(funding.monthlyYieldUsd)}</Text>
          <Text color={colors.textMuted}> of the {usd(funding.planCost, 0)}/mo plan</Text>
        </Text>
        {stakeLamports === 0 ? (
          <Button title="Stake SOL to start" onPress={() => router.push('/(tabs)/stake')} style={{ alignSelf: 'stretch' }} />
        ) : null}
      </Card>

      <PlanCard
        active={active}
        esimReady={esimReady}
        unlocked={unlocked}
        stakeLamports={stakeLamports}
        renewsIn={renewsIn}
        usage={usage.data}
        onGo={(tab) => router.push(tab)}
      />

      {config.cluster !== 'mainnet-beta' ? (
        <Notice tone="warn">
          {config.cluster === 'devnet' ? 'Devnet' : 'Localnet'} demo: the plan unlocks at {funding.minStakeSol} zeroSOL so anyone can try it. At today&apos;s yield, fully funding{' '}
          {config.plan.name} takes about {funding.fullStakeSol.toFixed(1)} SOL. Test SOL has no monetary value.
        </Notice>
      ) : null}

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="heading">Where your yield goes</Text>
          <Chip label={`Epoch ${pool.data?.epoch ?? '…'}`} />
        </Row>
        <Row>
          <Stat label="Pool staked" value={pool.data ? `${sol(pool.data.totalStakedLamports, 2)}` : '…'} sub="SOL" />
          <Stat
            label="Yield"
            value={pct(funding.apy, 1)}
            sub={funding.apySource === 'measured' ? 'measured last epoch' : 'mainnet reference'}
            align="right"
          />
        </Row>
        <Divider />
        <KeyValue label="Paid to Shaka for plans so far" value={pool.data ? `${sol(pool.data.treasuryEarnedLamports, 4)} SOL` : '…'} />
        <KeyValue label="1 zeroSOL is worth" value={pool.data ? `${pool.data.exchangeRate.toFixed(4)} SOL` : '…'} />
        <Stack gap={6}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="small" color={colors.textMuted}>
              Next reward payout
            </Text>
            <Text variant="small">{pool.data ? pct(pool.data.epochProgress) : '…'} through epoch</Text>
          </Row>
          <ProgressBar value={pool.data?.epochProgress ?? 0} color={colors.info} />
        </Stack>
      </Card>
    </Screen>
  )
}

function PlanCard(props: {
  active: boolean
  esimReady: boolean
  unlocked: boolean
  stakeLamports: number
  renewsIn: number
  usage?: { dataUsedMb: number; dataTotalMb: number; minutesUsed: number; textsUsed: number }
  onGo: (tab: '/(tabs)/plan' | '/(tabs)/stake') => void
}) {
  const { config } = useZero()
  const min = Number(config.minStakeLamports)

  if (props.active && props.esimReady) {
    const u = props.usage
    return (
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Stack gap={2}>
            <Text variant="heading">{config.plan.name}</Text>
            <Text variant="small" color={colors.textMuted}>
              Active · renews in {props.renewsIn} days, funded by your stake
            </Text>
          </Stack>
          <Chip label="Active" tone="lime" />
        </Row>
        {u ? (
          <Stack gap={6}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="small" color={colors.textMuted}>
                Data
              </Text>
              <Text variant="small">
                {mb(u.dataUsedMb)} of {mb(u.dataTotalMb)}
              </Text>
            </Row>
            <ProgressBar value={u.dataUsedMb / u.dataTotalMb} />
            <Text variant="small" color={colors.textMuted}>
              {u.minutesUsed} min · {u.textsUsed} texts this period
            </Text>
          </Stack>
        ) : null}
        <Button title="Manage eSIM" kind="secondary" onPress={() => props.onGo('/(tabs)/plan')} />
      </Card>
    )
  }

  if (props.active) {
    return (
      <Card>
        <Row>
          <Feather name="check-circle" size={20} color={colors.lime} />
          <Text variant="heading">Plan active for this period</Text>
        </Row>
        <Text color={colors.textMuted}>Your entitlement is on-chain. Get your eSIM to start using it.</Text>
        <Button title="Get my eSIM" onPress={() => props.onGo('/(tabs)/plan')} />
      </Card>
    )
  }

  if (props.unlocked) {
    return (
      <Card>
        <Row>
          <Feather name="unlock" size={20} color={colors.lime} />
          <Text variant="heading">Your stake unlocks {config.plan.name}</Text>
        </Row>
        <Text color={colors.textMuted}>
          {config.plan.dataGb} GB data, {config.plan.minutes} minutes and {config.plan.texts} texts. Activate it for this period.
        </Text>
        <Button title="Activate plan" onPress={() => props.onGo('/(tabs)/plan')} />
      </Card>
    )
  }

  const progress = props.stakeLamports / min
  return (
    <Card>
      <Text variant="heading">Unlock {config.plan.name}</Text>
      <View style={{ gap: 6 }}>
        <ProgressBar value={progress} />
        <Text variant="small" color={colors.textMuted}>
          {sol(props.stakeLamports)} of {sol(min)} zeroSOL. Stake {sol(Math.max(0, min - props.stakeLamports))} more SOL to unlock.
        </Text>
      </View>
      {props.stakeLamports > 0 ? <Button title="Stake SOL" kind="secondary" onPress={() => props.onGo('/(tabs)/stake')} /> : null}
    </Card>
  )
}
