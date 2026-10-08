import { useQuery } from '@tanstack/react-query'
import { PublicKey } from '@solana/web3.js'
import { api, ApiError, type Me, type PoolStats, type Usage } from './api'
import { useMobiloot } from './config'
import { useSession } from './session'

function useAuthed<T>(
  key: string,
  path: string,
  opts: { enabled?: boolean; refetchInterval?: number | ((data: T | undefined) => number) } = {},
) {
  const { token, invalidate } = useSession()
  return useQuery({
    queryKey: [key, token],
    enabled: Boolean(token) && (opts.enabled ?? true),
    refetchInterval:
      typeof opts.refetchInterval === 'function'
        ? (q) => (opts.refetchInterval as (d: T | undefined) => number)(q.state.data)
        : opts.refetchInterval,
    queryFn: async () => {
      try {
        return await api<T>(path, { token })
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) invalidate()
        throw e
      }
    },
  })
}

// Poll quickly while a live eSIM is being set up on the network.
export const useMe = () =>
  useAuthed<Me>('me', '/v1/me', { refetchInterval: (me) => (me?.esim?.status === 'pending' ? 4_000 : 30_000) })

export function useUsage(enabled: boolean) {
  return useAuthed<Usage>('usage', '/v1/usage', { enabled, refetchInterval: 60_000 })
}

export function usePool() {
  return useQuery({ queryKey: ['pool'], queryFn: () => api<PoolStats>('/v1/pool'), refetchInterval: 60_000 })
}

export function useSolBalance() {
  const { connection } = useMobiloot()
  const { address } = useSession()
  return useQuery({
    queryKey: ['balance', address],
    enabled: Boolean(address),
    queryFn: () => connection.getBalance(new PublicKey(address!)),
    refetchInterval: 30_000,
  })
}

/**
 * The plan maths shown throughout the app: how much of the plan's monthly cost the
 * user's stake covers at the pool's yield, and how much stake would cover all of it.
 */
export function useFunding(stakeLamports: number) {
  const { config } = useMobiloot()
  const pool = usePool()
  const apy = pool.data?.apy ?? 0.068
  const solUsd = config.solUsd.usd
  const monthlyYieldUsd = ((stakeLamports / 1e9) * apy * solUsd) / 12
  const planCost = config.plan.monthlyCostUsd
  const fullStakeSol = (planCost * 12) / (apy * solUsd)
  return {
    apy,
    apySource: pool.data?.apySource ?? 'reference',
    solUsd,
    priceSource: config.solUsd.source,
    monthlyYieldUsd,
    planCost,
    fundedRatio: planCost > 0 ? monthlyYieldUsd / planCost : 0,
    fullStakeSol,
    minStakeSol: Number(config.minStakeLamports) / 1e9,
  }
}
