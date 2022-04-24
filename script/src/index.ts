import moment from "moment";
import { lifecycle } from "./lifecycle";
import {  writeLogs } from "./utils";


async function main() {
    await lifecycle.establishConnection();

    await lifecycle.establishPayer();

    await lifecycle.checkProgramWasDeployed();
    
    await lifecycle.testDonateInstruction();

    lifecycle.checkTimeOrParticipants().then(async () => {
        await lifecycle.launchLottery();
    }).catch(() => {
        writeLogs("No need to launch lottery!");
        process.exit();
    });
}

main().then(() => {
    writeLogs("Script was successfully finished");
})
.catch((e: Error) => {
    writeLogs("Error occured during script execution!", e);
    process.exit(-1);
});