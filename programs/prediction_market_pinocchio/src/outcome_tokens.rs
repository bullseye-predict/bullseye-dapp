//! SPL representation of existing collateral-backed positions for local venue
//! comparisons. Export removes internal units; import burns SPL units. Neither
//! operation changes payout collateral. Unrestricted venue execution is NOT
//! governed by Market::require_trading, so this module is excluded by default.
use crate::{
    accounts as a,
    codec::Reader,
    error::{add, check, sub, Error, Result},
    state,
};
use pinocchio::{
    cpi::{Seed, Signer},
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address,
};
use pinocchio_token::instructions::{Burn, InitializeMint2, MintTo};

pub fn process(
    program: &Address,
    accounts: &mut [AccountView],
    args: &[u8],
    tag: u8,
) -> Result<()> {
    check(
        accounts.len() == if tag == 19 { 7 } else { 8 },
        Error::InvalidAccount,
    )?;
    a::distinct(accounts, &(0..accounts.len()).collect::<Vec<_>>())?;
    let mut r = Reader::new(args);
    let outcome = r.u8()?;
    let amount = if tag == 19 { 0 } else { r.u64()? };
    r.done()?;
    let config = a::config(&accounts[1], program)?;
    let market = a::market(&accounts[2], program)?;
    check(!market.manifest_guarded, Error::InvalidStatus)?;
    check(
        market.mint == config.mint && market.outcomes == 2,
        Error::InvalidToken,
    )?;
    market.validate_outcome(outcome)?;
    let market_key = a::key(&accounts[2]);
    let outcome_seed = [outcome];
    let seeds: &[&[u8]] = &[b"outcome_mint", &market_key, &outcome_seed];
    a::signer(&accounts[0])?;
    if tag == 19 {
        // Admin chooses whether a market may issue externally transferable
        // claims. An arbitrary caller cannot turn internal positions into SPL.
        check(
            a::key(&accounts[0]) == config.authority,
            Error::Unauthorized,
        )?;
        check(
            !config.paused && !market.paused && market.status <= state::TRADING,
            Error::InvalidStatus,
        )?;
        check(
            Clock::get()?.unix_timestamp < market.locks_at,
            Error::InvalidTime,
        )?;
        a::mint(&accounts[4], &config.mint)?;
        a::program(&accounts[5], &pinocchio_system::ID)?;
        a::program(&accounts[6], &pinocchio_token::ID)?;
        let decimals = accounts[4].try_borrow()?[44];
        a::create(
            &accounts[0],
            &accounts[3],
            seeds,
            program,
            &pinocchio_token::ID,
            82,
        )?;
        InitializeMint2::new(&accounts[3], decimals, accounts[2].address(), None).invoke()?;
        return Ok(());
    }
    check(amount > 0, Error::InvalidAmount)?;
    let mut vault = a::vault(&accounts[3], program)?;
    check(
        a::key(&accounts[0]) == vault.owner && vault.mint == config.mint,
        Error::Unauthorized,
    )?;
    let mut position = a::position(&accounts[4], &market_key, &a::key(&accounts[3]), program)?;
    a::pda(&accounts[5], seeds, program)?;
    let mint_key = a::key(&accounts[5]);
    a::mint(&accounts[5], &mint_key)?;
    {
        let mint = accounts[5].try_borrow()?;
        check(
            mint[..4] == [1, 0, 0, 0] && mint[4..36] == market_key && mint[46..50] == [0; 4],
            Error::InvalidToken,
        )?;
    }
    a::token(&accounts[6], &mint_key, &vault.owner, false)?;
    a::program(&accounts[7], &pinocchio_token::ID)?;
    if tag == 20 {
        market.require_trading(&config, Clock::get()?.unix_timestamp)?;
        position.balances[outcome as usize] = sub(position.balances[outcome as usize], amount)?;
        vault.exposure = sub(vault.exposure, amount)?;
        let bump = [market.bump];
        let signer_seeds = [
            Seed::from(b"market".as_slice()),
            Seed::from(market.match_id.as_slice()),
            Seed::from(bump.as_slice()),
        ];
        MintTo::new(&accounts[5], &accounts[6], &accounts[2], amount)
            .invoke_signed(&[Signer::from(signer_seeds.as_slice())])?;
    } else {
        // Import remains available after cutoff/pause/settlement for redemption.
        // Owner authorization prevents strangers using imports to grief agent
        // exposure limits. Burn failure rolls the entire transaction back.
        position.balances[outcome as usize] = add(position.balances[outcome as usize], amount)?;
        vault.exposure = add(vault.exposure, amount)?;
        Burn::new(&accounts[6], &accounts[5], &accounts[0], amount).invoke()?;
    }
    a::save(&mut accounts[3], &vault, program)?;
    a::save(&mut accounts[4], &position, program)
}
