import {
    Keypair,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

export function getKeypair(): Keypair {
    const walletPath = path.join(__dirname, "..", "dev-wallet.json");
    const secretKey = Uint8Array.from(
        JSON.parse(fs.readFileSync(walletPath, "utf-8")) as number[]
    );
    return Keypair.fromSecretKey(secretKey);
}