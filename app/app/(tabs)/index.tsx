import { Feather } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { RefreshControl, View } from 'react-native'
import { CoverageRing } from '@/components/brand'
import { Header } from '@/components/header'
import {
  Button,
  Card,
  Chip,
  Divider,
  KeyValue,
  Notice,
  ProgressBar,
  Row,
  Screen,
  Stack,
  Stat,
  Text,
} from '@/components/ui'
import { colors, space } from '@/constants/theme'
import { useMobiloot } from '@/features/config'
import { useFunding, useMe, usePool, useUsage } from '@/features/data'
import { daysUntil, mb, pct, sol } from '@/features/format'

export default function Home() {
  const { config } = useMobiloot()
  const me = useMe()
  const pool = usePool()
  const queryClient = useQueryClient()
  const router = useRouter()

  const stakeLamports = Number(me.data?.holdings.stakeLamports ?? 0)
  const funding = useFunding(stakeLamports)
  const unlocked = stakeLamports >= Number(config.minStakeLamports)
  const active = Boolean(me.data?.entitlement || me.data?.testGrant)
  const esimReady = me.data?.esim?.status === 'ready'
  const suspended = Boolean(me.data?.esim?.suspended)
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
      {me.isError && !me.data ? (
        <Notice tone="danger">
          Couldn&apos;t load your plan: {(me.error as Error).message} Pull down to try again.
        </Notice>
      ) : null}
      <Card style={{ alignItems: 'center', paddingVertical: space.xl, opacity: me.data ? 1 : 0.5 }}>
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
          {funding.fundedRatio >= 1 ? (
            <Text color={colors.textMuted}> staked: your {funding.money(funding.planCost, 0)}/mo plan is free</Text>
          ) : (
            <>
              <Text color={colors.textMuted}> staked, paying ≈ </Text>
              <Text variant="heading">{funding.money(funding.monthlyYield)}</Text>
              <Text color={colors.textMuted}> of the {funding.money(funding.planCost, 0)}/mo plan</Text>
            </>
          )}
        </Text>
        {stakeLamports === 0 ? (
          <Button
            title="Stake SOL to start"
            onPress={() => router.push('/(tabs)/stake')}
            style={{ alignSelf: 'stretch' }}
          />
        ) : null}
      </Card>

      <PlanCard
        active={active}
        testGrant={Boolean(me.data?.testGrant && !me.data.entitlement)}
        esimReady={esimReady}
        suspended={suspended}
        unlocked={unlocked}
        stakeLamports={stakeLamports}
        renewsIn={renewsIn}
        usage={usage.data}
        onGo={(tab) => router.push(tab)}
      />

      {config.cluster !== 'mainnet-beta' ? (
        <Notice tone="warn">
          {config.cluster === 'devnet' ? 'Devnet' : 'Localnet'} demo: the plan unlocks at {funding.minStakeSol} lootSOL
          so anyone can try it. At today&apos;s yield, fully funding {config.plan.name} takes about{' '}
          {funding.fullStakeSol.toFixed(1)} SOL. Test SOL has no monetary value.
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
        <KeyValue
          label="Paid to the treasury for plans so far"
          value={pool.data ? `${sol(pool.data.treasuryEarnedLamports, 4)} SOL` : '…'}
        />
        <KeyValue label="1 lootSOL is worth" value={pool.data ? `${pool.data.exchangeRate.toFixed(4)} SOL` : '…'} />
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
  testGrant: boolean
  esimReady: boolean
  suspended: boolean
  unlocked: boolean
  stakeLamports: number
  renewsIn: number
  usage?: { dataUsedMb: number; dataTotalMb: number | null; minutesUsed: number; textsUsed: number }
  onGo: (tab: '/(tabs)/plan' | '/(tabs)/stake') => void
}) {
  const { config } = useMobiloot()
  const min = Number(config.minStakeLamports)

  if (props.active && props.esimReady && props.suspended) {
    return (
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="heading">{config.plan.name}</Text>
          <Chip label="Suspended" tone="danger" />
        </Row>
        <Text color={colors.textMuted}>
          Your line is paused because your wallet holds less than {sol(min)} lootSOL. Stake back up and it resumes
          automatically.
        </Text>
        <Button title="Stake SOL" onPress={() => props.onGo('/(tabs)/stake')} />
      </Card>
    )
  }

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
                {u.dataTotalMb == null
                  ? `${mb(u.dataUsedMb)} used · unlimited`
                  : `${mb(u.dataUsedMb)} of ${mb(u.dataTotalMb)}`}
              </Text>
            </Row>
            {u.dataTotalMb == null ? null : <ProgressBar value={u.dataUsedMb / u.dataTotalMb} />}
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
        <Text color={colors.textMuted}>
          {props.testGrant
            ? 'Test access: this wallet can get an eSIM without staking.'
            : 'Your entitlement is on-chain. Get your eSIM to start using it.'}
        </Text>
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
        <Text color={colors.textMuted}>{planSummary(config.plan)}. Activate it for this period.</Text>
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
          {sol(props.stakeLamports)} of {sol(min)} lootSOL. Stake {sol(Math.max(0, min - props.stakeLamports))} more SOL
          to unlock.
        </Text>
      </View>
      {props.stakeLamports > 0 ? (
        <Button title="Stake SOL" kind="secondary" onPress={() => props.onGo('/(tabs)/stake')} />
      ) : null}
    </Card>
  )
}

function planSummary(p: { dataGb: number | 'unlimited'; minutes: number | 'unlimited'; texts: number | 'unlimited' }) {
  if (p.dataGb === 'unlimited' && p.minutes === 'unlimited' && p.texts === 'unlimited')
    return 'Unlimited data, calls and texts'
  const data = p.dataGb === 'unlimited' ? 'Unlimited data' : `${p.dataGb} GB data`
  const minutes = p.minutes === 'unlimited' ? 'unlimited minutes' : `${p.minutes} minutes`
  const texts = p.texts === 'unlimited' ? 'unlimited texts' : `${p.texts} texts`
  return `${data}, ${minutes} and ${texts}`
}
