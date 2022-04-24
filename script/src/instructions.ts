import {serialize} from 'borsh';
import moment from 'moment';

class Instruction {
    code: number;

    constructor(code?: number) {
        this.code = code !== null ? code : 0;
    }

    static instructionSchema = new Map([
      [Instruction, { kind: 'struct', fields: [['code', 'u8']] }]
    ]);
}

class StartLotteryInstruction extends Instruction {
  max_participants: number;
  unix_timestamp: number;

  constructor(max_participants: number) {
    super(0);
    this.max_participants = max_participants;
    this.unix_timestamp = moment().unix();
  }

  static startLotterySerializationSchema = new Map([
    [
      StartLotteryInstruction,
      {
        kind: 'struct',
        fields: [
          ['code', 'u8'],
          ['max_participants', 'u32'],
          ['unix_timestamp', 'u64']
        ]
      }
    ]
  ]);
}

class LaunchLotteryInstruction extends Instruction {
  hashes: string;

  constructor(hashes: string) {
    super(2);
    this.hashes = hashes;
  }

  static launchLotteryInstructionSchema = new Map([
    [
      LaunchLotteryInstruction, 
      {
        kind: 'struct', 
        fields: [
          ['code', 'u8'],
          ['hashes', 'string']
        ]
      }
    ]
  ]);
}

class DonateInstruction extends Instruction {
  amount: number;

  constructor(amount: number) {
    super(1);
    this.amount = amount;
  }

  static donateInstructionSchema = new Map([
    [
      DonateInstruction,
      {
        kind: 'struct',
        fields: [
          ['code', 'u8'],
          ['amount', 'u64']
        ]
      }
    ]
  ]);
}

/**
 * Creating Launch Lottery Instruction
 * @param hashes - list with recent blockhashes
 * @returns - buffered transaction data
 */
export function createLaunchLotteryInstruction(hashes: string | string[]): Buffer {
  if (typeof hashes !== 'string') {
    hashes = hashes.join('');
  }
  console.log(`result hash string is ${hashes}`)
  const launchLotteryInstruction = new LaunchLotteryInstruction(hashes);
  const serialized = serialize(LaunchLotteryInstruction.launchLotteryInstructionSchema, launchLotteryInstruction);
  return Buffer.from(serialized);
}

/**
 * Creating Start Lottery Instruction
 * @param max_participants - max amount of lottery participants
 * @returns - buffered transaction data
 */
export function createStartLotteryInstruction(max_participants: number): Buffer {
  const startLotteryInstruction = new StartLotteryInstruction(max_participants);
  const serialized = serialize(StartLotteryInstruction.startLotterySerializationSchema, startLotteryInstruction);
  return Buffer.from(serialized);
}

/**
 * Creating test Donation Lottery Instruction
 * @param amount - amount of lamports to be donated
 * @returns - buffered transaction data
 */
export function createDonateInstruction(amount: number): Buffer {
  const donateInstruction = new DonateInstruction(amount);
  const serialized = serialize(DonateInstruction.donateInstructionSchema, donateInstruction);
  return Buffer.from(serialized);
}

/**
 * Creating Complete Lottery Instruction
 * @returns buffered transaction data
 */
export function createCompleteLotteryInstruction(): Buffer {
  const completeInstruction = new Instruction(3);
  const serialized = serialize(Instruction.instructionSchema, completeInstruction);
  return Buffer.from(serialized);
}