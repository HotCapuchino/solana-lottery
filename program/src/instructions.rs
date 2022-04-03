use crate::state::LotteryAccount;
use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{AccountInfo, next_account_info},
    entrypoint::ProgramResult,
    program_error::ProgramError,
    msg,
    program::invoke,
    pubkey::Pubkey,
    system_instruction::{transfer, create_account_with_seed},
};
use crate::state::LotteryState;
// use crate::error::create_u32_error;
use std::{mem::size_of, collections::HashMap};

const LAMPORTS_DECIMALS: f64 = 1000000000.0;
// const PROGRAM_SEED: &str = "lottery";

pub enum LotteryInstructions {
    StartLottery(u32), // 0
    DonateInstruction(u64), // 1
    CheckTime, // 2
    LaunchLottery(Vec<u8>), // 3
    CompleteLottery, // 4
}

impl LotteryInstructions {
    pub fn unpack(input: &[u8]) -> Result<Self, ProgramError> {
        let (inst_code, rest ) = input.split_first().ok_or(ProgramError::InvalidInstructionData)?;

        return match inst_code {
            0 => {
                if rest.len() != 4 {
                    return Err(ProgramError::InvalidInstructionData);
                }

                let val: Result<[u8; 4], _> = rest[..4].try_into();
                if val.is_ok() {
                    return Ok(Self::StartLottery(u32::from_le_bytes(val.unwrap())));
                }
                return Err(ProgramError::InvalidInstructionData);
            },
            1 => {
                if rest.len() != 8 {
                    return Err(ProgramError::InvalidInstructionData);
                }

                let val: Result<[u8; 8], _> = rest[..8].try_into();

                if val.is_ok() {
                    let amount = u64::from_le_bytes(val.unwrap());
                    return Ok(Self::DonateInstruction(amount));
                } else {
                    return Err(ProgramError::InvalidInstructionData);
                }
            },
            2 => Ok(Self::CheckTime),
            3 => {
                let hashes = rest.to_vec();
                Ok(Self::LaunchLottery(hashes))
            },
            4 => Ok(Self::CompleteLottery),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}

/// Accounts expected:
/// 0. `[writable]` PDA account
/// 1. `[]` System program
pub fn start_lottery(program_id: &Pubkey, accounts: &[AccountInfo], max_participants: u32) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();

    let pda_acc = next_account_info(accounts_iter)?;
    // checking pda account
    if !pda_acc.is_writable && pda_acc.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }

    let mut lottery_account = LotteryAccount::try_from_slice(&pda_acc.data.borrow())?;
    lottery_account.winner = None;
    lottery_account.participants = HashMap::new();
    if lottery_account.max_participants != max_participants {
        lottery_account.max_participants = max_participants;
    }
    lottery_account.lottery_state = LotteryState::IN_PROGRESS;

    lottery_account.serialize(&mut &mut pda_acc.data.borrow_mut()[..])?;

    Ok(())
}

/// Accounts expected:
/// 0. `[signer, writable]` Debit lamports from this account
/// 1. `[writable]` Credit lamports to this account, must be PDA account
/// 2. `[]` System program
pub fn handle_donate_instruction(program_id: &Pubkey, accounts: &[AccountInfo], lamports_amount: u64) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();

    let participant_acc = next_account_info(accounts_iter)?;
    // checking donater account
    if !participant_acc.is_writable && !participant_acc.is_signer {
        return Err(ProgramError::InvalidAccountData);
    }

    let pda_acc = next_account_info(accounts_iter)?;
    // checking pda account
    if !pda_acc.is_writable && pda_acc.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }

    // checking if it's still available to donate sol
    let lottery_availability = check_for_lottery_availability(pda_acc);
    if !lottery_availability.is_ok() {
        return lottery_availability;
    }

    invoke(
        &transfer(participant_acc.key, pda_acc.key, lamports_amount),
        &[participant_acc.clone(), pda_acc.clone()],
    )?; 

    msg!("transfer {} lamports from {:?} to PDA {:?}: done", lamports_amount, participant_acc.key, pda_acc.key);

    Ok(())
}

/// checking whether new participant can join the lottery
pub fn check_for_lottery_availability(pda_account: &AccountInfo) -> ProgramResult {
    let lottery_data = LotteryAccount::try_from_slice(&pda_account.data.borrow())?;

    if lottery_data.lottery_state != LotteryState::IN_PROGRESS || 
        lottery_data.participants.len() as u32 == lottery_data.max_participants {
        return Err(ProgramError::Custom(100));  
    }

    Ok(()) 
}

/// Do I need it???
/// 2. `[writable]` PDA for main account to store state 
// pub fn init_main_acc_state(program_id: &Pubkey, account: &AccountInfo) -> Result<(), ProgramError> {
//     // creating pubkey of pda account for main account to store state
//     let main_acc_pda_pubkey = Pubkey::create_program_address(&[account.key.as_ref()], program_id)?;

