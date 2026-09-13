use crate::{
    codec::State,
    error::{check, Error, Result},
    state::{Config, Key, Market, OrderState, Position, Vault},
};
use pinocchio::{
    cpi::{Seed, Signer},
    sysvars::{get_sysvar, rent::RENT_ID},
    AccountView, Address,
};
use pinocchio_system::instructions::{Allocate, Assign, CreateAccount, Transfer as SystemTransfer};
use pinocchio_token::instructions::{InitializeAccount3, Transfer};

pub const CONFIG_SEED: &[u8] = b"prediction_config";
pub fn key(account: &AccountView) -> Key {
    account.address().to_bytes()
}
pub fn signer(account: &AccountView) -> Result<()> {
    check(account.is_signer(), Error::Unauthorized)
}
pub fn program(account: &AccountView, expected: &Address) -> Result<()> {
    check(
        account.address() == expected && account.executable(),
        Error::InvalidAccount,
    )
}
pub fn require_key(account: &AccountView, expected: &Key) -> Result<()> {
    check(
        account.address().as_ref() == expected,
        Error::InvalidAccount,
    )
}
pub fn writable(account: &AccountView) -> Result<()> {
    check(account.is_writable(), Error::InvalidAccount)
}
pub fn pda(account: &AccountView, seeds: &[&[u8]], program: &Address) -> Result<u8> {
    let (expected, bump) = Address::find_program_address(seeds, program);
    check(account.address() == &expected, Error::InvalidAccount)?;
    Ok(bump)
}
pub fn load<T: State>(account: &AccountView, program: &Address) -> Result<T> {
    check(
        account.owner() == program && !account.executable(),
        Error::InvalidAccount,
    )?;
    T::decode(&account.try_borrow()?)
}
pub fn save<T: State>(account: &mut AccountView, value: &T, program: &Address) -> Result<()> {
    writable(account)?;
    check(account.owner() == program, Error::InvalidAccount)?;
    value.encode(&mut account.try_borrow_mut()?)
}
pub fn config(account: &AccountView, program: &Address) -> Result<Config> {
    let value: Config = load(account, program)?;
    check(
        pda(account, &[CONFIG_SEED], program)? == value.bump,
        Error::InvalidAccount,
    )?;
    Ok(value)
}
pub fn market(account: &AccountView, program: &Address) -> Result<Market> {
    let value: Market = load(account, program)?;
    let bump = if value.question_id == [0; 32] {
        pda(account, &[b"market", &value.match_id], program)?
    } else {
        pda(account, &[b"market", &value.match_id, &value.question_id], program)?
    };
    check(bump == value.bump, Error::InvalidAccount)?;
    Ok(value)
}
pub fn vault(account: &AccountView, program: &Address) -> Result<Vault> {
    let value: Vault = load(account, program)?;
    check(
        pda(account, &[b"agent_vault", &value.owner], program)? == value.bump,
        Error::InvalidAccount,
    )?;
    Ok(value)
}
pub fn position(
    account: &AccountView,
    market: &Key,
    vault: &Key,
    program: &Address,
) -> Result<Position> {
    let value: Position = load(account, program)?;
    check(
        &value.vault == vault
            && &value.market == market
            && pda(account, &[b"position", market, vault], program)? == value.bump,
        Error::InvalidAccount,
    )?;
    Ok(value)
}
pub fn order(
    account: &AccountView,
    vault: &Key,
    nonce: u64,
    program: &Address,
) -> Result<OrderState> {
    pda(account, &[b"order", vault, &nonce.to_le_bytes()], program)?;
    let value: OrderState = load(account, program)?;
    check(
        &value.vault == vault && value.nonce == nonce,
        Error::InvalidAccount,
    )?;
    Ok(value)
}
// Pinocchio 0.11 uses SIMD-0194 rent (8-byte rate); older Solana runtimes
// retain a 17-byte rate/threshold/burn layout. Support both without floating
// point, so the same binary can be tested and deployed across the transition.
fn minimum_rent(len: usize) -> Result<u64> {
    let mut rate = [0; 8];
    get_sysvar(&mut rate, &RENT_ID, 0)?;
    let mut threshold = [0; 8];
    let multiplier = match get_sysvar(&mut threshold, &RENT_ID, 8) {
        Ok(()) => match u64::from_le_bytes(threshold) {
            0x3ff0000000000000 => 1,
            0x4000000000000000 => 2,
            _ => return Err(Error::InvalidData.into()),
        },
        Err(pinocchio::error::ProgramError::InvalidArgument) => 1,
        Err(error) => return Err(error),
    };
    (len as u64)
        .checked_add(128)
        .and_then(|v| v.checked_mul(u64::from_le_bytes(rate)))
        .and_then(|v| v.checked_mul(multiplier))
        .ok_or(Error::Arithmetic.into())
}
pub fn create(
    payer: &AccountView,
    target: &AccountView,
    seeds: &[&[u8]],
    program: &Address,
    owner: &Address,
    len: usize,
) -> Result<u8> {
    signer(payer)?;
    writable(payer)?;
    writable(target)?;
    check(
        target.owner() == &pinocchio_system::ID && target.data_len() == 0,
        Error::AlreadyInitialized,
    )?;
    let bump = pda(target, seeds, program)?;
    let bump_seed = [bump];
    let mut signer_seeds: Vec<Seed> = seeds.iter().map(|s| Seed::from(*s)).collect();
    signer_seeds.push(Seed::from(&bump_seed));
    let signing = [Signer::from(signer_seeds.as_slice())];
    let rent = minimum_rent(len)?;
    if target.lamports() == 0 {
        CreateAccount {
            from: payer,
            to: target,
            lamports: rent,
            space: len as u64,
            owner,
        }
        .invoke_signed(&signing)?;
    } else {
        // Donations to uninitialized PDAs cannot squat on markets/vaults.
        if target.lamports() < rent {
            SystemTransfer {
                from: payer,
                to: target,
                lamports: rent - target.lamports(),
            }
            .invoke()?;
        }
        Allocate {
            account: target,
            space: len as u64,
        }
        .invoke_signed(&signing)?;
        Assign {
            account: target,
            owner,
        }
        .invoke_signed(&signing)?;
    }
    Ok(bump)
}
pub fn mint(account: &AccountView, expected: &Key) -> Result<()> {
    require_key(account, expected)?;
    check(
        account.owner() == &pinocchio_token::ID && account.data_len() == 82,
        Error::InvalidToken,
    )?;
    check(account.try_borrow()?[45] == 1, Error::InvalidToken)
}
pub fn token(account: &AccountView, mint: &Key, authority: &Key, escrow: bool) -> Result<u64> {
    check(
        account.owner() == &pinocchio_token::ID && account.data_len() == 165,
        Error::InvalidToken,
    )?;
    let data = account.try_borrow()?;
    check(
        &data[..32] == mint && &data[32..64] == authority && data[108] == 1,
        Error::InvalidToken,
    )?;
    if escrow {
        check(
            data[72..76] == [0; 4] && data[129..133] == [0; 4],
            Error::InvalidToken,
        )?;
    }
    Ok(u64::from_le_bytes(
        data[64..72].try_into().map_err(|_| Error::InvalidToken)?,
    ))
}
pub fn init_escrow(
    payer: &AccountView,
    escrow: &AccountView,
    mint: &AccountView,
    authority: &Address,
    seeds: &[&[u8]],
    program: &Address,
) -> Result<u8> {
    let bump = create(payer, escrow, seeds, program, &pinocchio_token::ID, 165)?;
    InitializeAccount3::new(escrow, mint, authority).invoke()?;
    Ok(bump)
}
pub fn transfer(
    from: &AccountView,
    to: &AccountView,
    authority: &AccountView,
    amount: u64,
    seeds: &[&[u8]],
) -> Result<()> {
    check(from.address() != to.address(), Error::InvalidAccount)?;
    writable(from)?;
    writable(to)?;
    if amount == 0 {
        return Ok(());
    }
    let sign_seeds: Vec<Seed> = seeds.iter().map(|s| Seed::from(*s)).collect();
    if seeds.is_empty() {
        Transfer::new(from, to, authority, amount).invoke()
    } else {
        Transfer::new(from, to, authority, amount)
            .invoke_signed(&[Signer::from(sign_seeds.as_slice())])
    }
}
pub fn distinct(accounts: &[AccountView], indices: &[usize]) -> Result<()> {
    for (i, a) in indices.iter().enumerate() {
        for b in &indices[..i] {
            check(
                accounts[*a].address() != accounts[*b].address(),
                Error::InvalidAccount,
            )?;
        }
    }
    Ok(())
}
