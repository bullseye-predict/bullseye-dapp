use crate::{
    codec::{Reader, State, Writer},
    error::{add, check, sub, Error, Result},
};

pub const MAX_OUTCOMES: usize = 16;
pub const PRICE_SCALE: u64 = 1_000_000;
pub type Key = [u8; 32];
pub const PENDING: u8 = 0;
pub const TRADING: u8 = 1;
pub const LOCKED: u8 = 2;
pub const RESOLVED: u8 = 3;
pub const VOIDED: u8 = 4;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    pub authority: Key,
    pub oracle: Key,
    pub mint: Key,
    pub domain: Key,
    pub paused: bool,
    pub bump: u8,
}
impl State for Config {
    const TAG: &'static [u8; 8] = b"SOLZCFG1";
    const LEN: usize = 138;
    fn read(r: &mut Reader) -> Result<Self> {
        Ok(Self {
            authority: r.bytes()?,
            oracle: r.bytes()?,
            mint: r.bytes()?,
            domain: r.bytes()?,
            paused: r.bool()?,
            bump: r.u8()?,
        })
    }
    fn write(&self, w: &mut Writer) -> Result<()> {
        w.bytes(&self.authority)?;
        w.bytes(&self.oracle)?;
        w.bytes(&self.mint)?;
        w.bytes(&self.domain)?;
        w.bool(self.paused)?;
        w.u8(self.bump)
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Market {
    pub match_id: Key,
    pub mint: Key,
    pub oracle: Key,
    pub escrow: Key,
    pub starts_at: i64,
    pub locks_at: i64,
    pub expiry: i64,
    pub created_at: i64,
    pub status: u8,
    pub outcomes: u8,
    pub winner: u8,
    pub paused: bool,
    pub bump: u8,
    pub escrow_bump: u8,
    pub collateral_locked: u64,
    pub result_hash: Key,
    pub void_shares_redeemed: u128,
}
impl State for Market {
    const TAG: &'static [u8; 8] = b"SOLZMKT1";
    const LEN: usize = 230;
    fn read(r: &mut Reader) -> Result<Self> {
        Ok(Self {
            match_id: r.bytes()?,
            mint: r.bytes()?,
            oracle: r.bytes()?,
            escrow: r.bytes()?,
            starts_at: r.i64()?,
            locks_at: r.i64()?,
            expiry: r.i64()?,
            created_at: r.i64()?,
            status: r.u8()?,
            outcomes: r.u8()?,
            winner: r.u8()?,
            paused: r.bool()?,
            bump: r.u8()?,
            escrow_bump: r.u8()?,
            collateral_locked: r.u64()?,
            result_hash: r.bytes()?,
            void_shares_redeemed: r.u128()?,
        })
    }
    fn write(&self, w: &mut Writer) -> Result<()> {
        w.bytes(&self.match_id)?;
        w.bytes(&self.mint)?;
        w.bytes(&self.oracle)?;
        w.bytes(&self.escrow)?;
        w.i64(self.starts_at)?;
        w.i64(self.locks_at)?;
        w.i64(self.expiry)?;
        w.i64(self.created_at)?;
        w.u8(self.status)?;
        w.u8(self.outcomes)?;
        w.u8(self.winner)?;
        w.bool(self.paused)?;
        w.u8(self.bump)?;
        w.u8(self.escrow_bump)?;
        w.u64(self.collateral_locked)?;
        w.bytes(&self.result_hash)?;
        w.u128(self.void_shares_redeemed)
    }
}
impl Market {
    pub fn require_trading(&self, config: &Config, now: i64) -> Result<()> {
        check(!config.paused && !self.paused, Error::Paused)?;
        check(self.status <= TRADING, Error::InvalidStatus)?;
        check(
            now >= self.starts_at && now < self.locks_at,
            Error::InvalidTime,
        )
    }
    pub fn validate_outcome(&self, outcome: u8) -> Result<()> {
        check(outcome < self.outcomes, Error::InvalidOutcome)
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Vault {
    pub owner: Key,
    pub agent: Key,
    pub mint: Key,
    pub escrow: Key,
    pub available: u64,
    pub exposure: u64,
    /// Cumulative agent BUY collateral budget; owner funding is independent.
    pub max_capital: u64,
    /// Maximum collateral notional of an agent's entire signed order.
    pub max_order_size: u64,
    /// Sum of outstanding outcome units across markets (a conservative payout bound).
    pub max_exposure: u64,
    pub expiry: i64,
    pub epoch: u64,
    pub enabled: bool,
    pub bump: u8,
    pub escrow_bump: u8,
    /// Gross agent BUY quote spent since the last owner policy authorization.
    pub spent_capital: u64,
}
impl State for Vault {
    const TAG: &'static [u8; 8] = b"SOLZVLT2";
    const LEN: usize = 203;
    fn read(r: &mut Reader) -> Result<Self> {
        Ok(Self {
            owner: r.bytes()?,
            agent: r.bytes()?,
            mint: r.bytes()?,
            escrow: r.bytes()?,
            available: r.u64()?,
            exposure: r.u64()?,
            max_capital: r.u64()?,
            max_order_size: r.u64()?,
            max_exposure: r.u64()?,
            expiry: r.i64()?,
            epoch: r.u64()?,
            enabled: r.bool()?,
            bump: r.u8()?,
            escrow_bump: r.u8()?,
            spent_capital: r.u64()?,
        })
    }
    fn write(&self, w: &mut Writer) -> Result<()> {
        w.bytes(&self.owner)?;
        w.bytes(&self.agent)?;
        w.bytes(&self.mint)?;
        w.bytes(&self.escrow)?;
        w.u64(self.available)?;
        w.u64(self.exposure)?;
        w.u64(self.max_capital)?;
        w.u64(self.max_order_size)?;
        w.u64(self.max_exposure)?;
        w.i64(self.expiry)?;
        w.u64(self.epoch)?;
        w.bool(self.enabled)?;
        w.u8(self.bump)?;
        w.u8(self.escrow_bump)?;
        w.u64(self.spent_capital)
    }
}
impl Vault {
    pub fn authorize(&self, signer: &Key, now: i64) -> Result<bool> {
        if signer == &self.owner {
            return Ok(false);
        }
        check(
            self.enabled && signer == &self.agent && now < self.expiry,
            Error::Unauthorized,
        )?;
        Ok(true)
    }
    pub fn check_agent_order(
        &self,
        signer: &Key,
        now: i64,
        expiry: i64,
        quantity: u64,
        price: u64,
        next_exposure: u64,
    ) -> Result<()> {
        if self.authorize(signer, now)? {
            check(
                expiry <= self.expiry
                    && quote(quantity, price)? <= self.max_order_size
                    && (next_exposure <= self.max_exposure || next_exposure < self.exposure),
                Error::RiskLimit,
            )?;
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Position {
    pub vault: Key,
    pub market: Key,
    pub balances: [u64; MAX_OUTCOMES],
    pub bump: u8,
}
impl State for Position {
    const TAG: &'static [u8; 8] = b"SOLZPOS1";
    const LEN: usize = 201;
    fn read(r: &mut Reader) -> Result<Self> {
        let vault = r.bytes()?;
        let market = r.bytes()?;
        let mut balances = [0; MAX_OUTCOMES];
        for b in &mut balances {
            *b = r.u64()?;
        }
        Ok(Self {
            vault,
            market,
            balances,
            bump: r.u8()?,
        })
    }
    fn write(&self, w: &mut Writer) -> Result<()> {
        w.bytes(&self.vault)?;
        w.bytes(&self.market)?;
        for b in self.balances {
            w.u64(b)?;
        }
        w.u8(self.bump)
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OrderState {
    pub vault: Key,
    pub nonce: u64,
    pub epoch: u64,
    pub filled: u64,
    pub cancelled: bool,
    pub bound: bool,
    pub body: [u8; 138],
}
impl State for OrderState {
    const TAG: &'static [u8; 8] = b"SOLZORD1";
    const LEN: usize = 204;
    fn read(r: &mut Reader) -> Result<Self> {
        Ok(Self {
            vault: r.bytes()?,
            nonce: r.u64()?,
            epoch: r.u64()?,
            filled: r.u64()?,
            cancelled: r.bool()?,
            bound: r.bool()?,
            body: r.bytes()?,
        })
    }
    fn write(&self, w: &mut Writer) -> Result<()> {
        w.bytes(&self.vault)?;
        w.u64(self.nonce)?;
        w.u64(self.epoch)?;
        w.u64(self.filled)?;
        w.bool(self.cancelled)?;
        w.bool(self.bound)?;
        w.bytes(&self.body)
    }
}
/// Upward rounding pays the seller at least the execution price. Fill validation
/// separately enforces the buyer's exact limit, rejecting unrepresentable dust.
pub fn quote(quantity: u64, price: u64) -> Result<u64> {
    let value = (quantity as u128) * (price as u128);
    u64::try_from(value.div_ceil(PRICE_SCALE as u128)).map_err(|_| Error::Arithmetic.into())
}
pub fn split(
    market: &mut Market,
    vault: &mut Vault,
    position: &mut Position,
    amount: u64,
) -> Result<()> {
    check(amount > 0, Error::InvalidAmount)?;
    let units = amount
        .checked_mul(market.outcomes as u64)
        .ok_or(Error::Arithmetic)?;
    vault.available = sub(vault.available, amount)?;
    vault.exposure = add(vault.exposure, units)?;
    market.collateral_locked = add(market.collateral_locked, amount)?;
    for b in &mut position.balances[..market.outcomes as usize] {
        *b = add(*b, amount)?;
    }
    market.status = TRADING;
    Ok(())
}
pub fn merge(
    market: &mut Market,
    vault: &mut Vault,
    position: &mut Position,
    amount: u64,
) -> Result<()> {
    check(market.status != RESOLVED, Error::InvalidStatus)?;
    check(amount > 0, Error::InvalidAmount)?;
    for b in &mut position.balances[..market.outcomes as usize] {
        *b = sub(*b, amount)?;
    }
    let units = amount
        .checked_mul(market.outcomes as u64)
        .ok_or(Error::Arithmetic)?;
    vault.exposure = sub(vault.exposure, units)?;
    vault.available = add(vault.available, amount)?;
    market.collateral_locked = sub(market.collateral_locked, amount)?;
    Ok(())
}
pub fn redeem(market: &mut Market, vault: &mut Vault, position: &mut Position) -> Result<u64> {
    check(
        market.status == RESOLVED || market.status == VOIDED,
        Error::InvalidStatus,
    )?;
    let total = position
        .balances
        .iter()
        .try_fold(0_u64, |a, b| add(a, *b))?;
    check(total > 0, Error::InvalidAmount)?;
    // Cumulative rounding conserves every collateral atom when all shares are
    // redeemed. Redemption order can move at most one atom between holders.
    let payout = if market.status == VOIDED {
        let before = market.void_shares_redeemed / (market.outcomes as u128);
        market.void_shares_redeemed = market
            .void_shares_redeemed
            .checked_add(total as u128)
            .ok_or(Error::Arithmetic)?;
        u64::try_from(market.void_shares_redeemed / (market.outcomes as u128) - before)
            .map_err(|_| Error::Arithmetic)?
    } else {
        position.balances[market.winner as usize]
    };
    vault.exposure = sub(vault.exposure, total)?;
    vault.available = add(vault.available, payout)?;
    market.collateral_locked = sub(market.collateral_locked, payout)?;
    position.balances.fill(0);
    Ok(payout)
}
