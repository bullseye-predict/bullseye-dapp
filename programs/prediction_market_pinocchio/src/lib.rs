//! Fully collateralized SOLZ prediction markets implemented with Pinocchio.
//! No Anchor, RPC endpoints or wallet secrets are embedded in the program.
use pinocchio::{AccountView, Address, ProgramResult};
pub mod accounts;
pub mod codec;
pub mod error;
pub mod orders;
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
