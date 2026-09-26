//! Zero Mobile entitlement program.
//!
//! A wallet that holds enough zeroSOL (the Shaka stake pool token) can activate a
//! mobile-plan entitlement for the current billing period. The stake pool pays 100%
//! of its staking rewards to the Shaka treasury, so holding zeroSOL is how the user
//! pays for the plan, while their principal stays redeemable in their own wallet.
//!
//! The program never takes custody of anything. It reads the holder's token account
//! and the stake pool's exchange rate, then records a per-period entitlement that
//! Shaka's backend checks before provisioning or renewing service. No personal or
//! telecom data is ever written on-chain.
use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

declare_id!("ALt9aMm6fdhbtdRq9ftbdyQGKkFjoimGfRHNEMtHiWcp");

/// Byte offsets inside an SPL stake pool account (identical in the official program
/// and Sanctum's fork).
mod stake_pool_layout {
    pub const ACCOUNT_TYPE: usize = 0;
    pub const POOL_MINT: usize = 162;
    pub const TOTAL_LAMPORTS: usize = 258;
    pub const POOL_TOKEN_SUPPLY: usize = 266;
    pub const MIN_LEN: usize = 274;
    pub const ACCOUNT_TYPE_STAKE_POOL: u8 = 1;
}

#[program]
pub mod zero_mobile {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, params: ConfigParams) -> Result<()> {
        params.validate()?;
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.stake_pool = ctx.accounts.stake_pool.key();
        config.stake_pool_program = *ctx.accounts.stake_pool.owner;
        config.pool_mint = read_pool(&ctx.accounts.stake_pool)?.mint;
        config.bump = ctx.bumps.config;
        config.apply(&params);
        Ok(())
    }

    pub fn update_config(ctx: Context<UpdateConfig>, params: ConfigParams) -> Result<()> {
        params.validate()?;
        ctx.accounts.config.apply(&params);
        Ok(())
    }

    /// Activates the plan for `period`, which must be the current billing period.
    pub fn activate(ctx: Context<Activate>, period: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, ZeroError::Paused);
        let now = Clock::get()?.unix_timestamp;
        require_eq!(period, config.period_at(now)?, ZeroError::WrongPeriod);

        let pool = read_pool(&ctx.accounts.stake_pool)?;
        require_keys_eq!(pool.mint, config.pool_mint, ZeroError::WrongStakePool);
        let pool_tokens = ctx.accounts.holder_tokens.amount;
        let stake_lamports = pool.lamports_for(pool_tokens)?;
        require!(stake_lamports >= config.min_stake_lamports, ZeroError::InsufficientStake);

        let entitlement = &mut ctx.accounts.entitlement;
        entitlement.owner = ctx.accounts.owner.key();
        entitlement.period = period;
        entitlement.plan_code = config.plan_code;
        entitlement.pool_tokens = pool_tokens;
        entitlement.stake_lamports = stake_lamports;
        entitlement.activated_at = now;
        entitlement.bump = ctx.bumps.entitlement;

        emit!(EntitlementActivated {
            owner: entitlement.owner,
            period,
            plan_code: config.plan_code,
            stake_lamports,
        });
        Ok(())
    }

    /// Returns the entitlement's rent to its owner once its period has ended.
    pub fn close_entitlement(ctx: Context<CloseEntitlement>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            ctx.accounts.entitlement.period < ctx.accounts.config.period_at(now)?,
            ZeroError::PeriodNotOver
        );
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ConfigParams {
    /// Short public plan identifier, e.g. b"zero-essentials\0".
    pub plan_code: [u8; 16],
    /// SOL value of zeroSOL a wallet must hold to activate a period.
    pub min_stake_lamports: u64,
    /// Length of one billing period.
    pub period_seconds: u32,
    /// Unix timestamp at which period 0 starts.
    pub period_origin: i64,
    pub paused: bool,
}

impl ConfigParams {
    fn validate(&self) -> Result<()> {
        require!(self.period_seconds >= 60, ZeroError::InvalidConfig);
        require!(self.min_stake_lamports > 0, ZeroError::InvalidConfig);
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub stake_pool_program: Pubkey,
    pub stake_pool: Pubkey,
    pub pool_mint: Pubkey,
    pub plan_code: [u8; 16],
    pub min_stake_lamports: u64,
    pub period_seconds: u32,
    pub period_origin: i64,
    pub paused: bool,
    pub bump: u8,
}

impl Config {
    fn apply(&mut self, p: &ConfigParams) {
        self.plan_code = p.plan_code;
        self.min_stake_lamports = p.min_stake_lamports;
        self.period_seconds = p.period_seconds;
        self.period_origin = p.period_origin;
        self.paused = p.paused;
    }

