# Screenshots

The four images in `screenshots/` are genuine 1440 × 900 captures of this dashboard, taken on 2026-11-16 in OpenBot's
embedded browser from a local build of the practice snapshot (snapshot date 2026-11-14). The page made no network
requests. No image is a mock-up or a placeholder. Earlier draft captures were replaced.

| File | Route (from `out/dashboard/index.html`, opened from disk) | Shows |
|---|---|---|
| `1-board.png` | `index.html` (default view) | KPIs, the held-out validation strip and the ranked board |
| `2-detail.png` | `index.html#p=steakhouse-financial` | Value build-up (fitted base, growth/age sensitivity) beside the official-source curator plan with cost/time per step |
| `3-filtered.png` | `index.html#set=sourced` | Board filtered to the 9 rows whose plans come from official docs |
| `4-infrastructure.png` | `index.html#p=veda` | Vault infrastructure reached through partners, with source notes |

To reproduce them:

1. `npm run build -- --input <kit>/input/snapshot.json --output out`
2. Open each route at a 1440 × 900 viewport.
3. Save as PNG at most 512 KiB each.
4. Rebuild so `dossier.json` lists the images.
