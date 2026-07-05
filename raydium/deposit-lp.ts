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
const BASE_MINT = process.env.BASE_MINT ?? "7cfwWFgwDESjWLCQxJVJd9PZ9myVJ5nZx5Q9K7KvecWe";
const QUOTE_MINT = process.env.QUOTE_MINT ?? "8wxVQjQ994K31odPWBgDqbXJv581fMiFH9G4VLGQ6cnY";
const BASE_AMOUNT = Number(process.env.BASE_AMOUNT ?? 200_000);
const QUOTE_AMOUNT = Number(process.env.QUOTE_AMOUNT ?? 100);
const SLIPPAGE = Number(process.env.SLIPPAGE ?? 0.01);

function addThousandsSeparator(value: string): string {
    return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatTokenAmount(amount: BN, decimals: number): string {
    const sign = amount.isNeg() ? "-" : "";
    const abs = amount.abs();

    if (decimals === 0) {
        return sign + addThousandsSeparator(abs.toString());
    }

    const raw = abs.toString().padStart(decimals + 1, "0");
    const intPart = raw.slice(0, -decimals);
    const fracPart = raw.slice(-decimals).replace(/0+$/, "");
    const intFormatted = addThousandsSeparator(intPart);
    return fracPart ? `${sign}${intFormatted}.${fracPart}` : `${sign}${intFormatted}`;
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

function mapAmountsToPool(
    poolBaseMint: string,
    poolQuoteMint: string,
    baseMint: string,
    quoteMint: string,
    baseAmount: number,
    quoteAmount: number,
) {
    if (baseMint === poolBaseMint && quoteMint === poolQuoteMint) {
        return { poolBaseAmount: baseAmount, poolQuoteAmount: quoteAmount };
    }
    if (baseMint === poolQuoteMint && quoteMint === poolBaseMint) {
        return { poolBaseAmount: quoteAmount, poolQuoteAmount: baseAmount };
    }
    throw new Error(
        `Mints do not match pool. Pool base/quote: ${poolBaseMint} / ${poolQuoteMint}, got ${baseMint} / ${quoteMint}`,
    );
}

async function depositLiquidity() {
    const connection = getConnection("devnet");
    const owner = getKeypair();

    const raydium = await Raydium.load({
        owner,
        connection,
        cluster: "devnet",
        disableFeatureCheck: true,
        blockhashCommitment: "finalized",
    });

    const { poolInfo, poolKeys, rpcData } = await raydium.cpmm.getPoolInfoFromRpc(POOL_ID);

    const symbolBase = getSymbol(poolInfo.mintA.address) ?? poolInfo.mintA.symbol;
    const symbolQuote = getSymbol(poolInfo.mintB.address) ?? poolInfo.mintB.symbol;
    const baseDecimals = poolInfo.mintA.decimals;
    const quoteDecimals = poolInfo.mintB.decimals;
    const lpDecimals = poolInfo.lpMint.decimals;

    const { poolBaseAmount, poolQuoteAmount } = mapAmountsToPool(
        poolInfo.mintA.address,
        poolInfo.mintB.address,
        BASE_MINT,
        QUOTE_MINT,
        BASE_AMOUNT,
        QUOTE_AMOUNT,
    );

    const baseMint = new PublicKey(poolInfo.mintA.address);
    const quoteMint = new PublicKey(poolInfo.mintB.address);
    const lpMint = new PublicKey(poolInfo.lpMint.address);
    const baseProgram = new PublicKey(poolInfo.mintA.programId);
    const quoteProgram = new PublicKey(poolInfo.mintB.programId);

    const slippage = new Percent(Math.round(SLIPPAGE * 10000), 10000);
    const epochInfo = await connection.getEpochInfo();

    const fromBase = raydium.cpmm.computePairAmount({
        poolInfo,
        baseReserve: rpcData.baseReserve,
        quoteReserve: rpcData.quoteReserve,
        amount: String(poolBaseAmount),
        slippage,
        baseIn: true,
        epochInfo,
    });

    const quoteAmountRaw = new BN(Math.round(poolQuoteAmount * 10 ** quoteDecimals));
    let baseIn = true;
    let inputAmount = new BN(Math.round(poolBaseAmount * 10 ** baseDecimals));
    let depositBase = inputAmount;
    let depositQuote = fromBase.anotherAmount.amount;
    let expectedLp = fromBase.liquidity;

    if (fromBase.maxAnotherAmount.amount.gt(quoteAmountRaw)) {
        const fromQuote = raydium.cpmm.computePairAmount({
            poolInfo,
            baseReserve: rpcData.baseReserve,
            quoteReserve: rpcData.quoteReserve,
            amount: String(poolQuoteAmount),
            slippage,
            baseIn: false,
            epochInfo,
        });

        const baseAmountRaw = new BN(Math.round(poolBaseAmount * 10 ** baseDecimals));
        if (fromQuote.maxAnotherAmount.amount.gt(baseAmountRaw)) {
            throw new Error(
                "Amounts do not match pool ratio. Adjust BASE_AMOUNT / QUOTE_AMOUNT to match current pool price.",
            );
        }

        baseIn = false;
        inputAmount = quoteAmountRaw;
        depositBase = fromQuote.anotherAmount.amount;
        depositQuote = inputAmount;
        expectedLp = fromQuote.liquidity;
    }

    const balanceBaseBefore = await getTokenBalance(connection, owner.publicKey, baseMint, baseProgram);
    const balanceQuoteBefore = await getTokenBalance(connection, owner.publicKey, quoteMint, quoteProgram);
    const lpBefore = await getTokenBalance(connection, owner.publicKey, lpMint);

    console.log(`\nPool:   ${POOL_ID}`);
    console.log(`Wallet: ${owner.publicKey.toBase58()}`);
    console.log(`Pair:   ${symbolBase} (base) / ${symbolQuote} (quote)`);

    console.log("\n--- Deposit plan ---");
    console.log(`Requested:    ${poolBaseAmount.toLocaleString()} ${symbolBase} + ${poolQuoteAmount.toLocaleString()} ${symbolQuote}`);
    console.log(`Depositing:   ${formatTokenAmount(depositBase, baseDecimals)} ${symbolBase} + ${formatTokenAmount(depositQuote, quoteDecimals)} ${symbolQuote}`);
    console.log(`Expected LP:  ${formatTokenAmount(expectedLp, lpDecimals)}`);
    console.log(`Side / slippage: baseIn=${baseIn}, slippage=${SLIPPAGE}`);

    console.log("\n--- Balances before ---");
    console.log(`Base:  ${formatTokenAmount(balanceBaseBefore, baseDecimals)} ${symbolBase}`);
    console.log(`Quote: ${formatTokenAmount(balanceQuoteBefore, quoteDecimals)} ${symbolQuote}`);
    console.log(`LP:    ${formatTokenAmount(lpBefore, lpDecimals)}`);

    console.log("\nDepositing liquidity...");
    const { execute } = await raydium.cpmm.addLiquidity({
        poolInfo,
        poolKeys,
        inputAmount,
        slippage,
        baseIn,
        txVersion: TxVersion.V0,
        computeBudgetConfig: {
            units: 400_000,
            microLamports: 50_000,
        },
    });

    const { txId } = await execute({ sendAndConfirm: true });

    const balanceBaseAfter = await getTokenBalance(connection, owner.publicKey, baseMint, baseProgram);
    const balanceQuoteAfter = await getTokenBalance(connection, owner.publicKey, quoteMint, quoteProgram);
    const lpAfter = await getTokenBalance(connection, owner.publicKey, lpMint);

    const spentBase = balanceBaseBefore.sub(balanceBaseAfter);
    const spentQuote = balanceQuoteBefore.sub(balanceQuoteAfter);
    const lpReceived = lpAfter.sub(lpBefore);

    console.log("\n--- Balances after ---");
    console.log(`Base:  ${formatTokenAmount(balanceBaseAfter, baseDecimals)} ${symbolBase}`);
    console.log(`Quote: ${formatTokenAmount(balanceQuoteAfter, quoteDecimals)} ${symbolQuote}`);
    console.log(`LP:    ${formatTokenAmount(lpAfter, lpDecimals)}`);

    console.log("\n--- Summary ---");
    console.log(`Spent base:   -${formatTokenAmount(spentBase, baseDecimals)} ${symbolBase}`);
    console.log(`Spent quote:  -${formatTokenAmount(spentQuote, quoteDecimals)} ${symbolQuote}`);
    console.log(`LP received:  +${formatTokenAmount(lpReceived, lpDecimals)}`);
    console.log(`Tx:           https://solscan.io/tx/${txId}?cluster=devnet`);
}

depositLiquidity().catch(console.error);
