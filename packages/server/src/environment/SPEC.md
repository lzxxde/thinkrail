---
id: submodule-server-environment
type: submodule-design
status: active
title: environment — stored host environment (pi config folder + variables)
parent: module-server
depends-on: [module-contracts, module-shared]
---

## Responsibility

The user's stored host environment: an optional pi config folder (`PI_CODING_AGENT_DIR`) and an ordered
list of `NAME=value` variables, edited in Settings → Environment and applied to `process.env` once per
host process at boot. It exists because a Dock/Finder launch has no way to pass `PI_*` (the login-shell
import never imports them) and a shell alias is never exported. Everything in-process — pi, extensions,
the bash tool, terminals, stdio MCP servers — then sees one consistent environment, so a `pi` run in a
ThinkRail terminal uses the same config folder.

## Boundary

- **Owns:** structural parse + semantic validation of the record, `applyHostEnvironment()` (called only
  by `host`'s `bootHost`), the applied snapshot and launch-key snapshot, and the status the Settings
  section reads.
- **Public surface (barrel):** `applyHostEnvironment`, `hostEnvironmentStatus`, `updateHostEnvironment`.
- **Allowed deps:** `persistence` (`loadHostEnvironment` / `saveHostEnvironment`), `log`, `contracts`
  (types), `@thinkrail/shared/shellEnv` (`launchEnvKeys`), `@earendil-works/pi-coding-agent`
  (`getAgentDir`, for the folder in use).
- **Forbidden:** `settings` / `AppConfig` (values may be secrets and `AppConfig` is broadcast to every
  frontend and seeded in `server.welcome`); publishing on any channel; logging or reporting variable
  names or values.

## Get right

- **Apply point.** `bootHost` calls `applyHostEnvironment()` after `await resolveShellEnv()` and before
  `initializeJbcentralRuntime()` / `createServer()` — before the first `getAgentDir()` reader. Applying
  later would split the process: the model runtime, MCP user-config watcher, history root and Central
  hold the agent dir they first saw.
- **Precedence: launch env > stored record > login-shell import / locale repair.** Names present before
  the shell repair (`launchEnvKeys()`) are never overwritten, so `FOO=1 thinkrail` and the e2e/smoke
  isolation through `PI_CODING_AGENT_DIR` keep working; the status lists those names as
  `launchOverridden`. The key set is copied at apply time, so a fallback snapshot (no shell repair ran)
  never includes the record's own writes.
- **Change = restart.** `environment.update` only persists; `restartRequired` is "stored ≠ applied".
  Live re-apply was rejected for the split-process reason above. A "Restart now" action is deferred: no
  generic host restart exists.
- **Validation** (all-or-nothing on update, issue per field/row): agent dir must be absolute after `~`
  expansion and an existing directory; names match `[A-Za-z_][A-Za-z0-9_]*`, no duplicates; reserved
  (case-insensitive) are `PATH` (shellEnv owns it), `HOME` / `USERPROFILE` (Bun caches `homedir()`),
  `PI_CODING_AGENT_DIR` (its own field) and `THINKRAIL_*` (data dir, port and host are read before or
  outside the record). Blank rows are dropped; a structurally malformed record is a thrown request error.
- **Names follow the platform's case rule.** On Windows environment names are case-insensitive (Bun's
  `process.env` too), so launch-key membership, duplicate detection and override reporting compare an
  upper-cased key there and exact names elsewhere; display keeps the user's spelling. `applyHostEnvironment`
  takes an injectable `platform` so both branches are pinned by tests on any OS.
- **Boot tolerates drift.** An entry that is invalid on disk (a deleted folder, a hand-edited reserved
  name) is skipped with a `log.warn` naming only field and code; the rest applies. A skipped agent dir
  falls back to pi's default, which the status' `effectiveAgentDir` makes visible.
- **Storage:** `<dataDir>/environment.json`, atomically replaced with mode `0600`; fetched only by
  `environment.get`, never broadcast.
- **One setup per host, not per project.** Per-project was rejected: `process.env` is process-global with pi
  in-process, so provider key lookups and extension code cannot see a per-project value, and third-party
  extensions read the global `getAgentDir()` regardless of a per-session `agentDir`. Revisit only if pi
  gains a scoped agent dir.
- **Consequence the user accepted:** pi keeps transcripts under `<agentDir>/sessions`, so switching the
  folder hides chats made under another one until switched back, as in pi's CLI.

## Network proxy

The same module also owns the stored **network proxy** — one `http(s)://host:port` URL plus a `NO_PROXY`
list — because it is the second thing that only exists to reach `process.env` before anything reads it.

- **Surface:** `applyHostProxy()` (called only by `bootHost`, right after `applyHostEnvironment()`),
  `hostProxyStatus()`, `updateHostProxy()`.
- **Apply = set three variables.** When a URL is stored and the launch environment set neither
  `HTTP_PROXY` nor `HTTPS_PROXY`, boot writes `HTTPS_PROXY` and `HTTP_PROXY` (one URL) and, when present,
  `NO_PROXY`. Nothing else is needed: Bun reads `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` and `NO_PROXY`
  **on every `fetch`**, so a boot-time write covers later requests, child processes and terminals alike.
- **Precedence: launch env > stored proxy.** A launch that already carries `HTTPS_PROXY` (a shell export,
  `HTTPS_PROXY=… thinkrail`) is reported in `launchOverridden` and the record is not applied — otherwise a
  per-launch override could not be tested against a saved value.
- **`http`/`https` only.** A `socks5://` URL is refused as `unsupportedScheme` instead of being written and
  silently ignored: Bun's environment-proxy path skips non-HTTP schemes, so the user must point the record
  at the client's HTTP (mixed) port. `invalidUrl` covers everything the URL parser rejects; there is no
  separate empty-host case because the parser folds it into that error.
- **Change = restart**, for the same split-process reason as the environment: `proxy.update` only persists
  and `restartRequired` is "stored ≠ applied". The panel also shows what the running host actually has, so
  a stale value is visible rather than guessed.
- **Proxy beats an Environment row with the same name.** The environment record applies first, the proxy
  second; a user who typed `HTTPS_PROXY` into the variable list while a proxy URL is stored gets the proxy.
- **Storage:** `<dataDir>/proxy.json`, atomically replaced with mode `0600`; fetched only by `proxy.get`,
  never broadcast (a proxy URL may embed credentials).
