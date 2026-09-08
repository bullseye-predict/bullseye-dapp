use crate::{
    codec::{Reader, Writer},
    error::{add, check, sub, Error, Result},
    state::{quote, Config, Key, Market, OrderState, Position, Vault, PRICE_SCALE},
};
use pinocchio::Address;

pub const ORDER_DOMAIN: &[u8] = b"SOLZ_PREDICTION_ORDER_V1";
pub const ORDER_LEN: usize = 138;
pub const FILL_TAG: u8 = 16;
pub const FILL_LEN: usize = 485;
pub const BUY_DIGEST_OFFSET: usize = 293;
pub const SELL_DIGEST_OFFSET: usize = 325;
pub const BUY_SIGNATURE_OFFSET: usize = 357;
pub const SELL_SIGNATURE_OFFSET: usize = 421;
pub const ED25519_ID: Address =
    Address::from_str_const("Ed25519SigVerify111111111111111111111111111");

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Order {
    pub signer: Key,
    pub vault: Key,
    pub market: Key,
    pub outcome: u8,
    pub side: u8,
    pub price: u64,
    pub quantity: u64,
    pub nonce: u64,
    pub expiry: i64,
    pub epoch: u64,
}
impl Order {
    pub fn decode(body: &[u8]) -> Result<Self> {
        let mut r = Reader::new(body);
        let order = Self {
            signer: r.bytes()?,
            vault: r.bytes()?,
            market: r.bytes()?,
            outcome: r.u8()?,
            side: r.u8()?,
            price: r.u64()?,
            quantity: r.u64()?,
            nonce: r.u64()?,
            expiry: r.i64()?,
            epoch: r.u64()?,
        };
        r.done()?;
        Ok(order)
    }
    pub fn encode(&self) -> Result<[u8; ORDER_LEN]> {
        let mut bytes = [0; ORDER_LEN];
        let mut w = Writer::new(&mut bytes);
        w.bytes(&self.signer)?;
        w.bytes(&self.vault)?;
        w.bytes(&self.market)?;
        w.u8(self.outcome)?;
        w.u8(self.side)?;
        w.u64(self.price)?;
        w.u64(self.quantity)?;
        w.u64(self.nonce)?;
        w.i64(self.expiry)?;
        w.u64(self.epoch)?;
        Ok(bytes)
    }
    pub fn digest(&self, program: &Address, domain: &Key) -> Result<Key> {
        Ok(
            solana_sha256_hasher::hashv(&[ORDER_DOMAIN, program.as_ref(), domain, &self.encode()?])
                .to_bytes(),
        )
    }
    pub fn validate(
        &self,
        vault: &Vault,
        state: &OrderState,
        now: i64,
        quantity: u64,
    ) -> Result<()> {
        check(
            self.quantity > 0 && self.price > 0 && self.price <= PRICE_SCALE && self.side <= 1,
            Error::InvalidOrder,
        )?;
        check(now < self.expiry, Error::InvalidTime)?;
        check(self.epoch == vault.epoch, Error::StaleEpoch)?;
        check(
            state.vault == self.vault && state.nonce == self.nonce,
            Error::InvalidAccount,
        )?;
        check(!state.cancelled, Error::OrderCancelled)?;
        if state.bound {
            check(
                state.body == self.encode()? && state.epoch == self.epoch,
                Error::InvalidOrder,
            )?;
        }
        check(
            add(state.filled, quantity)? <= self.quantity,
            Error::OrderFilled,
        )
    }
}
/// Canonical two-signature precompile referencing the following Fill instruction.
/// No alternate offsets, signature counts, source indices or trailing bytes are accepted.
pub fn ed25519_descriptors(fill_index: u16) -> [u8; 30] {
    let mut data = [0; 30];
    data[0] = 2;
    for (i, fields) in [
        [
            BUY_SIGNATURE_OFFSET as u16,
            fill_index,
            1,
            fill_index,
            BUY_DIGEST_OFFSET as u16,
            32,
            fill_index,
        ],
        [
            SELL_SIGNATURE_OFFSET as u16,
            fill_index,
            139,
            fill_index,
            SELL_DIGEST_OFFSET as u16,
            32,
            fill_index,
        ],
    ]
    .iter()
    .enumerate()
    {
        for (j, value) in fields.iter().enumerate() {
            data[2 + i * 14 + j * 2..4 + i * 14 + j * 2].copy_from_slice(&value.to_le_bytes());
        }
    }
    data
}
fn u16_at(data: &[u8], at: usize) -> Result<u16> {
    Ok(u16::from_le_bytes(
        data.get(at..at + 2)
            .ok_or(Error::InvalidSignatureInstruction)?
            .try_into()
            .map_err(|_| Error::InvalidSignatureInstruction)?,
    ))
}
fn instruction_at(data: &[u8], index: usize) -> Result<(&[u8], &[u8], usize)> {
    let count = u16_at(data, 0)? as usize;
    check(index < count, Error::InvalidSignatureInstruction)?;
    let offset = u16_at(data, 2 + index * 2)? as usize;
    check(offset >= 2 + count * 2, Error::InvalidSignatureInstruction)?;
    let accounts = u16_at(data, offset)? as usize;
    let start = offset
        .checked_add(2 + accounts * 33)
        .ok_or(Error::InvalidSignatureInstruction)?;
    let program = data
        .get(start..start + 32)
        .ok_or(Error::InvalidSignatureInstruction)?;
    let len = u16_at(data, start + 32)? as usize;
    let bytes = data
        .get(start + 34..start + 34 + len)
        .ok_or(Error::InvalidSignatureInstruction)?;
    Ok((program, bytes, accounts))
}
/// Caller MUST verify the account address equals the real instructions sysvar.
/// This parser is intentionally bounds checked even though runtime owns that data.
pub fn verify_precompile(sysvar: &[u8], program: &Address, fill: &[u8]) -> Result<()> {
    check(
        fill.len() == FILL_LEN && fill[0] == FILL_TAG && sysvar.len() >= 2,
        Error::InvalidSignatureInstruction,
    )?;
    let current = u16_at(sysvar, sysvar.len() - 2)?;
    check(current > 0, Error::InvalidSignatureInstruction)?;
    let (current_program, current_data, _) = instruction_at(sysvar, current as usize)?;
    check(
        current_program == program.as_ref() && current_data == fill,
        Error::InvalidSignatureInstruction,
    )?;
    let (ed_program, ed_data, accounts) = instruction_at(sysvar, current as usize - 1)?;
    check(
        ed_program == ED25519_ID.as_ref()
            && accounts == 0
            && ed_data == ed25519_descriptors(current),
        Error::InvalidSignatureInstruction,
    )
}
pub fn apply_fill(
    config: &Config,
    market: &mut Market,
    buy: &Order,
    sell: &Order,
    buyer: &mut Vault,
    seller: &mut Vault,
    buyer_position: &mut Position,
    seller_position: &mut Position,
    buy_state: &mut OrderState,
    sell_state: &mut OrderState,
    quantity: u64,
    execution_price: u64,
    now: i64,
) -> Result<u64> {
    market.require_trading(config, now)?;
    check(quantity > 0, Error::InvalidAmount)?;
    check(
        buy.vault != sell.vault
            && buy.market == sell.market
            && buy.outcome == sell.outcome
            && buy.side == 0
            && sell.side == 1,
        Error::InvalidOrder,
    )?;
    market.validate_outcome(buy.outcome)?;
    check(
        execution_price >= sell.price && execution_price <= buy.price,
        Error::InvalidOrder,
    )?;
    buy.validate(buyer, buy_state, now, quantity)?;
    sell.validate(seller, sell_state, now, quantity)?;
    let cost = quote(quantity, execution_price)?;
    // The transfer amount must satisfy BOTH signed limits after atomic rounding.
    check(
        (cost as u128) * (PRICE_SCALE as u128) <= (quantity as u128) * (buy.price as u128),
        Error::InvalidAmount,
    )?;
    let next_buyer_exposure = add(buyer.exposure, quantity)?;
    let next_seller_exposure = sub(seller.exposure, quantity)?;
    buyer.check_agent_order(
        &buy.signer,
        now,
        buy.expiry,
        buy.quantity,
        buy.price,
        next_buyer_exposure,
    )?;
    seller.check_agent_order(
        &sell.signer,
        now,
        sell.expiry,
        sell.quantity,
        sell.price,
        next_seller_exposure,
    )?;
    if buy.signer != buyer.owner {
        let spent_capital = add(buyer.spent_capital, cost)?;
        check(spent_capital <= buyer.max_capital, Error::RiskLimit)?;
        buyer.spent_capital = spent_capital;
    }
    // Sales, owner trades and returned collateral never replenish this budget.
    buyer.available = sub(buyer.available, cost)?;
    seller.available = add(seller.available, cost)?;
    buyer.exposure = next_buyer_exposure;
    seller.exposure = next_seller_exposure;
    let outcome = buy.outcome as usize;
    seller_position.balances[outcome] = sub(seller_position.balances[outcome], quantity)?;
    buyer_position.balances[outcome] = add(buyer_position.balances[outcome], quantity)?;
    buy_state.filled = add(buy_state.filled, quantity)?;
    sell_state.filled = add(sell_state.filled, quantity)?;
    buy_state.body = buy.encode()?;
    sell_state.body = sell.encode()?;
    buy_state.bound = true;
    sell_state.bound = true;
    buy_state.epoch = buy.epoch;
    sell_state.epoch = sell.epoch;
    market.status = crate::state::TRADING;
    Ok(cost)
}
