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
import { getPayer, getRpcUrl, getSizeOfAccount, writeLogs, createKeypairFromFile, getConfig, startFetchingLastBlockHashes } from './utils';
import {deserializeUnchecked} from 'borsh';
import { fs } from 'mz';
import { LotteryState, LotteryStruct, serializingSchema } from './state';
import { BorshError } from 'borsh';
import moment from 'moment';
import { createCompleteLotteryInstruction, createDonateInstruction, createLaunchLotteryInstruction, createStartLotteryInstruction } from './instructions';
import {BN} from 'bn.js';
import { clearInterval } from 'timers';
import {eventEmitter} from './eventsHandler';

interface AccountConfig {
  max_participants: number;
  lottery_duration: number;
  blockhashes_num: number;
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
    private DEFAULT_WINNER_PUBLICKEY = Uint8Array.from(Array(32).fill(0));

    constructor() {
      this.asyncLotteryCallback.bind(this);
    }

    /**
     * Establishing connection with RPC cluster
     */
    async establishConnection(): Promise<void> {
      debugger;
      const rpcUrl = await getRpcUrl(this.CONFIG_FILE_PATH);
      this.connection = new Connection(rpcUrl, 'confirmed');
      try {
          const version = await this.connection.getVersion();
          // writeLogs(`Connection to solana RPC cluster successfully established\n RPC URL: ${rpcUrl}, cluster version: ${version['solana-core']}}`)
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
        console.log('account config')
      } catch(e) {
        throw new Error('Invalid config for lottery account! Make sure config have following fields:\nmax_participants of type number\nlottery_duration of type number\nblockhashes_num of type number');
      }

      this.accountSize = await getSizeOfAccount(this.LOTTERY_CONFIG_PATH);
      // writeLogs(`ACCOUNT SIZE: ${this.accountSize}`);

      // Calculating min amount of lamports for the payer in order to account be rent exempt
      fees += await this.connection.getMinimumBalanceForRentExemption(this.accountSize);
      // Adding cost of transaction
      fees += feeCalculator.lamportsPerSignature * 100; // wage

      this.payer = await getPayer(this.CONFIG_FILE_PATH);
      console.log('payer', this.payer);
  
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
  
      // writeLogs(`Using account: ${this.payer.publicKey.toBase58()} that has ${lamports / LAMPORTS_PER_SOL} SOL locked`);
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
      // writeLogs(`Using program ${this.programId.toBase58()}`);

      // Searching valid PDA key from lottery account
      this.lotteryPubkey = (await PublicKey.findProgramAddress([Buffer.from(this.LOTTERY_SEED, 'utf-8')], this.programId))[0];
    
      // Checking whether PDA account was created earlier
      const lotteryAccount = await this.connection.getAccountInfo(this.lotteryPubkey);

      if (lotteryAccount === null) {
        // writeLogs(`Creating account ${this.lotteryPubkey.toBase58()}`);
        await this.startLottery();
      } else {
        const lotteryAccount = await this.getLotteryAccount();

        if (lotteryAccount) {
          console.log('lottery account is:', lotteryAccount.lottery_state);
          console.log('default winner', new PublicKey(this.DEFAULT_WINNER_PUBLICKEY).toBase58());
          console.log('lottery winner', new PublicKey(lotteryAccount.winner).toBase58());
          console.log('equals:', new PublicKey(lotteryAccount.winner).toBase58() === new PublicKey(this.DEFAULT_WINNER_PUBLICKEY).toBase58());
          if (lotteryAccount.lottery_state === LotteryState.COMPLETED || new PublicKey(lotteryAccount.winner).toBase58() !== new PublicKey(this.DEFAULT_WINNER_PUBLICKEY).toBase58()) {
            // we have to start lottery all over again
            writeLogs('Starting lottery again...');
            return await this.startLottery();
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
      const isTimeUp = new BN(lotteryAccount.lottery_start).toNumber() + this.accountConfig.lottery_duration <= moment().unix();

      if (isMaxAmountOfParticipantas || isTimeUp) {
        // we have to launch loterry
        return Promise.resolve();
      } else {
        return Promise.reject();
      }
    }

    /**
     * Event listener, emits after Nth amount of blockhashes recieved
     * @param eventObject - event object
     */
    private asyncLotteryCallback(eventObject: {blockhashes: string[]}): void {
      console.log("fetched blockhashes are", eventObject.blockhashes);

      const instructionData = createLaunchLotteryInstruction(eventObject.blockhashes);
      const instruction = new TransactionInstruction({
        keys: [
          {pubkey: this.payer.publicKey, isSigner: true, isWritable: false},
          {pubkey: this.lotteryPubkey, isSigner: false, isWritable: true}
        ],
        programId: this.programId,
        data: instructionData,
      });

      console.log("Executing launch lottery instruction, data is", instruction);

      sendAndConfirmTransaction(this.connection, new Transaction().add(instruction), [this.payer], {commitment: "confirmed"})
        .then(() => {
          // Start checking if winner was chosen
          const intervalID = setInterval(async () => {
            const lotteryAccount = await this.getLotteryAccount();
            console.log('lotteryAccount', lotteryAccount);

            if (lotteryAccount.winner !== this.DEFAULT_WINNER_PUBLICKEY && lotteryAccount.lottery_state === LotteryState.LAUCNHED) {
              clearInterval(intervalID);
              const winnerPubkey = new PublicKey(lotteryAccount.winner);
              // firing complete lottery event
              eventEmitter.emitCompleteLotteryEvent({winner: winnerPubkey});
            }
          }, 1000);

          // listen for complete lottery event to be fired
          eventEmitter.onCompleteLotteryEvent(this.completeLottery.bind(this), intervalID);
      }); 

      console.log("Launch lottery was executed");
    }

    /**
     * Launching process of choosing winner of lottery
     */
    async launchLottery(): Promise<void> {
      const lotteryAccount = await this.getLotteryAccount();

      if (lotteryAccount.lottery_state === LotteryState.LAUCNHED) {
        this.completeLottery({winner: new PublicKey(lotteryAccount.winner)});
      } else {
        console.log('amount of blockhashes required:', this.accountConfig.blockhashes_num);
        const intervalID = startFetchingLastBlockHashes(this.connection, this.accountConfig.blockhashes_num);
  
        // listen for blockhashes event to be fired
        eventEmitter.onBlockHashesEvent(this.asyncLotteryCallback.bind(this), intervalID);
      }
    }

    /**
     * Finishing lottery and transfer lamports from PDA account to winner account
     * @param lotteryWinner - Public key of lottery winner
     */
    private completeLottery(eventObject: {winner: PublicKey}): void {
      console.log('winner pubkey is', eventObject.winner.toBase58());
      const instructionData = createCompleteLotteryInstruction();
      const instruction = new TransactionInstruction({
        keys: [
          {pubkey: this.payer.publicKey, isSigner: true, isWritable: false},
          {pubkey: this.lotteryPubkey, isSigner: false, isWritable: true},
          {pubkey: eventObject.winner, isSigner: false, isWritable: true},
          {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
        ],
        programId: this.programId,
        data: instructionData,
      });

      sendAndConfirmTransaction(this.connection, new Transaction().add(instruction), [this.payer])
      .then(() => {
        writeLogs('Complete lottery transaction was completed');
        this.getLotteryAccount()
        .then((lotteryAccount) => {
          console.log('Lottery account after start lottery transaction:', lotteryAccount);
          // writeLogs('Lottery account after start lottery transaction:',);
        }).finally(() => {
          process.exit();
        });
      });
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

      try {
        await sendAndConfirmTransaction(this.connection, new Transaction().add(instruction), [this.payer]);
      } catch (e) {
        console.error('oops error:', e);
      };

      writeLogs('Start lottery transaction was completed');
      const lotteryAccount = await this.getLotteryAccount();
      console.log('Lottery account after start lottery transaction:', lotteryAccount);
      // writeLogs(`Lottery account after start lottery transaction: `, );
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
        try {
          await sendAndConfirmTransaction(this.connection, new Transaction().add(instructions[i]), [participants[i]]);
          console.log(`Donation from ${participants[i].publicKey} accepted!`);
        } catch (e) {
          console.error('error while donating tokens:', e);
        }
      }

      const lottery_account = await this.getLotteryAccount();
      console.log('lottery account after donation instructions:', lottery_account);

      const totalInfo = await this.connection.getAccountInfo(this.lotteryPubkey);
      console.log('total account info:', totalInfo);
    }
}

const lifecycle = new LifeCycle();

export {lifecycle};