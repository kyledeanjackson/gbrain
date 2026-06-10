# Search Modes + Eval Discipline

The three named search modes (`conservative` / `balanced` / `tokenmax`), the per-knob resolution chain in `src/core/search/mode.ts`, the cost-anchor matrix, cache-key contamination guard (migration v56), the three CLI surfaces (`gbrain search modes`, `gbrain search stats`, `gbrain search tune`), and the eval-discipline rules that every `gbrain eval *` and `gbrain search stats` command resolves through `src/core/eval/metric-glossary.ts`.

---

## Search Mode (v0.32.3)

GBrain ships three named search modes that bundle the search-lite knobs from
PR #897 into a single config key. Pick one at install time; the rest of the
project resolves through `src/core/search/mode.ts`.

| Knob                          | `conservative` | `balanced` | `tokenmax`     |
|-------------------------------|----------------|------------|----------------|
| `cache.enabled`               | true           | true       | true           |
| `cache.similarity_threshold`  | 0.92           | 0.92       | 0.92           |
| `cache.ttl_seconds`           | 3600           | 3600       | 3600           |
| `intentWeighting`             | true           | true       | true           |
| `tokenBudget`                 | **4000**       | **12000**  | **off**        |
| `expansion` (LLM multi-query) | false          | false      | **true**       |
| `searchLimit` default         | 10             | 25         | 50             |

**Cost anchors (downstream agent input cost — gbrain itself is rounding error).**
The corner-to-corner spread is 25x once you pair mode with downstream model.
Chunks ~400 tokens avg. Per-query cost @ 10K queries/month (typical
single-user volume), full search payload, no cache savings:

| Mode \ Downstream | Haiku 4.5 (\$1/M) | Sonnet 4.6 (\$3/M) | Opus 4.7 (\$5/M) |
|---|---|---|---|
| conservative (~4K) | **\$40/mo** | \$120/mo | \$200/mo |
| balanced (~10K) | \$100/mo | \$300/mo | \$500/mo |
| tokenmax (~20K) | \$200/mo | \$600/mo | **\$1,000/mo** |

Scales linearly: multiply by 10 for 100K/mo (heavy power user / multi-user
fleet); divide by 10 for 1K/mo (light usage). Natural pairings span ~4x.
Mismatches (tokenmax+Haiku, conservative+Opus) waste capacity differently
— too-big payload overwhelms a cheap model; too-small payload starves an
expensive one.

tokenmax adds ~\$1.50 per 1K queries in Haiku expansion calls on top of
the matrix (\$15/mo @ 10K). Cache hits cut all numbers ~50%. **The cost
picker copy in `gbrain init` carries the same matrix verbatim** — update
both when refreshing.

**Per-query math vs real-world spend.** The matrix above is what an
isolated benchmark would measure. Real agent loops with disciplined
Anthropic prompt caching see 50-80% discount on top (cache hits skip
downstream entirely). The realistic-scale anchor in
`docs/eval/SEARCH_MODE_METHODOLOGY.md` walks the natural pairings at
single-power-user volume (~860 turns/mo): tokenmax+Opus ~\$700/mo,
balanced+Sonnet ~\$430/mo, conservative+Haiku ~\$170/mo. Setups WITHOUT
cache-aware prompt layout (frequent prefix churn) see the per-query
matrix dominate — mode + model choice matters more there.

**Resolution chain** (matches the v0.31.12 model-tier pattern at
`src/core/model-config.ts:resolveModel`):

    per-call SearchOpts → per-key config (search.cache.enabled, …) →
      MODE_BUNDLES[search.mode] → MODE_BUNDLES.balanced (fallback)

Mode resolution lives in **bare `hybridSearch`** (NOT just the cached wrapper)
per `[CDX-5+6]` in `~/.claude/plans/lets-take-a-look-validated-parrot.md` — so
`gbrain eval replay` and `gbrain eval longmemeval` test the same mode-affected
behavior as the production `query` op.

**Cache-key contamination hotfix `[CDX-4]`:** migration v56 added a
`knobs_hash` column to `query_cache`. The lookup filter is now
`WHERE source_id = $ AND knobs_hash = $ AND embedding similarity < $` so a
tokenmax write (expansion=on, limit=50) can't be served to a conservative
read.

**Three CLI surfaces:**

    gbrain search modes              # what is running, with per-knob attribution
    gbrain search modes --reset      # clear search.* overrides (mode bundle wins)
    gbrain search stats [--days N]   # cache hit rate, intent mix, budget drops
    gbrain search tune [--apply]     # data-driven recommendations

The install picker fires inside `gbrain init` AFTER `engine.initSchema()`
(non-TTY auto-selects). The upgrade banner fires once via `runPostUpgrade`
in `src/commands/upgrade.ts`, gated by `search.mode_upgrade_notice_shown`.

## Eval discipline (v0.32.3)

Every metric printed by any `gbrain eval *` or `gbrain search stats` command
resolves through `src/core/eval/metric-glossary.ts` so industry terms
(`P@k`, `nDCG@k`, `MRR`, `Jaccard@k`) carry a plain-English line in human
output and a `_meta.metric_glossary` block in JSON output (one block per
response per `[CDX-25]`, NOT sibling `_gloss` fields).

The full methodology — datasets, sample selection, pre-registered
expectations, threats to validity, paired-bootstrap + Bonferroni p-value
discipline `[CDX-14]` — lives in `docs/eval/SEARCH_MODE_METHODOLOGY.md`.
Auto-regenerated `docs/eval/METRIC_GLOSSARY.md` is CI-guarded against
drift (`scripts/check-eval-glossary-fresh.sh`).

Per-run records land at `<repo>/.gbrain-evals/eval-results.jsonl` per
`[CDX-23]`. The user's personal `~/.gbrain` brain is NEVER touched —
audit trail lives in the source repo's git history.

