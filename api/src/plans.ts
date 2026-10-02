// The plan catalogue. `code` must match the mobiloot program's configured plan code.
// Costs are illustrative wholesale assumptions used for the funding maths, not prices.
export interface Plan {
  code: string
  name: string
  tagline: string
  dataGb: number
  minutes: 'unlimited' | number
  texts: 'unlimited' | number
  coverage: string
  /** Assumed monthly wholesale cost the pool's yield has to cover. */
  monthlyCostUsd: number
}

export const PLANS: Plan[] = [
  {
    code: 'loot-essentials',
    name: 'Mobiloot Essentials',
    tagline: 'Everyday data, calls and texts. Paid for by your stake.',
    dataGb: 10,
    minutes: 'unlimited',
    texts: 'unlimited',
    coverage: 'UK, with EU roaming',
    monthlyCostUsd: 6,
  },
]

export const planByCode = (code: string) => PLANS.find((p) => p.code === code)
