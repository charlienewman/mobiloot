import { Feather } from '@expo/vector-icons'
import * as WebBrowser from 'expo-web-browser'
import { ActivityIndicator, Modal, Pressable, View } from 'react-native'
import { useZero } from '@/features/config'
import type { TxState } from '@/features/transactions'
import { colors, radius, space } from '@/constants/theme'
import { Button, Row, Stack, Text } from './ui'

const TITLES = {
  deposit: 'Staking your SOL',
  withdraw: 'Withdrawing your SOL',
  activate: 'Activating your plan',
} as const

const STEPS: { key: TxState['step']; label: string }[] = [
  { key: 'preparing', label: 'Preparing transaction' },
  { key: 'wallet', label: 'Approve in your wallet' },
  { key: 'confirming', label: 'Confirming on Solana' },
  { key: 'done', label: 'Confirmed' },
]

/** Bottom sheet that walks through a transaction's life so no wait is unexplained. */
export function TxSheet({ state, onClose, successNote }: { state: TxState; onClose: () => void; successNote?: string }) {
  const { explorer } = useZero()
  const visible = state.step !== 'idle'
  const current = STEPS.findIndex((s) => s.key === state.step)
  const finished = state.step === 'done' || state.step === 'error'
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={finished ? onClose : undefined}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={finished ? onClose : undefined} />
      <View
        style={{
          backgroundColor: colors.surface,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          padding: space.xl,
          paddingBottom: space.xxl,
          gap: space.xl,
          borderTopWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text variant="title">{state.kind ? TITLES[state.kind] : ''}</Text>
        {state.step === 'error' ? (
          <Stack>
            <Row>
              <Feather name="alert-circle" size={22} color={colors.danger} />
              <Text variant="heading" color={colors.danger}>
                That didn&apos;t go through
              </Text>
            </Row>
            <Text color={colors.textMuted}>{state.error}</Text>
          </Stack>
        ) : (
          <Stack gap={space.lg}>
            {STEPS.map((s, i) => {
              const done = i < current || state.step === 'done'
              const active = i === current && state.step !== 'done'
              return (
                <Row key={s.key} accessibilityState={{ busy: active }} accessible>
                  <View style={{ width: 24, alignItems: 'center' }}>
                    {done ? (
                      <Feather name="check-circle" size={22} color={colors.lime} />
                    ) : active ? (
                      <ActivityIndicator color={colors.lime} />
                    ) : (
                      <Feather name="circle" size={20} color={colors.textFaint} />
                    )}
                  </View>
                  <Text variant="body" color={done || active ? colors.text : colors.textFaint}>
                    {s.label}
                  </Text>
                </Row>
              )
            })}
            {state.step === 'done' && successNote ? <Text color={colors.textMuted}>{successNote}</Text> : null}
          </Stack>
        )}
        {state.signature ? (
          <Pressable onPress={() => WebBrowser.openBrowserAsync(explorer(`tx/${state.signature}`))} accessibilityRole="link">
            <Row gap={6}>
              <Feather name="external-link" size={14} color={colors.textMuted} />
              <Text variant="small" color={colors.textMuted}>
                View on Solana Explorer
              </Text>
            </Row>
          </Pressable>
        ) : null}
        {finished ? <Button title={state.step === 'done' ? 'Done' : 'Close'} kind={state.step === 'done' ? 'primary' : 'secondary'} onPress={onClose} /> : null}
      </View>
    </Modal>
  )
}
