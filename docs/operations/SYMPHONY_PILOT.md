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

The host refuses a different Symphony HEAD or an unexpected patch path set. `scripts/symphony-pilot-codex.sh` refuses a missing `bwrap`, a non-Linux host, a workspace or pilot home on `/mnt/c`, a changed pilot config, or a Codex version other than `codex-cli 0.147.0`. No latest-version substitution is permitted.

The pinned Symphony patch is `symphony/patches/0001-disable-github-agent-tool.patch`. It:

- changes turn metadata title to the identifier only;
- adds pilot-only named permission-profile selection;
- sends `environments: []`, `selectedCapabilityRoots: []`, and `dynamicTools: []`;
- verifies `activePermissionProfile.id == "symphony-pilot"` before `turn/start`;
- fails the pilot on unexpected dynamic-tool interaction;
- exposes no GitHub tool specification and rejects GitHub tool execution.

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
  -> atomic filesystem lock + durable preparing/claimed state
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

One Symphony process is the expected operating configuration. This is not the concurrency security boundary: a Linux atomic `mkdir` claim outside the workspace and durable per-execution state enforce cross-process exclusion. A second process cannot reach Codex for the same `(Issue, executionId)`. Locks are never broken because of age.

## AI input and capability boundary

Codex receives only:

- the safe identifier `GH-<number>`;
- `.symphony/task.json`, produced by the deterministic validator;
- approved public repository files.

It does not receive the raw Issue title, Issue prose outside the safe task, comments, URL, labels, product/customer/user data, private operational data, provider responses, or credentials.

The dedicated pilot `CODEX_HOME` must contain only the exact `symphony/codex/config.toml`, Codex-managed state required for this pilot, and the pilot authentication state. Do not copy the normal `~/.codex`, config, MCP servers, apps, plugins, connectors, capability roots, remote environments, memories, or skills into it.

Codex 0.147.0 applies this named profile:

```toml
default_permissions = "symphony-pilot"

[permissions.symphony-pilot.filesystem]
":minimal" = "read"

[permissions.symphony-pilot.filesystem.":workspace_roots"]
"." = "write"

[permissions.symphony-pilot.network]
enabled = false
```

Unlisted filesystem paths are denied. The normal HOME, normal `~/.codex`, unrelated repositories, host operational files, `/mnt/c`, and GitHub credentials are not mounted into the outer bwrap namespace. The dedicated pilot home is mounted for app-server state and authentication, but is not in the agent-command permission set. The workspace is the only writable project root. Agent command network access is denied.

Unexpected approval, permission escalation, MCP elicitation, external-tool call, or user-input request terminates the unattended run. The pilot does not silently approve it.

## Required local setup

Use a trusted WSL2/Linux filesystem, not `/mnt/c`:

```sh
export SYMPHONY_PILOT_CONTROL_ROOT=/home/me/code/kaimono-baton-control
export SYMPHONY_PILOT_WORKSPACE_ROOT=/home/me/code/kaimono-baton-symphony-workspaces
export SYMPHONY_PILOT_STATE_DIR=/home/me/.local/state/kaimono-baton-symphony
export SYMPHONY_PILOT_SYMPHONY_ROOT=/home/me/code/openai-symphony
export SYMPHONY_PILOT_CODEX_HOME=/home/me/.local/share/kaimono-baton-codex-home
export SYMPHONY_PILOT_CODEX_BIN=/home/me/.local/lib/kaimono-baton-codex/codex
export GITHUB_TOKEN='<fine-grained host token supplied outside the repository>'
```

Install the exact official Codex 0.147.0 binary at `SYMPHONY_PILOT_CODEX_BIN`. Create the dedicated home, copy `symphony/codex/config.toml` to its `config.toml`, and let Codex manage its existing ChatGPT authentication there. Do not invent a separate OAuth or refresh service. Do not put auth material in the workspace or repository.

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

Each `referencePath` is inspected in the approved Git tree. It must be a tracked regular `100644` or `100755` blob at `baseSha`. Directories, missing/untracked files, symlinks, submodules, transient control paths, and protected paths are rejected.

Immediately before the atomic durable claim, the host re-fetches and revalidates the Issue state, trusted author, label, current task, execution ID, task hash, base SHA, trusted approval, and fetched `origin/main`.

## Workspace and durable state

Before claim creation or `task.json`, the host checks out and hard-resets to the approved base, runs `git clean -ffdx`, and requires full `git status --porcelain --untracked-files=all` cleanliness. This removes tracked modifications, untracked files, and ignored leftovers from earlier executions.

State progression is:

