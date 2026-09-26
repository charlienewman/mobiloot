// Builds, simulates, signs (via Mobile Wallet Adapter) and confirms the three user
// transactions: deposit SOL for zeroSOL, withdraw SOL, and activate the plan.
import { useQueryClient } from '@tanstack/react-query'
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import * as Haptics from 'expo-haptics'
import { useCallback, useState } from 'react'
import {
  activateIx,
  associatedTokenAddress,
  createAssociatedTokenAccountIdempotent,
  depositSolIx,
  fetchStakePool,
  refreshIxs,
  withdrawSolIx,
  zeroErrorMessage,
} from '@zero/shared'
import { useZero } from './config'
import { describeWalletError, useSession } from './session'

export type TxStep = 'idle' | 'preparing' | 'wallet' | 'confirming' | 'done' | 'error'

export interface TxState {
  step: TxStep
  kind?: 'deposit' | 'withdraw' | 'activate'
  signature?: string
  error?: string
}

export function useTransactions() {
  const { connection, stakePool, zeroProgram, config } = useZero()
  const wallet = useMobileWallet()
  const { address } = useSession()
  const queryClient = useQueryClient()
  const [state, setState] = useState<TxState>({ step: 'idle' })

  const run = useCallback(
    async (kind: TxState['kind'], build: (owner: PublicKey) => Promise<TransactionInstruction[]>) => {
      if (!address || state.step === 'preparing' || state.step === 'wallet' || state.step === 'confirming') return
      const owner = new PublicKey(address)
      setState({ step: 'preparing', kind })
      try {
        const ixs = await build(owner)
        const { context, value: blockhash } = await connection.getLatestBlockhashAndContext()
        const tx = new VersionedTransaction(
          new TransactionMessage({
            payerKey: owner,
            recentBlockhash: blockhash.blockhash,
            instructions: ixs,
          }).compileToV0Message(),
        )
        // Catch program errors before bothering the wallet.
        const sim = await connection.simulateTransaction(tx, { sigVerify: false })
        if (sim.value.err) throw Object.assign(new Error(JSON.stringify(sim.value.err)), { logs: sim.value.logs ?? [] })

        setState({ step: 'wallet', kind })
        let signature: string
        if (config.cluster === 'localnet') {
          // Wallets can't reach a laptop validator, so sign in the wallet and send ourselves.
          const signed = await wallet.signTransaction(tx)
          signature = await connection.sendRawTransaction(signed.serialize())
        } else {
          signature = await wallet.signAndSendTransaction(tx, context.slot)
        }

        setState({ step: 'confirming', kind, signature })
        await confirmByPolling(connection, signature, blockhash.lastValidBlockHeight)

        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        setState({ step: 'done', kind, signature })
        await Promise.all(['me', 'balance', 'pool'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })))
        return signature
      } catch (e: any) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        setState({ step: 'error', kind, error: describeTxError(e) })
      }
    },
    [address, state.step, connection, config.cluster, wallet, queryClient],
  )

  const deposit = useCallback(
    (lamports: bigint) =>
      run('deposit', async (owner) => {
        const pool = await fetchStakePool(connection, stakePool)
        return [
          ...(await refreshIxs(connection, pool)),
          createAssociatedTokenAccountIdempotent(owner, owner, pool.poolMint),
          depositSolIx(pool, owner, lamports),
        ]
      }),
    [run, connection, stakePool],
  )

  const withdraw = useCallback(
    (poolTokens: bigint) =>
      run('withdraw', async (owner) => {
        const pool = await fetchStakePool(connection, stakePool)
        return [...(await refreshIxs(connection, pool)), withdrawSolIx(pool, owner, poolTokens)]
      }),
    [run, connection, stakePool],
  )

  const activate = useCallback(
    (period: bigint) =>
      run('activate', async (owner) => {
        const pool = await fetchStakePool(connection, stakePool)
        return [
          // The program values zeroSOL at the pool's rate, which must be current.
          ...(await refreshIxs(connection, pool)),
          activateIx({
            owner,
            stakePool,
            holderTokens: associatedTokenAddress(owner, pool.poolMint),
            period,
            programId: zeroProgram,
          }),
        ]
      }),
    [run, connection, stakePool, zeroProgram],
  )

  const reset = useCallback(() => setState({ step: 'idle' }), [])
  return { state, deposit, withdraw, activate, reset }
}

/**
 * Polls signature status over HTTP instead of web3.js's websocket subscription, which is
 * unreliable on mobile networks and unavailable through adb port forwarding.
 */
async function confirmByPolling(connection: Connection, signature: string, lastValidBlockHeight: number) {
  for (;;) {
    const { value } = await connection.getSignatureStatuses([signature])
    const status = value[0]
    if (status?.err) throw new Error(JSON.stringify(status.err))
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return
    if ((await connection.getBlockHeight('confirmed')) > lastValidBlockHeight) {
      throw new Error('Transaction expired: blockhash expired before confirmation')
    }
    await new Promise((r) => setTimeout(r, 800))
  }
}

function describeTxError(e: any): string {
  const zero = zeroErrorMessage(e)
  if (zero) return zero
  const logs: string[] = e?.logs ?? []
  const text = String(e?.message ?? e) + logs.join(' ')
  if (/already in use/.test(text)) return 'Your plan is already active for this period.'
  if (/insufficient (funds|lamports)|0x1\b/.test(text)) return 'Not enough SOL to cover this and the network fee.'
  if (/SolWithdrawalTooLarge|0x19\b|reserve/i.test(text))
    return "The pool's instant-withdrawal reserve is low. Try a smaller amount."
  return describeWalletError(e)
}
