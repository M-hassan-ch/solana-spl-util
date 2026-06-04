import {
    createMint,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
    PublicKey,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { addMetadataToSplMint } from "./utils/metaplex";
import { getConnection } from "./utils/get-rpc";
import { getKeypair } from "./utils/get-keypair";
import { DECIMALS, TOKEN_DETAILS } from "./utils/constants";
import { uploadJsonToPinata } from "./utils/pinata";
import type {
    DeployedToken,
    TokenDeploymentReport,
    TokenDetails,
    DeploymentContext
} from "./types";
import dotenv from "dotenv";
dotenv.config();


const DEPLOYED_TOKENS_PATH = path.join(__dirname, "deployed-token.json");
const TOKEN_ASSET_URI = "N/A";
const MINT_VISIBILITY_RETRIES = 20;
const MINT_VISIBILITY_DELAY_MS = 1_000;

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function buildTokenMetadata({ name, symbol }: TokenDetails): Record<string, unknown> {
    return {
        name,
        symbol,
        uri: TOKEN_ASSET_URI,
        sellerFeeBasisPoints: 0,
    };
}

function saveDeployedTokens(tokens: DeployedToken[]): void {
    let existing: DeployedToken[] = [];
    if (fs.existsSync(DEPLOYED_TOKENS_PATH)) {
        existing = JSON.parse(
            fs.readFileSync(DEPLOYED_TOKENS_PATH, "utf-8")
        ) as DeployedToken[];
    }
    const updated = [...existing, ...tokens];
    fs.writeFileSync(DEPLOYED_TOKENS_PATH, JSON.stringify(updated, null, 2));
    console.log(`Saved ${tokens.length} token(s) to ${DEPLOYED_TOKENS_PATH}`);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMintAccount(
    context: DeploymentContext,
    mint: PublicKey
): Promise<void> {
    for (let attempt = 1; attempt <= MINT_VISIBILITY_RETRIES; attempt++) {
        const account = await context.connection.getAccountInfo(mint, "finalized");

        if (
            account &&
            account.owner.equals(TOKEN_PROGRAM_ID) &&
            account.data.length > 0
        ) {
            return;
        }

        if (attempt < MINT_VISIBILITY_RETRIES) {
            await sleep(MINT_VISIBILITY_DELAY_MS);
        }
    }

    throw new Error(`Mint account is not visible yet: ${mint.toBase58()}`);
}

function createDeploymentReport({ name, symbol }: TokenDetails): TokenDeploymentReport {
    return {
        name,
        symbol,
        pinataUpload: "skipped",
        splMint: "skipped",
        metaplexMetadata: "skipped",
        saved: false,
    };
}

async function uploadMetadata(
    token: TokenDetails,
    report: TokenDeploymentReport
): Promise<boolean> {
    try {
        const metadataFileName = `${token.symbol.toLowerCase()}.json`;
        console.log(`  [1/3] Uploading metadata JSON to Pinata as ${metadataFileName}...`);

        const upload = await uploadJsonToPinata(
            buildTokenMetadata(token),
            metadataFileName
        );

        report.pinataUpload = "success";
        report.metadataCid = upload.cid;
        report.metadataUri = upload.url;
        console.log(`  [1/3] Pinata upload complete: ${upload.url}`);
        return true;
    } catch (error) {
        report.pinataUpload = "failed";
        report.issue = `Pinata upload failed: ${getErrorMessage(error)}`;
        console.error(`  [1/3] ${report.issue}`);
        return false;
    }
}

async function createTokenMint(
    context: DeploymentContext,
    report: TokenDeploymentReport
): Promise<boolean> {
    try {
        console.log("  [2/3] Creating SPL mint...");

        const mint = await createMint(
            context.connection,
            context.payer,
            context.payer.publicKey,
            context.payer.publicKey,
            DECIMALS,
            undefined,
            {
                commitment: "finalized",
            },
            TOKEN_PROGRAM_ID
        );

        report.splMint = "success";
        report.mint = mint.toBase58();
        console.log(`  [2/3] SPL mint created: ${report.mint}`);
        console.log("  [2/3] Waiting for SPL mint account to be readable...");
        await waitForMintAccount(context, mint);
        return true;
    } catch (error) {
        report.splMint = "failed";
        report.issue = `SPL mint deployment failed: ${getErrorMessage(error)}`;
        console.error(`  [2/3] ${report.issue}`);
        return false;
    }
}

async function addTokenMetadata(
    context: DeploymentContext,
    token: TokenDetails,
    report: TokenDeploymentReport
): Promise<boolean> {
    if (!report.mint || !report.metadataUri) {
        report.metaplexMetadata = "skipped";
        report.issue = "Metaplex metadata skipped: missing mint or metadata URI.";
        console.error(`  [3/3] ${report.issue}`);
        return false;
    }

    try {
        console.log("  [3/3] Associating Metaplex metadata with SPL mint...");

        const metadataTransaction = await addMetadataToSplMint({
            connection: context.connection,
            mint: report.mint,
            name: token.name,
            symbol: token.symbol,
            uri: report.metadataUri,
        });

        report.metaplexMetadata = "success";
        report.metadataTransaction = metadataTransaction;
        console.log(`  [3/3] Metaplex metadata associated: ${metadataTransaction}`);
        return true;
    } catch (error) {
        report.metaplexMetadata = "failed";
        report.issue = `Metaplex metadata failed: ${getErrorMessage(error)}`;
        console.error(`  [3/3] ${report.issue}`);
        return false;
    }
}

function buildDeployedToken(report: TokenDeploymentReport): DeployedToken {
    return {
        name: report.name,
        symbol: report.symbol,
        mint: report.mint!,
        metadataCid: report.metadataCid!,
        metadataUri: report.metadataUri!,
        metadataTransaction: report.metadataTransaction!,
    };
}

async function deploySingleToken(
    token: TokenDetails,
    context: DeploymentContext
): Promise<{ deployedToken?: DeployedToken; report: TokenDeploymentReport }> {
    const report = createDeploymentReport(token);
    console.log(`\nDeploying ${token.name} (${token.symbol})...`);

    if (!(await uploadMetadata(token, report))) {
        return { report };
    }

    if (!(await createTokenMint(context, report))) {
        return { report };
    }

    if (!(await addTokenMetadata(context, token, report))) {
        return { report };
    }

    report.saved = true;
    return {
        deployedToken: buildDeployedToken(report),
        report,
    };
}

function printDeploymentStatistics(reports: TokenDeploymentReport[]): void {
    console.log("\nDeployment statistics:");
    console.table(
        reports.map((report) => ({
            name: report.name,
            symbol: report.symbol,
            pinataUpload: report.pinataUpload,
            splMint: report.splMint,
            metaplexMetadata: report.metaplexMetadata,
            saved: report.saved ? "yes" : "no",
            mint: report.mint ?? "",
            issue: report.issue ?? "",
        }))
    );
}

function saveCompletedDeployments(deployed: DeployedToken[]): void {
    if (deployed.length > 0) {
        saveDeployedTokens(deployed);
    } else {
        console.log("No fully completed token deployments to save.");
    }
}

export async function deployTokens(
    tokenDetails: TokenDetails[]
): Promise<DeployedToken[]> {
    const context: DeploymentContext = {
        payer: getKeypair(),
        connection: getConnection("devnet"),
    };
    const deployed: DeployedToken[] = [];
    const reports: TokenDeploymentReport[] = [];

    for (const token of tokenDetails) {
        const result = await deploySingleToken(token, context);

        reports.push(result.report);
        if (result.deployedToken) {
            deployed.push(result.deployedToken);
        }
    }

    // printDeploymentStatistics(reports);
    saveCompletedDeployments(deployed);

    return deployed;
}

deployTokens(TOKEN_DETAILS)
    .then((results) => {
        console.log("\nDeployed tokens:");
        console.table(results);
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
