import BN from "bn.js";
import { Raydium } from "@raydium-io/raydium-sdk-v2";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import dotenv from "dotenv";
import { getConnection } from "../utils/get-rpc";
import { getKeypair } from "../utils/get-keypair";
import { getSymbol } from "../utils/get-symbol";

dotenv.config();

const POOL_ID = process.env.POOL_ID ?? "FKzvtrxbd1SBn7DrnmbWqA2HB2NiH7PJmVehHVnCHn79";
const INITIAL_BASE_AMOUNT = Number(process.env.INITIAL_BASE_AMOUNT ?? 200_000);
const INITIAL_QUOTE_AMOUNT = Number(process.env.INITIAL_QUOTE_AMOUNT ?? 100);
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

    // LP fee earnings: trade fees stay in vault reserves and grow LP value
    const lpMint = new PublicKey(poolInfo.lpMint.address);
    const lpAta = await getAssociatedTokenAddress(lpMint, owner.publicKey);
    const lpAccount = await getAccount(connection, lpAta);
    const userLpBalance = new BN(lpAccount.amount.toString());
    const totalLpSupply = rpcData.lpAmount;

    const redeemA = rpcData.baseReserve.mul(userLpBalance).div(totalLpSupply);
    const redeemB = rpcData.quoteReserve.mul(userLpBalance).div(totalLpSupply);

    const lpSharePct = userLpBalance.mul(new BN(10000)).div(totalLpSupply).toNumber() / 100;
    const initialARaw = new BN(Math.round(INITIAL_BASE_AMOUNT * 10 ** decimalsA));
    const initialBRaw = new BN(Math.round(INITIAL_QUOTE_AMOUNT * 10 ** decimalsB));

    // Scale initial deposit by LP share (100% if you own all LP)
    const initialAOwned = initialARaw.mul(userLpBalance).div(totalLpSupply);
    const initialBOwned = initialBRaw.mul(userLpBalance).div(totalLpSupply);

    const deltaA = redeemA.sub(initialAOwned);
    const deltaB = redeemB.sub(initialBOwned);

    const spotPriceAInB = rpcData.quoteReserve.toNumber() / 10 ** decimalsB
        / (rpcData.baseReserve.toNumber() / 10 ** decimalsA);

    const initialValueQuote = INITIAL_BASE_AMOUNT * lpSharePct / 100 * spotPriceAInB
        + INITIAL_QUOTE_AMOUNT * lpSharePct / 100;
    const redeemValueQuote = redeemA.toNumber() / 10 ** decimalsA * spotPriceAInB
        + redeemB.toNumber() / 10 ** decimalsB;
    const netValueQuote = redeemValueQuote - initialValueQuote;

    console.log("\n--- LP withdrawal preview (your trade-fee earnings) ---");
    console.log(`Wallet:              ${owner.publicKey.toBase58()}`);
    console.log(`Your LP balance:     ${formatTokenAmount(userLpBalance, poolInfo.lpMint.decimals)} / ${formatTokenAmount(totalLpSupply, poolInfo.lpMint.decimals)} (${lpSharePct.toFixed(4)}% of pool)`);
    console.log(`Initial deposit:     ${formatTokenAmount(initialAOwned, decimalsA)} ${symbolA}, ${formatTokenAmount(initialBOwned, decimalsB)} ${symbolB}`);
    console.log(`Redeemable on burn:  ${formatTokenAmount(redeemA, decimalsA)} ${symbolA}, ${formatTokenAmount(redeemB, decimalsB)} ${symbolB}`);
    console.log(`Net change:          ${formatTokenAmount(deltaA, decimalsA)} ${symbolA}, ${formatTokenAmount(deltaB, decimalsB)} ${symbolB}`);
    // console.log(`Net value (~${symbolB}): ${netValueQuote >= 0 ? "+" : ""}${netValueQuote.toFixed(6)} ${symbolB} at current spot price`);
    console.log("Set INITIAL_BASE_AMOUNT / INITIAL_QUOTE_AMOUNT if your seed deposit differed from create-pool defaults.");
}

getFees(POOL_ID).catch(console.error);
