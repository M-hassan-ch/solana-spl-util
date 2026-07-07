import {
    Cluster,
    clusterApiUrl,
    Connection,
} from "@solana/web3.js";


export function getConnection(network: Cluster) {
    return new Connection("https://devnet.helius-rpc.com/?api-key=8d46c96c-eca3-48a4-a340-9fcaf733f0fe", "confirmed");
    // return new Connection(clusterApiUrl(network), "confirmed");
}