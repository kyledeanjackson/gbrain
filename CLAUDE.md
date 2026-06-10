# CLAUDE.md

GBrain is a personal knowledge brain and GStack mod for agent platforms. Pluggable
engines: PGLite (embedded Postgres via WASM, zero-config default) or Postgres + pgvector
+ hybrid search in a managed Supabase instance. `gbrain init` defaults to PGLite;
suggests Supabase for 1000+ files. GStack teaches agents how to code. GBrain teaches
agents everything else: brain ops, signal detection, content ingestion, enrichment,
cron scheduling, reports, identity, and access control.

## Where everything lives (read this first)

This root file is the auto-loaded brief. Deep references live in sibling docs and
are pulled on demand:

| Need | Read |
|---|---|
| File-by-file source tour (operations.ts, engines, MCP, OAuth, minions, cycle, evals — 230+ files) | [`docs/architecture/key-files.md`](docs/architecture/key-files.md) |
| Thin-client (`gbrain init --mcp-only`) routing | [`docs/architecture/thin-client.md`](docs/architecture/thin-client.md) |
| CLI command reference (`init`, `dream`, `jobs`, `eval`, `models`, `doctor`, ...) | [`docs/architecture/commands.md`](docs/architecture/commands.md) |
| Test infrastructure (`bun run test`, verify, slow, serial, E2E DB lifecycle, isolation lint) | [`docs/architecture/testing.md`](docs/architecture/testing.md) |
| Search modes + eval discipline | [`docs/architecture/search-and-eval.md`](docs/architecture/search-and-eval.md) |
| Brain + source topology diagrams | [`docs/architecture/brains-and-sources.md`](docs/architecture/brains-and-sources.md) |
| Releases — versioning, ship, post-ship, CHANGELOG voice, migrations | [`docs/contributing/releases.md`](docs/contributing/releases.md) |
| Policies — migration-canonical, privacy, disclosure, CI, PR scope, community waves | [`docs/contributing/policies.md`](docs/contributing/policies.md) |

Non-Claude agents (Codex, Cursor, OpenClaw, Aider, Continue): start in
[`AGENTS.md`](AGENTS.md) for the install + operating protocol, then come back here
for the architecture reference.

## Two organizational axes (read this first)

GBrain knowledge is organized along two orthogonal axes. Users AND agents must
understand both, or queries misroute silently.

- **Brain** — WHICH DATABASE. Your personal brain is `host`. You can mount
  additional brains (team-published, each with their own DB and access policy)
  via `gbrain mounts add` (v0.19+). Routing: `--brain`, `GBRAIN_BRAIN_ID`,
  `.gbrain-mount` dotfile.
- **Source** — WHICH REPO INSIDE THE DATABASE. A brain can hold many sources
  (wiki, gstack, openclaw, essays). Slugs scope per source. Routing:
  `--source`, `GBRAIN_SOURCE`, `.gbrain-source` dotfile.

Both axes follow the same 6-tier resolution pattern. Read
`docs/architecture/brains-and-sources.md` for topology diagrams (personal, team
mount, CEO-class with multiple team brains) and
`skills/conventions/brain-routing.md` for the agent-facing decision table.

## Architecture

Contract-first: `src/core/operations.ts` defines ~47 shared operations (v0.29 adds `get_recent_salience`, `find_anomalies`, `get_recent_transcripts`). CLI and MCP
server are both generated from this single source. Engine factory (`src/core/engine-factory.ts`)
dynamically imports the configured engine (`'pglite'` or `'postgres'`). Skills are fat
markdown files (tool-agnostic, work with both CLI and plugin contexts).

**Trust boundary:** `OperationContext.remote` distinguishes trusted local CLI callers
(`remote: false` set by `src/cli.ts`) from untrusted agent-facing callers
(`remote: true` set by `src/mcp/server.ts`). Security-sensitive operations like
`file_upload` tighten filesystem confinement when `remote=true` and default to
strict behavior when unset.

For per-file annotations (what each src file does, what landed in which version, who contributed) → [`docs/architecture/key-files.md`](docs/architecture/key-files.md).

## Skills

Read the skill files in `skills/` before doing brain operations. GBrain ships 29 skills
organized by `skills/RESOLVER.md` (`AGENTS.md` is also accepted as of v0.19):

**Original 8 (conformance-migrated):** ingest (thin router), query, maintain, enrich,
briefing, migrate, setup, publish.

