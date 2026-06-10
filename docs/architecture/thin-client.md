# Thin-Client Routing

How `gbrain init --mcp-only` thin-client installs route operations to a remote `gbrain serve --http` instead of opening a local PGLite. Pulled out of root `CLAUDE.md` for the same reason as `key-files.md`.

---

## Thin-client routing (v0.31.1, Issue #734)

`gbrain init --mcp-only` (v0.29.2) sets up a thin-client install: no local
brain content, just an OAuth client pointing at a remote `gbrain serve --http`.
v0.29.2/v0.30.0 only refused 9 obvious local-only commands; the other ~25
silently fell through to `connectEngine()` and opened the empty local PGLite,
returning "No results." against a populated remote brain. v0.31.1 fixes the
silent-empty-results bug class for every operation surface.

Key files:

- `src/cli.ts` — Routing seam INSIDE the existing op-dispatch path (CDX-1: no
  parallel `src/core/thin-client/` module; routing is a ~80-line conditional
  in `runThinClientRouted`). Detects `isThinClient(cfg)` BEFORE `connectEngine`
  so thin-client installs never open the empty PGLite. localOnly ops on
  thin-client refuse via `refuseThinClient` (with pinpoint hint table
  `THIN_CLIENT_REFUSE_HINTS`). Banner via `printIdentityBannerBestEffort`
  before each routed call (suppressed by `--quiet`, `GBRAIN_NO_BANNER=1`,
  non-TTY default). Exhaustive TS `never` switch on `RemoteMcpError.reason`
  for canned, actionable error messages. ENG-2 renderer parity: local-engine
  path runs `JSON.parse(JSON.stringify(result))` so renderers see the same
  shape on both paths (kills Date/bigint/Buffer drift class).
- `src/core/mcp-client.ts` — `callRemoteTool(config, toolName, args, opts)`.
  Hardened in v0.31.1 (CDX-4): all transport errors normalized to
  `RemoteMcpError` via the `toRemoteMcpError` funnel. New `CallRemoteToolOptions
  {timeoutMs, signal}`; `buildAbortController` composes external signal with
  timeout. New `RemoteMcpErrorReason` stable union, `RemoteMcpErrorDetail.kind`
  ('timeout' | 'aborted' | 'unreachable') sub-tag, `RemoteMcpErrorDetail.code`
  field carrying server-supplied error codes (e.g. `missing_scope`).
  `extractToolErrorCode` parses JSON envelopes first, falls back to substring
  detection for legacy server messages. `unpackToolResult<T>(res)` unchanged
  (parses tool-call JSON content). `_clearMcpClientTokenCache()` test escape.
- `src/core/cli-options.ts` — `parseGlobalFlags` adds `--timeout=Ns` (accepts
  `30s`, `2m`, `500ms`, plain ms). Default `null` = per-command default (30s
  for most ops, 180s for `think`). `parseTimeout(s)` exported helper.
- `src/core/doctor-remote.ts` — `gbrain remote doctor` adds the
  `oauth_client_scopes_probe` check (CDX-5). Probes the read tier via
  `get_brain_identity` and admin tier via `get_health`; reports per-tier
  status with pinpoint remediation when admin is missing. `buildScopeCheck`
  + `ScopeProbeResult` exported for test access. Skippable via
  `GBRAIN_DOCTOR_SKIP_SCOPE_PROBE=1` for fixtures that mock /mcp at JSON-RPC
  initialize level only (MCP SDK Client hangs on shape mismatch).
- `src/core/operations.ts` — `get_brain_identity` op (read scope, no params,
  banner-only): cheap counter packet `{version, engine, page_count,
  chunk_count, last_sync_iso}` for the thin-client identity banner. Reuses
  `engine.getStats()`; banner's 60s client-side TTL bounds frequency to
  ≤1/60s per CLI process (well below the Fly.io health-check cadence that
  motivated the original `getStats` cost warning).
- `src/commands/{salience,anomalies,graph-query,think}.ts` — Per-command
  thin-client routing branches. These commands bypass the operation-layer
  dispatch in cli.ts (call `engine.foo()` directly), so each gets its own
  `if (isThinClient(cfg)) { callRemoteTool(...) }` branch that maps CLI flags
  to op params. `think` is a special case: the server's `think` op
  intentionally disables `--save`/`--take` for remote callers
  (operations.ts:1103-1135 trust-boundary gate); thin-client `think` warns
  loudly when those flags are set.

