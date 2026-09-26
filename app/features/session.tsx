// Wallet connection + backend session in a single Mobile Wallet Adapter handoff:
// the wallet is asked to authorize *and* Sign In With Solana using a server nonce.
import { useQueryClient } from '@tanstack/react-query'
import { fromUint8Array, useMobileWallet } from '@wallet-ui/react-native-web3js'
import * as SecureStore from 'expo-secure-store'
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Buffer } from 'buffer'
import { api } from './api'

interface Session {
  address: string
  token: string
  expiresAt: number
}

interface SessionContext {
  address?: string
  token?: string
  ready: boolean
  busy: boolean
  error?: string
  connect(): Promise<void>
  disconnect(): Promise<void>
  /** Called when the API rejects the token (expired or revoked). */
  invalidate(): void
}

const KEY = 'zero.session.v1'
const Ctx = createContext<SessionContext | null>(null)

export function useSession() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession outside SessionProvider')
  return v
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then((raw) => {
        const s: Session | null = raw ? JSON.parse(raw) : null
        if (s && s.expiresAt > Date.now()) setSession(s)
      })
      .catch(() => {})
      .finally(() => setReady(true))
  }, [])

  const persist = useCallback(async (s: Session | null) => {
    setSession(s)
    if (s) await SecureStore.setItemAsync(KEY, JSON.stringify(s))
    else await SecureStore.deleteItemAsync(KEY)
  }, [])

  const connect = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      const input = await api<Record<string, string>>('/v1/auth/challenge', { method: 'POST' })
      const result = await wallet.signIn(input)
      const signedMessage = unwrapBase64(result.signedMessage, (b) =>
        b.toString('utf8').includes(' wants you to sign in'),
      )
      const signature = unwrapBase64(result.signature, (b) => b.length === 64)
      // The SIWS message names the signing account on its second line; the server
      // verifies the signature against it, so it is the most reliable source.
      const address = Buffer.from(signedMessage).toString('utf8').split('\n')[1] ?? accountAddress(result.account)
      const verified = await api<{ token: string; expiresAt: number }>('/v1/auth/verify', {
        method: 'POST',
        body: { address, signedMessage: fromUint8Array(signedMessage), signature: fromUint8Array(signature) },
      })
      await persist({ address, token: verified.token, expiresAt: verified.expiresAt })
      await queryClient.invalidateQueries()
    } catch (e: any) {
      setError(describeWalletError(e))
    } finally {
      setBusy(false)
    }
  }, [wallet, persist, queryClient])

  const disconnect = useCallback(async () => {
    const token = session?.token
    await persist(null)
    queryClient.clear()
    if (token) void api('/v1/auth/logout', { method: 'POST', token }).catch(() => {})
    await wallet.disconnect().catch(() => {})
  }, [session, persist, queryClient, wallet])

  const invalidate = useCallback(() => void persist(null), [persist])

  // The wallet may remember a different account than our session (e.g. switched in the
  // wallet app). Treat the session as the source of truth for identity.
  const value = useMemo<SessionContext>(
    () => ({ address: session?.address, token: session?.token, ready, busy, error, connect, disconnect, invalidate }),
    [session, ready, busy, error, connect, disconnect, invalidate],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function describeWalletError(e: any): string {
  const msg = String(e?.message ?? e)
  if (/ERROR_WALLET_NOT_FOUND|no installed wallet|Found no installed wallet/i.test(msg)) {
    return 'No Solana wallet found. Install a Mobile Wallet Adapter wallet (Seed Vault, Phantom or Solflare) and try again.'
  }
  if (/declined|rejected|cancel|ERROR_AUTHORIZATION_FAILED|ERROR_NOT_SIGNED|CancellationException/i.test(msg)) {
    return 'Request cancelled in your wallet.'
  }
  if (/blockhash|expired/i.test(msg)) return 'The request expired before it was confirmed. Please try again.'
  return msg.length < 160 ? msg : 'Something went wrong. Please try again.'
}

/**
 * Some wallet/adapter combinations return the base64 *text* of a value as bytes rather
 * than the decoded bytes. If `bytes` is ASCII base64 whose decoding passes `looksRight`,
 * return the decoded bytes; otherwise return `bytes` unchanged.
 */
function unwrapBase64(bytes: Uint8Array, looksRight: (decoded: Buffer) => boolean): Uint8Array {
  const raw = Buffer.from(bytes)
  if (looksRight(raw)) return bytes
  const text = raw.toString('latin1')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return bytes
  const decoded = Buffer.from(text, 'base64')
  return looksRight(decoded) ? new Uint8Array(decoded) : bytes
}

function accountAddress(account: any): string {
  if (account?.publicKey?.toBase58) return account.publicKey.toBase58()
  if (account?.address?.toBase58) return account.address.toBase58()
  return String(account?.address ?? '')
}
