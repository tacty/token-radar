# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/tacty/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/tacty/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar over the sealed DefiLlama snapshot: all 289 pre-token protocols ranked by an implied value built from their own category's trading peers — median market-cap/TVL with winsorized ratios and shrinkage for thin categories — tilted by 7-day momentum and track record, with wrapped and staked products of already-trading assets flagged and discounted instead of mistaken for launches. Every row carries a concrete farm plan (action, cost, time) generated from its own category, chains, TVL and age, and the dashboard prints each protocol's full model breakdown, with sortable and filterable board, per-protocol detail views, and a separate already-trading view that holds the peer evidence.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=kwg9khhh&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
