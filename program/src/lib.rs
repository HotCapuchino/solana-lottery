use solana_program::entrypoint;

pub mod instructions;
pub mod state;
pub mod processor;
pub mod error;

use crate::processor::process_instruction;

entrypoint!(process_instruction);