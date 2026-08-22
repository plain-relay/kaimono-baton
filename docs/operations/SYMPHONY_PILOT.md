# Symphony Pilot

Status: experimental, repository-scoped, not enabled for unattended live use

## Purpose and hard gate

This pilot turns one human-approved, deterministic GitHub Issue task into one Codex execution and one Draft PR. It never authorizes merge, ready-for-review, Production, deployment, repository settings, Secrets, Variables, Environments, Cloudflare, DNS, billing, migrations, or user-data operations.

Unattended live use is prohibited until the executable negative isolation test passes on the target machine and a fresh independent exact-base/head security review accepts the implementation. Documentation and ordinary unit tests are not substitutes for those gates.

## Pinned runtime

- Symphony: `openai/symphony@8001b52e3062495a16e520e4ceaf8f9de868c4d0`
- Codex CLI/app-server: exactly `0.147.0`
- Host: WSL2/Linux with `bubblewrap` (`bwrap`)
- Codex permission profile: `symphony-pilot`

The host refuses a different Symphony HEAD, an unexpected patch path set, a mutable or overlapping control plane, an untrusted executable path, an unexpected pilot auth-home entry, or a Codex version other than `codex-cli 0.147.0`. No latest-version substitution is permitted.

The pinned Symphony patch is `symphony/patches/0001-disable-github-agent-tool.patch`. It:

- changes turn metadata title to the identifier only;
- adds pilot-only named permission-profile selection;
- sends exactly one explicit local environment on both `thread/start` and `turn/start`: `environmentId: "local"`, `cwd: workspace`, and `runtimeWorkspaceRoots: [workspace]`; it also sets the top-level `runtimeWorkspaceRoots: [workspace]` that materializes the named profile's `:workspace_roots`, and sends `selectedCapabilityRoots: []` and `dynamicTools: []`;
- verifies `activePermissionProfile.id == "symphony-pilot"` before `turn/start`;
- fails the pilot on unexpected dynamic-tool interaction;
- exposes no GitHub tool specification and rejects GitHub tool execution.
- invokes local hooks with the absolute trusted `/bin/sh`, not a `PATH` lookup.

Validate it against a clean exact checkout:

```sh
node scripts/verify-symphony-pilot-upstream.mjs /path/to/openai-symphony
node scripts/verify-symphony-pilot-upstream.mjs /path/to/disposable-openai-symphony --apply-and-test
```

## Security architecture

```text
human-approved public Issue safe-task v2
  -> exact canonical task hash (includes executionId and baseSha)
  -> trusted approval v2
  -> pristine approved-base workspace
  -> issue lock + final remote revalidation + durable owned claim
  -> one-use 60-second host-only launch permit
  -> root-owned SHA-256-attested control root and external launcher
  -> pinned patched Symphony
  -> bwrap-confined pinned Codex 0.147.0
  -> named default-deny permission profile
  -> workspace-only edits and selected checks
  -> strict regular-file handoff.json
  -> trusted tree builder (temporary index + hash-object + write-tree)
  -> commit-tree
  -> durable treeSha/commitSha
  -> update-ref with trusted empty hooks path
  -> exact-SHA credentialed push
  -> Draft PR
  -> completed state
  -> codex-ready cleanup
```

One Symphony process is the expected operating configuration. This is not the concurrency security boundary: Linux atomic `mkdir` issue/execution claims outside the workspace and durable per-execution state enforce cross-process exclusion. Every process has an unpredictable `SYMPHONY_PILOT_INSTANCE_ID`, plus a launcher-derived SHA-256 process identity over the instance ID, Linux boot ID, and a stable non-shell Symphony parent PID/start time. Both values are persisted and bound into the one-use permit; only their exact pair can finalize. A losing process's `after_run` is a deterministic no-op that does not inspect the handoff or mutate the owner's state. Locks are never broken because of age.

## AI input and capability boundary

Codex receives only:

- the safe identifier `GH-<number>`;
- `.symphony/task.json`, produced by the deterministic validator;
- approved public repository files.

It does not receive the raw Issue title, Issue prose outside the safe task, comments, URL, labels, product/customer/user data, private operational data, provider responses, or credentials.

