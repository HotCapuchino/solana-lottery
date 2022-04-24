use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{AccountInfo, next_account_info},
    entrypoint::ProgramResult,
    program_error::ProgramError,
    msg,
    program::{invoke, invoke_signed},
    pubkey::Pubkey,
    system_instruction::transfer, 
    sysvar::{rent::Rent, Sysvar},
    system_instruction
};
use crate::state::{LotteryState, LOTTERY_SEED, LotteryAccount, DEFAULT_WINNER_KEY};
use std::collections::HashMap;
use crate::utils::{
    check_for_lottery_availability, 
    calculate_lottery_account_size,
    deserialize,
    calculate_random_number,
    calculate_overall_donations,
    check_lottery_lifecycle
};


#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum LotteryInstructions {
    StartLottery(u32, u64), // 0
    DonateInstruction(u64), // 1
    LaunchLottery(Vec<u8>), // 2
    CompleteLottery, // 3
}

impl LotteryInstructions {
    pub fn unpack(input: &[u8]) -> Result<Self, ProgramError> {
        msg!("Unpacking instruction data!");

        let (inst_code, rest ) = input.split_first().ok_or(ProgramError::InvalidInstructionData)?;

        msg!("Instruction code: {}", inst_code);

        return match inst_code {
            0 => {
                if rest.len() != 12 {
                    return Err(ProgramError::InvalidInstructionData);
                }

                msg!("Processing start lottery instruction");

                let max_participants: Result<[u8; 4], _> = rest[..4].try_into();

                if max_participants.is_ok() {
                    msg!("Max_participants: {}", u32::from_le_bytes(max_participants.unwrap()));
                }

                let unix_timestamp: Result<[u8; 8], _> = rest[4..12].try_into();

                if unix_timestamp.is_ok() {
                    msg!("Unix timestamp: {}", u64::from_le_bytes(unix_timestamp.unwrap()));
                }
                
                if max_participants.is_ok() && unix_timestamp.is_ok() {
                    return Ok(Self::StartLottery(
                                u32::from_le_bytes(max_participants.unwrap()),
                                u64::from_le_bytes(unix_timestamp.unwrap()))
                    );
                }

                msg!("{}, {}",max_participants.is_ok(), unix_timestamp.is_ok());
                return Err(ProgramError::InvalidInstructionData);
            },
            1 => {
                msg!("Processing donate instruction");

                if rest.len() != 8 {
                    return Err(ProgramError::InvalidInstructionData);
                }

                let val: Result<[u8; 8], _> = rest[..8].try_into();

                if val.is_ok() {
                    let amount = u64::from_le_bytes(val.unwrap());
                    return Ok(Self::DonateInstruction(amount));
                } else {
                    msg!("{}", val.is_ok());
                    return Err(ProgramError::InvalidInstructionData);
                }
            },
            2 => {
                let hashes = rest.to_vec();
                Ok(Self::LaunchLottery(hashes))
            },
            3 => Ok(Self::CompleteLottery),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}

/// Accounts expected:
/// 0. `[signer]` Main account, owner of program
/// 1. `[writable]` PDA account
/// 2. `[]` Rent sysvar
/// 3. `[]` System program
pub fn start_lottery(program_id: &Pubkey, accounts: &[AccountInfo], max_participants: u32, unix_timestamp: u64) -> ProgramResult {
    msg!("Executing start lottery instruction!");

    let accounts_iter = &mut accounts.iter();

    let main_acc = next_account_info(accounts_iter)?;
    // checking main account
    if !main_acc.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let pda_acc = next_account_info(accounts_iter)?;
    // checking pda account
    if !pda_acc.is_writable && pda_acc.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }

    let rent_sysvar = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;

    let (lottery_pubkey, lottery_bump) = LotteryAccount::get_lottery_pubkey(program_id);
    if !LotteryAccount::check_pubkey(program_id, pda_acc.key) {
        return Err(ProgramError::InvalidArgument);
    }

    msg!("Pda acc data before {:?}", &pda_acc.data.borrow());

    // if data is empty, we need to create PDA account first
    if pda_acc.data_is_empty() {
        msg!("PDA data is empty! Creating PDA account!");
        let space: u64 = calculate_lottery_account_size(max_participants);
        let rent = &Rent::from_account_info(rent_sysvar)?;
        let lamports = rent.minimum_balance(space as usize);
        let signer_seeds: &[&[_]] = &[LOTTERY_SEED.as_bytes(), &[lottery_bump]];

        msg!("Required space for account is {}", space);

        invoke_signed(
            &system_instruction::create_account(
                main_acc.key,
                &lottery_pubkey,
                lamports,
                space,
                program_id
            ), 
            &[main_acc.clone(), pda_acc.clone(), system_program.clone()], 
            &[&signer_seeds]
        )?;
    }

    msg!("Pda acc data after {:?}", &pda_acc.data.borrow());

    let mut lottery_account = deserialize(&pda_acc.data.borrow()).unwrap();

    let lifecycle_check = check_lottery_lifecycle(0, Option::Some(&lottery_account));
    if lifecycle_check.is_err() {
        // return lifecycle_check;
    }

    msg!("Lottery account state before initializing: {:?}", lottery_account);

    let new_participants_map: HashMap<Pubkey, u64> = HashMap::new();
    lottery_account.winner = DEFAULT_WINNER_KEY;
    lottery_account.participants = new_participants_map;

    if lottery_account.max_participants != max_participants {
        lottery_account.max_participants = max_participants;
    }

    lottery_account.lottery_state = LotteryState::IN_PROGRESS;
    lottery_account.lottery_start = unix_timestamp;

    msg!("Lottery account state after initializing: {:?}", lottery_account);

    lottery_account.serialize(&mut &mut pda_acc.data.borrow_mut()[..])?;

    Ok(())
}

/// Accounts expected:
/// 0. `[signer, writable]` Debit lamports from this account
/// 1. `[writable]` Credit lamports to this account, must be PDA account
/// 2. `[]` System program
pub fn handle_donate_instruction(program_id: &Pubkey, accounts: &[AccountInfo], lamports_amount: u64) -> ProgramResult {
    msg!("Executing donate instruction!");

    let accounts_iter = &mut accounts.iter();

    let participant_acc = next_account_info(accounts_iter)?;
    // checking donater account
    if !participant_acc.is_writable && !participant_acc.is_signer {
        return Err(ProgramError::InvalidAccountData);
    }

    msg!("Participant pubkey: {:?}", participant_acc.key);

    let pda_acc = next_account_info(accounts_iter)?;
    // checking pda account
    if !pda_acc.is_writable && pda_acc.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }

