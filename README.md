# Solana SPL Token Utility

TypeScript utilities for deploying SPL tokens on Solana devnet and operating Raydium CPMM liquidity pools with those tokens.

## What This Project Does

### Token deployment

Deploys SPL token mints on devnet using the wallet in `dev-wallet.json` as payer, mint authority, and metadata authority.

For each token in `utils/constants.ts`, the deploy flow:

1. Uploads token metadata JSON to Pinata
2. Creates a new SPL token mint with `DECIMALS` (6)
3. Attaches Metaplex metadata to the mint

Successful deployments are saved to `deployed-token.json`.

### Raydium CPMM (devnet)

Scripts in `raydium/` use [`@raydium-io/raydium-sdk-v2`](https://github.com/raydium-io/raydium-sdk-V2) to manage a **Constant Product Market Maker (CPMM)** pool on devnet.

Typical workflow:

```
deploy-token.ts  →  create-pool.ts  →  get-price.ts / swap.ts
                         ↓
              deposit-lp.ts / withdraw-lp.ts / fee-stat.ts
```

| Script | Purpose |
|--------|---------|
| `create-pool.ts` | Create a new CPMM pool and seed initial liquidity |
| `deposit-lp.ts` | Add liquidity to an existing pool |
| `withdraw-lp.ts` | Burn all LP tokens and redeem base + quote |
| `swap.ts` | Execute a token swap through the pool |
| `get-price.ts` | Read pool reserves and spot/swap quotes |
| `fee-stat.ts` | View accrued fees, effective rates, and LP earnings preview |

**Terminology:** Raydium uses `mintA` (base) and `mintB` (quote). Scripts use **base** / **quote** in logs and env vars. Token symbols are resolved from `deployed-token.json` via `utils/get-symbol.ts`.

## Setup

Install dependencies:

```bash
npm install
```

Create a `.env` file:

```bash
PINATA_JWT=your_pinata_jwt_here
```

Optional Raydium env vars (see [Raydium scripts](#raydium-scripts)) can also go in `.env`.

Requirements:

- `dev-wallet.json` with a Solana secret key array
- Enough devnet SOL for transaction fees
- Enough base/quote tokens in the wallet for pool operations

RPC is configured in `utils/get-rpc.ts` (defaults to a devnet Helius endpoint). The public Solana devnet RPC (`api.devnet.solana.com`) may fail due to SSL certificate issues — use a private RPC if needed.

## Useful Commands

### Token deployment

Deploy tokens listed in `utils/constants.ts`:

```bash
npx tsx deploy-token.ts
```

Mint an existing token to a wallet:

```bash
npx tsx mint-token.ts <mint-address> <recipient-address> <amount>
```

Example:

```bash
npx tsx mint-token.ts 6pkzKh42cV2WEmkLnP9FeVQiS1sd1Jc9m3tHVkFqrWWV 4vKaFwMgBgc2V9gbQgzohKbsu3AttPhaX9BwHuWqjkFn 20.123456
```

Amounts support up to 6 decimal places (`DECIMALS = 6`).

### Raydium CPMM

Create a pool (prints `Pool ID` — save it for other scripts):

```bash
npx tsx raydium/create-pool.ts
```

Check pool price and reserves:

```bash
npx tsx raydium/get-price.ts
```

Swap tokens:

```bash
INPUT_MINT=8wxVQjQ994K31odPWBgDqbXJv581fMiFH9G4VLGQ6cnY \
AMOUNT_RAW=1000000 \
npx tsx raydium/swap.ts
```

Deposit liquidity:

```bash
BASE_AMOUNT=1000 QUOTE_AMOUNT=0.5 npx tsx raydium/deposit-lp.ts
```

Withdraw all LP:

```bash
npx tsx raydium/withdraw-lp.ts
```

View fee stats and LP earnings preview:

```bash
npx tsx raydium/fee-stat.ts
```

Type-check:

```bash
npx tsc --noEmit
```

## Scripts

### `deploy-token.ts`

Deploys SPL token mints for every token in `TOKEN_DETAILS`. Uploads metadata to Pinata, creates the mint, attaches Metaplex metadata, and appends successes to `deployed-token.json`.

### `mint-token.ts`

Mints an existing SPL token to a recipient. Creates the recipient ATA if needed.

---

## Raydium scripts

All Raydium scripts use `dev-wallet.json`, target **devnet**, and accept config via environment variables (with devnet defaults for the AAPL-t / USDC-T test pair).

Shared env vars:

| Variable | Description | Default |
|----------|-------------|---------|
| `POOL_ID` | CPMM pool address | `FKzvtrxbd1SBn7DrnmbWqA2HB2NiH7PJmVehHVnCHn79` |

### `raydium/create-pool.ts`

Creates a new Raydium CPMM pool and deposits initial liquidity in one transaction.

| Variable | Description | Default |
|----------|-------------|---------|
| `BASE_MINT` | Base token mint (mintA) | AAPL-t mint |
| `QUOTE_MINT` | Quote token mint (mintB) | USDC-T mint |
| `BASE_AMOUNT` | Initial base deposit (human-readable) | `200000` |
| `QUOTE_AMOUNT` | Initial quote deposit (human-readable) | `100` |

Outputs: `Pool ID`, `LP mint`, vault addresses, transaction link.

Pool config: 0.25% trade fee, no protocol/fund/creator fee split (100% of fees go to LPs).

```bash
BASE_MINT=... QUOTE_MINT=... BASE_AMOUNT=200000 QUOTE_AMOUNT=100 npx tsx raydium/create-pool.ts
```

### `raydium/deposit-lp.ts`

Adds liquidity to an existing pool. Specify how much base and quote to deposit; the script picks the limiting side to match the pool ratio.

| Variable | Description | Default |
|----------|-------------|---------|
| `BASE_MINT` | Base token mint | AAPL-t mint |
| `QUOTE_MINT` | Quote token mint | USDC-T mint |
| `BASE_AMOUNT` | Base amount to deposit | `200000` |
| `QUOTE_AMOUNT` | Quote amount to deposit | `100` |
| `SLIPPAGE` | Slippage tolerance (decimal) | `0.01` (1%) |

Shows before/after balances, tokens spent, and LP received.

**Note:** With `SLIPPAGE=0.01`, the SDK deposits ~99% of the input-side amount (e.g. 99 USDC instead of 100). Lower slippage for tighter amounts, or request slightly more to compensate.

```bash
BASE_AMOUNT=1000 QUOTE_AMOUNT=0.5 SLIPPAGE=0.005 npx tsx raydium/deposit-lp.ts
```

### `raydium/withdraw-lp.ts`

Burns **all** LP tokens in the wallet for the given pool and redeems base + quote.

| Variable | Description | Default |
|----------|-------------|---------|
| `SLIPPAGE` | Slippage tolerance | `0.005` (0.5%) |

Prints before/expected/after balances and the net tokens received.

```bash
npx tsx raydium/withdraw-lp.ts
```

### `raydium/swap.ts`

Executes a CPMM swap. Fee is deducted from the **input** token.

| Variable | Description | Default |
|----------|-------------|---------|
| `INPUT_MINT` | Mint of the token you are selling | USDC-T mint |
| `AMOUNT_RAW` | Input amount in raw units (atoms) | `1000000` (1 USDC) |

`AMOUNT_RAW` is in smallest units: for 6-decimal tokens, `1_000_000` = 1 token.

Prints human-readable quote, fee, and transaction link.

```bash
# Swap 5 USDC-T for AAPL-t
INPUT_MINT=8wxVQjQ994K31odPWBgDqbXJv581fMiFH9G4VLGQ6cnY \
AMOUNT_RAW=5000000 \
npx tsx raydium/swap.ts
```

### `raydium/get-price.ts`

Read-only pool stats: reserves, spot prices, and real swap quotes for 1 base / 1 quote (includes fees and price impact).

| Variable | Description | Default |
|----------|-------------|---------|
| `POOL_ID` | Pool to query | see above |

```bash
npx tsx raydium/get-price.ts
```

### `raydium/fee-stat.ts`

Fee and LP analytics for pool admins / LPs:

- Accrued protocol, fund, and creator fees (raw + human-readable)
- Effective fee rates from on-chain config
- LP withdrawal preview: initial deposit vs redeemable amounts on burn

| Variable | Description | Default |
|----------|-------------|---------|
| `INITIAL_BASE_AMOUNT` | Your original base seed deposit | `200000` |
| `INITIAL_QUOTE_AMOUNT` | Your original quote seed deposit | `100` |

Trade fees with no creator/protocol/fund split accrue in vault reserves and increase LP value. Net change vs initial deposit includes both fees earned and impermanent loss.

```bash
INITIAL_BASE_AMOUNT=200000 INITIAL_QUOTE_AMOUNT=100 npx tsx raydium/fee-stat.ts
```

---

## Important Files

### `utils/constants.ts`

Project constants: `DECIMALS`, `RPC_URL`, `TOKEN_DETAILS`.

### `utils/pinata.ts`

Pinata SDK wrapper. Reads `PINATA_JWT` from `.env`.

### `utils/metaplex.ts`

Creates Metaplex metadata for an SPL mint.

### `utils/get-keypair.ts`

Loads the local keypair from `dev-wallet.json`.

### `utils/get-rpc.ts`

Creates a Solana `Connection` for devnet. Edit this file to change the RPC endpoint.

### `utils/get-symbol.ts`

Maps mint addresses to symbols using `deployed-token.json`.

### `deployed-token.json`

Successful token deployments: `name`, `symbol`, `mint`, `metadataCid`, `metadataUri`, `metadataTransaction`.

### `types.ts`

Shared TypeScript types.

## Notes

- All scripts target **devnet**.
- The same wallet (`dev-wallet.json`) is payer, mint authority, metadata authority, and pool LP provider.
- Failed token deploys are skipped; `deployed-token.json` is append-only.
- Save the `Pool ID` from `create-pool.ts` — other Raydium scripts default to it but can override via `POOL_ID`.
- Spot prices from `get-price.ts` differ from swap quotes: spot is theoretical (zero-size), swap quotes include fees and price impact.
- Depositing liquidity requires base/quote amounts that match the pool's current price ratio.
