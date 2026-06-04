import {
    getMint,
    getOrCreateAssociatedTokenAccount,
    mintTo,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { getConnection } from "./utils/get-rpc";
import { getKeypair } from "./utils/get-keypair";
import { DECIMALS } from "./utils/constants";


function printUsage() {
    console.error(
        "Usage: npx tsx mint-token.ts <mint-address> <recipient-address> <amount>"
    );
    console.error("  amount: human-readable token amount (up to 6 decimal places)");
    process.exit(1);
}

function parseHumanAmount(amountStr: string, mintDecimals: number): bigint {
    if (!/^\d+(\.\d+)?$/.test(amountStr)) {
        throw new Error(`Invalid amount: ${amountStr}`);
    }

    const [whole, fraction = ""] = amountStr.split(".");
    if (fraction.length > DECIMALS) {
        throw new Error(
            `Amount can have at most ${DECIMALS} decimal places`
        );
    }
    if (fraction.length > mintDecimals) {
        throw new Error(
            `Amount has more decimal places than the mint supports (${mintDecimals})`
        );
    }

    const paddedFraction = fraction.padEnd(mintDecimals, "0");
    return BigInt(whole + paddedFraction);
}

async function main(): Promise<void> {
    const [, , mintAddress, recipientAddress, amountStr] = process.argv;

    if (!mintAddress || !recipientAddress || !amountStr) {
        printUsage();
    }

    const payer = getKeypair();
    const connection = getConnection("devnet");
    const mint = new PublicKey(mintAddress);
    const recipient = new PublicKey(recipientAddress);

    const mintInfo = await getMint(connection, mint, undefined, TOKEN_PROGRAM_ID);
    const rawAmount = parseHumanAmount(amountStr, mintInfo.decimals);

    if (rawAmount <= 0n) {
        throw new Error("Amount must be greater than zero");
    }

    console.log(`Minting ${amountStr} to ${recipientAddress}...`);
    console.log(`  Mint: ${mintAddress}`);
    console.log(`  Decimals: ${mintInfo.decimals}`);
    console.log(`  Raw amount: ${rawAmount}`);

    const tokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        recipient,
        false,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
    );

    const signature = await mintTo(
        connection,
        payer,
        mint,
        tokenAccount.address,
        payer,
        rawAmount,
        [],
        undefined,
        TOKEN_PROGRAM_ID
    );

    console.log(`  ATA: ${tokenAccount.address.toBase58()}`);
    console.log(`  Signature: ${signature}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
