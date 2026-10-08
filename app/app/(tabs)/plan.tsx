import { Feather } from '@expo/vector-icons'
import Clipboard from '@react-native-clipboard/clipboard'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import * as WebBrowser from 'expo-web-browser'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Animated, Linking, Pressable, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { BrandMark } from '@/components/brand'
import { Header } from '@/components/header'
import { TxSheet } from '@/components/tx-sheet'
import { Button, Card, Chip, Divider, KeyValue, Notice, ProgressBar, Row, Screen, Stack, Text } from '@/components/ui'
import { colors, radius, space } from '@/constants/theme'
import { api, type EsimOrder, type RevealedEsim } from '@/features/api'
import { useMobiloot } from '@/features/config'
import { useMe, useUsage } from '@/features/data'
import { daysUntil, mb, sol } from '@/features/format'
import { useSession } from '@/features/session'
import { useTransactions } from '@/features/transactions'

export default function Plan() {
  const { config } = useMobiloot()
  const me = useMe()
  const tx = useTransactions()
  const router = useRouter()
  const stake = Number(me.data?.holdings.stakeLamports ?? 0)
  const min = Number(config.minStakeLamports)
  const entitlement = me.data?.entitlement
  const testGrant = Boolean(me.data?.testGrant)
  const esim = me.data?.esim

  return (
    <Screen header={<Header />}>
      <Text variant="title">Your plan</Text>
      <PlanDetails />

      {me.isLoading ? (
        <ActivityIndicator color={colors.lime} />
      ) : !entitlement && !testGrant ? (
        stake >= min ? (
          <Card>
            <Text variant="heading">Activate for this period</Text>
            <Text color={colors.textMuted}>
              This writes your plan entitlement to Solana for the period ending in {daysUntil(config.period.end)} days.
              No personal or SIM data goes on-chain.
            </Text>
            {config.paused ? <Notice tone="warn">Activations are paused right now.</Notice> : null}
            <Button
              title="Activate plan"
              disabled={config.paused}
              onPress={() => tx.activate(BigInt(config.period.id))}
              icon={<Feather name="zap" size={18} color={colors.limeInk} />}
              accessibilityHint="Opens your wallet to approve the activation"
            />
          </Card>
        ) : (
          <Card>
            <Text variant="heading">Locked</Text>
            <ProgressBar value={stake / min} />
            <Text color={colors.textMuted}>
              Hold at least {sol(min)} lootSOL to activate. You have {sol(stake)}.
            </Text>
            <Button title="Stake SOL" kind="secondary" onPress={() => router.push('/(tabs)/stake')} />
          </Card>
        )
      ) : esim?.status === 'ready' ? (
        <EsimReady order={esim} />
      ) : (
        <Provisioning entitlementAddress={entitlement?.address} order={esim} />
      )}

      <TxSheet
        state={tx.state}
        onClose={tx.reset}
        successNote="Your plan is active on-chain for this period. Next, get your eSIM."
      />
    </Screen>
  )
}

function PlanDetails() {
  const { config } = useMobiloot()
  const p = config.plan
  return (
    <Card tone="raised">
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Stack gap={2} style={{ flex: 1 }}>
          <Text variant="title">{p.name}</Text>
          <Text variant="small" color={colors.textMuted}>
            {p.tagline}
          </Text>
        </Stack>
        <BrandMark size={36} />
      </Row>
      <Row gap={space.xl}>
        <Feature icon="wifi" label={p.dataGb === 'unlimited' ? 'Unlimited' : `${p.dataGb} GB`} />
        <Feature icon="phone" label={p.minutes === 'unlimited' ? 'Unlimited' : `${p.minutes} min`} />
        <Feature icon="message-square" label={p.texts === 'unlimited' ? 'Unlimited' : `${p.texts}`} />
      </Row>
      <Text variant="small" color={colors.textMuted}>
        {p.coverage} · no card, no contract
      </Text>
    </Card>
  )
}