The durable `SYMPHONY_PILOT_CODEX_HOME` is an auth-only store and must contain exactly one regular non-symlink `auth.json`. Every app-server launch gets a newly created runtime `CODEX_HOME` containing only a copy of that auth file and the SHA-256-attested control-root config. The runtime home is deleted after the app-server exits and is never reused. Any durable `AGENTS.md`, `config.toml`, skill, hook, plugin, MCP, app, connector, marketplace, memory, or other entry makes startup fail before the permit is consumed.

Codex 0.147.0 is explicitly configured with skill instructions and bundled skills disabled, hooks disabled, apps/plugins/connectors/search disabled, no MCP servers, and no orchestrator capability roots. The patched Symphony request selects exactly one built-in `local` environment whose cwd and only environment-native runtime workspace root are the host-validated workspace. Its top-level runtime workspace root is the same exact workspace, which materializes the named profile's `:workspace_roots`. It does not omit environments, select a default, add a second or remote environment, or send capability roots or dynamic tools; unexpected external interaction fails closed.

Codex 0.147.0 applies this named profile:

```toml
default_permissions = "symphony-pilot"

[permissions.symphony-pilot.filesystem]
":minimal" = "read"
"/pilot-runtime/codex" = "read"
"/usr/local" = "deny"
"/usr/src" = "deny"

[permissions.symphony-pilot.filesystem.":workspace_roots"]
"." = "write"

[permissions.symphony-pilot.network]
enabled = false
```

Unlisted filesystem paths are denied. The only non-minimal runtime exception is the read-only `/pilot-runtime/codex` executable that Codex 0.147.0 must re-enter inside its own Bubblewrap stage; it does not grant the `/pilot-runtime` directory, the runtime auth home, or any host data. The normal HOME, normal `~/.codex`, unrelated repositories, host operational files, `/mnt/c`, and GitHub credentials are not mounted into the outer bwrap namespace. Only the fresh ephemeral runtime home is mounted for app-server state and authentication; the durable auth store and state/permit roots are absent from the namespace. The runtime home is not in the agent-command permission set. The workspace is the only writable project root.

The pinned Codex app-server is trusted control-plane code and uses the host network only for its authenticated model-provider transport. The outer namespace therefore does not unshare networking. That does not grant networking to model-controlled execution: the exact `symphony-pilot` profile creates Codex's inner Bubblewrap command sandbox with network disabled. MCP, apps, plugins, connectors, web search, remote environments, capability roots, and dynamic tools remain disabled and fail closed.

Unexpected approval, permission escalation, MCP elicitation, external-tool call, or user-input request terminates the unattended run. The pilot does not silently approve it.

Codex 0.147.0 uses its `granular` approval policy with `sandbox_approval`, `rules`,
`skill_approval`, `mcp_elicitations`, and `request_permissions` all explicitly set to
`false`. In this pinned version, `false` rejects that approval flow instead of
presenting it to an unattended user. The negative gate reads the runtime-effective
policy through app-server `config/read` before starting a thread.

## Required local setup

The runtime control plane is an installed artifact, not the Issue workspace or a normal checkout. From an independently reviewed exact source head, an operator explicitly installs a versioned control root; unattended runtime never invokes `sudo` or self-installs:

```sh
sudo ./scripts/install-symphony-pilot-control.sh "$PWD" '<reviewed-version-or-sha>'
```

The installer refuses a non-root invocation and an existing destination. It copies only the enumerated runtime artifacts to `/opt/plain-relay/kaimono-baton-symphony-control/<version-or-sha>/`, creates a SHA-256 manifest there, and installs a byte-identical launcher at `/opt/plain-relay/kaimono-baton-symphony-launcher`. The control root, manifest, launcher, and trusted executable ancestors must be canonical, root-owned, and not group/other writable. The outer namespace does not mount `/opt`, so neither the active control root nor stable launcher is agent-visible. The host verifies the exact manifest path set and every digest before use. It rejects control/workspace/state overlap in either direction and symlink resolution into an agent-writable tree.

