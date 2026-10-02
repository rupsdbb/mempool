# mempool for the Bitcoin Knots BLAKE2b chain

[mempool](https://github.com/mempool/mempool) v3.3.1, patched to run against the
Bitcoin Knots chain that replaced SHA256d proof-of-work with BLAKE2b at mainnet
height **961640**. Bitcoin Core cannot follow this chain; upstream mempool cannot
index it.

This is a backport. Nearly all of the chain-specific work is other people's —
see [Credits](#credits).

## What the chain needs

| Component | Requirement |
|---|---|
| Node | [Bitcoin Knots](https://bitcoinknots.org/) 29.4.1 or later |
| Electrum server | A BLAKE2b-aware electrs — an unpatched one crash-loops at the first v2 header |
| Database | MariaDB / MySQL |
| Build | Node v24.13.0, Cargo 1.84 (for the Rust GBT module) |

For electrs, use [jasonsopko/electrs branch `blake2b`](https://github.com/jasonsopko/electrs/tree/blake2b),
or Retropex/electrs branch `mempool` for the esplora-style server.

## What was changed

### Backend

| Area | Change |
|---|---|
| Block header | Parses the 164-byte v2 header — `nonce2`, `nonce3`, `extranonce`, `h1Flags`, `xorKey`, `xorKeyMaskClearBits`. Offsets verified against Knots `src/policy/../primitives/block.h` |
| Difficulty | Reads `difficulty_blake2b` when the node omits `difficulty` (Knots #420 removed `getdifficulty`) |
| Fee thresholds | Derived from `BLOCK_WEIGHT_UNITS` instead of the hardcoded 500,000/950,000 vsize, which pinned every tier to the minimum at 800,000 WU |
| Sighash | `SIGHASH_UNIFIED` (0x20) — `0x21`–`0x23` and `0xa1`–`0xa3` |
| Chain tips | Skips the canonical lookup for stale blocks above the active tip, where `getblockhash` throws |
| Mining pools | DATUM pools matched first and flagged from the pools list, rather than hardcoding a single pool name |
| Prices | Fiat price derived as `BTC/<fiat> × BTCB2/BTC`, the cross rate taken from [NeoxEX](https://neoxa.exchange) |

### Frontend

BLAKE2b header fields and a chain badge on block pages; a replay-protection badge
in the transaction features row; SIGHASH_UNIFIED colours and filter; hashrate in
PH/s; no minimum share threshold hiding small pools; English-only build.

### Database migrations

Two migrations run automatically on first start:

- **107** — widens `blocks.header` from `varchar(160)` to `varchar(500)`; the v2 header is 328 hex characters
- **108** — adds `pools.datum`, so DATUM pools are data-driven

Dump your database before upgrading an existing instance.

## Configuration

`backend/mempool-config.json`:

```json
"MEMPOOL": {
  "BLOCK_WEIGHT_UNITS": 800000,
  "AUTOMATIC_POOLS_UPDATE": true,
  "POOLS_JSON_URL": "https://raw.githubusercontent.com/Retropex/mining-pools/master/pools-v2.json",
  "POOLS_JSON_TREE_URL": "https://api.github.com/repos/Retropex/mining-pools/git/trees/master",
  "POOLS_UPDATE_DELAY": 3600
}
```

`frontend/mempool-frontend-config.json`:

```json
"BLOCK_WEIGHT_UNITS": 800000
```

Blocks are capped at 800,000 WU while RDTS is active. At the 4,000,000 default the
projected blocks show the queue at a fifth of its length, and fees are estimated
against blocks the chain cannot mine.

The pools list is Retropex's, which carries the BLAKE2b miners; upstream's does not.
It is refreshed hourly rather than weekly because the miner list still grows quickly.

Note that the pools updater skips re-importing when the upstream file's SHA is
unchanged, so after changing pool-parsing code you may need
`DELETE FROM state WHERE name='pools_json_sha';` to force a refresh.

## Build

```bash
cd backend  && npm install && npm run build
cd frontend && npm install && npm run build
```

`npm install` in `backend/` builds the Rust GBT module, which is why Cargo is
required. `npm ci` does not work — upstream ships a lockfile that npm 11 considers
out of sync with `package.json`.

Serve `frontend/dist/mempool/browser` with nginx and proxy `/api` to the backend.

## Known limitations

- **Historical prices are approximate.** NeoxEX exposes no candles endpoint, so past
  BTC prices are scaled by the *current* cross rate. Live prices are exact.
- **English only.** Other locales are not built; the language selector lists one entry.
- **Address pages depend on electrs.** They will fail against an unpatched server.

## Credits

The chain-specific work is overwhelmingly from these two repositories, both AGPL-3.0:

- **[Retropex/mempool](https://github.com/Retropex/mempool)** — Léo Haf: BLAKE2b
  header support, SIGHASH_UNIFIED, DATUM pool handling, the pools repository,
  hashrate units and pool-ranking changes
- **[jasonsopko/mempool](https://github.com/jasonsopko/mempool)** (branch
  `knots-blake2b`) — Jason Sopko: the chain-tips fix, fee thresholds scaled by block
  weight, and `difficulty_blake2b` support

This repository backports their commits onto the v3.3.1 release, with local changes
to presentation and price handling. It is not affiliated with either project, nor
with [The Mempool Open Source Project](https://github.com/mempool/mempool).

## License

[GNU AGPL v3](LICENSE), inherited from upstream mempool. Copyright for the original
work remains with Mempool Space K.K. and contributors.

"The Mempool Open Source Project" and the mempool logo are trademarks of Mempool
Space K.K. The AGPL covers the code, not the marks — see upstream's trademark policy
before rebranding or redistributing.
