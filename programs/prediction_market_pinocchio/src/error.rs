use pinocchio::error::ProgramError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Error {
    InvalidData = 7000,
    InvalidAccount,
    Unauthorized,
    AlreadyInitialized,
    Paused,
    InvalidTime,
    InvalidStatus,
    InvalidOutcome,
    InvalidAmount,
    InsufficientBalance,
    Arithmetic,
    RiskLimit,
    InvalidOrder,
    InvalidSignatureInstruction,
    OrderCancelled,
    OrderFilled,
    StaleEpoch,
    InvalidToken,
}
impl From<Error> for ProgramError {
    fn from(value: Error) -> Self {
        Self::Custom(value as u32)
    }
}
pub type Result<T> = core::result::Result<T, ProgramError>;
pub fn check(condition: bool, error: Error) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(error.into())
    }
}
pub fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or(Error::Arithmetic.into())
}
pub fn sub(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b).ok_or(Error::InsufficientBalance.into())
}