    fn period_at(&self, now: i64) -> Result<u64> {
        let elapsed = now.checked_sub(self.period_origin).ok_or(ZeroError::WrongPeriod)?;
        require!(elapsed >= 0, ZeroError::WrongPeriod);
        Ok(elapsed as u64 / self.period_seconds as u64)
    }
}

#[account]
#[derive(InitSpace)]
pub struct Entitlement {
    pub owner: Pubkey,
    pub period: u64,
    pub plan_code: [u8; 16],
    /// zeroSOL held at activation.
    pub pool_tokens: u64,
    /// SOL value of that zeroSOL at activation.
    pub stake_lamports: u64,
    pub activated_at: i64,
    pub bump: u8,
}

#[event]
pub struct EntitlementActivated {
    pub owner: Pubkey,
    pub period: u64,
    pub plan_code: [u8; 16],
    pub stake_lamports: u64,
}

struct PoolView {
    mint: Pubkey,
    total_lamports: u64,
    pool_token_supply: u64,
}

impl PoolView {
    fn lamports_for(&self, tokens: u64) -> Result<u64> {
        if self.pool_token_supply == 0 {
            return Ok(tokens);
        }
        let v = (tokens as u128)
            .checked_mul(self.total_lamports as u128)
            .ok_or(ZeroError::MathOverflow)?
            / self.pool_token_supply as u128;
        u64::try_from(v).map_err(|_| error!(ZeroError::MathOverflow))
    }
}

fn read_pool(info: &AccountInfo) -> Result<PoolView> {
    use stake_pool_layout::*;
    let data = info.try_borrow_data()?;
    require!(
        data.len() >= MIN_LEN && data[ACCOUNT_TYPE] == ACCOUNT_TYPE_STAKE_POOL,
        ZeroError::WrongStakePool
    );
    let u64_at = |o: usize| u64::from_le_bytes(data[o..o + 8].try_into().unwrap());
    Ok(PoolView {
        mint: Pubkey::try_from(&data[POOL_MINT..POOL_MINT + 32]).unwrap(),
        total_lamports: u64_at(TOTAL_LAMPORTS),
        pool_token_supply: u64_at(POOL_TOKEN_SUPPLY),
    })
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    /// CHECK: validated as a stake pool account by `read_pool`; its owner is recorded
    /// as the trusted stake pool program.
    pub stake_pool: UncheckedAccount<'info>,
    /// Only the program's upgrade authority may create the config.
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, crate::program::ZeroMobile>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ ZeroError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
#[instruction(period: u64)]
pub struct Activate<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: pinned to the configured pool address and program owner.
    #[account(address = config.stake_pool, owner = config.stake_pool_program)]
    pub stake_pool: UncheckedAccount<'info>,
    #[account(
        constraint = holder_tokens.mint == config.pool_mint @ ZeroError::WrongMint,
        constraint = holder_tokens.owner == owner.key() @ ZeroError::WrongOwner,
    )]
    pub holder_tokens: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = owner,
        space = 8 + Entitlement::INIT_SPACE,
        seeds = [b"entitlement", owner.key().as_ref(), &period.to_le_bytes()],
        bump
    )]
    pub entitlement: Account<'info, Entitlement>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseEntitlement<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, has_one = owner, close = owner)]
    pub entitlement: Account<'info, Entitlement>,
}

#[error_code]
pub enum ZeroError {
    #[msg("Signer is not the program upgrade authority")]
    Unauthorized,
    #[msg("Activations are paused")]
    Paused,
    #[msg("Period is not the current billing period")]
    WrongPeriod,
    #[msg("Account is not the configured stake pool")]
    WrongStakePool,
    #[msg("Token account is not zeroSOL")]
    WrongMint,
    #[msg("Token account does not belong to the signer")]
    WrongOwner,
    #[msg("Not enough zeroSOL to fund this plan")]
    InsufficientStake,
    #[msg("The entitlement's period has not ended")]
    PeriodNotOver,
    #[msg("Invalid configuration")]
    InvalidConfig,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
