import deployedTokens from "../deployed-token.json";

export function getSymbol(mint: string) {
    const token = deployedTokens.find((token) => token.mint === mint);
    return token?.symbol;
}