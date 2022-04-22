import {
    Keypair,
    Connection,
    PublicKey,
    SystemProgram,
    TransactionInstruction,
    Transaction,
    sendAndConfirmTransaction,
    LAMPORTS_PER_SOL,
    SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import path from 'path';
import os from 'os';
import { getPayer, getRpcUrl, getSizeOfAccount, writeLogs, createKeypairFromFile, getConfig, getLastBlockHashes } from './utils';
import {deserializeUnchecked} from 'borsh';
import { fs } from 'mz';
import { LotteryState, LotteryStruct, serializingSchema } from './state';
import { BorshError } from 'borsh';
import moment from 'moment';
import { createDonateInstruction, createLaunchLotteryInstruction, createStartLotteryInstruction } from './instructions';
import {BN} from 'bn.js';

interface AccountConfig {
  max_participants: number;
  lottery_duration: number;
  blockhases_num: number;
}

class LifeCycle {

    private connection: Connection | null = null;
    private payer: Keypair | null = null;
    private programId: PublicKey | null = null;
    private lotteryPubkey: PublicKey | null = null;
    private PROGRAM_DIRECTORY_PATH = path.resolve(__dirname, '../../program/dist/program');
    private PROGRAM_PATH = path.resolve(this.PROGRAM_DIRECTORY_PATH, 'lottery.so');
    public PROGRAM_KEYPAIR_PATH = path.resolve(this.PROGRAM_DIRECTORY_PATH, 'lottery-keypair.json');
    private CONFIG_DIRECTORY_PATH = path.resolve(
        os.homedir(),
        '.config', 
        'solana', 
        'cli'
    );
    public CONFIG_FILE_PATH = path.resolve(this.CONFIG_DIRECTORY_PATH, 'config.yml');
    private LOTTERY_CONFIG_PATH = path.resolve(this.CONFIG_DIRECTORY_PATH, 'lottery', 'config.yml');
    private LOTTERY_SEED = "lottery";
    private accountSize: number | null = null;
    private accountConfig: AccountConfig | null = null;

    /**
     * Establishing connection with RPC cluster
     */
    async establishConnection(): Promise<void> {
      debugger;
      const rpcUrl = await getRpcUrl(this.CONFIG_FILE_PATH);
      this.connection = new Connection(rpcUrl, 'confirmed');
      try {
          const version = await this.connection.getVersion();
          writeLogs(`Connection to solana RPC cluster successfully established\n RPC URL: ${rpcUrl}, cluster version: ${version['solana-core']}}`)
      } catch(e) {
          throw new Error("Solana cluster version exception: " + e?.message)
      }
    }

    /**
     * Establishing the account of payer
     */
    async establishPayer(): Promise<void> {
      let fees = 0;
      const {feeCalculator} = await this.connection.getRecentBlockhash();
  
      try {
        this.accountConfig = await (getConfig(this.LOTTERY_CONFIG_PATH)) as unknown as AccountConfig;
      } catch(e) {
        throw new Error('Invalid config for lottery account! Make sure config have following fields:\nmax_participants of type number\nlottery_duration of type number\nblockhashes_num of type number');
      }

      this.accountSize = await getSizeOfAccount(this.LOTTERY_CONFIG_PATH);
      writeLogs(`ACCOUNT SIZE: ${this.accountSize}`);

      if (!this.payer) {
        // Calculating min amount of lamports for the payer in order to account be rent exempt
        fees += await this.connection.getMinimumBalanceForRentExemption(this.accountSize);
        // Adding cost of transaction
        fees += feeCalculator.lamportsPerSignature * 100; // wage
  
        this.payer = await getPayer(this.CONFIG_FILE_PATH);
      }
  
      // Only on localhost or testnet!!!
      let lamports = await this.connection.getBalance(this.payer.publicKey);
      if (lamports < fees) {
          // Request airdrop in case if there are not enough lamports
          const airdrop = await this.connection.requestAirdrop(
              this.payer.publicKey,
              fees - lamports,
          );
          await this.connection.confirmTransaction(airdrop);
          lamports = await this.connection.getBalance(this.payer.publicKey);
      }
  
      writeLogs(`Using account: ${this.payer.publicKey.toBase58()} that has ${lamports / LAMPORTS_PER_SOL} SOL locked`);
    }

    /**
     * Checking whether program was actually deployed
     */
    async checkProgramWasDeployed(): Promise<void> {
    // Writing program data from file
      try {
        const programKeypair = await createKeypairFromFile(this.PROGRAM_KEYPAIR_PATH);
        this.programId = programKeypair.publicKey;
      } catch (err) {
        const errMsg = (err as Error).message;
        throw new Error(`Failed to read program keypair at '${this.PROGRAM_KEYPAIR_PATH}' due to error: ${errMsg}!`);
      }
    
      // Checking if program was deployed
      const programInfo = await this.connection.getAccountInfo(this.programId);
      if (programInfo === null) {
        if (fs.existsSync(this.PROGRAM_PATH)) {
          throw new Error(`Program needs to be deployed with: solana program deploy ${this.PROGRAM_PATH}`);
        } else {
          throw new Error('Program needs to be built and deployed');
        }
      } else if (!programInfo.executable) {
        throw new Error(`Program is not executable`);
      }
      writeLogs(`Using program ${this.programId.toBase58()}`);

      // Searching valid PDA key from lottery account
      this.lotteryPubkey = (await PublicKey.findProgramAddress([Buffer.from(this.LOTTERY_SEED, 'utf-8')], this.programId))[0];
    
      // Checking whether PDA account was created earlier
      const lotteryAccount = await this.connection.getAccountInfo(this.lotteryPubkey);

      if (lotteryAccount === null) {
        writeLogs(`Creating account ${this.lotteryPubkey.toBase58()}`);
        await this.startLottery();
      } else {
        const lotteryAccount = await this.getLotteryAccount();

        if (lotteryAccount) {
          if (lotteryAccount.lottery_state === LotteryState.COMPLETED) {
            // we have to start lottery
            await this.startLottery();
          } else {
            writeLogs('No need to start lottery!');
          }
        }
      }
    }

    /**
     * Getting Lottery Account data
     * @returns Promise with Lottery Account data
     */
    private async getLotteryAccount(): Promise<LotteryStruct> {
      try {
        const bytes = await this.connection.getAccountInfo(this.lotteryPubkey);
        if (!bytes) {
          throw new Error(`Unable to fetch account info for ${this.lotteryPubkey} public key`);
        }
        // unchecked deserialization, because map structure can have various length
        const lotteryAccount = deserializeUnchecked(serializingSchema, LotteryStruct, bytes.data);
        return lotteryAccount;
      } catch (e) {
        if (e instanceof BorshError) {
          throw new Error(`Error with deserializing struct! ${e}`);
        } else {
          throw e;
        }
      }
    }

    /**
     * Checking whether lottery reached max amount of participants or its time is up
     */
    async checkTimeOrParticipants(): Promise<void> {
      const lotteryAccount = await this.getLotteryAccount();

      const isMaxAmountOfParticipantas = lotteryAccount.participants.size >= lotteryAccount.max_participants;
      const isTimeUp = new BN(lotteryAccount.lottery_start).toNumber() + this.accountConfig.lottery_duration * 1000 <= moment().unix();
      console.log('max participants:', isMaxAmountOfParticipantas);
      console.log('lottery start:', isTimeUp);
      if (isMaxAmountOfParticipantas || isTimeUp) {
        // we have to launch loterry
        await this.launchLottery();
        return Promise.resolve();
      } else {
        return Promise.reject();
      }
    }

    /**
     * Launching process of choosing winner of lottery
     */
    async launchLottery(): Promise<void> {
      const blockhashes = await getLastBlockHashes(this.connection, this.accountConfig.blockhases_num);
      const instructionData = createLaunchLotteryInstruction(blockhashes);
      const instruction = new TransactionInstruction({
        keys: [
          {pubkey: this.payer.publicKey, isSigner: true, isWritable: false},
          {pubkey: this.lotteryPubkey, isSigner: false, isWritable: true}
        ],
        programId: this.programId,
        data: instructionData,
      });
      
      return sendAndConfirmTransaction(this.connection, new Transaction().add(instruction), [this.payer], {commitment: "confirmed"})
        .then(() => {
          // Start checking if winner was chosen
          const intervalID = setInterval(async () => {
            const lotteryAccount = await this.getLotteryAccount();

            if (lotteryAccount.winner && lotteryAccount.lottery_state === LotteryState.LAUCNHED) {
              clearInterval(intervalID);
              await this.completeLottery(lotteryAccount.winner);
            }
          }, 1000);
        });
    }

    /**
     * Finishing lottery and transfer lamports from PDA account to winner account
     * @param lotteryWinner - Public key of lottery winner
     */
    private async completeLottery(lotteryWinner: Uint8Array): Promise<void> {
      const instruction = new TransactionInstruction({
        keys: [
          {pubkey: this.payer.publicKey, isSigner: true, isWritable: false},
          {pubkey: this.lotteryPubkey, isSigner: false, isWritable: true},
          {pubkey: new PublicKey(lotteryWinner), isSigner: false, isWritable: true},
          {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
        ],
        programId: this.programId,
      });

      await sendAndConfirmTransaction(this.connection, new Transaction().add(instruction), [this.payer]);
      writeLogs('Complete lottery transaction was completed');
      const lotteryAccount = await this.getLotteryAccount();
      writeLogs(`Lottery account after start lottery transaction: ${lotteryAccount}`);
    }

    /**
     * Initialiaing Lottery Account
     */
    private async startLottery(): Promise<void> {
      const instructionData = createStartLotteryInstruction(this.accountConfig.max_participants);
      const instruction = new TransactionInstruction({
        programId: this.programId,
        keys: [
          {pubkey: this.payer.publicKey, isSigner: true, isWritable: false},
          {pubkey: this.lotteryPubkey, isSigner: false, isWritable: true},
          {pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false},
          {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
        ],
        data: instructionData
      });

      await sendAndConfirmTransaction(this.connection, new Transaction().add(instruction), [this.payer]);

      console.log('Start lottery transaction was completed');
      const lotteryAccount = await this.getLotteryAccount();
      console.log(`Lottery account after start lottery transaction: ${lotteryAccount}`);
    }

    /**
     * Only for test purposes
     * Performing donation from 4 participants: alice, bob, cassy and duke
     */
    async testDonateInstruction(): Promise<void> {
      const PARTICIPANTS_KEYPAIRS_DIR = path.resolve(__dirname, '../../program/localnet');
      const filenames = fs.readdirSync(PARTICIPANTS_KEYPAIRS_DIR);
      const participants: Keypair[] = [];
      
      for (const filename of filenames) {
        const participant = await createKeypairFromFile(path.resolve(PARTICIPANTS_KEYPAIRS_DIR, filename));
        participants.push(participant);
      }

      const instructions: TransactionInstruction[] = [];
      for (const participant of participants) {
        const airdrop = await this.connection.requestAirdrop(participant.publicKey, LAMPORTS_PER_SOL * 2);
        await this.connection.confirmTransaction(airdrop);

        instructions.push(
          new TransactionInstruction({
            programId: this.programId,
            keys: [
              {pubkey: participant.publicKey, isSigner: true, isWritable: true},
              {pubkey: this.lotteryPubkey, isSigner: false, isWritable: true},
              {pubkey: SystemProgram.programId, isSigner: false, isWritable: false}
            ],
            data: createDonateInstruction(LAMPORTS_PER_SOL)
          })
        );
      }

      for (let i = 0; i < instructions.length; i++) {
        await sendAndConfirmTransaction(this.connection, new Transaction().add(instructions[i]), [participants[i]]);
        console.log(`Donation from ${participants[i].publicKey} accepted!`);
      }

      const lottery_account = await this.getLotteryAccount();
      console.log('lottery account after donation instructions:', lottery_account);

      const totalInfo = await this.connection.getAccountInfo(this.lotteryPubkey);
      console.log('total account info:', totalInfo);
    }
}

const lifecycle = new LifeCycle();

export {lifecycle};