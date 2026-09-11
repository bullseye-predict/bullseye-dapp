//! Fully collateralized SOLZ prediction markets implemented with Pinocchio.
//! No Anchor, RPC endpoints or wallet secrets are embedded in the program.
use pinocchio::{AccountView, Address, ProgramResult};
pub mod accounts;
pub mod codec;
pub mod error;
pub mod identity;
pub mod manifest_tokens;
pub mod orders;
#[cfg(feature = "external-venue-comparison")]
pub mod outcome_tokens;
pub mod processor;
pub mod state;

#[cfg(not(feature = "no-entrypoint"))]
pinocchio::entrypoint!(process_instruction);

pub fn process_instruction(
    program: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    processor::process(program, accounts, data)
}
