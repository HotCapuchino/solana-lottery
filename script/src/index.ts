import { lifecycle } from "./lifecycle";
import {  writeLogs } from "./utils";


async function main() {
    await lifecycle.establishConnection();

    await lifecycle.establishPayer();

    await lifecycle.checkProgramWasDeployed();

    lifecycle.checkTimeOrParticipants()
    .catch(() => console.log('no need to start lottery!'));

    await lifecycle.testDonateInstruction();

    // lifecycle.checkTimeOrParticipants().then(async () => {
    //     await lifecycle.launchLottery();
    // }).catch(() => {
    //     writeLogs("No need to launch lottery!");
    // });
}

main().then(() => {
    writeLogs("Script was successfully finished");
    process.exit();
})
.catch((e: Error) => {
    writeLogs("Error occured during script execution!", e);
    process.exit(-1);
});