function Feature({ icon, label }: { icon: React.ComponentProps<typeof Feather>['name']; label: string }) {
  return (
    <Row gap={6}>
      <Feather name={icon} size={16} color={colors.lime} />
      <Text variant="heading">{label}</Text>
    </Row>
  )
}

/** `entitlementAddress` is absent for a test-grant wallet, which orders without staking. */
function Provisioning({ entitlementAddress, order }: { entitlementAddress?: string; order?: EsimOrder }) {
  const { token } = useSession()
  const { explorer, config } = useMobiloot()
  const queryClient = useQueryClient()
  const provision = useMutation({
    mutationFn: () => api<EsimOrder>('/v1/esim', { method: 'POST', token }),
    onSuccess: (o) => {
      if (o.status === 'ready') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      return queryClient.invalidateQueries({ queryKey: ['me'] })
    },
  })
  const failed = provision.isError || order?.status === 'failed'
  const ordered = order?.status === 'pending'
  const steps = [
    {
      label: entitlementAddress ? 'Plan entitlement confirmed on Solana' : 'Test access granted (no stake needed)',
      done: true,
    },
    {
      label: (order?.providerMode ?? config.providerMode) === 'mock' ? 'eSIM ordered (mock provider)' : 'eSIM ordered',
      done: ordered,
      active: provision.isPending,
    },
    { label: ordered ? 'Activating your eSIM on the network…' : 'eSIM ready to install', done: false, active: ordered },
  ]
  return (
    <Card>
      <Text variant="heading">Get your eSIM</Text>
      <Stack gap={space.md}>
        {steps.map((s) => (
          <Row key={s.label}>
            <View style={{ width: 24, alignItems: 'center' }}>
              {s.done ? (
                <Feather name="check-circle" size={20} color={colors.lime} />
              ) : s.active ? (
                <ActivityIndicator color={colors.lime} />
              ) : (
                <Feather name="circle" size={18} color={colors.textFaint} />
              )}
            </View>
            <Text color={s.done || s.active ? colors.text : colors.textMuted}>{s.label}</Text>
          </Row>
        ))}
      </Stack>
      {entitlementAddress ? (
        <Pressable
          onPress={() => WebBrowser.openBrowserAsync(explorer(`address/${entitlementAddress}`))}
          accessibilityRole="link"
        >
          <Row gap={6}>
            <Feather name="external-link" size={14} color={colors.textMuted} />
            <Text variant="small" color={colors.textMuted}>
              View entitlement on Solana Explorer
            </Text>
          </Row>
        </Pressable>
      ) : null}
      {failed ? (
        <Notice tone="danger">
          {(provision.error as Error)?.message ?? order?.error ?? 'The eSIM order failed.'}{' '}
          {entitlementAddress ? 'Your plan is safe on-chain; try again.' : 'Try again.'}
        </Notice>
      ) : null}
      {ordered ? (
        <Text variant="small" color={colors.textMuted}>
          This usually takes a few seconds and sometimes a few minutes. You can leave this screen; it carries on in the
          background.
        </Text>
      ) : (
        <Button
          title={failed ? 'Try again' : 'Get my eSIM'}
          loading={provision.isPending}
          onPress={() => provision.mutate()}
        />
      )}
    </Card>
  )
}

