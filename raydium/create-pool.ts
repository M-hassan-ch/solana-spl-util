import { Raydium, DEVNET_PROGRAM_ID, TxVersion, CREATE_CPMM_POOL_FEE_ACC } from "@raydium-io/raydium-sdk-v2";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { getConnection } from "../utils/get-rpc";
import { getKeypair } from "../utils/get-keypair";

async function createCpmmPool() {
    const connection = getConnection("devnet");
    const owner = getKeypair();

    // 1. Initialize Raydium Client mapped to Devnet
    const raydium = await Raydium.load({
        owner,
        connection,
        cluster: "devnet",
        disableFeatureCheck: true,
    });

    // 2. Define your Devnet test token mint addresses
    const tokenAMintStr = "7cfwWFgwDESjWLCQxJVJd9PZ9myVJ5nZx5Q9K7KvecWe"; // AAPl-t
    const tokenBMintStr = "8wxVQjQ994K31odPWBgDqbXJv581fMiFH9G4VLGQ6cnY"; // USDC-t

    const mintA = await raydium.token.getTokenInfo(tokenAMintStr); //
    const mintB = await raydium.token.getTokenInfo(tokenBMintStr); //

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
        mintAAmount: new BN(200_000 * 10 ** mintA.decimals),
        mintBAmount: new BN(100 * 10 ** mintB.decimals),
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

createCpmmPool().catch(console.error);
