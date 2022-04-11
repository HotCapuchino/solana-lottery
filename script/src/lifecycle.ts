import {
    Keypair,
    Connection,
    PublicKey,
    LAMPORTS_PER_SOL,
    SystemProgram,
    TransactionInstruction,
    Transaction,
    sendAndConfirmTransaction,
} from '@solana/web3.js';
import path from 'path';
import os from 'os';
import { getPayer, getRpcUrl, getSizeOfAccount, writeLogs, createKeypairFromFile, getConfig, getLastBlockHashes } from './utils';
import borsh from 'borsh';
import { fs } from 'mz';
import { LotteryStruct, serializingSchema } from './state';
import { BorshError } from 'borsh';
import moment from 'moment';

interface AccountConfig {
  max_participants: number;
  lottery_duration: number;
  blockhases_num: number;
}


class LifeCycle {

    private connection: Connection;
    private payer: Keypair;
    private programId: PublicKey;
    private lotteryPubkey: PublicKey;
    private PROGRAM_DIRECTORY_PATH = path.relative(__dirname, 'program/dist/program');
    private PROGRAM_PATH = path.resolve(this.PROGRAM_DIRECTORY_PATH, 'lottery.so');
    private PROGRAM_KEYPAIR_PATH = path.resolve(this.PROGRAM_DIRECTORY_PATH, 'lottery-keypair.json');
    private CONFIG_DIRECTORY_PATH = path.resolve(
        os.homedir(),
        '.config', 
        'solana', 
        'cli'
    );
    private CONFIG_FILE_PATH = path.resolve(this.CONFIG_DIRECTORY_PATH, 'config.yml');
    private LOTTERY_CONFIG_PATH = path.resolve(this.CONFIG_DIRECTORY_PATH, 'lottery', 'config.yml');
    private LOTTERY_SEED = "lottery";
    private accountSize: number;
    private accountConfig: AccountConfig;

    /**
     * Establishing connection with RPC cluster
     */
    async establishConnection(): Promise<void> {
        const rpcUrl = await getRpcUrl(this.CONFIG_FILE_PATH);
        this.connection = new Connection(rpcUrl, 'confirmed');
        try {
            const version = await this.connection.getVersion();
            writeLogs(`Connection to solana RPC cluster successfully established\n RPC URL: ${rpcUrl}, cluster version: ${version}}`)
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
          this.accountConfig = getConfig(this.LOTTERY_CONFIG_PATH) as unknown as AccountConfig;
        } catch(e) {
          // const errorDescription = 'Invalid config for lottery account! Make sure config have following fields:';
          // for (const iterator of object) {
            
          // }
          throw new Error('Invalid config for lottery account! Make sure config have following fields:\nmax_participants of type number\nlottery_duration of type number');
        }

        this.accountSize = await getSizeOfAccount(this.LOTTERY_CONFIG_PATH);
        // Считаем минимальное значение лампортов, чтобы аккаунт был освобожден от ренты
        fees += await this.connection.getMinimumBalanceForRentExemption(this.accountSize);
        // Плюсуем стоимость транзакции внутри сети
        fees += feeCalculator.lamportsPerSignature * 100; // wage

        this.payer = await getPayer(this.CONFIG_FILE_PATH);
    
        // only on localhost or testnet!!!
        let lamports = await this.connection.getBalance(this.payer.publicKey);
        if (lamports < fees) {
            // Если недостаточно лампортов - запрашиваем эирдроп
            const airdrop = await this.connection.requestAirdrop(
                this.payer.publicKey,
                fees - lamports,
            );
            await this.connection.confirmTransaction(airdrop);
            lamports = await this.connection.getBalance(this.payer.publicKey);
        }
    
        // console.log(
        // 'Используется аккаунт: ',
        // this.payer.publicKey.toBase58(),
        // 'содержажий',
        // lamports / LAMPORTS_PER_SOL,
        // 'SOL для оплаты',
        // );
    }

    async checkProgramWasDeployed(): Promise<void> {
    // Чтение адреса программы из файла с публичным/приватным ключом
    try {
        const programKeypair = await createKeypairFromFile(this.PROGRAM_KEYPAIR_PATH);
        this.programId = programKeypair.publicKey;
      } catch (err) {
        const errMsg = (err as Error).message;
        throw new Error(`Failed to read program keypair at '${this.PROGRAM_KEYPAIR_PATH}' due to error: ${errMsg}!`);
      }
    
      // Проверка, был ли деплой программы
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
    
      /** 
       * Важный момент!
       * Тут создается публичный ключ для PDA аккаунта, в котором будет хранится состояние калькулятора
       * Аккаунт создается на основе пользователя, который заплатил за транзакцию,
       * и адреса программы. Т.е. по сути у каждого пользователя будет свой аккаунт с калькулятором???
       * Сделано для того, чтобы не приходилось создавать еще один аккаунт и записывать его публичный/приватный ключ???
       */ 
      this.lotteryPubkey = await PublicKey.createWithSeed(
        this.payer.publicKey,
        this.LOTTERY_SEED,
        this.programId,
      );
    
      // Проверка, если PDA аккаунт уже был создан
      const lotteryAccount = await this.connection.getAccountInfo(this.lotteryPubkey);
      if (lotteryAccount === null) {
        // console.log(
        //   'Creating account',
        //   loteryPubkey.toBase58(),
        //   'to say hello to',
        // );
        const lamports = await this.connection.getMinimumBalanceForRentExemption(this.accountSize);
    
        /**
         * Создаем PDA аккаунт из сгенерированного ранее публичного ключа
         */
        const transaction = new Transaction().add(
          SystemProgram.createAccountWithSeed({
            fromPubkey: this.payer.publicKey,
            basePubkey: this.payer.publicKey,
            seed: this.LOTTERY_SEED,
            newAccountPubkey: this.lotteryPubkey,
            lamports,
            space: this.accountSize,
            programId: this.programId,
          }),
        );
        await sendAndConfirmTransaction(this.connection, transaction, [this.payer]);
      }
    }


    async checkTimeOrParticipants(): Promise<void> {
      try {
        const bytes = await this.connection.getAccountInfo(this.lotteryPubkey);
        if (!bytes) {
          throw new Error(`Unable to fetch account info for ${this.lotteryPubkey} public key`);
        }
        const lotteryAccount = borsh.deserialize(serializingSchema, LotteryStruct, bytes.data);

        if (lotteryAccount.participants.size >= lotteryAccount.max_participants 
            || lotteryAccount.lottery_start + this.accountConfig.lottery_duration >= moment().unix()) {
          // we have to launch loterry
        }
      } catch (e) {
        if (e instanceof BorshError) {
          throw new Error(`Error with deserializing struct! ${e}`);
        } else {
          throw e;
        }
      }
    }

    async launchLottery(): Promise<void> {
      const blockhashes = await getLastBlockHashes(this.connection, this.accountConfig.blockhases_num);
    }

    async completeLottery(): Promise<void> {
      return null;
    }

    async startLottery(): Promise<void> {
      return null;
    }
}

const lifecycle = new LifeCycle();

export {lifecycle};