    // checking if it's still available to donate sol
    // let lottery_availability = check_for_lottery_availability(pda_acc);
    // if !lottery_availability.is_ok() {
    //     return lottery_availability;
    // }

    invoke(
        &transfer(participant_acc.key, pda_acc.key, lamports_amount),
        &[participant_acc.clone(), pda_acc.clone()],
    )?; 

    msg!("transfer {} lamports from {:?} to PDA {:?}: done", lamports_amount, participant_acc.key, pda_acc.key);

    Ok(())
}

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

    let mut lottery_account = deserialize(&pda_acc.data.borrow()).unwrap();

    let lifecycle_check = check_lottery_lifecycle(1, Option::Some(&lottery_account));
    if lifecycle_check.is_err() {
        return lifecycle_check;
    }

    // checking whether this user has already donated 
    if lottery_account.participants.contains_key(participant_acc.key) {
        let amount_donated = lottery_account.participants[participant_acc.key] + lamports_amount;
        msg!("This user has already donated {:?} amount of SOL, total sum for him is {:?}", lottery_account.participants[participant_acc.key], amount_donated);
        lottery_account.participants.insert(participant_acc.key.clone(), amount_donated);
    } else {
        msg!("This user hasn't donated yet, his bet is {:?} SOL", lamports_amount);
        lottery_account.participants.insert(participant_acc.key.clone(), lamports_amount);

        // if overall amount of users >= max_participants, change lottery state
        if lottery_account.participants.len() as u32 >= lottery_account.max_participants {
            lottery_account.lottery_state = LotteryState::BETS_CLOSED;
        }
    }

    msg!("Participants after update: {:?}", lottery_account.participants);

    lottery_account.serialize(&mut &mut pda_acc.data.borrow_mut()[..])?;

    Ok(())
}