Use private directories on the WSL/Linux filesystem, not `/mnt/c`. The workspace, state, and auth roots must be owned by the Symphony service account and not group/other writable. The auth root contains only `auth.json`:

```sh
export SYMPHONY_PILOT_CONTROL_ROOT=/opt/plain-relay/kaimono-baton-symphony-control/<reviewed-version-or-sha>
export SYMPHONY_PILOT_TRUSTED_LAUNCHER=/opt/plain-relay/kaimono-baton-symphony-launcher
export SYMPHONY_PILOT_WORKSPACE_ROOT=/var/lib/kaimono-baton-symphony/workspaces
export SYMPHONY_PILOT_STATE_DIR=/var/lib/kaimono-baton-symphony/state
export SYMPHONY_PILOT_SYMPHONY_ROOT=/opt/plain-relay/openai-symphony-8001b52e
export SYMPHONY_PILOT_CODEX_HOME=/var/lib/kaimono-baton-symphony/codex-auth
export SYMPHONY_PILOT_CODEX_BIN=/usr/local/libexec/codex-0.147.0
export SYMPHONY_PILOT_GIT_BIN=/usr/bin/git
export SYMPHONY_PILOT_GIT_EXEC_PATH=/usr/lib/git-core
export SYMPHONY_PILOT_NODE_BIN=/usr/bin/node
export SYMPHONY_PILOT_NPM_BIN=/usr/bin/npm
export SYMPHONY_PILOT_BWRAP_BIN=/usr/bin/bwrap
export SYMPHONY_PILOT_SHELL_BIN=/bin/sh
export SYMPHONY_PILOT_INSTANCE_ID='<a fresh random UUID unique to this Symphony process>'
export GITHUB_TOKEN='<fine-grained host token supplied outside the repository>'
```

Resolve the actual distribution-specific absolute paths; do not copy these examples blindly. Install the exact official Codex 0.147.0 binary at `SYMPHONY_PILOT_CODEX_BIN`. Authenticate the dedicated auth-only store through a separate attended operator step. Do not put auth material in the workspace, repository, control root, normal `~/.codex`, or environment visible inside bwrap.

The fine-grained GitHub token is host-only and repository-scoped. Minimum permissions are Metadata read, Contents read/write, Issues read/write, and Pull requests read/write. Do not grant Actions, Administration, Environments, Secrets, Variables, Pages, or organization-wide access.

Server-side main Ruleset/branch protection remains mandatory. Local validation is defense in depth and cannot replace it.

## Gate A: safe task v2

`codex-ready` is necessary but insufficient. The Issue must be open, owner-authored, and contain exactly one block:

```text
<!-- symphony-safe-task:v2 -->
{
  "schemaVersion": 2,
  "executionId": 1,
  "baseSha": "35e94f28587e8e60ad5a39fcd83748f47880c70a",
  "operation": "implement-existing-public-spec",
  "changeMode": "modify-existing",
  "scopePaths": ["src/pages"],
  "referencePaths": ["docs/PROJECT_MAP.md"],
  "symbols": ["HomePage"],
  "acceptanceChecks": ["npm-test", "build", "git-diff-check"],
  "risk": "medium"
}
<!-- /symphony-safe-task -->
```

`baseSha` is a full lowercase 40-hex commit and is part of the canonical task hash. It is selected before approval. If fetched `origin/main` differs, execution is blocked with `base-moved`; the host never silently runs on the new main.

The trusted approval is:

```text
<!-- symphony-approval:v2 -->
{
  "schemaVersion": 2,
  "executionId": 1,
  "taskSha256": "<64 lowercase hex SHA-256 of the canonical validated task>"
}
<!-- /symphony-approval -->
```

Changing the task, `executionId`, or `baseSha` requires a new approval. Unknown keys, free text inside either block, traversal, absolute/backslash/Unicode paths, sibling-prefix escape, and protected paths are rejected.

`changeMode` is enforced against the exact approved base tree:

- `modify-existing`: every output path must be an existing regular base blob and must remain present; additions and deletions are rejected.
- `add-file`: every output path must be absent at the base and become a regular file; overwrites and deletions are rejected.
- `modify-or-add`: each output path may be an existing regular base blob or a new regular file; deletions are rejected.

