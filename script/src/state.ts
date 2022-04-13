import { PublicKey } from "@solana/web3.js";
import {deserialize, serialize} from 'borsh';
import moment from "moment";
import path from "path";
import os from 'os';
import { getConfig } from "./utils";

export enum LotteryState {
    BETS_CLOSED,
    IN_PROGRESS,
    LAUCNHED, 
    COMPLETED
}

interface AccountConfig {
  max_participants: number;
  lottery_duration: number;
  blockhases_num: number;
}

export interface LotteryStructInterface {
    participants: Map<Uint8Array, number>
    max_participants: number;
    lottery_state: LotteryState;
    winner: Uint8Array;
    lottery_start: number;
}

export class LotteryStruct {
    participants: Map<Uint8Array, number>
    max_participants: number;
    lottery_state: LotteryState;
    winner: Uint8Array;
    lottery_start: number;

    constructor({
        	participants, 
          max_participants, 
          lottery_state, 
          winner,
          lottery_start }: LotteryStructInterface) {
        this.participants = participants;
        this.max_participants = max_participants;
        this.lottery_state = lottery_state;
        this.winner = winner;
        this.lottery_start = lottery_start;
    }
}

export const serializingSchema = new Map([
  [
    LotteryStruct,
    {
      kind: "struct",
      fields: [
        ["participants", {kind: "map", key: ['u8', 32], value: "u64"}],
        ["max_participants", "u32"],
        ["lottery_state", "u8"],
        ["winner", ['u8', 32]],
        ["lottery_start", "u64"],
      ]
    }
  ]
]);

// only for test purposes
export function testSerialization(): Uint8Array {
  const config = getConfig(path.resolve(
    os.homedir(),
    '.config', 
    'solana', 
    'cli',
    'lottery', 
    'config.yml'
  )) as unknown as AccountConfig;

  
  const testMap: Map<Uint8Array, number> = new Map();  
  for (let i = 0; i < config.max_participants; i++) {
    testMap.set(new PublicKey(i * i).toBytes(), i);
  }

  const testLotteryStruct = new LotteryStruct({
                                  participants: testMap, 
                                  max_participants: config.max_participants, 
                                  lottery_state: LotteryState.IN_PROGRESS,
                                  winner: new PublicKey(12).toBytes(),
                                  lottery_start: moment().unix()
                                });
  const buffer = serialize(serializingSchema, testLotteryStruct);
	const deserializedStruct = deserialize<LotteryStruct>(serializingSchema, LotteryStruct, Buffer.from(buffer));
  // console.log(deserializedStruct.lottery_start);
  return buffer;
}