/// Accounts expected:
/// 0. `[signer, writable]` Main account, owner of program
/// 1. `[writable]` PDA account to transfer lamports from
/// 2. `[writable]` Winner account, credit lamports here
/// 3. `[]` System program
pub fn complete_lottery(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    msg!("Executing complete lottery instruction!");

    let accounts_iter = &mut accounts.iter();

    let main_acc = next_account_info(accounts_iter)?;
    // checking main account
    if !main_acc.is_signer {
        return Err(ProgramError::InvalidAccountData);
    }

    let pda_acc = next_account_info(accounts_iter)?;
    // checking pda account
    if !pda_acc.is_writable && pda_acc.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }

    let mut lottery_account = deserialize(&pda_acc.data.borrow()).unwrap();

    let lifecycle_check = check_lottery_lifecycle(3, Option::Some(&lottery_account));
    if lifecycle_check.is_err() {
        return lifecycle_check;
    }

    // if complete lottery instruction was called before launch lottery or winner wasn't chosen
    if lottery_account.winner == DEFAULT_WINNER_KEY {
        return Err(ProgramError::InvalidAccountData);
    }

    let winner_acc = next_account_info(accounts_iter)?;
    // checking winner account
    if !winner_acc.is_writable || (winner_acc.key.clone() != lottery_account.winner) {
        return Err(ProgramError::InvalidAccountData);
    }

    lottery_account.lottery_state = LotteryState::COMPLETED;

    if calculate_overall_donations(&lottery_account).is_none() {
        return Err(ProgramError::Custom(200));
    }

    let overall_donations = calculate_overall_donations(&lottery_account).unwrap();
    let fee: u64 = ((overall_donations as f64) * 0.01) as u64;
    msg!("Overall lottery donations are {}", overall_donations);

    msg!("Calculated fee is {}", fee);
    let winner_lamports = overall_donations - fee;

    if !LotteryAccount::check_pubkey(program_id, pda_acc.key) {
        return Err(ProgramError::InvalidArgument);
    }

    // transfer lamports to winner account
    if **pda_acc.try_borrow_lamports()? < winner_lamports {
        return Err(ProgramError::InsufficientFunds);
    }

    **pda_acc.try_borrow_mut_lamports()? -= winner_lamports;
    **winner_acc.try_borrow_mut_lamports()? += winner_lamports;

    msg!("Transfered winner payment from: {:?} to: {:?}", pda_acc.key, winner_acc.key);

    // transfer fees to main account
    if **pda_acc.try_borrow_lamports()? < fee {
        return Err(ProgramError::InsufficientFunds);
    }

    **pda_acc.try_borrow_mut_lamports()? -= fee;
    **main_acc.try_borrow_mut_lamports()? += fee;

    msg!("Transfered fee payment from: {:?} to: {:?}", pda_acc.key, main_acc.key);
    msg!("Lottery account after changing state {:?}", lottery_account);

    lottery_account.serialize(&mut &mut pda_acc.data.borrow_mut()[..])?;

    Ok(())
}

/// Accounts expected:
/// 0. `[signer]` Main account, owner of program
/// 1. `[writable]` PDA account to transfer lamports from
/// 2. `[]` System program
pub fn launch_lottery(program_id: &Pubkey, accounts: &[AccountInfo], hashes: Vec<u8>) -> ProgramResult {
    msg!("Executing launch lottery instruction!");

    let accounts_iter = &mut accounts.iter();

    let main_acc = next_account_info(accounts_iter)?;
    // checking main account
    if !main_acc.is_signer {
        return Err(ProgramError::InvalidAccountData);
    }

    let pda_acc = next_account_info(accounts_iter)?;
    // checking pda account
    if !pda_acc.is_writable && pda_acc.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }

    msg!("Recieved hash string {:?}", hashes);

    let mut lottery_account = deserialize(&pda_acc.data.borrow()).unwrap();

    let lifecycle_check = check_lottery_lifecycle(2, Option::Some(&lottery_account));
    if lifecycle_check.is_err() {
        return lifecycle_check;
    }

    let winner_num: usize = calculate_random_number(&hashes, lottery_account.participants.len().try_into().unwrap());

    msg!("Winner index is {}", winner_num);
    let participants_pubkeys: Vec<Pubkey> = lottery_account.participants
                                    .clone()
                                    .into_iter()
                                    .map(|(pubkey, _)| pubkey)
                                    .collect();
    let winner_pubkey = participants_pubkeys.get(winner_num);
    if winner_pubkey.is_some() {
        lottery_account.winner = winner_pubkey.unwrap().clone();
        lottery_account.lottery_state = LotteryState::LAUCNHED;
        msg!("Winner pubkey is {:?}", lottery_account.winner);
    };

    msg!("Lottery account after changing state {:?}", lottery_account);

    lottery_account.serialize(&mut &mut pda_acc.data.borrow_mut()[..])?;

    Ok(())
}