Each `referencePath` is inspected in the approved Git tree. It must be a tracked regular `100644` or `100755` blob at `baseSha`. Directories, missing/untracked files, symlinks, submodules, transient control paths, and protected paths are rejected.

Immediately before the atomic durable claim, the host re-fetches and revalidates the Issue state, trusted author, label, current task, execution ID, task hash, base SHA, trusted approval, and fetched `origin/main`.

`codex-ready` authorizes dispatch only until the host successfully persists that exact owned claim. The successful claim is the point of no return for the approved execution: a later label removal or Issue edit is not a retroactive revocation. There is no claim that GitHub state and local process launch are globally atomic. Instead, the host performs the final remote read under the issue lock immediately before the claim, then creates a short-lived one-use permit binding issue, execution ID, task hash, base SHA, owner UUID, timestamp, and nonce. The wrapper cannot start app-server without consuming that exact permit.

## Workspace and durable state

Before claim creation or `task.json`, the host checks out and hard-resets to the approved base, runs `git clean -ffdx`, and requires full `git status --porcelain --untracked-files=all` cleanliness. This removes tracked modifications, untracked files, and ignored leftovers from earlier executions.

State progression is:

```text
preparing -> claimed -> finalizing -> completed
     \          \
      +-----------> blocked
```

- `preparing`: the issue/execution locks and owner identity are durable; deterministic pre-agent work is in progress.
- `claimed`: the exact authorization and owner are durable and one launch permit may be consumed. Another process/restart does not rerun it.
- `finalizing`: exact `treeSha` and `commitSha` are durable; recovery uses only those objects.
- `completed`: Draft PR handoff is durable; label cleanup may be retried.
- `blocked`: a larger `executionId` and new exact approval are required.

Transient unauthenticated GitHub read/API failures and temporary remote transport failures are not converted into permanent task rejection. Deterministic task/approval/base/pin/path/workspace/configuration/tooling failures occur under the issue coordination lock and are persisted with enumerated blocker codes. If a bootstrap control check fails before the host can safely execute, the immutable launcher best-effort records an execution-0 generic blocked state only after the private state/workspace roots and owner UUID are valid; it never executes a failed-attestation host. A blocked execution ID cannot dispatch again; a larger exact execution ID and approval are required. Raw provider/system errors are not copied into Issue comments, PR bodies, handoff, or AI task data.

A stale lock is never removed automatically. An operator must verify the owning process is gone and reconcile state. An interrupted `preparing` or `claimed` state can be explicitly quarantined with:

```sh
"$SYMPHONY_PILOT_TRUSTED_LAUNCHER" host operator-block <issue-number> <execution-id>
```

The command refuses while the lock directory still exists. Lock removal itself is a deliberate operator action after process/state inspection, never an age-based action.

## Handoff and trusted finalizer

`task.json` and `handoff.json` must be regular non-symlink files inside a regular `.symphony` directory. FIFOs, devices, directories, symlinks, and path escapes are rejected. A ready handoff contains exactly the selected checks, each exactly `"pass"`; arbitrary prose is rejected.

The host independently verifies unchanged HEAD, current branch ref, all refs snapshot, repository index bytes, `.git/config`, origin fetch/push URL, changed paths, regular-file types, protected paths, exact scope ancestry, and `git diff --check`. Added symlinks/submodules are rejected.

The agent-controlled index is never used to create the commit. The trusted finalizer:

1. loads the approved base into a temporary trusted index;
2. hashes validated regular files with `git hash-object --no-filters`;
3. applies only `changeMode`-authorized additions/modifications with `git update-index --cacheinfo` (no mode authorizes deletion);
4. obtains the exact tree with `git write-tree`;
5. creates the commit object with `git commit-tree`;
6. durably records `treeSha` and `commitSha` before changing a ref;
7. updates only the deterministic local branch ref;
8. pushes the exact persisted SHA to `refs/heads/codex/gh-<issue>`.

