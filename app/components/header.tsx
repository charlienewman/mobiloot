import { View } from 'react-native'
import { useZero } from '@/features/config'
import { colors, space } from '@/constants/theme'
import { Wordmark } from './brand'
import { Chip } from './ui'

/**
 * App header. The network and provider chips are always visible so nobody mistakes
 * test-network value or a mock eSIM for the real thing.
 */
export function Header() {
  const { config } = useZero()
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
        <Chip label={config.providerMode === 'mock' ? 'Mock eSIM' : 'Shaka sandbox'} tone="info" />
      </View>
    </View>
  )
}
