import { PublicKey } from '@solana/web3.js';
import events from 'events';
import moment from 'moment';

class CustomEventEmitter extends events.EventEmitter {
    private BLOCKHASHES_EVENT = "blockhashes";
    private COMPLETE_LOTTERY_EVENT = "complete_lottery";
    private EMITED_TIMEOUT_SEC = 60;

    emitBlockHashesEvent(eventObject: {blockhashes: string[]}): void {
        this.emit(this.BLOCKHASHES_EVENT, eventObject);
    }

    onBlockHashesEvent(listener: (eventObject: {blockhashes: string[]}) => void, intervalID: NodeJS.Timer): void {
        console.log(`listener to blockhashes event was set at ${moment().format('HH:mm')}`);
        const handleRemoveTimeoutID = (obj: any): void => {
            clearTimeout(timeoutID);
            clearInterval(intervalID);
            console.log('cleaning timeout');
        };

        const timeoutID = setTimeout(() => {
            this.off(this.BLOCKHASHES_EVENT, listener);
            this.off(this.BLOCKHASHES_EVENT, handleRemoveTimeoutID);

            clearInterval(intervalID);
            // throw Error(`Unable to get blockhashes strings!`);
        }, this.EMITED_TIMEOUT_SEC * 1000);

        this.on(this.BLOCKHASHES_EVENT, handleRemoveTimeoutID);
        this.on(this.BLOCKHASHES_EVENT, listener);
    }

    emitCompleteLotteryEvent(eventObject: {winner: PublicKey}): void {
        this.emit(this.COMPLETE_LOTTERY_EVENT, eventObject);
    }

    onCompleteLotteryEvent(listener: (eventObject: {winner: PublicKey}) => void, intervalID: NodeJS.Timer): void {
        console.log(`listener to complete lottery event was set at ${moment().format('HH:mm')}`);
        const handleRemoveTimeoutID = (): void => { 
            clearTimeout(timeoutID);
            clearInterval(intervalID);
            console.log('cleaning timeout');
        }

        const timeoutID = setTimeout(() => {
            this.off(this.COMPLETE_LOTTERY_EVENT, listener);
            this.off(this.COMPLETE_LOTTERY_EVENT, handleRemoveTimeoutID);

            clearInterval(intervalID);
            // throw Error(`Unable to complete lottery!`);
        }, this.EMITED_TIMEOUT_SEC * 1000);

        this.on(this.COMPLETE_LOTTERY_EVENT, handleRemoveTimeoutID);
        this.on(this.COMPLETE_LOTTERY_EVENT, listener);
    } 
}

const eventEmitter = new CustomEventEmitter();

export {eventEmitter};