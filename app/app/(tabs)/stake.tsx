import { useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { Header } from '@/components/header'
import { TxSheet } from '@/components/tx-sheet'
import { Button, Card, Divider, KeyValue, Notice, Row, Screen, Stack, Text } from '@/components/ui'
import { colors, radius, space } from '@/constants/theme'
import { useMobiloot } from '@/features/config'
import { useFunding, useMe, usePool, useSolBalance } from '@/features/data'
import { pct, sol, usd } from '@/features/format'
import { useTransactions } from '@/features/transactions'

type Mode = 'stake' | 'withdraw'
// Leaves room for the lootSOL token account's rent and network fees.
const FEE_BUFFER = 10_000_000

export default function Stake() {
  const { config } = useMobiloot()
  const [mode, setMode] = useState<Mode>('stake')
  const [amount, setAmount] = useState('')
  const me = useMe()
  const pool = usePool()
  const balance = useSolBalance()
  const tx = useTransactions()

  const rate = pool.data?.exchangeRate ?? 1
  const heldTokens = Number(me.data?.holdings.poolTokens ?? 0)
  const heldLamports = Number(me.data?.holdings.stakeLamports ?? 0)
  const walletLamports = balance.data ?? 0
  const min = Number(config.minStakeLamports)

  const parsed = Number(amount.replace(',', '.'))
  const valid = Number.isFinite(parsed) && parsed > 0
  const lamports = valid ? Math.round(parsed * 1e9) : 0
  const maxLamports = mode === 'stake' ? Math.max(0, walletLamports - FEE_BUFFER) : heldTokens
  const tooMuch = lamports > maxLamports
  const reserve = Number(pool.data?.reserveLamports ?? 0)
  const withdrawLamports = lamports * rate
  const reserveShort = mode === 'withdraw' && withdrawLamports > reserve - 2_282_880

  const afterLamports = mode === 'stake' ? heldLamports + lamports : Math.max(0, heldLamports - withdrawLamports)
  const now = useFunding(heldLamports)
  const after = useFunding(afterLamports)
  const active = Boolean(me.data?.entitlement)

  const setFraction = (f: number) =>
    setAmount(((maxLamports * f) / 1e9).toFixed(mode === 'stake' ? 3 : 4).replace(/\.?0+$/, ''))

  const submit = async () => {
    const sig = mode === 'stake' ? await tx.deposit(BigInt(lamports)) : await tx.withdraw(BigInt(lamports))
    if (sig) setAmount('')
  }

  return (
    <Screen header={<Header />}>
      <Text variant="title">{mode === 'stake' ? 'Stake SOL' : 'Withdraw SOL'}</Text>
      <Segmented value={mode} onChange={(m) => (setMode(m), setAmount(''))} />

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="label" color={colors.textMuted}>
            {mode === 'stake' ? 'You stake' : 'You redeem'}
          </Text>
          <Text variant="small" color={colors.textMuted}>
            {mode === 'stake' ? `Wallet: ${sol(walletLamports)} SOL` : `Held: ${sol(heldTokens, 4)} lootSOL`}
          </Text>
        </Row>
        <Row>
          <TextInput
            value={amount}
            onChangeText={(t) => setAmount(t.replace(/[^0-9.,]/g, ''))}
            placeholder="0.0"
            placeholderTextColor={colors.textFaint}
            keyboardType="decimal-pad"
            accessibilityLabel={mode === 'stake' ? 'Amount of SOL to stake' : 'Amount of lootSOL to redeem'}
            style={{
              flex: 1,
              color: colors.text,
              fontSize: 44,
              fontWeight: '800',
              padding: 0,
              fontVariant: ['tabular-nums'],
            }}
          />
          <Text variant="title" color={colors.textMuted}>
            {mode === 'stake' ? 'SOL' : 'lootSOL'}
          </Text>
        </Row>
        <Row gap={space.sm}>
          {[0.25, 0.5, 1].map((f) => (
            <Pressable key={f} onPress={() => setFraction(f)} style={styles.preset} accessibilityRole="button">
              <Text variant="small">{f === 1 ? 'Max' : pct(f)}</Text>
            </Pressable>
          ))}
        </Row>
      </Card>

      <Card tone="raised">
        <Text variant="label" color={colors.textMuted}>
          After this
        </Text>
        <KeyValue label="Your stake" value={`${sol(afterLamports)} SOL`} />
        <KeyValue label="Plan funded by yield" value={`${pct(now.fundedRatio)} → ${pct(after.fundedRatio)}`} />
        <KeyValue label="Yield to your plan" value={`${usd(after.monthlyYieldUsd)}/mo`} />
        <KeyValue
          label="Unlocks this period's plan"
          value={afterLamports >= min ? 'Yes' : `Needs ${sol(min - afterLamports)} more`}
        />
        {mode === 'stake' ? (
          <Text variant="small" color={colors.textMuted}>
            You receive about {sol(lamports / rate, 4)} lootSOL. Your principal stays redeemable, and the staking
            rewards go to the treasury to pay for your plan.
          </Text>
        ) : (
          <Text variant="small" color={colors.textMuted}>
            You receive about {sol(withdrawLamports, 4)} SOL straight to your wallet. There is no withdrawal fee.
          </Text>
        )}
      </Card>

      {mode === 'withdraw' && active && afterLamports < min && lamports > 0 ? (
        <Notice tone="warn">
          Below {sol(min)} lootSOL your line pauses until you stake back up, and the plan won&apos;t renew.
        </Notice>
      ) : null}
      {reserveShort && lamports > 0 ? (
        <Notice tone="warn">
          The pool&apos;s instant-withdrawal reserve is {sol(reserve)} SOL right now. Try a smaller amount.
        </Notice>
      ) : null}

      <Button
        title={mode === 'stake' ? 'Stake' : 'Withdraw'}
        disabled={!valid || tooMuch || reserveShort}
        onPress={submit}
        accessibilityHint="Opens your wallet to approve the transaction"
      />
      {tooMuch && valid ? (
        <Text variant="small" color={colors.danger} style={{ textAlign: 'center' }}>
          {mode === 'stake' ? 'More than your wallet balance (after fees)' : 'More than you hold'}
        </Text>
      ) : null}

      <Card>
        <Text variant="heading">What would fully fund my plan?</Text>
        <Text variant="number" style={{ fontSize: 40, lineHeight: 44 }}>
          {now.fullStakeSol.toFixed(1)} SOL
        </Text>
        <Text variant="small" color={colors.textMuted}>
          {config.plan.name} costs Mobiloot about {usd(config.plan.monthlyCostUsd, 0)} a month. At {pct(now.apy, 1)}{' '}
          yield ({now.apySource === 'measured' ? 'measured' : 'mainnet reference'}) and SOL at {usd(now.solUsd, 0)} (
          {now.priceSource === 'pyth' ? 'Pyth' : 'estimate'}), that stake&apos;s rewards cover the plan. These are
          estimates, not guarantees: yield and SOL&apos;s price both move.
        </Text>
        <Divider />
        <Text variant="small" color={colors.textMuted}>
          Staking carries risk, including validator downtime and smart-contract risk. lootSOL is always redeemable for
          its share of the pool.
        </Text>
      </Card>

      <TxSheet
        state={tx.state}
        onClose={tx.reset}
        successNote={
          tx.state.kind === 'deposit'
            ? 'Your lootSOL is in your wallet. Its rewards now go towards your plan.'
            : 'Your SOL is back in your wallet.'
        }
      />
    </Screen>
  )
}

function Segmented({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: colors.surface,
        borderRadius: radius.pill,
        padding: 4,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      {(['stake', 'withdraw'] as const).map((m) => (
        <Pressable
          key={m}
          onPress={() => onChange(m)}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === m }}
          style={{
            flex: 1,
            paddingVertical: 12,
            borderRadius: radius.pill,
            alignItems: 'center',
            backgroundColor: value === m ? colors.surfaceRaised : 'transparent',
          }}
        >
          <Text variant="heading" color={value === m ? colors.text : colors.textMuted}>
            {m === 'stake' ? 'Stake' : 'Withdraw'}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

const styles = {
  preset: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center' as const,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
}
