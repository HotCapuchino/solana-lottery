use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;
use std::collections::HashMap;

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum LotteryState {
    IN_PROGRESS,
    BETS_CLOSED,
    LAUCNHED, 
    COMPLETED
}

impl PartialEq for LotteryState {
    fn eq(&self, other: &Self) -> bool {
        core::mem::discriminant(self) == core::mem::discriminant(other)
    }
}

// Max number of participants is 1024
// Max token balance is 4294967296 SOL
// Size of account is 
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct LotteryAccount {
    pub participants: HashMap<Pubkey, f64>,
    pub max_participants: u32,
    pub lottery_state: LotteryState,
    pub winner: Option<Pubkey>
}