function EsimReady({ order }: { order: EsimOrder }) {
  const { config } = useMobiloot()
  const { token } = useSession()
  const usage = useUsage(!order.suspended)
  const [revealed, setRevealed] = useState<RevealedEsim | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const pop = useRef(new Animated.Value(0.9)).current

  useEffect(() => {
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, friction: 5 }).start()
  }, [pop])

  // Hide the code again after a minute so it isn't left on screen.
  useEffect(() => {
    if (!revealed) return
    const t = setTimeout(() => setRevealed(null), 60_000)
    return () => clearTimeout(t)
  }, [revealed])

  const live = order.providerMode !== 'mock'
  const reveal = useMutation({
    mutationFn: () => api<RevealedEsim>('/v1/esim/reveal', { method: 'POST', token }),
    onSuccess: setRevealed,
  })
  // Hands the code straight to Android's eSIM installer; it never appears on screen.
  const install = useMutation({
    mutationFn: async () => {
      const esim = await api<RevealedEsim>('/v1/esim/reveal', { method: 'POST', token })
      if (!esim.androidInstallUrl) throw new Error('This eSIM has no install link. Use the activation code instead.')
      await Linking.openURL(esim.androidInstallUrl)
    },
  })

  const copy = (label: string, value: string) => {
    Clipboard.setString(value)
    void Haptics.selectionAsync()
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <Stack gap={space.lg}>
      <Animated.View style={{ transform: [{ scale: pop }] }}>
        <View style={styles.sim}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="label" color={colors.limeInk}>
              {config.plan.name}
            </Text>
            <Text variant="label" color={colors.limeInk}>
              {live ? 'eSIM' : 'Mock eSIM'}
            </Text>
          </Row>
          <View style={styles.chip} />
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <Stack gap={0}>
              <Text variant="label" color="rgba(11,11,12,0.6)">
                ICCID
              </Text>
              <Text variant="heading" color={colors.limeInk} style={{ fontFamily: 'monospace' }}>
                •••• •••• •••• {order.iccidLast4}
              </Text>
            </Stack>
            <Text variant="heading" color={colors.limeInk}>
              Mobiloot
            </Text>
          </Row>
        </View>
      </Animated.View>

      {order.suspended ? (
        <Notice tone="danger">
          Line suspended: your wallet no longer holds enough lootSOL to cover the plan. Stake back up and it resumes
          automatically.
        </Notice>
      ) : null}
      <Card style={order.suspended ? { opacity: 0.5 } : undefined}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="heading">Install your eSIM</Text>
          <Chip label={order.suspended ? 'Suspended' : 'Ready'} tone={order.suspended ? 'danger' : 'lime'} />
        </Row>
        {live ? (
          <Stack gap={space.sm}>
            <Text color={colors.textMuted}>
              1. Tap Install on this phone. Android opens its eSIM installer with your code filled in.
            </Text>
            <Text color={colors.textMuted}>
              2. Confirm the download. Stay on Wi-Fi or mobile data until it finishes.
            </Text>
            <Text color={colors.textMuted}>3. Turn on the Mobiloot line, and pick it for mobile data if you like.</Text>
            <Text variant="small" color={colors.textFaint}>
              If the installer doesn&apos;t open, show the activation code and enter it in SIM settings under Add eSIM.
            </Text>
          </Stack>
        ) : (
          <Stack gap={space.sm}>
            <Text color={colors.textMuted}>1. Open SIM settings and choose Add eSIM (or Download a SIM).</Text>
            <Text color={colors.textMuted}>
              2. Pick &quot;Enter code manually&quot; and paste the activation code, or scan the QR from another screen.
            </Text>
            <Text color={colors.textMuted}>3. Turn on the Mobiloot line for mobile data.</Text>
          </Stack>
        )}
        {live ? (
          <Button
            title="Install on this phone"
            disabled={order.suspended}
            loading={install.isPending}
            onPress={() => install.mutate()}
            icon={<Feather name="download" size={18} color={colors.limeInk} />}
            accessibilityHint="Opens Android's eSIM installer"
          />
        ) : null}
        {install.isError ? <Notice tone="danger">{(install.error as Error).message}</Notice> : null}
        {!live ? (
          <Notice tone="info">
            This is a mock eSIM for the demo. Its code points to a test server and will not install a live line.
          </Notice>
        ) : null}
        {revealed ? (
          <Stack gap={space.md}>
            <Notice tone="warn">
              Anyone with this code can install your eSIM. Don&apos;t share it or post it publicly.
            </Notice>
            <View style={{ alignSelf: 'center', padding: space.md, backgroundColor: '#fff', borderRadius: radius.md }}>
              <QRCode value={revealed.activationCode} size={180} />
            </View>
            {revealed.msisdn ? (
              <CopyRow
                label="Your number"
                value={`+${revealed.msisdn.replace(/^\+/, '')}`}
                copied={copied}
                onCopy={copy}
              />
            ) : null}
            {revealed.smdpAddress ? (
              <CopyRow label="SM-DP+ address" value={revealed.smdpAddress} copied={copied} onCopy={copy} />
            ) : null}
            {revealed.matchingId ? (
              <CopyRow label="Activation code" value={revealed.matchingId} copied={copied} onCopy={copy} />
            ) : null}
            <CopyRow label="Full LPA string" value={revealed.activationCode} copied={copied} onCopy={copy} />
            <Button title="Hide code" kind="ghost" onPress={() => setRevealed(null)} />
          </Stack>
        ) : (
          <Button
            title="Show activation code"
            kind="secondary"
            disabled={order.suspended}
            loading={reveal.isPending}
            onPress={() => reveal.mutate()}
            icon={<Feather name="eye" size={18} color={colors.text} />}
          />
        )}
        <Button
          title="Open SIM settings"
          kind={live ? 'ghost' : 'primary'}
          onPress={openSimSettings}
          icon={<Feather name="settings" size={18} color={live ? colors.text : colors.limeInk} />}
        />
      </Card>

      <Card>
        <Text variant="heading">This period</Text>
        {order.suspended ? (
          <Text color={colors.textMuted}>Usage is paused while the line is suspended.</Text>
        ) : usage.data ? (
          <Stack gap={space.md}>
            <Stack gap={6}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="small" color={colors.textMuted}>
                  Data
                </Text>
                <Text variant="small">
                  {usage.data.dataTotalMb == null
                    ? `${mb(usage.data.dataUsedMb)} used · unlimited`
                    : `${mb(usage.data.dataUsedMb)} of ${mb(usage.data.dataTotalMb)}`}
                </Text>
              </Row>
              {usage.data.dataTotalMb == null ? null : (
                <ProgressBar value={usage.data.dataUsedMb / usage.data.dataTotalMb} />
              )}
            </Stack>
            <Divider />
            <KeyValue label="Calls" value={`${usage.data.minutesUsed} min`} />
            <KeyValue label="Texts" value={`${usage.data.textsUsed}`} />
            <KeyValue label="Renews" value={`in ${daysUntil(config.period.end)} days, if your stake still covers it`} />
          </Stack>
        ) : (
          <ActivityIndicator color={colors.lime} />
        )}
      </Card>
    </Stack>
  )
}

function CopyRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string
  value: string
  copied: string | null
  onCopy: (l: string, v: string) => void
}) {
  return (
    <Pressable
      onPress={() => onCopy(label, value)}
      accessibilityRole="button"
      accessibilityLabel={`Copy ${label}`}
      style={styles.copyRow}
    >
      <Stack gap={2} style={{ flex: 1 }}>
        <Text variant="label" color={colors.textMuted}>
          {label}
        </Text>
        <Text variant="mono" numberOfLines={1}>
          {value}
        </Text>
      </Stack>
      <Feather
        name={copied === label ? 'check' : 'copy'}
        size={18}
        color={copied === label ? colors.lime : colors.textMuted}
      />
    </Pressable>
  )
}

async function openSimSettings() {
  for (const action of [
    'android.settings.MANAGE_ALL_SIM_PROFILES_SETTINGS',
    'android.settings.NETWORK_OPERATOR_SETTINGS',
    'android.settings.WIRELESS_SETTINGS',
  ]) {
    try {
      await Linking.sendIntent(action)
      return
    } catch {}
  }
  await Linking.openSettings()
}

const styles = {
  sim: {
    backgroundColor: colors.lime,
    borderRadius: radius.lg,
    borderTopRightRadius: 56,
    padding: space.xl,
    aspectRatio: 1.586,
    justifyContent: 'space-between' as const,
  },
  chip: { width: 48, height: 36, borderRadius: 8, backgroundColor: 'rgba(11,11,12,0.18)' },
  copyRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    minHeight: 56,
  },
}
