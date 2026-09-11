//! Controlled classic-SPL claims for a specifically bound customized Manifest.
//! Mint authority remains the prediction PDA. Freeze authority belongs to the
//! bound venue, which seals all token accounts outside atomic guarded calls.
use crate::{
    accounts as a,
    codec::{Reader, State, Writer},
    error::{add, check, sub, Error, Result},
    state::{self, Key},
};
use pinocchio::{
    cpi::{invoke_signed, Seed, Signer},
    instruction::{InstructionAccount, InstructionView},
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address,
};
use pinocchio_token::instructions::{Burn, InitializeMint2, MintTo};

pub struct Binding {
    pub question: Key,
    pub program: Key,
    pub venue: Key,
    pub mint: Key,
    pub collateral: Key,
    pub recipient: Key,
    pub bps: u16,
    pub outcome: u8,
    pub bump: u8,
}
impl State for Binding {
    const LEN: usize = 204;
    const TAG: &'static [u8; 8] = b"SOLZMAN1";
    fn read(r: &mut Reader) -> Result<Self> {
        Ok(Self {
            question: r.bytes()?,
            program: r.bytes()?,
            venue: r.bytes()?,
            mint: r.bytes()?,
            collateral: r.bytes()?,
            recipient: r.bytes()?,
            bps: u16::from_le_bytes(r.bytes()?),
            outcome: r.u8()?,
            bump: r.u8()?,
        })
    }
    fn write(&self, w: &mut Writer) -> Result<()> {
        for k in [
            &self.question,
            &self.program,
            &self.venue,
            &self.mint,
            &self.collateral,
            &self.recipient,
        ] {
            w.bytes(k)?;
        }
        w.bytes(&self.bps.to_le_bytes())?;
        w.u8(self.outcome)?;
        w.u8(self.bump)
    }
}
fn load(account: &AccountView, program: &Address, question: &Key) -> Result<Binding> {
    let b: Binding = a::load(account, program)?;
    check(
        b.question == *question && b.outcome <= 1 && b.bps > 0 && b.bps <= 10_000,
        Error::InvalidAccount,
    )?;
    check(
        a::pda(
            account,
            &[b"manifest_binding", question, &[b.outcome]],
            program,
        )? == b.bump,
        Error::InvalidAccount,
    )?;
    Ok(b)
}
fn seal(
    accounts: &[AccountView],
    b: &Binding,
    market_bump: u8,
    match_id: &Key,
    frozen: bool,
) -> Result<()> {
    // owner,config,question,vault,position,binding,mint,user token,venue program,freeze authority,token program
    let metas = [
        InstructionAccount::readonly_signer(accounts[2].address()),
        InstructionAccount::readonly(accounts[5].address()),
        InstructionAccount::readonly(accounts[6].address()),
        InstructionAccount::writable(accounts[7].address()),
        InstructionAccount::readonly(accounts[9].address()),
        InstructionAccount::readonly(accounts[10].address()),
    ];
    let views = [
        &accounts[2],
        &accounts[5],
        &accounts[6],
        &accounts[7],
        &accounts[9],
        &accounts[10],
    ];
    let bump = [market_bump];
    let seeds = [
        Seed::from(b"market".as_slice()),
        Seed::from(match_id.as_slice()),
        Seed::from(bump.as_slice()),
    ];
    let target = Address::new_from_array(b.program);
    invoke_signed(
        &InstructionView {
            program_id: &target,
            accounts: &metas,
            data: &[250, u8::from(frozen)],
        },
        &views,
        &[Signer::from(seeds.as_slice())],
    )
}
pub fn process(
    program: &Address,
    accounts: &mut [AccountView],
    args: &[u8],
    tag: u8,
) -> Result<()> {
    check(
        accounts.len()
            == match tag {
                22 => 7,
                23 => 10,
                26 => 14,
                _ => 11,
            },
        Error::InvalidAccount,
    )?;
    a::distinct(accounts, &(0..accounts.len()).collect::<Vec<_>>())?;
    a::signer(&accounts[0])?;
    let config = a::config(&accounts[1], program)?;
    let mut market = a::market(&accounts[2], program)?;
    check(
        market.outcomes == 2 && market.mint == config.mint,
        Error::InvalidToken,
    )?;
    let question = a::key(&accounts[2]);
    if tag == 22 {
        check(
            a::key(&accounts[0]) == config.authority,
            Error::Unauthorized,
        )?;
        check(
            !config.paused
                && !market.paused
                && market.status <= state::TRADING
                && Clock::get()?.unix_timestamp < market.locks_at,
            Error::InvalidStatus,
        )?;
        let mut r = Reader::new(args);
        let outcome = r.u8()?;
        let recipient = r.bytes()?;
        let bps = u16::from_le_bytes(r.bytes()?);
        r.done()?;
        check(
            outcome <= 1 && bps > 0 && bps <= 10_000 && recipient != [0; 32],
            Error::InvalidData,
        )?;
        a::program(&accounts[4], &pinocchio_system::ID)?;
        check(
            accounts[5].executable() && accounts[5].address() != program,
            Error::InvalidAccount,
        )?;
        a::pda(
            &accounts[6],
            &[b"manifest_book", &question, &[outcome]],
            program,
        )?;
        let mint =
            Address::find_program_address(&[b"manifest_outcome", &question, &[outcome]], program)
                .0
                .to_bytes();
        if accounts[3].owner() == program {
            let old = load(&accounts[3], program, &question)?;
            check(
                old.program == a::key(&accounts[5])
                    && old.venue == a::key(&accounts[6])
                    && old.mint == mint
                    && old.collateral == config.mint
                    && old.recipient == recipient
                    && old.bps == bps
                    && old.outcome == outcome,
                Error::InvalidAccount,
            )?;
            return Ok(());
        }
        if !market.manifest_guarded {
            // Existing funded questions cannot change execution engines. Legacy
            // accounts remain readable/redeemable but require a new question.
            check(
                accounts[2].data_len() == state::Market::LEN && market.collateral_locked == 0,
                Error::InvalidStatus,
            )?;
            market.manifest_guarded = true;
            a::save(&mut accounts[2], &market, program)?;
        }
        let bump = a::create(
            &accounts[0],
            &accounts[3],
            &[b"manifest_binding", &question, &[outcome]],
            program,
            program,
            Binding::LEN,
        )?;
        let binding = Binding {
            question,
            program: a::key(&accounts[5]),
            venue: a::key(&accounts[6]),
            mint,
            collateral: config.mint,
            recipient,
            bps,
            outcome,
            bump,
        };
        return a::save(&mut accounts[3], &binding, program);
    }
    let binding_index = if tag == 23 || tag == 26 { 3 } else { 5 };
    let b = load(&accounts[binding_index], program, &question)?;
    check(b.collateral == config.mint, Error::InvalidToken)?;
    let venue_program = Address::new_from_array(b.program);
    let authority = Address::find_program_address(&[b"claims_authority"], &venue_program).0;
    if tag == 26 {
        check(
            args.is_empty() && a::key(&accounts[0]) == config.authority,
            Error::Unauthorized,
        )?;
        a::require_key(&accounts[4], &b.venue)?;
        a::mint(&accounts[5], &b.mint)?;
        a::mint(&accounts[6], &b.collateral)?;
        a::program(&accounts[9], &venue_program)?;
        a::program(&accounts[10], &pinocchio_system::ID)?;
        a::program(&accounts[11], &pinocchio_token::ID)?;
        check(accounts[13].address() == &authority, Error::InvalidAccount)?;
        if accounts[4].owner() == &venue_program {
            let d = accounts[4].try_borrow()?;
            check(
                d.len() >= 256 && d[16..48] == b.mint && d[48..80] == b.collateral,
                Error::InvalidAccount,
            )?;
            return Ok(());
        }
        a::create(
            &accounts[0],
            &accounts[4],
            &[b"manifest_book", &question, &[b.outcome]],
            program,
            &venue_program,
            256,
        )?;
        let indexes = [0, 4, 10, 5, 6, 7, 8, 11, 12, 3, 1, 2, 5, 13, 0, 0, 11];
        let metas: Vec<InstructionAccount> = indexes
            .iter()
            .enumerate()
            .map(|(i, j)| {
                InstructionAccount::new(accounts[*j].address(), matches!(i, 0 | 1 | 5 | 6), i == 0)
            })
            .collect();
        let views: Vec<&AccountView> = indexes.iter().map(|j| &accounts[*j]).collect();
        pinocchio::cpi::invoke_signed_with_slice(
            &InstructionView {
                program_id: &venue_program,
                accounts: &metas,
                data: &[0; 9],
            },
            &views,
            &[],
        )?;
        return Ok(());
    }
    if tag == 23 {
        check(
            args.is_empty() && a::key(&accounts[0]) == config.authority,
            Error::Unauthorized,
        )?;
        a::mint(&accounts[5], &config.mint)?;
        a::program(&accounts[6], &pinocchio_system::ID)?;
        a::program(&accounts[7], &pinocchio_token::ID)?;
        a::program(&accounts[8], &venue_program)?;
        check(accounts[9].address() == &authority, Error::InvalidAccount)?;
        a::require_key(&accounts[4], &b.mint)?;
        let decimals = accounts[5].try_borrow()?[44];
        check(decimals == 6, Error::InvalidToken)?;
        if accounts[4].owner() == &pinocchio_token::ID {
            a::mint(&accounts[4], &b.mint)?;
            let d = accounts[4].try_borrow()?;
            check(
                d[44] == 6
                    && d[..4] == [1, 0, 0, 0]
                    && d[4..36] == question
                    && d[46..50] == [1, 0, 0, 0]
                    && d[50..82] == authority.to_bytes(),
                Error::InvalidToken,
            )?;
            return Ok(());
        }
        a::create(
            &accounts[0],
            &accounts[4],
            &[b"manifest_outcome", &question, &[b.outcome]],
            program,
            &pinocchio_token::ID,
            82,
        )?;
        return InitializeMint2::new(&accounts[4], 6, accounts[2].address(), Some(&authority))
            .invoke();
    }
    let mut r = Reader::new(args);
    let amount = r.u64()?;
    r.done()?;
    check(amount > 0, Error::InvalidAmount)?;
    let mut vault = a::vault(&accounts[3], program)?;
    check(
        vault.owner == a::key(&accounts[0]) && vault.mint == config.mint,
        Error::Unauthorized,
    )?;
    let mut position = a::position(&accounts[4], &question, &a::key(&accounts[3]), program)?;
    a::mint(&accounts[6], &b.mint)?;
    a::program(&accounts[8], &venue_program)?;
    a::program(&accounts[10], &pinocchio_token::ID)?;
    check(accounts[9].address() == &authority, Error::InvalidAccount)?;
    {
        check(
            accounts[7].owner() == &pinocchio_token::ID,
            Error::InvalidToken,
        )?;
        let d = accounts[7].try_borrow()?;
        check(
            d.len() == 165
                && d[..32] == b.mint
                && d[32..64] == vault.owner
                && (d[108] == 1 || d[108] == 2),
            Error::InvalidToken,
        )?;
    }
    if tag == 24 {
        market.require_trading(&config, Clock::get()?.unix_timestamp)?;
    }
    seal(accounts, &b, market.bump, &market.match_id, false)?;
    if tag == 24 {
        position.balances[b.outcome as usize] = sub(position.balances[b.outcome as usize], amount)?;
        vault.exposure = sub(vault.exposure, amount)?;
        let bump = [market.bump];
        let seeds = [
            Seed::from(b"market".as_slice()),
            Seed::from(market.match_id.as_slice()),
            Seed::from(bump.as_slice()),
        ];
        MintTo::new(&accounts[6], &accounts[7], &accounts[2], amount)
            .invoke_signed(&[Signer::from(seeds.as_slice())])?;
    } else {
        position.balances[b.outcome as usize] = add(position.balances[b.outcome as usize], amount)?;
        vault.exposure = add(vault.exposure, amount)?;
        Burn::new(&accounts[7], &accounts[6], &accounts[0], amount).invoke()?;
    }
    seal(accounts, &b, market.bump, &market.match_id, true)?;
    a::save(&mut accounts[3], &vault, program)?;
    a::save(&mut accounts[4], &position, program)
}
