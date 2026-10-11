// The plan catalogue. `code` must match the mobiloot program's configured plan code.
// `monthlyPriceGbp` is the retail price the stake's yield has to cover.
export interface Plan {
  code: string
  name: string
  tagline: string
  dataGb: number | 'unlimited'
  minutes: 'unlimited' | number
  texts: 'unlimited' | number
  coverage: string
  /** Monthly retail price in pounds; the pool's yield has to cover it. */
  monthlyPriceGbp: number
}

export const PLANS: Plan[] = [
  {
    code: 'loot-essentials',
    name: 'Mobiloot Unlimited',
    tagline: 'Unlimited UK data, calls and texts. Paid for by your stake.',
    dataGb: 'unlimited',
    minutes: 'unlimited',
    texts: 'unlimited',
    coverage: 'UK',
    monthlyPriceGbp: 10,
  },
]

export const planByCode = (code: string) => PLANS.find((p) => p.code === code)