```text
preparing -> claimed -> finalizing -> completed
     \          \
      +-----------> blocked
```

- `preparing`: exclusive claim is durable; deterministic pre-agent work is in progress.
- `claimed`: Codex may run once. Another process/restart does not rerun it.
- `finalizing`: exact `treeSha` and `commitSha` are durable; recovery uses only those objects.
- `completed`: Draft PR handoff is durable; label cleanup may be retried.
- `blocked`: a larger `executionId` and new exact approval are required.

Transient unauthenticated GitHub read/API failures are not converted into permanent task rejection. Deterministic approval/base/reference/workspace/tooling failures are persisted with enumerated blocker codes. Raw provider/system errors are not copied into Issue comments, PR bodies, handoff, or AI task data.

A stale lock is never removed automatically. An operator must verify the owning process is gone and reconcile state. An interrupted `preparing` or `claimed` state can be explicitly quarantined with:

```sh
node scripts/symphony-pilot-host.mjs operator-block <issue-number> <execution-id>
```

The command refuses while the lock directory still exists. Lock removal itself is a deliberate operator action after process/state inspection, never an age-based action.

## Handoff and trusted finalizer

`task.json` and `handoff.json` must be regular non-symlink files inside a regular `.symphony` directory. FIFOs, devices, directories, symlinks, and path escapes are rejected. A ready handoff contains exactly the selected checks, each exactly `"pass"`; arbitrary prose is rejected.

The host independently verifies unchanged HEAD, current branch ref, all refs snapshot, repository index bytes, `.git/config`, origin fetch/push URL, changed paths, regular-file types, protected paths, exact scope ancestry, and `git diff --check`. Added symlinks/submodules are rejected.

The agent-controlled index is never used to create the commit. The trusted finalizer:

1. loads the approved base into a temporary trusted index;
2. hashes validated regular files with `git hash-object --no-filters`;
3. applies additions/deletions with `git update-index --cacheinfo`;
4. obtains the exact tree with `git write-tree`;
5. creates the commit object with `git commit-tree`;
6. durably records `treeSha` and `commitSha` before changing a ref;
7. updates only the deterministic local branch ref;
8. pushes the exact persisted SHA to `refs/heads/codex/gh-<issue>`.

All privileged Git commands use sanitized HOME/XDG, `GIT_CONFIG_NOSYSTEM=1`, no global config, an empty trusted `core.hooksPath` outside the workspace, no credential helper, and a literal validated HTTPS destination. Repository/system/global pre-push and reference-transaction hooks, aliases, helpers, and local config cannot change privileged semantics. `--no-verify` is not used.

No npm, test, build, package script, agent executable, or repository hook runs after the finalizer introduces credentials. After push, the host performs only GitHub API handoff, persists `completed`, and removes `codex-ready` best-effort. The PR is always Draft and targets `main`.

## Negative isolation test

Run on the exact target WSL/Linux setup before any unattended live execution:

```sh
node scripts/symphony-pilot-isolation-test.mjs
```

The test uses Codex app-server `thread/start` and sandboxed `command/exec`; it does not prompt a model or transmit canary contents. It proves:

1. workspace read succeeds;
2. workspace write succeeds;
3. normal HOME canary read fails;
4. normal `~/.codex` canary read fails;
5. pilot auth-directory canary read fails from the agent sandbox;
6. unrelated outside-workspace canary read fails;
7. `/mnt/c` is unavailable;
8. external network access fails;
9. `activePermissionProfile.id` is exactly `symphony-pilot`;
10. the wrapper accepts only Codex 0.147.0.

Missing WSL/Linux, `bwrap`, `curl`, exact Codex, config, or expected profile is a hard failure, not a skip/pass.

## Start, stop, and rollback

After the upstream patch/tests and negative isolation gate pass:

```sh
cd "$SYMPHONY_PILOT_SYMPHONY_ROOT/elixir"
./bin/symphony "$SYMPHONY_PILOT_CONTROL_ROOT/symphony/WORKFLOW.md"
```

Stopping the single expected Symphony process is the kill switch. Do not enable unattended execution until independent review accepts the exact implementation head.

Rollback: stop Symphony, verify no needed finalization remains, retain state until no Issue can dispatch, remove workspaces and the dedicated pilot runtime, and revoke the pilot token. Repository rollback is a separately reviewed revert. Product runtime and Production infrastructure are not changed by this pilot.

The autonomous boundary ends at one Draft PR. Independent exact-base/head review, CI, human residual-risk acceptance, human exact-head merge approval, and any later Production decision remain separate gates.
