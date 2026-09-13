//! SOLZ customized Manifest entry point (GPL-3.0, like the upstream program).
//! Every entry route verifies an immutable prediction-owned binding. Classic
//! SPL claims are frozen outside guarded calls, including wallet and venue
//! accounts, so a public exchange cannot accept exported claims.
use borsh::BorshDeserialize;
use pinocchio::{account::AccountView, address::Address, error::ProgramError, sysvars::{clock::Clock, Sysvar}, ProgramResult};
use solana_program::pubkey::Pubkey;
use crate::{validation::AccountViewExt, program::batch_update::BatchUpdateParams};

// Replaced with explicit deployment public keys by the reproducible builder.
const PREDICTION: Pubkey = Pubkey::from_str_const("SOLZ_PREDICTION_PROGRAM_ID");
const EXTRA: usize = 8;
const ERR: ProgramError = ProgramError::Custom(8100);
fn need(ok: bool) -> ProgramResult { if ok { Ok(()) } else { Err(ERR) } }
fn key(bytes: &[u8], at: usize) -> Result<Pubkey, ProgramError> {
    Ok(Pubkey::new_from_array(bytes.get(at..at+32).ok_or(ERR)?.try_into().map_err(|_| ERR)?))
}
fn volume(a: &AccountView) -> Result<u64, ProgramError> {
    let d = a.try_borrow()?;
    Ok(u64::from_le_bytes(d.get(184..192).ok_or(ERR)?.try_into().map_err(|_| ERR)?))
}
struct Binding { question: Pubkey, venue: Pubkey, base: Pubkey, quote: Pubkey, recipient: Pubkey, bps: u16 }
fn binding(a: &AccountView) -> Result<Binding, ProgramError> {
    need(a.owner_pubkey() == PREDICTION)?;
    let d = a.try_borrow()?;
    need(d.len() == 204 && &d[..8] == b"SOLZMAN1")?;
    let question = key(&d, 8)?;
    let outcome = d[202];
    need(outcome <= 1 && key(&d, 40)? == crate::id())?;
    let (pda, bump) = Pubkey::find_program_address(&[b"manifest_binding", question.as_ref(), &[outcome]], &PREDICTION);
    need(a.pubkey() == &pda && bump == d[203])?;
    let bps = u16::from_le_bytes(d[200..202].try_into().map_err(|_| ERR)?);
    need(bps > 0 && bps <= 10_000)?;
    Ok(Binding { question, venue: key(&d,72)?, base: key(&d,104)?, quote: key(&d,136)?, recipient: key(&d,168)?, bps })
}
fn mint(b: &Binding, a: &AccountView, authority: &AccountView) -> ProgramResult {
    let auth = Pubkey::find_program_address(&[b"claims_authority"], &crate::id()).0;
    need(authority.pubkey() == &auth && a.pubkey() == &b.base && a.owner_pubkey() == spl_token::id())?;
    let d = a.try_borrow()?;
    need(d.len() == 82 && d[44] == 6 && d[45] == 1 && d[..4] == [1,0,0,0] && key(&d,4)? == b.question && d[46..50] == [1,0,0,0] && key(&d,50)? == auth)
}
fn frozen(a: &AccountView, mint: &AccountView, authority: &AccountView, freeze: bool) -> ProgramResult {
    need(a.owner_pubkey() == spl_token::id())?;
    let state = { let d = a.try_borrow()?; need(d.len() == 165 && key(&d,0)? == *mint.pubkey())?; d[108] };
    need(state == 1 || state == 2)?;
    if (state == 2) == freeze { return Ok(()); }
    let ix = if freeze { spl_token::instruction::freeze_account(&spl_token::id(), a.pubkey(), mint.pubkey(), authority.pubkey(), &[]) }
             else { spl_token::instruction::thaw_account(&spl_token::id(), a.pubkey(), mint.pubkey(), authority.pubkey(), &[]) }.map_err(|_| ERR)?;
    let bump = Pubkey::find_program_address(&[b"claims_authority"], &crate::id()).1;
    crate::program::invoke_signed(&ix, &[a, mint, authority], &[&[b"claims_authority", &[bump]]])
}
fn open(config: &AccountView, question: &AccountView, b: &Binding, trading: bool) -> ProgramResult {
    need(config.owner_pubkey() == PREDICTION && question.owner_pubkey() == PREDICTION && question.pubkey() == &b.question)?;
    need(config.pubkey() == &Pubkey::find_program_address(&[b"prediction_config"], &PREDICTION).0)?;
    let c = config.try_borrow()?; let q = question.try_borrow()?;
    need(c.len() == 138 && &c[..8] == b"SOLZCFG1" && key(&c,72)? == b.quote)?;
    let lazy = q.len() == 263 && &q[..8] == b"SOLZMKT3";
    let legacy = q.len() == 231 && &q[..8] == b"SOLZMKT2";
    need(lazy || legacy)?;
    let (question_id, mint_at, starts_at, locks_at, status_at, outcomes_at, paused_at, guarded_at) = if lazy {
        (&q[40..72], 72, 168, 176, 200, 201, 203, 262)
    } else {
        (&q[0..0], 40, 136, 144, 168, 169, 171, 230)
    };
    need(q[guarded_at] == 1 && key(&q,mint_at)? == b.quote && q[outcomes_at] == 2)?;
    let expected = if question_id.iter().any(|byte| *byte != 0) {
        Pubkey::find_program_address(&[b"market", &q[8..40], question_id], &PREDICTION).0
    } else {
        Pubkey::find_program_address(&[b"market", &q[8..40]], &PREDICTION).0
    };
    need(question.pubkey() == &expected)?;
    if trading {
        let now = Clock::get()?.unix_timestamp;
        let starts = i64::from_le_bytes(q[starts_at..starts_at+8].try_into().map_err(|_| ERR)?);
        let locks = i64::from_le_bytes(q[locks_at..locks_at+8].try_into().map_err(|_| ERR)?);
        need(c[136] == 0 && q[paused_at] == 0 && q[status_at] <= 1 && now >= starts && now < locks)?;
    }
    Ok(())
}

