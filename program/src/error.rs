use thiserror::Error;

#[derive(Error, Debug, Copy, Clone)]
pub enum EscrowError {
    /// Invalid instruction
    #[error("Invalid Instruction")]
    InvalidInstruction,
}

pub fn create_u32_error(string: &str) -> u32 {
    string.to_string().parse::<u32>().unwrap()
}