**Brain skills (ported from an upstream agent fork):** signal-detector, brain-ops, idea-ingest, media-ingest,
meeting-ingestion, citation-fixer, repo-architecture, skill-creator, daily-task-manager.

**Operational + identity:** daily-task-prep, cross-modal-review, cron-scheduler, reports,
testing, soul-audit, webhook-transforms, data-research, minion-orchestrator. As of
v0.20.4, `minion-orchestrator` is the single unified skill for both lanes of background
work (shell jobs via `gbrain jobs submit shell`, LLM subagents via `gbrain agent run`) ...
the prior `gbrain-jobs` skill was merged in, Preconditions are shared, and trigger
routing is narrowed to what the skill actually covers.

**Skillify loop (v0.19):** skillify (the markdown orchestration), skillpack-check
(agent-readable health report).

**Routing-table compression (v0.32.3.0):** `skills/functional-area-resolver/` —
two-layer dispatch pattern for shrinking large AGENTS.md / RESOLVER.md files
(>=12KB) without losing routing accuracy. Replaces one row per skill with one
entry per functional area, where each area declares its sub-skills in a
`(dispatcher for: ...)` clause. The static-prompt analog of hierarchical agent
routing (AnyTool [arXiv:2402.04253](https://arxiv.org/abs/2402.04253), RAG-MCP
[arXiv:2505.03275](https://arxiv.org/html/2505.03275v1), Anthropic Agent Skills
progressive disclosure). Empirically validated across Opus 4.7 / Sonnet 4.6 /
Haiku 4.5: +13 to +17pp over the verbose baseline at 48% the size (25KB → 13KB
on a real fork). The `(dispatcher for: ...)` clause is the load-bearing signal
— strip it and lenient accuracy collapses to 41.7% on Sonnet (the
`resolver-of-resolvers` ablation case). A/B eval surface lives at
`evals/functional-area-resolver/` (outside `skills/` deliberately so the
skillpack bundler doesn't ship eval infrastructure to downstream installs):
gateway-routed TypeScript harness, 20 training + 5 held-out fixtures, strict +
lenient scoring, three committed cross-model receipts in `baseline-runs/`.
Receipt header binds (model, prompt_template_hash, fixtures_hash, harness_sha,
ts) so future contributors can verify reproduction. Companion `rescore.mjs`
re-scores existing JSONL with lenient tolerance for zero API cost. Reproduce
with `cd evals/functional-area-resolver && node harness.mjs --model
{opus|sonnet|haiku}` (~$0.30–1.70 per model). Nine v0.33.x follow-up TODOs
filed for held-out corpus growth, cross-vendor verification, hierarchical
area-of-areas, embedding-based pre-router, and the run-1 vs run-2
prompt-design ablation methodology.

**Operational health (v0.19.1):** smoke-test (8 post-restart health checks with auto-fix
for Bun, CLI, DB, worker, Zod CJS, gateway, API key, brain repo; user-extensible via
`~/.gbrain/smoke-tests.d/*.sh`).

**Conventions:** `skills/conventions/` has cross-cutting rules (quality, brain-first,
model-routing, test-before-bulk, cross-modal). `skills/_brain-filing-rules.md` and
`skills/_output-rules.md` are shared references.

## Bulk-action progress reporting

All bulk commands (doctor, embed, import, export, sync, extract, migrate,
repair-jsonb, orphans, check-backlinks, lint, integrity auto, eval, files
sync, and apply-migrations) stream progress through the shared reporter
at `src/core/progress.ts`. Agents get heartbeats within 1 second of every
iteration regardless of how slow the underlying work is.

Rules:
- Progress always writes to **stderr**. Stdout stays clean for data output
  (`--json` payloads, final summaries, JSON action events from `extract`).
- Non-TTY default: plain one-line-per-event human text. JSON requires the
  explicit `--progress-json` flag.
- Global flags (`--quiet`, `--progress-json`, `--progress-interval=<ms>`)
  are parsed by `src/core/cli-options.ts` BEFORE command dispatch.
- Phase names are machine-stable `snake_case.dot.path` (e.g.
  `doctor.db_checks`, `sync.imports`). Documented in
  `docs/progress-events.md`; additive changes only.
- `scripts/check-progress-to-stdout.sh` is a CI guard that fails the build
  if any new code writes `\r` progress to stdout. Wired into `bun run test`.
- Minion handlers pass `job.updateProgress` as the `onProgress` callback
  to core functions (DB-backed primary progress channel); stderr from
  `jobs work` stays coarse for daemon liveness only.

When wiring a new bulk command: `import { createProgress } from '../core/progress.ts'`
and `import { getCliOptions, cliOptsToProgressOptions } from '../core/cli-options.ts'`.
Create a reporter with `createProgress(cliOptsToProgressOptions(getCliOptions()))`,
`start(phase, total?)` before the loop, `tick()` inside it, `finish()` after.
For single long-running queries, use `startHeartbeat(reporter, note)` with a
try/finally to guarantee cleanup. Never call `process.stdout.write('\r...')`
in bulk paths, the CI guard will fail the build.

## Capturing test output (NEVER pipe through `tail` / `head`)

**Iron rule:** when running `bun test`, `bun run test:e2e`, `bun run typecheck`,
or any other test/check command, redirect to a file FIRST, then `tail` the file
separately:

```bash
# RIGHT — full output preserved, real exit code visible
bun test > /tmp/ship_units.txt 2>&1
echo "EXIT=$?"
tail -50 /tmp/ship_units.txt
grep -E '(fail\)|✗|error:' /tmp/ship_units.txt | head -30
```

```bash
# WRONG — exit code is `tail`'s (always 0), failures truncated, ship gates fail open
bun test 2>&1 | tail -10
```

The pipe form silently breaks /ship Step T1 (test failure ownership triage) and
the test verification gate (Step 16) because:
- `$?` after a pipe is the LAST command's exit code (`tail` → 0), not bun's
- bun prints failure details before the summary line, so `tail -N` drops them
- Step T1 needs the full failure list to classify in-branch vs pre-existing

This bit us during v0.26.2 ship: `bun test 2>&1 | tail -10` reported "3911 pass / 23 fail"
but no failure details survived, forcing a 23-minute re-run to triage.

Apply the same pattern to any long-running command whose exit code matters:
`bun run typecheck`, `bun run ci:local`, migration runs, eval suites, etc.
For background tasks (`run_in_background: true`), the harness captures the exit
file separately — use it via the bg task's `<id>.exit` file, not the streamed
output.

For the full test taxonomy (fast loop, slow, serial, e2e), the isolation lint, the
`withEnv()` pattern, the canonical PGLite block, and the E2E DB lifecycle → [`docs/architecture/testing.md`](docs/architecture/testing.md).

## Build

`bun build --compile --outfile bin/gbrain src/cli.ts`

## Commands

Top-level: `gbrain init`, `gbrain dream`, `gbrain jobs <sub>`, `gbrain agent <sub>`, `gbrain serve [--http]`, `gbrain models [doctor]`, `gbrain eval <sub>`, `gbrain doctor`, `gbrain reindex`, `gbrain sources <sub>`, `gbrain pages <sub>`, `gbrain whoknows`, `gbrain salience`, `gbrain anomalies`, `gbrain transcripts recent`, `gbrain search modes|stats|tune`.

For the full reference (subcommand flags, "Key commands added in vX.Y.Z" change-log sections, post-upgrade migrations) → [`docs/architecture/commands.md`](docs/architecture/commands.md). Or just run `gbrain --help` / `gbrain --tools-json`.

## Releases + policies

Cutting a release walks through the five files that carry the version, pre- and post-ship requirements, CHANGELOG voice, and the `## To take advantage of v[version]` self-repair block — see [`docs/contributing/releases.md`](docs/contributing/releases.md).

The "what we don't broadcast" rules (privacy, responsible-disclosure, real-names scrubbing) and the CI-maintenance, PR-scope, and community-PR-wave conventions live in [`docs/contributing/policies.md`](docs/contributing/policies.md).

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

**NEVER hand-roll ship operations.** Do not manually run git commit + push + gh pr
create when /ship is available. /ship handles VERSION bump, CHANGELOG, document-release,
pre-landing review, test coverage audit, and adversarial review. Manually creating a PR
skips all of these. If the user says "commit and ship", "push and ship", "bisect and
ship", or any combination that ends with shipping — invoke /ship and let it handle
everything including the commits. If the branch name contains a version (e.g.
`v0.5-live-sync`), /ship should use that version for the bump.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR, "commit and ship", "push and ship" → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
