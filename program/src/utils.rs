use std::mem::size_of;

use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    program_error::ProgramError,
    msg,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize};

use crate::state::{LotteryState, LotteryAccount, LOTTERY_SEED};


/// checking whether new participant can join the lottery
pub fn check_for_lottery_availability(pda_account: &AccountInfo) -> ProgramResult {
    let lottery_data:LotteryAccount = deserialize(&pda_account.data.borrow())?;

    msg!("Max participants in lottery: {:?}", lottery_data.max_participants);

    if lottery_data.lottery_state != LotteryState::IN_PROGRESS || 
        lottery_data.participants.len() as u32 >= lottery_data.max_participants {
        return Err(ProgramError::Custom(100));  
    }

    Ok(()) 
}

impl LotteryAccount {
    pub fn get_lottery_pubkey(program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[LOTTERY_SEED.as_bytes()], program_id)
    }

    pub fn check_pubkey(program_id: &Pubkey, pubkey_to_check: &Pubkey) -> bool {
        let (lottery_pubkey, _) = Self::get_lottery_pubkey(program_id);
        lottery_pubkey.to_bytes() == pubkey_to_check.to_bytes()
    }
}

/// calculate size of acc
pub fn calculate_lottery_account_size(max_participants: u32) -> u64 {
    let mut size: u32 = 0;
    size += size_of::<u32>() as u32;
    size += size_of::<LotteryState>() as u32;
    size += size_of::<Pubkey>() as u32;
    size += size_of::<u64>() as u32;
    size += max_participants * ((size_of::<Pubkey>() + size_of::<u64>()) as u32) + 4; // 4 bytes is for HashMap capacity - https://github.com/near/borsh-rs/blob/master/borsh/src/de/mod.rs, 393 line

    size as u64
}

/// custom deserialization
/// first 49 bytes - determined account data, then goes HashMap (key, value) pairs
/// each pair - 40 bytes
pub fn deserialize(input: &[u8]) -> Result<LotteryAccount, ProgramError> {
    let mut stopping_index = 0; 
    let mut i = 0;
    let empty_pubkey = Pubkey::new_from_array([0; 32]);
    while i < input.len() {
        if i > 48 {
            // getting key of HashMap and checking whether it's empty
            let byte_array: [u8; 32] = input[i..i + 32].try_into().unwrap();
            let pubkey = Pubkey::new_from_array(byte_array);
            
            if pubkey == empty_pubkey {
                stopping_index = i;
                break;
            } else {
                // 32 pubkey + 8 u64 donation
                i += 40;
            }
        } else {
            i += 1;
        }
    }

    let lottery_account: LotteryAccount;
    if stopping_index == 0 {
        lottery_account = LotteryAccount::try_from_slice(&input)?;
    } else {
        lottery_account = LotteryAccount::try_from_slice(&input[..stopping_index])?;
    }
     
    Ok(lottery_account)
}

/// used to calculate random winner number from last 5 blockhashes of solana network
pub fn calculate_random_number(input: &[u8], pool_size: u32) -> usize {
    let general_len = input.len();
    let hashes_amount = (general_len as f32 / 16.0) as usize; 
    let single_len = general_len / if (hashes_amount) > 0 { hashes_amount } else { 1 };
    let mut sum: u128 = 0;
    let mut start = 0;
    let mut end = 0;

    for i in 0..hashes_amount {
        start = single_len * i;
        end = single_len * (i + 1);
        let current_slice: &[u8];
        if input.len() >= end {
            current_slice = &input[start..end];
        } else {
            current_slice = &input[start..];
        }

        let batch_size: usize = 4;
        if current_slice.len() < 16 {

            let difference = current_slice.len() - 16;
            let extra_bytes: Vec<u8> = vec![0, difference.try_into().unwrap()];
            let new_slice: Result<[u8; 16], _> = [current_slice, &extra_bytes].concat().try_into();

            if new_slice.is_ok() {
                sum += u128::from_le_bytes(new_slice.unwrap()) % (pool_size as u128);
            }
        } 

        if current_slice.len() >= 16 {
            let mut intervals_remain = current_slice.len() - 16;
            let interval_size = if ((current_slice.len() - 16) / 3) >= 1 {(current_slice.len() - 16) / 3} else { 1 };
            let mut byte_vec: Vec<u8> = current_slice[..batch_size].to_vec();
            let mut last_index = batch_size;

            for _j in 0..3 {
                if intervals_remain > 0 {
                    if intervals_remain - interval_size > 0 {
                        last_index += interval_size;
                        intervals_remain -= interval_size;
                    } else {
                        last_index += intervals_remain;
                        intervals_remain = 0;
                    }

                    if i % 2 == 0 {
                        byte_vec = [byte_vec, (current_slice[last_index..(last_index + batch_size)]).to_vec()].concat();
                    } else {
                        byte_vec = [(current_slice[last_index..(last_index + batch_size)]).to_vec(), byte_vec].concat();
                    }
                } else {
                    if i % 2 != 0 {
                        byte_vec = [byte_vec, (current_slice[(last_index + 1)..(last_index + 1 + batch_size)]).to_vec()].concat();
                    } else {
                        byte_vec = [(current_slice[(last_index + 1)..(last_index + 1 + batch_size)]).to_vec(), byte_vec].concat();
                    }
                }
            }

            let byte_array: Result<[u8; 16], _> = byte_vec.try_into();
            if byte_array.is_ok() {
                sum += u128::from_le_bytes(byte_array.unwrap()) % (pool_size as u128);
            }
        } 
    }

    (sum % (pool_size as u128)) as usize
}