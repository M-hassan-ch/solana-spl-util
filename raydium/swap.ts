import { Raydium, CurveCalculator, TxVersion } from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import dotenv from "dotenv";
import { getConnection } from "../utils/get-rpc";
import { getKeypair } from "../utils/get-keypair";
import { getSymbol } from "../utils/get-symbol";

dotenv.config();

function formatTokenAmount(amount: BN, decimals: number): string {
    return (amount.toNumber() / 10 ** decimals).toLocaleString(undefined, {
        maximumFractionDigits: decimals,
    });
}

// ── Config from env ──────────────────────────────────────────────
const POOL_ID = process.env.POOL_ID ?? "FKzvtrxbd1SBn7DrnmbWqA2HB2NiH7PJmVehHVnCHn79";
const INPUT_MINT = process.env.INPUT_MINT ?? "8wxVQjQ994K31odPWBgDqbXJv581fMiFH9G4VLGQ6cnY"; // USDC-t
const AMOUNT_RAW = process.env.AMOUNT_RAW ?? String(1 * 1_000_000); // 5 USDC (6 decimals)

if (!POOL_ID || !INPUT_MINT || !AMOUNT_RAW) {
    console.error("Set POOL_ID, INPUT_MINT, AMOUNT_RAW env vars.");
    process.exit(1);
}

async function swap() {
    const connection = getConnection("devnet");
    const owner = getKeypair();

    const raydium = await Raydium.load({
        owner,
        connection,
        cluster: "devnet",
        // disableFeatureCheck: true,
        // blockhashCommitment: "finalized",
    });

    const { poolInfo, poolKeys, rpcData } =
        await raydium.cpmm.getPoolInfoFromRpc(POOL_ID);

    const baseIn = poolInfo.mintA.address === INPUT_MINT;

    const inputAmount = new BN(AMOUNT_RAW);
    const config = rpcData.configInfo;
    if (!config) {
        throw new Error("Pool config not found in RPC data");
    }

    const isCreatorFeeOnInput = rpcData.feeOn === 0 || rpcData.feeOn === 2;

    const swapResult = CurveCalculator.swapBaseInput(
        inputAmount,
        baseIn ? rpcData.baseReserve : rpcData.quoteReserve,
        baseIn ? rpcData.quoteReserve : rpcData.baseReserve,
        config.tradeFeeRate,
        config.creatorFeeRate,
        config.protocolFeeRate,
        config.fundFeeRate,
        isCreatorFeeOnInput,
    );

    const inputMint = baseIn ? poolInfo.mintA : poolInfo.mintB;
    const outputMint = baseIn ? poolInfo.mintB : poolInfo.mintA;
    const inputSymbol = getSymbol(inputMint.address) ?? inputMint.symbol ?? "???";
    const outputSymbol = getSymbol(outputMint.address) ?? outputMint.symbol ?? "???";

    console.log(
        `Quote: ${formatTokenAmount(inputAmount, inputMint.decimals)} ${inputSymbol} -> ${formatTokenAmount(swapResult.outputAmount, outputMint.decimals)} ${outputSymbol}`,
    );
    console.log(`Fee:   ${formatTokenAmount(swapResult.tradeFee, inputMint.decimals)} ${inputSymbol}`);

    const { execute } = await raydium.cpmm.swap({
        poolInfo,
        poolKeys,
        inputAmount,
        swapResult,
        slippage: 0.005, // 0.5%
        baseIn,
        txVersion: TxVersion.V0,
        computeBudgetConfig: {
            units: 250_000,
            microLamports: 50_000,
        },
    });

    const { txId } = await execute({ sendAndConfirm: true });
    console.log(`Swap landed: https://solscan.io/tx/${txId}?cluster=devnet`);
}

swap().catch(console.error);
