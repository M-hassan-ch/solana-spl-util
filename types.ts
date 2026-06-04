import type {
    Connection,
    Keypair,
} from "@solana/web3.js";

export type TokenDetails = {
    name: string;
    symbol: string;
};

export type DeployedToken = TokenDetails & {
    mint: string;
    metadataCid: string;
    metadataUri: string;
    metadataTransaction: string;
};

export type StepStatus = "success" | "failed" | "skipped";

export type TokenDeploymentReport = TokenDetails & {
    pinataUpload: StepStatus;
    splMint: StepStatus;
    metaplexMetadata: StepStatus;
    saved: boolean;
    mint?: string;
    metadataCid?: string;
    metadataUri?: string;
    metadataTransaction?: string;
    issue?: string;
};

export type PinataJsonUpload = {
    id: string;
    name: string;
    cid: string;
    url: string;
};

export type AddTokenMetadataInput = {
    connection: Connection;
    mint: string;
    name: string;
    symbol: string;
    uri: string;
};

export type DeploymentContext = {
    connection: Connection;
    payer: Keypair;
};
