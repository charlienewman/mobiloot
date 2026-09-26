// Loads the deployment config (cluster, pool and program addresses, plan) from the API,
// caches it for offline starts, and sets up the wallet provider for that cluster.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useQuery } from '@tanstack/react-query'
import { Connection, PublicKey } from '@solana/web3.js'
import { MobileWalletProvider } from '@wallet-ui/react-native-web3js'
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { ZeroMark } from '@/components/brand'
import { Button, Text } from '@/components/ui'
import { APP_IDENTITY } from '@/constants/env'
import { colors, space } from '@/constants/theme'
import { api, type ZeroConfigResponse } from './api'

const CACHE_KEY = 'zero.config.v1'

export interface ZeroContext {
  config: ZeroConfigResponse
  connection: Connection
  stakePool: PublicKey
  zeroProgram: PublicKey
  /** MWA chain id; localnet borrows devnet's so test wallets accept it. */
  chain: 'solana:devnet' | 'solana:mainnet'
  explorer(path: string): string
}

const Ctx = createContext<ZeroContext | null>(null)

export function useZero(): ZeroContext {
  const v = useContext(Ctx)
  if (!v) throw new Error('useZero outside ZeroConfigProvider')
  return v
}

export function ZeroConfigProvider({ children }: { children: ReactNode }) {
  const [cached, setCached] = useState<ZeroConfigResponse | null | undefined>(undefined)
  useEffect(() => {
    AsyncStorage.getItem(CACHE_KEY)
      .then((v) => setCached(v ? JSON.parse(v) : null))
      .catch(() => setCached(null))
  }, [])

  const query = useQuery({
    queryKey: ['config'],
    queryFn: async () => {
      const c = await api<ZeroConfigResponse>('/v1/config')
      void AsyncStorage.setItem(CACHE_KEY, JSON.stringify(c)).catch(() => {})
      return c
    },
    staleTime: 60_000,
    retry: 2,
  })
  const config = query.data ?? cached ?? undefined

  const value = useMemo<ZeroContext | null>(() => {
    if (!config) return null
    const custom = config.cluster === 'localnet' ? `?cluster=custom&customUrl=${encodeURIComponent(config.rpcUrl)}` : config.cluster === 'devnet' ? '?cluster=devnet' : ''
    return {
      config,
      connection: new Connection(config.rpcUrl, 'confirmed'),
      stakePool: new PublicKey(config.stakePool),
      zeroProgram: new PublicKey(config.zeroProgram),
      chain: config.cluster === 'mainnet-beta' ? 'solana:mainnet' : 'solana:devnet',
      explorer: (path: string) => `https://explorer.solana.com/${path}${custom}`,
    }
  }, [config])

  if (!value) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: space.xl, padding: space.xl }}>
        <ZeroMark size={72} />
        {query.isError && cached === null ? (
          <>
            <Text variant="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
              Can&apos;t reach Zero right now. Check your connection and try again.
            </Text>
            <Button title="Try again" kind="secondary" onPress={() => query.refetch()} />
          </>
        ) : (
          <ActivityIndicator color={colors.lime} />
        )}
      </View>
    )
  }

  return (
    <Ctx.Provider value={value}>
      <MobileWalletProvider chain={value.chain} endpoint={value.config.rpcUrl} identity={APP_IDENTITY}>
        {children}
      </MobileWalletProvider>
    </Ctx.Provider>
  )
}
