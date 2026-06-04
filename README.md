# Solana SPL Token Utility

Small TypeScript utility project for deploying SPL token mints on Solana devnet, uploading token metadata JSON to Pinata, attaching Metaplex metadata, and minting tokens to wallet addresses.

## What This Project Does

The project currently works on Solana devnet and uses the wallet stored in `dev-wallet.json` as the payer, mint authority, and metadata authority.

The deploy flow performs three steps for each token in `utils/constants.ts`:

1. Upload token metadata JSON to Pinata.
2. Create a new SPL token mint with `DECIMALS`.
3. Attach Metaplex metadata to the SPL mint.

Only tokens that complete all three steps are appended to `deployed-token.json`.

## Setup

Install dependencies:

```bash
npm install
```

Create a `.env` file with your Pinata JWT:

```bash
PINATA_JWT=your_pinata_jwt_here
```

Make sure `dev-wallet.json` exists and contains a Solana secret key array. The wallet must have enough devnet SOL to pay transaction fees.

## Useful Commands

Deploy the tokens listed in `utils/constants.ts`:

```bash
npx tsx ./deploy-token.ts
```

Mint an existing SPL token to a wallet address:

```bash
npx tsx mint-token.ts <mint-address> <recipient-address> <amount>
```

Example:

```bash
npx tsx mint-token.ts 6pkzKh42cV2WEmkLnP9FeVQiS1sd1Jc9m3tHVkFqrWWV 4vKaFwMgBgc2V9gbQgzohKbsu3AttPhaX9BwHuWqjkFn 20.123456
```

The project uses `DECIMALS = 6`, so amounts can have at most 6 decimal places. For example, `20.1234567` has 7 decimal places and will fail validation.

Run a TypeScript compile check:

```bash
npx tsc --noEmit
```

## Scripts

### `deploy-token.ts`

Deploys SPL token mints for every token configured in `TOKEN_DETAILS`.

For each token, it:

- uploads metadata JSON to Pinata using a lowercase symbol filename
- creates a devnet SPL mint
- waits until the mint account is readable
- creates a Metaplex metadata account for that mint
- saves successful deployments to `deployed-token.json`

### `mint-token.ts`

Mints an existing SPL token to a recipient wallet.

It:

- reads the mint address, recipient address, and amount from command-line arguments
- validates the amount against the mint decimals
- creates the recipient associated token account if needed
- mints tokens using the local `dev-wallet.json` wallet as mint authority

## Important Files

### `utils/constants.ts`

Stores project constants:

- `DECIMALS`
- `RPC_URL`
- `TOKEN_DETAILS`

Edit `TOKEN_DETAILS` when you want to deploy a different set of tokens.

### `utils/pinata.ts`

Wraps the Pinata SDK.

It reads `PINATA_JWT` from `.env`, uploads JSON metadata to Pinata, and returns the uploaded CID and gateway URL.

### `utils/metaplex.ts`

Creates Metaplex metadata for an already-created SPL mint.

It uses the same `dev-wallet.json` wallet as the mint authority and update authority.

### `utils/get-keypair.ts`

Loads the local Solana keypair from `dev-wallet.json`.

### `utils/get-rpc.ts`

Creates a Solana `Connection` for the selected cluster.

### `types.ts`

Contains shared TypeScript types used by the deploy script and utilities.

### `deployed-token.json`

Stores successful deployments only.

Each saved token includes:

- `name`
- `symbol`
- `mint`
- `metadataCid`
- `metadataUri`
- `metadataTransaction`

## Notes

- The scripts currently target devnet.
- The same wallet is used as payer, mint authority, and metadata authority.
- Failed deploy iterations are skipped instead of crashing the entire deploy run.
- `deployed-token.json` is append-only; running deploy again creates and saves new mints for successful tokens.
