use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;
use std::collections::HashMap;

pub const LOTTERY_SEED: &str = "lottery";
pub const DEFAULT_WINNER_KEY: Pubkey = Pubkey::new_from_array([0; 32]);

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum LotteryState {
    BETS_CLOSED,
    IN_PROGRESS,
    LAUCNHED, 
    COMPLETED
}

impl PartialEq for LotteryState {
    fn eq(&self, other: &Self) -> bool {
        core::mem::discriminant(self) == core::mem::discriminant(other)
    }
}
/// borsh deserialize struct from top to bottom
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct LotteryAccount {
    pub max_participants: u32, // 4 bytes
    pub lottery_state: LotteryState, // 1 byte
    pub winner: Pubkey, // 32 bytes
    pub lottery_start: u64, // 8 bytes
    pub participants: HashMap<Pubkey, u64>, // 40 bytes per (key; value), 4 bytes for hashmap capacity
}
// total - 45 bytes for stationary data, 40 bytes * max_participants + 4 bytes for hash map size