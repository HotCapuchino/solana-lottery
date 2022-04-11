import { lifecycle } from "./lifecycle";
import { testSerialization } from "./state";
import { writeLogs } from "./utils";


async function main() {
    await lifecycle.establishConnection();

    await lifecycle.establishPayer();

    await lifecycle.checkProgramWasDeployed();

    await lifecycle.startLottery();

    await lifecycle.checkTimeOrParticipants();

    await lifecycle.launchLottery();

    await lifecycle.completeLottery();
}

try {
    const len = testSerialization();
    console.log(len);
} catch (e) {
    console.log('error is ', e);
}

// main().then(() => {
//     writeLogs("Script was successfully finished!");
//     process.exit();
// }).catch((e: Error) => {
//     writeLogs("Error occured during script execution!", e);
//     process.exit(-1);
// })