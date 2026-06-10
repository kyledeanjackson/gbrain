# Project Policies

What is canonical, what we do not broadcast, how we credit contributors, how we describe PRs, and how community wave-merges work.

Covers: migrations are canonical not advisory; privacy rule (no real names in public docs); responsible-disclosure rule; GitHub Actions SHA maintenance; PR description scope; community PR wave process.

---

## Migration is canonical, not advisory

GBrain's job is to deliver a canonical, working setup to every user on upgrade.
Anything that looks like a "host-repo change" — AGENTS.md, cron manifests,
launchctl units, config files outside `~/.gbrain/` — is a GBrain migration
step, not a nudge we leave for the host-repo maintainer. Migrations edit host
files (with backups) to make the canonical setup real. Exceptions: changes
that require human judgment (content edits, renames that break semantics,
host-specific handler registration where shell-exec would be an RCE surface).
Everything mechanical ships in the migration.

**Test:** if shipping a feature requires a sentence that starts with "in
your AGENTS.md, add…" or "in your cron/jobs.json, rewrite…", the migration
orchestrator should be doing that edit, not the user.

**The exception is host-specific code.** For custom Minion handlers
(host-specific integrations like inbox sweeps or third-party API scanners), shipping them as a
data file the worker would exec is an RCE surface. Those get registered in
the host's own repo via the plugin contract (`docs/guides/plugin-handlers.md`);
the migration orchestrator emits a structured TODO to
`~/.gbrain/migrations/pending-host-work.jsonl` + the host agent walks the
TODOs using `skills/migrations/v0.11.0.md` — stays host-agnostic, still
canonical.

## Privacy rule: scrub real names from public docs

**Never reference real people, companies, funds, or private agent names in any
public-facing artifact.** Public artifacts include: `CHANGELOG.md`, `README.md`,
`docs/`, `skills/`, PR titles + bodies, commit messages, and comments in checked-in
code. Query examples, benchmark stories, and migration guides MUST use generic
placeholders.

Why: gbrain runs a personal knowledge brain containing notes on real people and
real companies (YC founders, portfolio companies, funds, investors, meeting
attendees). When a doc copies a query like `gbrain graph diana-hu --depth 2` or
names a specific agent fork like `Wintermute`, that real name gets indexed by
search engines, surfaced in cross-references, and distributed with every release.

**Name mapping** to use in examples:
- Agent forks → `your agent fork`, `a downstream agent`, or `agent-fork`
- Example person → `alice-example`, `charlie-example`, or `a-founder`
- Example company → `acme-example`, `widget-co`, or `a-company`
- Example fund → `fund-a`, `fund-b`, `fund-c`
- Example deal → `acme-seed`, `widget-series-a`
- Example meeting → `meetings/2026-04-03` (generic date is fine)
- Example user → `you` or `the user`, never a proper name

**Specific rule: never say `Wintermute` in any CHANGELOG, README, doc, PR, or
commit message.** When the temptation is to illustrate with the real fork name:
- Reader-facing copy → `your OpenClaw` (covers Wintermute, Hermes, AlphaClaw,
  and any other downstream OpenClaw deployment in one term the reader already
  recognizes).
