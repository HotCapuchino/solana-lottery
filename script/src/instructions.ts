import {deserialize, serialize} from 'borsh';
import moment from 'moment';
// export interface InstructionStruct<T> {
//     instructionCode: number,
//     data?: T
// };

class Instruction {
    code: number;

    constructor(code?: number) {
        this.code = code !== null ? code : 0;
    }
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

export function createLaunchLotteryInstruction(hashes: string | string[]): Buffer {
  if (typeof hashes !== 'string') {
    hashes = hashes.join('');
  }
  const launchLotteryInstruction = new LaunchLotteryInstruction(hashes);
  const serialized = serialize(LaunchLotteryInstruction.launchLotteryInstructionSchema, launchLotteryInstruction);
  return Buffer.from(serialized);
}

export function createStartLotteryInstruction(max_participants: number): Buffer {
  const startLotteryInstruction = new StartLotteryInstruction(max_participants);
  const serialized = serialize(StartLotteryInstruction.startLotterySerializationSchema, startLotteryInstruction);
  return Buffer.from(serialized);
}

export function createDonateInstruction(amount: number): Buffer {
  const donateInstruction = new DonateInstruction(amount);
  const serialized = serialize(DonateInstruction.donateInstructionSchema, donateInstruction);
  return Buffer.from(serialized);
}