All privileged Git commands invoke validated absolute binaries with a fixed root-owned `GIT_EXEC_PATH` and minimal trusted `PATH`. They use sanitized HOME/XDG, `GIT_CONFIG_NOSYSTEM=1`, no global config, an empty trusted `core.hooksPath` outside the workspace, no credential helper, and a literal validated HTTPS destination. The host rejects unexpected local Git configuration, including helpers, URL rewrites, filters, SSH commands, and hook paths, before it constructs the Authorization value. Repository/system/global pre-push and reference-transaction hooks, aliases, remote helpers, and workspace executables cannot change privileged semantics. `--no-verify` is not used.

No npm, test, build, package script, agent executable, or repository hook runs after the finalizer introduces credentials. After push, the host performs only GitHub API handoff, persists `completed`, and removes `codex-ready` best-effort. The PR is always Draft and targets `main`.

## Negative isolation test

Run from a dedicated clean `GH-<number>` workspace on the exact installed target WSL/Linux setup before any unattended live execution. Its issue state slot must be unused; the test creates and removes a synthetic host-only claim and launch permit and never contacts GitHub:

```sh
node scripts/symphony-pilot-isolation-test.mjs
```

The default test uses Codex app-server `thread/start` and sandboxed `command/exec`; it does not prompt a model or transmit canary contents. An explicitly requested `--model-turn` run sends only the fixed synthetic prompt `Return exactly PILOT_MODEL_OK. Do not call tools.` and verifies the response before rerunning the command-network probe. `--model-edit` first performs that transport check, then uses a synthetic `pilot-fixture.txt` containing only `BEFORE` and requires a model-originated successful `commandExecution` to replace it with exactly `AFTER` and respond `PILOT_EDIT_OK`. It proves:

1. workspace read succeeds;
2. workspace write succeeds;
3. normal HOME canary read fails;
4. normal `~/.codex` canary read fails;
5. both durable and ephemeral pilot `auth.json` reads fail from the agent sandbox;
6. unrelated outside-workspace canary read fails;
7. `/mnt/c` is unavailable;
8. model-controlled command external network access fails;
9. `activePermissionProfile.id` is exactly `symphony-pilot`;
10. unexpected durable pilot-home `AGENTS.md`, skills, hooks, MCP, or plugin content makes startup fail closed;
11. both the installed control root and stable launcher are absent from the agent namespace, and control modification is impossible;
12. when explicitly enabled, the trusted app-server can complete the fixed no-tool authenticated provider turn while command network remains denied.
13. the exact one-local-environment session has a usable inner `command/exec` path;
14. the selected local environment has exactly the workspace as its cwd and only runtime workspace root;
15. no remote exec-server configuration reaches model-controlled commands.

Before these checks, the wrapper accepts only Codex 0.147.0 and the test verifies the
effective granular policy is the exact all-false pilot policy. Missing WSL/Linux,
`bwrap`, `curl`, exact Codex, config, or expected profile is a hard failure, not a
skip/pass.

Codex 0.147.0 `:minimal` intentionally includes system runtime paths such as `/usr`; those paths are a non-secret runtime boundary, not a private-control boundary. The more-specific `/usr/local` and `/usr/src` denies are validated in the target gate. Pilot control and auth material must never be placed under system-runtime roots; all stable pilot control lives beneath the outer-unmounted `/opt/plain-relay` root.

## Start, stop, and rollback

After the upstream patch/tests and negative isolation gate pass:

```sh
cd "$SYMPHONY_PILOT_SYMPHONY_ROOT/elixir"
./bin/symphony "$SYMPHONY_PILOT_CONTROL_ROOT/symphony/WORKFLOW.md"
```

Stopping the single expected Symphony process is the kill switch. Do not enable unattended execution until independent review accepts the exact implementation head.

Rollback: stop Symphony, verify no needed finalization remains, retain state until no Issue can dispatch, remove workspaces and the dedicated pilot runtime, and revoke the pilot token. Repository rollback is a separately reviewed revert. Product runtime and Production infrastructure are not changed by this pilot.

The autonomous boundary ends at one Draft PR. Independent exact-base/head review, CI, human residual-risk acceptance, human exact-head merge approval, and any later Production decision remain separate gates.