- First-person / origin-story copy → `Garry's OpenClaw` (honest that this is
  the production deployment driving the feature, without exposing the private
  agent's name).

`Wintermute` may appear in private artifacts (scratch plans under
`~/.gstack/projects/…`, memory files, conversation transcripts, CEO-review
plans) — those aren't distributed. Anything checked into this repo or shipped
in a release must use the OpenClaw phrasing above. Sweeping a stale reference
is a small clean-up PR, not a debate.

**When in doubt, ask yourself:** "Would this query reveal private information
about the user's contacts, investments, or portfolio if it were read by a
stranger?" If yes, replace with generic placeholders.

**Illustrative API examples with household-brand companies** (Stripe, Brex, OpenAI,
GitHub, etc.) are fine — they're public entities, not contacts in anyone's brain.
Do not confuse illustrative API examples with queries that reveal real
relationships.

## Responsible-disclosure rule: don't broadcast attack surface in release notes

**When a release fixes a security gap or a user-impacting bug, describe the fix
functionally. Do not enumerate the attack surface, quantify the exposure window,
or highlight the most sensitive records by name in public-facing artifacts.**

Public-facing artifacts include: `CHANGELOG.md`, `README.md`, `docs/`, PR titles
and bodies, commit messages, GitHub issue titles and comments, release pages,
tweets, blog posts.

**Don't write:**
- "10 tables were publicly readable by the anon key for months, including X, Y, Z"
- "X and Y are the most sensitive ones"
- "N tables exposed. Fix: enable RLS on these specific tables: ..."

**Do write:**
- "Security hardening pass. Fresh installs secure by default. Existing brains
  brought to the same bar automatically on upgrade."
- "If `gbrain doctor` still flags anything after upgrade, the message names each
  table and gives the exact fix."

Why: anyone reading the release page before they've upgraded now has a directed
probe list for unpatched installs. The source code ships the specifics anyway
(`src/schema.sql`, `src/core/migrate.ts`, test fixtures) — reverse engineers can
get them. But the release page is a broadcast channel. Don't hand attackers a
curated list with a banner.

**The test:** if a reader with no prior context could read the release note and
walk away knowing "gbrain at version X has table Y readable by anon key until
they patch," the note is too specific. Rewrite until that's no longer possible.

**What IS fine in public artifacts:**
- The mechanism of the fix ("the check now scans every public table instead of
  a hardcoded allowlist").
- User-facing operator ergonomics (the escape-hatch SQL template, the upgrade
  commands, the breaking-change flag).
- Credit to contributors.
- Generic framing of severity ("security posture tightening pass") without
  quantification.

**What stays in private artifacts (plan files, private memories, internal docs):**
- Specific table names, record counts, exposure duration.
- Which records stand out as highest-risk.
- Detailed before/after tables in the "numbers that matter" format.

If the CEO/Eng review of a plan produces a detailed exposure table, keep it in
the plan file under `~/.claude/plans/` or `~/.gstack/projects/`. Don't copy it
into the CHANGELOG or PR body.

Applies retroactively: if you see a prior CHANGELOG entry naming attack-surface
specifics, scrub it as a small cleanup commit, the same way a stale Wintermute
reference gets swept.

## Schema state tracking

`~/.gbrain/update-state.json` tracks which recommended schema directories the user
adopted, declined, or added custom. The auto-update agent (SKILLPACK Section 17)
reads this during upgrades to suggest new schema additions without re-suggesting
things the user already declined. The setup skill writes the initial state during
Phase C/E. Never modify a user's custom directories or re-suggest declined ones.

## GitHub Actions SHA maintenance

All GitHub Actions in `.github/workflows/` are pinned to commit SHAs. Before shipping
(`/ship`) or reviewing (`/review`), check for stale pins and update them:

```bash
for action in actions/checkout oven-sh/setup-bun actions/upload-artifact actions/download-artifact softprops/action-gh-release gitleaks/gitleaks-action; do
  tag=$(grep -r "$action@" .github/workflows/ | head -1 | grep -o '#.*' | tr -d '# ')
  [ -n "$tag" ] && echo "$action@$tag: $(gh api repos/$action/git/ref/tags/$tag --jq .object.sha 2>/dev/null)"
done
```

If any SHA differs from what's in the workflow files, update the pin and version comment.

## PR descriptions cover the whole branch

Pull request titles and bodies must describe **everything in the PR diff against the
base branch**, not just the most recent commit you made. When you open or update a
PR, walk the full commit range with `git log --oneline <base>..<head>` and write the
body to cover all of it. Group by feature area (schema, code, tests, docs) — not
chronologically by commit.

This matters because reviewers read the PR body to understand what's shipping. If
the body only covers your last commit, they miss everything else and can't review
properly. A 7-commit PR with a body that describes commit 7 is worse than no body
at all — it actively misleads.

When in doubt, run `gh pr view <N> --json commits --jq '[.commits[].messageHeadline]'`
to see what's actually in the PR before writing the body.

## Community PR wave process

Never merge external PRs directly into master. Instead, use the "fix wave" workflow:

1. **Categorize** — group PRs by theme (bug fixes, features, infra, docs)
2. **Deduplicate** — if two PRs fix the same thing, pick the one that changes fewer
   lines. Close the other with a note pointing to the winner.
3. **Collector branch** — create a feature branch (e.g. `garrytan/fix-wave-N`), cherry-pick
   or manually re-implement the best fixes from each PR. Do NOT merge PR branches directly —
   read the diff, understand the fix, and write it yourself if needed.
4. **Test the wave** — verify with `bun test && bun run test:e2e` (full E2E lifecycle).
   Every fix in the wave must have test coverage.
5. **Close with context** — every closed PR gets a comment explaining why and what (if
   anything) supersedes it. Contributors did real work; respect that with clear communication
   and thank them.
6. **Ship as one PR** — single PR to master with all attributions preserved via
   `Co-Authored-By:` trailers. Include a summary of what merged and what closed.

**Community PR guardrails:**
- Always AskUserQuestion before accepting commits that touch voice, tone, or
  promotional material (README intro, CHANGELOG voice, skill templates).
- Never auto-merge PRs that remove YC references or "neutralize" the founder perspective.
- Preserve contributor attribution in commit messages.

