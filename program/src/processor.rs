use solana_program::{
    account_info::{AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey
};


use crate::instructions::LotteryInstructions;
use crate::instructions::{
    start_lottery,
    handle_donate_instruction, 
    update_main_acc_state, 
    launch_lottery, 
    complete_lottery
};


pub fn process_instruction(
    program_id: &Pubkey,      // Public key of the account the program was loaded into
    accounts: &[AccountInfo], // All accounts required to process the instruction
    instruction_data: &[u8],  // Serialized instruction-specific data
) -> ProgramResult { 
    let instruction = LotteryInstructions::unpack(instruction_data)?;

    msg!("Recieved instruction: {:?}", instruction);

    return match instruction {
        LotteryInstructions::StartLottery(max_participants, unix_timestamp) => start_lottery(program_id, accounts, max_participants, unix_timestamp),
        LotteryInstructions::DonateInstruction(lamports_amount) => {
            // first we have to accept donation
            handle_donate_instruction(program_id, accounts, lamports_amount)?;
            // then need to modify main account state, add there participant and increase amount of sols
            update_main_acc_state(program_id, accounts, lamports_amount)?;

            Ok(())
        }, 
        LotteryInstructions::LaunchLottery(hashes) => launch_lottery(program_id, accounts, hashes),
        LotteryInstructions::CompleteLottery => complete_lottery(program_id, accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    };
}