import { View } from 'react-native'
import { useMobiloot } from '@/features/config'
import { useMe } from '@/features/data'
import { colors, space } from '@/constants/theme'
import { Wordmark } from './brand'
import { Chip } from './ui'

/**
 * App header. The network and provider chips are always visible so nobody mistakes
 * test-network value or a mock eSIM for the real thing.
 */
export function Header() {
  const { config } = useMobiloot()
  // Which provider serves *this* wallet; the server default is the mock for everyone else.
  const live = useMe().data?.liveEsim ?? config.providerMode !== 'mock'
  const network = config.cluster === 'mainnet-beta' ? null : config.cluster === 'devnet' ? 'Devnet' : 'Localnet'
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: space.lg,
        paddingTop: space.sm,
        paddingBottom: space.md,
        backgroundColor: colors.bg,
      }}
    >
      <Wordmark size={20} />
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {network ? <Chip label={network} tone="warn" /> : null}
        <Chip label={live ? 'Live eSIM' : 'Mock eSIM'} tone={live ? 'lime' : 'info'} />
      </View>
    </View>
  )
}
