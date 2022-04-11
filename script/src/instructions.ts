export interface InstructionStruct {
    instructionCode: number,
    data?: number | Array<number>
};

export function createLaunchLotteryInstruction(): Buffer {
    return null;
}

export function createCompleteLotteryInstruction(): Buffer {
    return null;
}

export function createStartLotteryInstruction(): Buffer {
    return null;
}

export function createDonateInstruction(): Buffer {
    return null;
}