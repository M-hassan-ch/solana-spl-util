import { Raydium, TxVersion } from "@raydium-io/raydium-sdk-v2";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { getConnection } from "../utils/get-rpc";
import { getKeypair } from "../utils/get-keypair";
import dotenv from "dotenv";

dotenv.config();

const BASE_MINT = process.env.BASE_MINT ?? "7cfwWFgwDESjWLCQxJVJd9PZ9myVJ5nZx5Q9K7KvecWe";
const QUOTE_MINT = process.env.QUOTE_MINT ?? "8wxVQjQ994K31odPWBgDqbXJv581fMiFH9G4VLGQ6cnY";

const BASE_AMOUNT = Number(process.env.BASE_AMOUNT ?? 200_000);
const QUOTE_AMOUNT = Number(process.env.QUOTE_AMOUNT ?? 100);

async function createCpmmPool(baseMint: string, quoteMint: string, baseAmount: number, quoteAmount: number) {
    const connection = getConnection("devnet");
    const owner = getKeypair();

    // 1. Initialize Raydium Client mapped to Devnet
    const raydium = await Raydium.load({
        owner,
        connection,
        cluster: "devnet",
        // disableFeatureCheck: true,
    });

    // 2. Define your Devnet test token mint addresses
    const mintA = await raydium.token.getTokenInfo(baseMint);
    const mintB = await raydium.token.getTokenInfo(quoteMint);

    // 3. Fallback configuration if the Raydium API is offline
    console.log("Building CPMM pool configuration and deposit inputs...");

    // Official Raydium Devnet CPMM Accounts
    const DEVNET_CPMM_PROGRAM = new PublicKey("CPMDWBwJDtYax9qW7AyRuVC19Cc4L4Vcy4n2BHAbHkCW");
    const DEVNET_CPMM_FEE_RECEIVER = new PublicKey("G11FKBRaAkHAKuLCgLM6K6NUc9rTjPAznRCjZifrTQe2");
    const DEVNET_CPMM_CONFIG_ID = "9zSzfkYy6awexsHvmggeH36pfVUdDGyCcwmjT3AQPBj6"; // Standard 0.25% fee account

    const targetFeeConfig = {
        id: DEVNET_CPMM_CONFIG_ID,
        index: 0,
        feeRate: 2500, // 0.25% pool fee
        description: "Devnet Pool",
        fundFeeRate: 0,
        protocolFeeRate: 0,
        fundOwner: DEVNET_CPMM_FEE_RECEIVER.toString(),
    };

    // 4. Build execution transaction
    const { execute, extInfo } = await raydium.cpmm.createPool({
        programId: DEVNET_CPMM_PROGRAM,               // Updated Devnet CPMM program
        poolFeeAccount: DEVNET_CPMM_FEE_RECEIVER,     // Updated Devnet Fee Receiver
        mintA,
        mintB,
        mintAAmount: new BN(baseAmount * 10 ** mintA.decimals),
        mintBAmount: new BN(quoteAmount * 10 ** mintB.decimals),
        startTime: new BN(0),
        feeConfig: {
            tradeFeeRate: targetFeeConfig.feeRate,
            createPoolFee: new BN(0),
            creatorFeeRate: new BN(0),
            ...targetFeeConfig,
            // id: new PublicKey(targetFeeConfig.id), // Cast ID explicitly to PublicKey string
        },
        associatedOnly: false,
        ownerInfo: { useSOLBalance: true },
        txVersion: TxVersion.V0,
        computeBudgetConfig: {
            units: 600_000,
            microLamports: 100_000,
        },
    });

    const { txId } = await execute({ sendAndConfirm: true });

    console.log(`Pool ID:  ${extInfo.address.poolId.toBase58()}`);
    console.log(`LP mint:  ${extInfo.address.lpMint.toBase58()}`);
    console.log(`Vault A:  ${extInfo.address.vaultA.toBase58()}`);
    console.log(`Vault B:  ${extInfo.address.vaultB.toBase58()}`);
    console.log(`Tx:       https://solscan.io/tx/${txId}`);
}

createCpmmPool(BASE_MINT, QUOTE_MINT, BASE_AMOUNT, QUOTE_AMOUNT).catch(console.error);
