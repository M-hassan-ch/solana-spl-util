import { PinataSDK, UploadResponse } from "pinata";
import type { PinataJsonUpload } from "../types";

const PINATA_GATEWAY_URL = "https://gateway.pinata.cloud/ipfs";

function getPinataJwt(): string {
    const jwt = process.env.PINATA_JWT;

    if (!jwt) {
        throw new Error(
            "Missing Pinata JWT. Set PINATA_JWT or add JWT=<token> to pinata-credentials.txt."
        );
    }

    return jwt;
}

function createPinataClient(): PinataSDK {
    return new PinataSDK({
        pinataJwt: getPinataJwt(),
        pinataGateway: "gateway.pinata.cloud",
    });
}

export async function uploadJsonToPinata(
    json: Record<string, unknown>,
    customName: string
): Promise<PinataJsonUpload> {
    const pinata = createPinataClient();
    const upload: UploadResponse = await pinata.upload.public
        .json(json)
        .name(customName);

    return {
        id: upload.id,
        name: upload.name,
        cid: upload.cid,
        url: `${PINATA_GATEWAY_URL}/${upload.cid}`,
    };
}
