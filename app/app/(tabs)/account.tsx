import { Feather } from '@expo/vector-icons'
import Clipboard from '@react-native-clipboard/clipboard'
import Constants from 'expo-constants'
import * as Haptics from 'expo-haptics'
import * as WebBrowser from 'expo-web-browser'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Platform, Pressable } from 'react-native'
import { Header } from '@/components/header'
import { Button, Card, Chip, Divider, KeyValue, Row, Screen, Stack, Text } from '@/components/ui'
import { API_URL } from '@/constants/env'
import { colors, space } from '@/constants/theme'
import { useMobiloot } from '@/features/config'
import { useMe, useSolBalance } from '@/features/data'
import { shortAddress, sol } from '@/features/format'
import { useSession } from '@/features/session'

// Seeker devices report their model name; used only for a friendly touch, never for security.
const isSeeker = Platform.OS === 'android' && /seeker/i.test(String((Platform.constants as any)?.Model ?? ''))

export default function Account() {
  const { address, disconnect } = useSession()
  const { config, explorer } = useMobiloot()
  const balance = useSolBalance()
  const me = useMe()
  const router = useRouter()
  const [copied, setCopied] = useState(false)

  const open = (path: string) => WebBrowser.openBrowserAsync(explorer(path))

  return (
    <Screen header={<Header />}>
      <Text variant="title">Account</Text>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="label" color={colors.textMuted}>
            Wallet
          </Text>
          {isSeeker ? <Chip label="Seeker" tone="lime" /> : null}
        </Row>
        <Pressable
          onPress={() => {
            Clipboard.setString(address!)
            void Haptics.selectionAsync()
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
          accessibilityRole="button"
          accessibilityLabel="Copy wallet address"
        >
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="title" style={{ fontFamily: 'monospace', fontSize: 20 }}>
              {shortAddress(address ?? '', 6)}
            </Text>
            <Feather name={copied ? 'check' : 'copy'} size={18} color={copied ? colors.lime : colors.textMuted} />
          </Row>
        </Pressable>
        <KeyValue label="SOL balance" value={balance.data !== undefined ? `${sol(balance.data)} SOL` : '…'} />
        <KeyValue label="lootSOL" value={me.data ? sol(me.data.holdings.poolTokens, 4) : '…'} />
        <Button title="View wallet on Explorer" kind="ghost" onPress={() => open(`address/${address}`)} />
      </Card>

      <Card>
        <Text variant="heading">Learn</Text>
        <LinkRow icon="help-circle" label="How Mobiloot works" onPress={() => router.push('/how-it-works')} />
        <Divider />
        <LinkRow icon="layers" label="lootSOL stake pool" onPress={() => open(`address/${config.stakePool}`)} />
        <Divider />
        <LinkRow icon="code" label="Mobiloot program" onPress={() => open(`address/${config.mobilootProgram}`)} />
        <Divider />
        <LinkRow
          icon="briefcase"
          label="Treasury (where yield goes)"
          onPress={() => open(`address/${config.treasury}`)}
        />
      </Card>

      <Card>
        <Text variant="heading">Diagnostics</Text>
        <KeyValue label="App version" value={`${Constants.expoConfig?.version ?? '?'}`} />
        <KeyValue label="Network" value={config.cluster} />
        <KeyValue label="RPC" value={config.rpcUrl.replace(/^https?:\/\//, '')} mono />
        <KeyValue label="API" value={API_URL.replace(/^https?:\/\//, '')} mono />
        <KeyValue label="eSIM provider" value={config.providerMode === 'mock' ? 'Mock (demo)' : 'Shaka sandbox'} />
        <KeyValue label="Program" value={shortAddress(config.mobilootProgram, 6)} mono />
        <KeyValue label="Stake pool" value={shortAddress(config.stakePool, 6)} mono />
      </Card>

      <Stack gap={space.sm}>
        <Button title="Disconnect wallet" kind="danger" onPress={disconnect} />
        <Text variant="small" color={colors.textFaint} style={{ textAlign: 'center' }}>
          Mobiloot never asks for your seed phrase. Your lootSOL stays in your wallet.
        </Text>
      </Stack>
    </Screen>
  )
}

function LinkRow({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name']
  label: string
  onPress: () => void
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" style={{ minHeight: 44, justifyContent: 'center' }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row>
          <Feather name={icon} size={18} color={colors.lime} />
          <Text>{label}</Text>
        </Row>
        <Feather name="chevron-right" size={18} color={colors.textFaint} />
      </Row>
    </Pressable>
  )
}
