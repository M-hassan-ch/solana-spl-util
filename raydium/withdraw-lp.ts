import BN from "bn.js";
import { Raydium, Percent, TxVersion } from "@raydium-io/raydium-sdk-v2";
import { getAssociatedTokenAddress, getAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import dotenv from "dotenv";
import { getConnection } from "../utils/get-rpc";
import { getKeypair } from "../utils/get-keypair";
import { getSymbol } from "../utils/get-symbol";

dotenv.config();

const POOL_ID = process.env.POOL_ID ?? "FKzvtrxbd1SBn7DrnmbWqA2HB2NiH7PJmVehHVnCHn79";
const SLIPPAGE = Number(process.env.SLIPPAGE ?? 0.005); // 0.5%

function formatTokenAmount(amount: BN, decimals: number): string {
    const sign = amount.isNeg() ? "-" : "";
    const abs = amount.abs();
    return sign + (abs.toNumber() / 10 ** decimals).toLocaleString(undefined, {
        maximumFractionDigits: decimals,
    });
}

async function getTokenBalance(
    connection: Connection,
    owner: PublicKey,
    mint: PublicKey,
    programId: PublicKey = TOKEN_PROGRAM_ID,
): Promise<BN> {
    try {
        const ata = await getAssociatedTokenAddress(mint, owner, false, programId);
        const account = await getAccount(connection, ata, undefined, programId);
        return new BN(account.amount.toString());
    } catch {
        return new BN(0);
    }
}

function printBalanceRow(label: string, amountA: BN, amountB: BN, lp: BN, symbolA: string, symbolB: string, lpDecimals: number, decimalsA: number, decimalsB: number) {
    console.log(`${label.padEnd(10)} ${formatTokenAmount(amountA, decimalsA).padStart(18)} ${symbolA.padEnd(8)} ${formatTokenAmount(amountB, decimalsB).padStart(14)} ${symbolB.padEnd(8)} ${formatTokenAmount(lp, lpDecimals).padStart(14)} LP`);
}

async function withdrawAllLp(poolId: string) {
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
        blockhashCommitment: "finalized",
    });

    const { poolInfo, poolKeys, rpcData } = await raydium.cpmm.getPoolInfoFromRpc(poolId);

    const symbolA = getSymbol(poolInfo.mintA.address) ?? poolInfo.mintA.symbol;
    const symbolB = getSymbol(poolInfo.mintB.address) ?? poolInfo.mintB.symbol;
    const decimalsA = poolInfo.mintA.decimals;
    const decimalsB = poolInfo.mintB.decimals;
    const lpDecimals = poolInfo.lpMint.decimals;

    const mintA = new PublicKey(poolInfo.mintA.address);
    const mintB = new PublicKey(poolInfo.mintB.address);
    const lpMint = new PublicKey(poolInfo.lpMint.address);
    const programA = new PublicKey(poolInfo.mintA.programId);
    const programB = new PublicKey(poolInfo.mintB.programId);

    const lpBalance = await getTokenBalance(connection, owner.publicKey, lpMint);
    if (lpBalance.isZero()) {
        throw new Error("No LP tokens found in wallet for this pool.");
    }

    const balanceABefore = await getTokenBalance(connection, owner.publicKey, mintA, programA);
    const balanceBBefore = await getTokenBalance(connection, owner.publicKey, mintB, programB);

    const totalLpSupply = rpcData.lpAmount;
    const expectedA = rpcData.baseReserve.mul(lpBalance).div(totalLpSupply);
    const expectedB = rpcData.quoteReserve.mul(lpBalance).div(totalLpSupply);

    console.log(`\nPool:   ${poolId}`);
    console.log(`Wallet: ${owner.publicKey.toBase58()}`);
    console.log(`Pair:   ${symbolA} / ${symbolB}`);
    console.log(`LP share: ${formatTokenAmount(lpBalance, lpDecimals)} / ${formatTokenAmount(totalLpSupply, lpDecimals)} (${lpBalance.mul(new BN(10000)).div(totalLpSupply).toNumber() / 100}%)`);

    console.log("\n--- Balances ---");
    console.log(`${" ".padEnd(10)} ${symbolA.padStart(18)}          ${symbolB.padStart(14)}          LP`);
    printBalanceRow("Before", balanceABefore, balanceBBefore, lpBalance, symbolA, symbolB, lpDecimals, decimalsA, decimalsB);
    printBalanceRow("Expected", expectedA, expectedB, new BN(0), symbolA, symbolB, lpDecimals, decimalsA, decimalsB);

    console.log("\nBurning all LP and withdrawing liquidity...");
    const { execute } = await raydium.cpmm.withdrawLiquidity({
        poolInfo,
        poolKeys,
        lpAmount: lpBalance,
        slippage: new Percent(Math.round(SLIPPAGE * 10000), 10000),
        txVersion: TxVersion.V0,
        computeBudgetConfig: {
            units: 400_000,
            microLamports: 50_000,
        },
    });

    const { txId } = await execute({ sendAndConfirm: true });

    const balanceAAfter = await getTokenBalance(connection, owner.publicKey, mintA, programA);
    const balanceBAfter = await getTokenBalance(connection, owner.publicKey, mintB, programB);
    const lpAfter = await getTokenBalance(connection, owner.publicKey, lpMint);

    const receivedA = balanceAAfter.sub(balanceABefore);
    const receivedB = balanceBAfter.sub(balanceBBefore);

    printBalanceRow("After", balanceAAfter, balanceBAfter, lpAfter, symbolA, symbolB, lpDecimals, decimalsA, decimalsB);
    printBalanceRow("Received", receivedA, receivedB, lpBalance.sub(lpAfter), symbolA, symbolB, lpDecimals, decimalsA, decimalsB);

    console.log("\n--- Summary ---");
    console.log(`LP burned:    ${formatTokenAmount(lpBalance.sub(lpAfter), lpDecimals)}`);
    console.log(`Got ${symbolA}:  +${formatTokenAmount(receivedA, decimalsA)}`);
    console.log(`Got ${symbolB}:  +${formatTokenAmount(receivedB, decimalsB)}`);
    console.log(`Tx:           https://solscan.io/tx/${txId}?cluster=devnet`);
}

withdrawAllLp(POOL_ID).catch(console.error);
