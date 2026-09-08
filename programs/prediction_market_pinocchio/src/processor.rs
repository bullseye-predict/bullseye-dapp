//! Wire format is versioned by each account's discriminator; all integers are
//! little endian. Instruction tags and account order are mirrored in the TS
//! adapter. Timestamps are Unix seconds; quantities are atomic collateral units.
use crate::{
    accounts as a,
    codec::{Reader, State},
    error::{add, check, sub, Error, Result},
    orders::{self, Order},
    state::{self, Config, Market, OrderState, Position, Vault, MAX_OUTCOMES},
};
use pinocchio::{
    sysvars::{clock::Clock, instructions::INSTRUCTIONS_ID, Sysvar},
    AccountView, Address, ProgramResult,
};

pub fn process(program: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let (&tag, args) = data.split_first().ok_or(Error::InvalidData)?;
    let count = match tag {
        0 => 6,
        1 | 2 => 7,
        3 => 5,
        4 | 5 => 6,
        6 | 7 | 8 => 8,
        9 | 10 | 11 | 13 => 3,
        12 | 14 | 15 | 18 => 2,
        16 => 12,
        17 => 4,
        _ => return Err(Error::InvalidData.into()),
    };
    check(accounts.len() == count, Error::InvalidAccount)?;
    // Duplicate writable state accounts cannot alias during in-memory accounting.
    a::distinct(accounts, &(0..accounts.len()).collect::<Vec<_>>())?;
    match tag {
        0 => initialize_config(program, accounts, args),
        1 => create_market(program, accounts, args),
        2 => initialize_vault(program, accounts, args),
        3 => initialize_position(program, accounts, args),
        4 | 5 => deposit_withdraw(program, accounts, args, tag == 4),
        6 | 7 | 8 => positions(program, accounts, args, tag),
        9 => lock_market(program, accounts, args),
        10 | 11 => settle_market(program, accounts, args, tag == 11),
        12 | 13 => pause(program, accounts, args, tag == 13),
        14 => authorize_agent(program, accounts, args),
        15 | 18 => revoke_or_cancel_all(program, accounts, args, tag == 15),
        16 => fill(program, accounts, data),
        17 => initialize_nonce(program, accounts, args),
        _ => Err(Error::InvalidData.into()),
    }
}
fn now() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}
fn empty(args: &[u8]) -> Result<()> {
    check(args.is_empty(), Error::InvalidData)
}
fn owner(actor: &AccountView, vault: &Vault) -> Result<()> {
    a::signer(actor)?;
    check(a::key(actor) == vault.owner, Error::Unauthorized)
}
fn admin(actor: &AccountView, config: &Config) -> Result<()> {
    a::signer(actor)?;
    check(a::key(actor) == config.authority, Error::Unauthorized)
}

