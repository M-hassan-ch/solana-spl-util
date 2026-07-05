import BN from "bn.js";
import { Raydium } from "@raydium-io/raydium-sdk-v2";
import { getConnection } from "../utils/get-rpc";
import { getKeypair } from "../utils/get-keypair";
import { getSymbol } from "../utils/get-symbol";

const POOL_ID = process.env.POOL_ID ?? "FKzvtrxbd1SBn7DrnmbWqA2HB2NiH7PJmVehHVnCHn79";
const FEE_DENOMINATOR = 1_000_000;

function formatTokenAmount(amount: BN, decimals: number): string {
    return (amount.toNumber() / 10 ** decimals).toLocaleString(undefined, {
        maximumFractionDigits: decimals,
    });
}

async function getFees(poolId: string) {
    if (!poolId) {
        console.error("Set POOL_ID env var.");
        process.exit(1);
    }

    const connection = getConnection("devnet");
    const owner = getKeypair();
    const raydium = await Raydium.load({
        owner,
        connection,
        cluster: "devnet",
        disableFeatureCheck: true,
    });

    const { poolInfo, rpcData } = await raydium.cpmm.getPoolInfoFromRpc(poolId);

    const symbolA = getSymbol(poolInfo.mintA.address) ?? poolInfo.mintA.symbol;
    const symbolB = getSymbol(poolInfo.mintB.address) ?? poolInfo.mintB.symbol;
    const decimalsA = poolInfo.mintA.decimals;
    const decimalsB = poolInfo.mintB.decimals;

    // Off-chain: current accrued fees in each bucket
    // SDK uses mintA/mintB (doc: token0/token1)
    console.log("\n--- Accrued fees (raw) ---");
    console.log(
        "Protocol accrued:",
        rpcData.protocolFeesMintA.toString(),
        rpcData.protocolFeesMintB.toString(),
    );
    console.log(
        "Fund accrued:",
        rpcData.fundFeesMintA.toString(),
        rpcData.fundFeesMintB.toString(),
    );
    console.log(
        "Creator accrued:",
        rpcData.creatorFeesMintA.toString(),
        rpcData.creatorFeesMintB.toString(),
    );

    console.log("\n--- Accrued fees (human-readable) ---");
    console.log(
        `Protocol accrued: ${formatTokenAmount(rpcData.protocolFeesMintA, decimalsA)} ${symbolA}, ${formatTokenAmount(rpcData.protocolFeesMintB, decimalsB)} ${symbolB}`,
    );
    console.log(
        `Fund accrued:     ${formatTokenAmount(rpcData.fundFeesMintA, decimalsA)} ${symbolA}, ${formatTokenAmount(rpcData.fundFeesMintB, decimalsB)} ${symbolB}`,
    );
    console.log(
        `Creator accrued:  ${formatTokenAmount(rpcData.creatorFeesMintA, decimalsA)} ${symbolA}, ${formatTokenAmount(rpcData.creatorFeesMintB, decimalsB)} ${symbolB}`,
    );

    const config = rpcData.configInfo;
    if (!config) {
        throw new Error("Pool config not found in RPC data");
    }

    // Off-chain: effective rates (from on-chain config; same math as official doc)
    // trade_fee_rate, creator_fee_rate = fractions of volume (denominator 1e6)
    // protocol_fee_rate, fund_fee_rate = fractions of the trade fee (same denominator)
    const tradeFeeRate = config.tradeFeeRate.toNumber();
    const protocolFeeRate = config.protocolFeeRate.toNumber();
    const fundFeeRate = config.fundFeeRate.toNumber();
    const creatorFeeRate = config.creatorFeeRate.toNumber();

    const tradeFeeOfVolume = tradeFeeRate / FEE_DENOMINATOR;
    const protocolOfTradeFee = protocolFeeRate / FEE_DENOMINATOR;
    const fundOfTradeFee = fundFeeRate / FEE_DENOMINATOR;
    const lpOfTradeFee = 1 - protocolOfTradeFee - fundOfTradeFee;

    console.log("\n--- Effective fee rates ---");
    console.log(`Config index:          ${config.index}`);
    console.log(`Trade fee (of volume): ${(tradeFeeOfVolume * 100).toFixed(4)} %`);
    console.log("LP fee effective:", (tradeFeeOfVolume * lpOfTradeFee * 100).toFixed(4), "%");
    console.log("Protocol fee effective:", (tradeFeeOfVolume * protocolOfTradeFee * 100).toFixed(4), "%");
    console.log("Fund fee effective:", (tradeFeeOfVolume * fundOfTradeFee * 100).toFixed(4), "%");
    console.log(
        "Creator fee effective:",
        rpcData.enableCreatorFee
            ? ((creatorFeeRate / FEE_DENOMINATOR) * 100).toFixed(4) + " %"
            : "0 % (disabled on this pool)",
    );
}

getFees(POOL_ID).catch(console.error);
