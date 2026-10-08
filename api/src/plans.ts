// The plan catalogue. `code` must match the mobiloot program's configured plan code.
// Costs are illustrative wholesale assumptions used for the funding maths, not prices.
export interface Plan {
  code: string
  name: string
  tagline: string
  dataGb: number | 'unlimited'
  minutes: 'unlimited' | number
  texts: 'unlimited' | number
  coverage: string
  /** Assumed monthly wholesale cost the pool's yield has to cover. */
  monthlyCostUsd: number
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
    monthlyCostUsd: 6,
  },
]

export const planByCode = (code: string) => PLANS.find((p) => p.code === code)