//     // invoke system instruction to create pda account
//     // invoke(
//         // &create_account_with_seed(from_pubkey, to_pubkey, base, seed, lamports, size_of<LotteryAccount>(), owner)
//     // );
//     Ok(())
// }

/// Accounts expected:
/// 0. `[signer, writable]` Debit lamports from this account
/// 1. `[writable]` Credit lamports to this account, must be PDA account
/// 2. `[]` System program
pub fn update_main_acc_state(program_id: &Pubkey, accounts: &[AccountInfo], lamports_amount: u64) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();

    let participant_acc = next_account_info(accounts_iter)?;
    // checking donater account
    if !participant_acc.is_writable && !participant_acc.is_signer {
        return Err(ProgramError::InvalidAccountData);
    }

    let pda_acc = next_account_info(accounts_iter)?;
    // checking pda account
    if !pda_acc.is_writable && pda_acc.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }

    let mut lottery_account = LotteryAccount::try_from_slice(&pda_acc.data.borrow())?;

    // checking whether this user has already donated 
    if lottery_account.participants.contains_key(participant_acc.key) {
        let amount_donated = lottery_account.participants[participant_acc.key] + ((lamports_amount as f64) / LAMPORTS_DECIMALS);
        lottery_account.participants.insert(participant_acc.key.clone(), amount_donated);
    } else {
        lottery_account.participants.insert(participant_acc.key.clone(), (lamports_amount as f64) / LAMPORTS_DECIMALS);
    }

    lottery_account.serialize(&mut &mut pda_acc.data.borrow_mut()[..])?;

    Ok(())
}

/// Accounts expected:
/// 0. `[signer, writable]` Main account, owner of program (should I need this account???)
/// 1. `[writable]` PDA account to transfer lamports from
/// 2. `[writable]` Winner account, credit lamports here
/// 3. `[]` System program
pub fn complete_lottery(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();

    let main_acc = next_account_info(accounts_iter)?;
    // checking main account
    if !main_acc.is_signer && !main_acc.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    let pda_acc = next_account_info(accounts_iter)?;
    // checking pda account
    if !pda_acc.is_writable && pda_acc.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }

    let mut lottery_account = LotteryAccount::try_from_slice(&pda_acc.data.borrow())?;

    let winner_acc = next_account_info(accounts_iter)?;
    // checking winner account
    if !winner_acc.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    // lottery_account.

    // let FEE = pda_acc.lamports.clone() * 0.01;
    // pda_acc.lamports

    // transfer lamports to winner account,
    // transfer fees to main account

    Ok(())
}

/// Accounts expected:
/// 0. `[signer]` Main account, owner of program (should I need this account???)
/// 1. `[writable]` PDA account to transfer lamports from
/// 2. `[]` System program
pub fn launch_lottery(program_id: &Pubkey, accounts: &[AccountInfo], hashes: Vec<u8>) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();

    // let main_acc = next_account_info(accounts_iter)?;
    // // checking main account
    // if !main_acc.is_signer && !main_acc.is_writable {
    //     return Err(ProgramError::InvalidAccountData);
    // }

    let pda_acc = next_account_info(accounts_iter)?;
    // checking pda account
    if !pda_acc.is_writable && pda_acc.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }

    let mut lottery_account = LotteryAccount::try_from_slice(&pda_acc.data.borrow())?;

    let winner_num: usize = calculate_random_number(&hashes, lottery_account.participants.len().try_into().unwrap()) as usize;
    let participants_pubkeys: Vec<Pubkey> = lottery_account.participants
                                    .clone()
                                    .into_iter()
                                    .map(|(pubkey, _)| pubkey)
                                    .collect();
    let winner_pubkey = participants_pubkeys.get(winner_num);
    if winner_pubkey.is_some() {
        lottery_account.winner = Some(winner_pubkey.unwrap().clone());
        lottery_account.lottery_state = LotteryState::LAUCNHED;
    } 

    lottery_account.serialize(&mut &mut pda_acc.data.borrow_mut()[..])?;

    Ok(())
}

// used to calculate random winner number from last 5 blockhashes of solana network
fn calculate_random_number(input: &[u8], pool_size: u32) -> u32 {
    let general_len = input.len();
    let hashes_amount = (general_len as f32 / 16.0).floor() as usize; 
    let single_len = general_len / hashes_amount;
    let mut sum: u128 = 0;
    let mut start = 0;
    let mut end = 0;

    for i in 0..hashes_amount {
        start = single_len * i;
        end = single_len * (i + 1);
        let current_slice = &input[start..end];

        // println!("current string {}", &str[start..end]);

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

    (sum % (pool_size as u128)) as u32
}