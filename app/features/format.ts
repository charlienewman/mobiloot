const LAMPORTS = 1_000_000_000

export const toSol = (lamports: bigint | number | string) => Number(lamports) / LAMPORTS

export function sol(lamports: bigint | number | string, digits = 3) {
  const v = toSol(lamports)
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function usd(v: number, digits = 2) {
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function gbp(v: number, digits = 2) {
  return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function pct(v: number, digits = 0) {
  return `${(v * 100).toFixed(digits)}%`
}

export function shortAddress(a: string, n = 4) {
  return a.length > n * 2 + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a
}

export function daysUntil(unixSeconds: number) {
  return Math.max(0, Math.ceil((unixSeconds * 1000 - Date.now()) / 86_400_000))
}

export function mb(v: number) {
  return v >= 1024 ? `${(v / 1024).toFixed(1)} GB` : `${Math.round(v)} MB`
}