// 0: payer/admin(s,w), config(w), mint, deployed program(s), system, token.
// The deployment keypair must co-sign initialization, preventing first-caller
// takeover. Its public key is the executing program ID; no embedded wallet key.
fn initialize_config(program: &Address, accounts: &mut [AccountView], args: &[u8]) -> Result<()> {
    let mut r = Reader::new(args);
    let oracle = r.bytes()?;
    let domain = r.bytes()?;
    r.done()?;
    check(oracle != [0; 32] && domain != [0; 32], Error::InvalidData)?;
    a::signer(&accounts[0])?;
    a::signer(&accounts[3])?;
    a::program(&accounts[3], program)?;
    a::program(&accounts[4], &pinocchio_system::ID)?;
    a::program(&accounts[5], &pinocchio_token::ID)?;
    let mint = a::key(&accounts[2]);
    a::mint(&accounts[2], &mint)?;
    let bump = a::create(
        &accounts[0],
        &accounts[1],
        &[a::CONFIG_SEED],
        program,
        program,
        Config::LEN,
    )?;
    let state = Config {
        authority: a::key(&accounts[0]),
        oracle,
        mint,
        domain,
        paused: false,
        bump,
    };
    a::save(&mut accounts[1], &state, program)
}
// 1: admin(s,w), config, market(w), market collateral(w), mint, system, token.
fn create_market(program: &Address, accounts: &mut [AccountView], args: &[u8]) -> Result<()> {
    let mut r = Reader::new(args);
    let match_id = r.bytes()?;
    let outcomes = r.u8()?;
    let starts_at = r.i64()?;
    let locks_at = r.i64()?;
    let expiry = r.i64()?;
    r.done()?;
    let config = a::config(&accounts[1], program)?;
    admin(&accounts[0], &config)?;
    check(!config.paused, Error::Paused)?;
    check(
        (2..=MAX_OUTCOMES as u8).contains(&outcomes),
        Error::InvalidOutcome,
    )?;
    let created_at = now()?;
    check(
        match_id != [0; 32] && starts_at >= created_at && locks_at > starts_at && expiry > locks_at,
        Error::InvalidTime,
    )?;
    a::mint(&accounts[4], &config.mint)?;
    a::program(&accounts[5], &pinocchio_system::ID)?;
    a::program(&accounts[6], &pinocchio_token::ID)?;
    let bump = a::create(
        &accounts[0],
        &accounts[2],
        &[b"market", &match_id],
        program,
        program,
        Market::LEN,
    )?;
    let market_key = a::key(&accounts[2]);
    let escrow_bump = a::init_escrow(
        &accounts[0],
        &accounts[3],
        &accounts[4],
        accounts[2].address(),
        &[b"market_collateral", &market_key],
        program,
    )?;
    let state = Market {
        match_id,
        mint: config.mint,
        oracle: config.oracle,
        escrow: a::key(&accounts[3]),
        starts_at,
        locks_at,
        expiry,
        created_at,
        status: if starts_at == created_at {
            state::TRADING
        } else {
            state::PENDING
        },
        outcomes,
        winner: u8::MAX,
        paused: false,
        bump,
        escrow_bump,
        collateral_locked: 0,
        result_hash: [0; 32],
        void_shares_redeemed: 0,
    };
    a::save(&mut accounts[2], &state, program)
}
// 2: owner(s,w), config, vault(w), vault collateral(w), mint, system, token.
fn initialize_vault(program: &Address, accounts: &mut [AccountView], args: &[u8]) -> Result<()> {
    let mut r = Reader::new(args);
    let max_capital = r.u64()?;
    r.done()?;
    check(max_capital > 0, Error::InvalidAmount)?;
    a::signer(&accounts[0])?;
    let config = a::config(&accounts[1], program)?;
    a::mint(&accounts[4], &config.mint)?;
    a::program(&accounts[5], &pinocchio_system::ID)?;
    a::program(&accounts[6], &pinocchio_token::ID)?;
    let owner = a::key(&accounts[0]);
    let bump = a::create(
        &accounts[0],
        &accounts[2],
        &[b"agent_vault", &owner],
        program,
        program,
        Vault::LEN,
    )?;
    let vault_key = a::key(&accounts[2]);
    let escrow_bump = a::init_escrow(
        &accounts[0],
        &accounts[3],
        &accounts[4],
        accounts[2].address(),
        &[b"vault_collateral", &vault_key],
        program,
    )?;
    let state = Vault {
        owner,
        agent: [0; 32],
        mint: config.mint,
        escrow: a::key(&accounts[3]),
        available: 0,
        exposure: 0,
        max_capital,
        max_order_size: 0,
        max_exposure: 0,
        expiry: 0,
        epoch: 0,
        enabled: false,
        bump,
        escrow_bump,
        spent_capital: 0,
    };
    a::save(&mut accounts[2], &state, program)
}
// 3: payer(s,w), market, vault, position(w), system. Permissionless rent funding.
fn initialize_position(program: &Address, accounts: &mut [AccountView], args: &[u8]) -> Result<()> {
    empty(args)?;
    let market = a::market(&accounts[1], program)?;
    let vault = a::vault(&accounts[2], program)?;
    check(market.mint == vault.mint, Error::InvalidToken)?;
    a::program(&accounts[4], &pinocchio_system::ID)?;
    let market = a::key(&accounts[1]);
    let vault = a::key(&accounts[2]);
    let bump = a::create(
        &accounts[0],
        &accounts[3],
        &[b"position", &market, &vault],
        program,
        program,
        Position::LEN,
    )?;
    a::save(
        &mut accounts[3],
        &Position {
            vault,
            market,
            balances: [0; MAX_OUTCOMES],
            bump,
        },
        program,
    )
}
// 4 deposit: owner(s), config, vault(w), owner token(w), vault token(w), token.
// 5 withdraw: owner(s), config, vault(w), vault token(w), owner token(w), token.
fn deposit_withdraw(
    program: &Address,
    accounts: &mut [AccountView],
    args: &[u8],
    deposit: bool,
) -> Result<()> {
    let mut r = Reader::new(args);
    let amount = r.u64()?;
    r.done()?;
    check(amount > 0, Error::InvalidAmount)?;
    let config = a::config(&accounts[1], program)?;
    let mut vault = a::vault(&accounts[2], program)?;
    owner(&accounts[0], &vault)?;
    check(vault.mint == config.mint, Error::InvalidToken)?;
    a::program(&accounts[5], &pinocchio_token::ID)?;
    let (escrow, user_token) = if deposit { (4, 3) } else { (3, 4) };
    a::require_key(&accounts[escrow], &vault.escrow)?;
    a::token(&accounts[escrow], &vault.mint, &a::key(&accounts[2]), true)?;
    a::token(&accounts[user_token], &vault.mint, &vault.owner, false)?;
    if deposit {
        // Funding belongs to the owner. Deposits do not reset or increase the
        // session's independently enforced cumulative trading budget.
        vault.available = add(vault.available, amount)?;
        a::transfer(&accounts[3], &accounts[4], &accounts[0], amount, &[])?;
    } else {
        vault.available = sub(vault.available, amount)?;
        let bump = [vault.bump];
        a::transfer(
            &accounts[3],
            &accounts[4],
            &accounts[2],
            amount,
            &[b"agent_vault", &vault.owner, &bump],
        )?;
    }
    a::save(&mut accounts[2], &vault, program)
}
// 6 split / 7 merge / 8 redeem: actor(s), config, market(w), vault(w),
// position(w), vault token(w), market token(w), token. Pauses never block exits.
fn positions(program: &Address, accounts: &mut [AccountView], args: &[u8], tag: u8) -> Result<()> {
    let mut r = Reader::new(args);
    let amount = if tag == 8 { 0 } else { r.u64()? };
    r.done()?;
    let config = a::config(&accounts[1], program)?;
    let mut market = a::market(&accounts[2], program)?;
    let mut vault = a::vault(&accounts[3], program)?;
    let mut position = a::position(
        &accounts[4],
        &a::key(&accounts[2]),
        &a::key(&accounts[3]),
        program,
    )?;
    check(
        market.mint == config.mint && vault.mint == config.mint,
        Error::InvalidToken,
    )?;
    a::program(&accounts[7], &pinocchio_token::ID)?;
    a::require_key(&accounts[5], &vault.escrow)?;
    a::require_key(&accounts[6], &market.escrow)?;
    a::token(&accounts[5], &config.mint, &a::key(&accounts[3]), true)?;
    a::token(&accounts[6], &config.mint, &a::key(&accounts[2]), true)?;
    if tag == 6 {
        owner(&accounts[0], &vault)?;
        market.require_trading(&config, now()?)?;
        state::split(&mut market, &mut vault, &mut position, amount)?;
        let bump = [vault.bump];
        a::transfer(
            &accounts[5],
            &accounts[6],
            &accounts[3],
            amount,
            &[b"agent_vault", &vault.owner, &bump],
        )?;
    } else {
        // Redemption is permissionless because proceeds can only enter the
        // original vault. Merge also cannot change the owner/destination.
        let payout = if tag == 7 {
            a::signer(&accounts[0])?;
            vault.authorize(&a::key(&accounts[0]), now()?)?;
            state::merge(&mut market, &mut vault, &mut position, amount)?;
            amount
        } else {
            state::redeem(&mut market, &mut vault, &mut position)?
        };
        let bump = [market.bump];
        a::transfer(
            &accounts[6],
            &accounts[5],
            &accounts[2],
            payout,
            &[b"market", &market.match_id, &bump],
        )?;
    }
    a::save(&mut accounts[2], &market, program)?;
    a::save(&mut accounts[3], &vault, program)?;
    a::save(&mut accounts[4], &position, program)
}
// 9: actor, config, market(w). The oracle/admin can lock early; anyone can lock
// at the cutoff, and every trade independently checks Clock before that point.
fn lock_market(program: &Address, accounts: &mut [AccountView], args: &[u8]) -> Result<()> {
    empty(args)?;
    let config = a::config(&accounts[1], program)?;
    let mut market = a::market(&accounts[2], program)?;
    check(market.status <= state::TRADING, Error::InvalidStatus)?;
    if now()? < market.locks_at {
        a::signer(&accounts[0])?;
        let actor = a::key(&accounts[0]);
        check(
            actor == config.authority || actor == market.oracle,
            Error::Unauthorized,
        )?;
    }
    market.status = state::LOCKED;
    a::save(&mut accounts[2], &market, program)
}
// 10 resolve: oracle(s), config, market(w), args winner, resultDigest32, endedAtSec.
// 11 void: actor, config, market(w), args resultDigest32. Oracle before expiry,
// permissionless after expiry; an unavailable oracle cannot strand collateral.
fn settle_market(
    program: &Address,
    accounts: &mut [AccountView],
    args: &[u8],
    void: bool,
) -> Result<()> {
    let mut r = Reader::new(args);
    let winner = if void { u8::MAX } else { r.u8()? };
    let result_hash = r.bytes()?;
    let ended_at = if void { 0 } else { r.i64()? };
    r.done()?;
    let _ = a::config(&accounts[1], program)?;
    let mut market = a::market(&accounts[2], program)?;
    let timestamp = now()?;
    check(market.status < state::RESOLVED, Error::InvalidStatus)?;
    if !void || timestamp < market.expiry {
        a::signer(&accounts[0])?;
        check(a::key(&accounts[0]) == market.oracle, Error::Unauthorized)?;
    }
    if void {
        market.status = state::VOIDED;
    } else {
        check(market.status == state::LOCKED, Error::InvalidStatus)?;
        check(timestamp < market.expiry, Error::InvalidTime)?;
        market.validate_outcome(winner)?;
        check(
            ended_at >= market.created_at && ended_at <= timestamp && result_hash != [0; 32],
            Error::InvalidTime,
        )?;
        market.status = state::RESOLVED;
        market.winner = winner;
    }
    market.result_hash = result_hash;
    a::save(&mut accounts[2], &market, program)
}
// 12 global pause: admin(s), config(w). 13 market pause: admin(s), config, market(w).
fn pause(
    program: &Address,
    accounts: &mut [AccountView],
    args: &[u8],
    market_pause: bool,
) -> Result<()> {
    let mut r = Reader::new(args);
    let paused = r.bool()?;
    r.done()?;
    let mut config = a::config(&accounts[1], program)?;
    admin(&accounts[0], &config)?;
    if market_pause {
        let mut market = a::market(&accounts[2], program)?;
        market.paused = paused;
        a::save(&mut accounts[2], &market, program)
    } else {
        config.paused = paused;
        a::save(&mut accounts[1], &config, program)
    }
}
// 14: owner(s), vault(w). Updating session policy revokes ALL old signed orders.
fn authorize_agent(program: &Address, accounts: &mut [AccountView], args: &[u8]) -> Result<()> {
    let mut r = Reader::new(args);
    let agent = r.bytes()?;
    let max_capital = r.u64()?;
    let max_order_size = r.u64()?;
    let max_exposure = r.u64()?;
    let expiry = r.i64()?;
    r.done()?;
    let mut vault = a::vault(&accounts[1], program)?;
    owner(&accounts[0], &vault)?;
    check(
        agent != [0; 32]
            && agent != vault.owner
            && max_capital > 0
            && max_order_size > 0
            && max_order_size <= max_capital
            && max_exposure > 0
            && max_exposure >= vault.exposure
            && expiry > now()?,
        Error::InvalidData,
    )?;
    vault.agent = agent;
    vault.max_capital = max_capital;
    vault.max_order_size = max_order_size;
    vault.max_exposure = max_exposure;
    vault.expiry = expiry;
    vault.enabled = true;
    vault.spent_capital = 0;
    vault.epoch = add(vault.epoch, 1)?;
    a::save(&mut accounts[1], &vault, program)
}
// 15 revoke / 18 cancel all: owner(s), vault(w). Owner can always withdraw
// available funds, even when the agent is disabled, expired or over its limit.
fn revoke_or_cancel_all(
    program: &Address,
    accounts: &mut [AccountView],
    args: &[u8],
    revoke: bool,
) -> Result<()> {
    empty(args)?;
    let mut vault = a::vault(&accounts[1], program)?;
    owner(&accounts[0], &vault)?;
    if revoke {
        vault.enabled = false;
    }
    vault.epoch = add(vault.epoch, 1)?;
    a::save(&mut accounts[1], &vault, program)
}
// 17: payer(s,w), vault, order state(w), system; nonce:u64, cancel:bool.
// Anyone can pay to create an unbound nonce; only owner/live session can cancel.
fn initialize_nonce(program: &Address, accounts: &mut [AccountView], args: &[u8]) -> Result<()> {
    let mut r = Reader::new(args);
    let nonce = r.u64()?;
    let cancel = r.bool()?;
    r.done()?;
    let vault = a::vault(&accounts[1], program)?;
    let vault_key = a::key(&accounts[1]);
    a::signer(&accounts[0])?;
    a::program(&accounts[3], &pinocchio_system::ID)?;
    if cancel {
        vault.authorize(&a::key(&accounts[0]), now()?)?;
    }
    let mut order = if accounts[2].owner() == program {
        a::order(&accounts[2], &vault_key, nonce, program)?
    } else {
        a::create(
            &accounts[0],
            &accounts[2],
            &[b"order", &vault_key, &nonce.to_le_bytes()],
            program,
            program,
            OrderState::LEN,
        )?;
        OrderState {
            vault: vault_key,
            nonce,
            epoch: 0,
            filled: 0,
            cancelled: false,
            bound: false,
            body: [0; 138],
        }
    };
    if cancel {
        order.cancelled = true;
    }
    a::save(&mut accounts[2], &order, program)
}
// 16 fill: config, market(w), buyer vault(w), seller vault(w), buyer position(w),
// seller position(w), buyer nonce(w), seller nonce(w), buyer token(w), seller token(w),
// instructions sysvar, token. Nonces/positions are initialized before filling.
#[inline(never)]
fn fill(program: &Address, accounts: &mut [AccountView], data: &[u8]) -> Result<()> {
    check(data.len() == orders::FILL_LEN, Error::InvalidData)?;
    a::require_key(&accounts[10], &INSTRUCTIONS_ID.to_bytes())?;
    orders::verify_precompile(&accounts[10].try_borrow()?, program, data)?;
    let buy = Order::decode(&data[1..139])?;
    let sell = Order::decode(&data[139..277])?;
    let mut r = Reader::new(&data[277..293]);
    let quantity = r.u64()?;
    let price = r.u64()?;
    r.done()?;
    let config = a::config(&accounts[0], program)?;
    check(
        data[293..325] == buy.digest(program, &config.domain)?
            && data[325..357] == sell.digest(program, &config.domain)?,
        Error::InvalidOrder,
    )?;
    let mut market = a::market(&accounts[1], program)?;
    let market_key = a::key(&accounts[1]);
    let mut buyer = a::vault(&accounts[2], program)?;
    let mut seller = a::vault(&accounts[3], program)?;
    check(
        buy.market == market_key
            && sell.market == market_key
            && buy.vault == a::key(&accounts[2])
            && sell.vault == a::key(&accounts[3]),
        Error::InvalidOrder,
    )?;
    check(
        market.mint == config.mint && buyer.mint == config.mint && seller.mint == config.mint,
        Error::InvalidToken,
    )?;
    let mut buyer_position = a::position(&accounts[4], &market_key, &buy.vault, program)?;
    let mut seller_position = a::position(&accounts[5], &market_key, &sell.vault, program)?;
    let mut buy_state = a::order(&accounts[6], &buy.vault, buy.nonce, program)?;
    let mut sell_state = a::order(&accounts[7], &sell.vault, sell.nonce, program)?;
    a::program(&accounts[11], &pinocchio_token::ID)?;
    a::require_key(&accounts[8], &buyer.escrow)?;
    a::require_key(&accounts[9], &seller.escrow)?;
    a::token(&accounts[8], &config.mint, &buy.vault, true)?;
    a::token(&accounts[9], &config.mint, &sell.vault, true)?;
    let cost = orders::apply_fill(
        &config,
        &mut market,
        &buy,
        &sell,
        &mut buyer,
        &mut seller,
        &mut buyer_position,
        &mut seller_position,
        &mut buy_state,
        &mut sell_state,
        quantity,
        price,
        now()?,
    )?;
    let bump = [buyer.bump];
    a::transfer(
        &accounts[8],
        &accounts[9],
        &accounts[2],
        cost,
        &[b"agent_vault", &buyer.owner, &bump],
    )?;
    a::save(&mut accounts[1], &market, program)?;
    a::save(&mut accounts[2], &buyer, program)?;
    a::save(&mut accounts[3], &seller, program)?;
    a::save(&mut accounts[4], &buyer_position, program)?;
    a::save(&mut accounts[5], &seller_position, program)?;
    a::save(&mut accounts[6], &buy_state, program)?;
    a::save(&mut accounts[7], &sell_state, program)
}
