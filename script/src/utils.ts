import moment from 'moment';
import { fs } from 'mz';
import yaml from 'yaml';
import { Commitment, Connection, Keypair, PublicKey } from '@solana/web3.js';
import { InstructionStruct } from './instructions';
import { LotteryState, LotteryStruct, serializingSchema } from './state';
import {deserialize, serialize} from 'borsh';

/**
 * Logging Errors and any logic of script
 * @param message - log message
 * @param error - thrown Error
 */
export function writeLogs(message: string, error?: Error) {
    if (!error) {
        console.log(`Script succesfully finished at ${moment().format("DD.MM.YYYY HH:mm:ss")}`);
    } else {
        // write exception to the logs
    }
}

/**
 * Getting and parsing yaml config
 * @param CONFIG_FILE_PATH - path to the solana config
 * @returns parsed JS object
 */
export async function getConfig(CONFIG_FILE_PATH: string): Promise<any> {
    const configYml = await fs.readFile(CONFIG_FILE_PATH, {encoding: 'utf8'});
    if (!configYml) {
        throw Error(`Config not found at ${CONFIG_FILE_PATH}`)
    }
    return yaml.parse(configYml);
}


/**
 * @param filePath - path to the private key
 * @returns keypair(pubkey, privatekey)
 */
export async function createKeypairFromFile(filePath: string): Promise<Keypair> {
    const secretKeyString = await fs.readFile(filePath, {encoding: 'utf8'});
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    return Keypair.fromSecretKey(secretKey);
}

/**
 * Getting url of RPC cluster to connect to
 * @param CONFIG_FILE_PATH - path to the solana config
 * @returns url of RPC cluster
 */
export async function getRpcUrl(CONFIG_FILE_PATH: string): Promise<string> {
    try {
        const config = await getConfig(CONFIG_FILE_PATH);
        if (!config.json_rpc_url) throw new Error('Missing RPC URL');
        return config.json_rpc_url;
    } catch (err) {
        writeLogs('Failed to read RPC url from CLI config file, falling back to localhost', err)
        return 'http://127.0.0.1:8899';
    }
}

/**
 * 
 * @param CONFIG_FILE_PATH - path to the solana config
 * @returns keypair to the payer wallet
 */
export async function getPayer(CONFIG_FILE_PATH: string): Promise<Keypair> {
    try {
        const config = await getConfig(CONFIG_FILE_PATH);
        if (!config.keypair_path) throw new Error('Missing keypair path');
        return await createKeypairFromFile(config.keypair_path);
    } catch (err) {
        writeLogs('Failed to create keypair from CLI config file, falling back to new random keypair', err);
        return Keypair.generate();
    }
}

/**
 * Calculate size of an account to be rent exempt
 * @param CONFIG_FILE_PATH - path to lottery config file
 * @returns size of an account to create
 */
export async function getSizeOfAccount(CONFIG_FILE_PATH: string): Promise<number> {
    const lottery_config = await getConfig(CONFIG_FILE_PATH);
    let max_participants = lottery_config.max_participants || 10;
    let testMap: Map<Uint8Array, number> = new Map();

    for (let i = 0; i < max_participants; i++) {
        testMap.set(new PublicKey(i).toBytes(), i);
    }
    const testLotteryStruct = new LotteryStruct({
        participants: testMap, 
        max_participants, 
        lottery_state: LotteryState.IN_PROGRESS,
        winner: new PublicKey(42).toBytes(),
        lottery_start: moment().unix()
    });

    const serializedStruct = serialize(serializingSchema, testLotteryStruct);
    return serializedStruct.byteLength;
}

/**
 * Getting N last blockhashes from solana network
 * @param connection - connection to RPC cluster
 * @param blockhases_num - number of blockhashes to collect
 * @returns array of blockhashes
 */
export async function getLastBlockHashes(connection: Connection, blockhases_num: number): Promise<string[]> {
    const blockType: Commitment = 'finalized';
    let hashes: string[] = [];

    const intervalID = setInterval(async () => {
        if (hashes.length === blockhases_num) {
            clearInterval(intervalID);
        }
        let hash = await connection.getLatestBlockhash(blockType)
        if (!hashes.includes(hash.blockhash)) {
            hashes.push(hash.blockhash);
        }
    }, 0);

    return hashes;
}
