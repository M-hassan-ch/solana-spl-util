import {
    createMetadataAccountV3,
    mplTokenMetadata,
} from "@metaplex-foundation/mpl-token-metadata";
import { mplToolbox } from "@metaplex-foundation/mpl-toolbox";
import {
    keypairIdentity,
    publicKey,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { base58 } from "@metaplex-foundation/umi/serializers";
import * as fs from "fs";
import * as path from "path";
import type { AddTokenMetadataInput } from "../types";

function readWalletSecretKey(): Uint8Array {
    const walletPath = path.join(__dirname, "..", "dev-wallet.json");
    return Uint8Array.from(
        JSON.parse(fs.readFileSync(walletPath, "utf-8")) as number[]
    );
}

export async function addMetadataToSplMint(
    input: AddTokenMetadataInput
): Promise<string> {
    const umi = createUmi(input.connection)
        .use(mplTokenMetadata())
        .use(mplToolbox());

    const keypair = umi.eddsa.createKeypairFromSecretKey(readWalletSecretKey());
    umi.use(keypairIdentity(keypair));

    const tx = await createMetadataAccountV3(umi, {
        mint: publicKey(input.mint),
        mintAuthority: umi.identity,
        payer: umi.identity,
        updateAuthority: umi.identity,
        data: {
            name: input.name,
            symbol: input.symbol,
            uri: input.uri,
            sellerFeeBasisPoints: 0,
            creators: null,
            collection: null,
            uses: null,
        },
        isMutable: true,
        collectionDetails: null,
    }).sendAndConfirm(umi);

    return base58.deserialize(tx.signature)[0];
}
