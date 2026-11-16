# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/NaufalDzz/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/NaufalDzz/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An offline research dashboard for DeFi protocols whose DefiLlama record carries **no token**. Each row gets an
implied value from a TVL-to-value mapping that is chosen by held-out error on the same snapshot's traded tokens,
plus a farm plan that is either built from official docs (for a few prominent rows) or a labelled research
checklist, separate risk / effort / cost figures, and a local watchlist. Built for make.fun's token-radar-01.

*Implied values are cross-sectional estimates of what a token might be worth if a protocol's record held. They
are not prices, launch forecasts, eligibility claims or promised rewards. "No token recorded" describes
DefiLlama's record, never proof that no token exists or is planned. Plan costs, times, test sizes and review
horizons are assumptions, not protocol requirements.*

## Run it

Node 22.18+ and the standard library only; no install step, no network.

```sh
# build from the token-radar-01 kit's practice snapshot (any valid snapshot path works)
npm run build -- --input /path/to/token-radar-01-kit/input/snapshot.json --output out
# open out/dashboard/index.html from disk (file://); it reads zz-data.js beside it, never fetches

# tests: gate replica, determinism, the real dossier text, validation, packing, honest failure cases, page logic
TOKEN_RADAR_SNAPSHOT=/path/to/token-radar-01-kit/input/snapshot.json npm test
```

Without `TOKEN_RADAR_SNAPSHOT` (and no kit beside the repo) the practice-snapshot tests are skipped and the
synthetic ones still run. `--screenshots <dir>` copies images from another directory instead of `screenshots/`.
In the grader `main.ts` reads `/input/snapshot.json` and writes `/output/{board.json,dashboard/,screenshots/,dossier.json}`.

## Value model and its validation (lib/validate.ts, lib/model.ts)

Only protocols whose token already trades have an observed market cap. On those, seven mappings from TVL (and
optionally category, 7-day growth, listing age, chain breadth) to log market cap are scored with 5-fold
cross-validation. Folds are fixed by a hash of the slug. Every median, OLS fit and category offset is refitted
without the held-out fold. Error is the median |log10(predicted ÷ actual)| in "dex" (0.30 dex is a factor of 2).

Practice snapshot (2026-11-14, 128 traded comparables):

| Mapping | Median dex | Mean dex | Within ×3 |
|---|---|---|---|
| one all-category multiple | 0.695 | 0.770 | 34% |
| shrunk category multiple | 0.663 | 0.793 | 33% |
| category multiple × growth × age × breadth (the previous model) | 0.677 | 0.795 | 31% |
| **size-aware fit: ln mcap = a + b ln TVL (used)** | **0.544** | **0.692** | 43% |
| size-aware fit + shrunk category offset | 0.567 | 0.705 | 44% |
| size-aware fit × growth × age × breadth | 0.547 | 0.697 | 45% |
| size-aware fit + category offset × growth × age × breadth | 0.578 | 0.714 | 46% |

The build selects the lowest median error, keeping a simpler mapping when another is within 0.02 dex. On this
snapshot that is the size-only fit (a = 6.965, b = 0.522: value grows with roughly the square root of TVL). The
fixed 7-day-growth, listing-age and breadth heuristics did **not** lower median held-out error (0.547 vs 0.544;
mean 0.697 vs 0.692, though slightly more tokens land within ×3), so they are not in the value. The page still
shows them on every row, with their value under the heuristics as a sensitivity, and the model tab has a
what-if that switches them on. The selection is generic: another snapshot may select another mapping.

Honest limits of this check: the same folds report the errors and pick the mapping, so the chosen error is
slightly optimistic (model selection, not an independent final test). Launched tokens may differ systematically
from tokenless protocols. It validates a cross-sectional proxy, not launch probability, future prices or rewards.

On top of the fitted base, two judgement discounts are applied and labelled as untested: ×0.6 when a
token-bearing protocol shares the first word of the name (a possible parent token), and ×0.3 for weak rows.
The range is ×/÷ the selected mapping's held-out median error, widened per missing field. The listing date is
DefiLlama's `listed_at`, a proxy for time without a token, not a founding or launch date.

**Value vs opportunity vs confidence.** Value is the estimate above. Opportunity (0–100) ranks value per $ of TVL
after risk and effort. Confidence grades the evidence (comparables, missing data, classification), not launch odds.

## Classification

Ranked: protocols with no CoinGecko id, ticker or market cap that are not bridges, exchanges, liquid-staking,
versioned or wrapped products, plus every watchlist slug. A watchlist slug whose record carries a token stays on
the board flagged `watchlist-token` (Low confidence, never called pre-token). If a snapshot has under 100
candidates, set-aside no-token rows are added as labelled `weak-candidate` rows. Traded or recorded tokens are
never used to reach the 100-row floor. If no-token rows cannot reach it, the build exits with code 3 and says why.
Every row carries a certainty (clear / uncertain / weak) and its reason.

## Plans and sources (lib/plans.ts, lib/sources.json)

For nine prominent practice rows, official public docs were read on 2026-11-16 with read-only requests and
paraphrased. Each source note records its exact URL, what it establishes and what it does not. These plans
separate curators (Steakhouse, Sentora, Gauntlet: risk managers of vaults hosted on Morpho, Kamino or Euler) and
vault infrastructure reached through partners (Veda) from direct user apps (USDD, Polymarket, OnRe, Symbiotic,
Upshift). Every other row gets a category research checklist: product, access and rewards gates, then an
*optional example workflow*. No plan uses leverage, wash trading or repeated transactions to create activity, and
none involves a wallet or a real transaction in this build. The URLs are inert reference text; the build and the
page never fetch them.

## Dossier evidence

`main.ts` writes `dashboard/0-evidence.md`, a generated summary of this run: coverage, the validation table,
worked valuations recomputed against board.json, classification, two representative plans and source reading.
It sorts first, and `zz-data.js` (all rows, packed so a 4000-row board stays under the 4 MiB dashboard limit) sorts
last. The vendored `buildDossier` then shows `0-evidence.md`, `app.css`, `app.js` and `index.html` whole within
its 65,536-byte text. `main.ts` checks this and drops whole low-priority evidence sections until it holds.

## Limitations

- One snapshot: no price history, supply, unlocks, funding or team intent.
- The comparables are tokens that already launched.
- Set-aside, related-token, risk, effort and cost rules are heuristics, with reasons shown per row.
- Gas and time figures are typical ranges, not quotes.
- Source notes reflect the docs on 2026-11-16 and can go stale.

## Credits

Started from the make.fun token-radar-01 starter (MIT, © 2026 the make.fun team): the main.ts pipeline shape and
snapshot parsing follow it. `vendor/makefun-board.ts` is the kit's library, unmodified. Data: DefiLlama via the
kit's snapshot. Source notes paraphrase the official docs listed in `lib/sources.json`. Some leads (Steakhouse
about/products pages, Morpho earn docs, Veda core components) were suggested by a reviewer and re-read
independently. The model, validation, plans, page and tests are this repository's own. MIT licence.

---

<sub>Entered on [make.fun](https://make.fun/?ref=52vz5va8&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
