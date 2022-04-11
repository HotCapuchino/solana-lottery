use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;
use std::collections::HashMap;

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

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct LotteryAccount {
    pub participants: HashMap<Pubkey, u64>,
    pub max_participants: u32,
    pub lottery_state: LotteryState,
    pub winner: Option<Pubkey>,
    pub lottery_start: u64,
}