pub fn process(program: &Address, accounts: &[AccountView], input: &[u8]) -> ProgramResult {
    need(crate::validation::as_pubkey(program) == &crate::id())?;
    // Bridge-only thaw/seal. A top-level caller cannot sign a prediction PDA.
    if input.first() == Some(&250) {
        need(accounts.len() == 6 && input.len() == 2 && input[1] <= 1)?;
        let b = binding(&accounts[1])?;
        need(accounts[0].is_signer() && accounts[0].pubkey() == &b.question && accounts[0].owner_pubkey() == PREDICTION)?;
        mint(&b, &accounts[2], &accounts[4])?;
        need(accounts[5].pubkey() == &spl_token::id())?;
        return frozen(&accounts[3], &accounts[2], &accounts[4], input[1] == 1);
    }
    need(input.len() >= 9 && accounts.len() >= EXTRA + 3)?;
    let data = &input[..input.len()-8];
    let max_fee = u64::from_le_bytes(input[input.len()-8..].try_into().map_err(|_| ERR)?);
    let (core, ext) = accounts.split_at(accounts.len()-EXTRA);
    let b = binding(&ext[0])?;
    need(core[0].is_signer() && core[1].pubkey() == &b.venue && ext[7].pubkey() == &spl_token::id())?;
    mint(&b, &ext[3], &ext[4])?;
    let tag = data[0];
    let expected = match tag { 0 => 9, 1 | 5 | 6 => 3, 2 | 3 => 6, 4 => 11, _ => return Err(ERR) };
    need(core.len() == expected)?;
    let mut trading = matches!(tag, 2 | 4);
    if tag == 6 {
        let params = BatchUpdateParams::try_from_slice(&data[1..]).map_err(|_| ERR)?;
        need(params.orders.iter().all(|o| o.order_type().as_u8() <= 2))?;
        trading = !params.orders.is_empty();
    }
    open(&ext[1], &ext[2], &b, trading)?;
    if tag != 0 {
        need(core[1].owner_pubkey() == crate::id())?;
        let d = core[1].try_borrow()?;
        need(d.len() >= 256 && key(&d,16)? == b.base && key(&d,48)? == b.quote)?;
    } else {
        need(core[3].pubkey() == &b.base && core[4].pubkey() == &b.quote)?;
    }
    // No globals or arbitrary token programs. Thaw just the accounts touched by
    // a classic SPL transfer; all are sealed again before this call returns.
    let token_indices: &[usize] = match tag { 0 => &[5], 2 | 3 => &[2,3], 4 => &[3,5], _ => &[] };
    for &i in token_indices {
        if tag != 0 && core[i].try_borrow()?.get(..32) == Some(b.base.as_ref()) { frozen(&core[i], &ext[3], &ext[4], false)?; }
    }
    let before = if tag == 0 { 0 } else { volume(&core[1])? };
    crate::process_core(program, core, data)?;
    let delta = volume(&core[1])?.checked_sub(before).ok_or(ERR)?;
    // Pinned core uses checked accumulation for this authoritative fee basis.
    let fee: u64 = ((delta as u128 * b.bps as u128 + 9_999) / 10_000).try_into().map_err(|_| ERR)?;
    need(fee <= max_fee)?;
    if fee > 0 {
        need(ext[5].pubkey() != ext[6].pubkey())?;
        for (account, owner) in [(&ext[5], core[0].pubkey()), (&ext[6], &b.recipient)] {
            need(account.owner_pubkey() == spl_token::id())?;
            let d = account.try_borrow()?;
            need(d.len() == 165 && key(&d,0)? == b.quote && key(&d,32)? == *owner && d[108] == 1)?;
        }
        let ix = spl_token::instruction::transfer(&spl_token::id(), ext[5].pubkey(), ext[6].pubkey(), core[0].pubkey(), &[], fee).map_err(|_| ERR)?;
        crate::program::invoke(&ix, &[&ext[5], &ext[6], &core[0]])?;
    }
    for &i in token_indices {
        if core[i].try_borrow()?.get(..32) == Some(b.base.as_ref()) { frozen(&core[i], &ext[3], &ext[4], true)?; }
    }
    Ok(())
}
