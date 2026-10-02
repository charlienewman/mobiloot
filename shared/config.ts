// Public, per-cluster deployment addresses written by `npm run pool:setup`.
export interface ClusterConfig {
  cluster: 'localnet' | 'devnet' | 'mainnet-beta'
  rpcUrl: string
  stakePoolProgram: string
  stakePool: string
  poolMint: string
  reserveStake: string
  validatorList: string
  treasury: string
  treasuryFeeAccount: string
  validatorVotes: string[]
  mobilootProgram?: string
}
