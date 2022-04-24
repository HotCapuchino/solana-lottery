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
    max_participants: number;
    lottery_state: LotteryState;
    winner: Uint8Array;
    lottery_start: number;
    participants: Map<Uint8Array, number>
}

export class LotteryStruct {
    max_participants: number;
    lottery_state: LotteryState;
    winner: Uint8Array;
    lottery_start: number;
    participants: Map<Uint8Array, number>

    constructor({ 
          max_participants, 
          lottery_state, 
          winner,
          lottery_start,
          participants, }: LotteryStructInterface) {
        this.max_participants = max_participants;
        this.lottery_state = lottery_state;
        this.winner = winner;
        this.lottery_start = lottery_start;
        this.participants = participants;
    }
}

export const serializingSchema = new Map([
  [
    LotteryStruct,
    {
      kind: "struct",
      fields: [
        ["max_participants", "u32"], // 4 bytes
        ["lottery_state", "u8"], // 1 byte
        ["winner", ['u8', 32]], // 32 bytes
        ["lottery_start", "u64"], // 8 bytes
        ["participants", {kind: "map", key: ['u8', 32], value: "u64"}], // 40 bytes per entry(key:value) + 4 bytes capacity
        // everything except participants map takes 45 bytes in total
      ]
    }
  ]
]);

// only for test purposes
export async function testSerialization(): Promise<Uint8Array> {
  const config = await getConfig(path.resolve(
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
  console.log(buffer.byteLength);
	const deserializedStruct = deserialize<LotteryStruct>(serializingSchema, LotteryStruct, Buffer.from(buffer));
  console.log('deserialized', deserializedStruct);
  return buffer;
}