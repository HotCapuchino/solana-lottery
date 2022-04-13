import { lifecycle } from "./lifecycle";
import { testSerialization } from "./state";
import { getConfig, writeLogs } from "./utils";
import path from 'path';
import os from 'os';


async function main() {
    await lifecycle.establishConnection();

    await lifecycle.establishPayer();

    await lifecycle.checkProgramWasDeployed();

    // lifecycle.checkTimeOrParticipants().then(async () => {
    //     await lifecycle.launchLottery();
    // }).catch(() => {
    //     writeLogs("No need to launch lottery!");
    // });
}

try {
    const buf = testSerialization();
    console.log(buf.buffer);
    // getConfig(path.resolve(
    //     os.homedir(),
    //     '.config', 
    //     'solana', 
    //     'cli',
    //     'lottery', 
    //     'config.yml'
    // )).then((obj) => console.log(obj));
} catch (e) {
    console.log('error is ', e);
}

// main().then(() => {
//     writeLogs("Script was successfully finished");
//     process.exit();
// }).catch((e: Error) => {
//     writeLogs("Error occured during script execution!", e);
//     process.exit(-1);
// });