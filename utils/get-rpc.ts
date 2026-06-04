import {
    Cluster,
    clusterApiUrl,
    Connection,
} from "@solana/web3.js";


export function getConnection(network: Cluster) {
    return new Connection(clusterApiUrl(network), "confirmed");
}