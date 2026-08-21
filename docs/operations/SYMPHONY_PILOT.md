# Symphony Pilot

Status: experimental, repository-scoped, trusted-machine pilot

## Purpose

This pilot removes manual copy/paste and manual Codex start between ChatGPT planning and Codex implementation while retaining GitHub Issues/PRs as the durable work record and keeping merge and Production as separate human approvals.

The design deliberately treats Symphony as a scheduler/runner, not as a trusted coding authority. Codex receives only a deterministic AI-safe task payload and has no GitHub write capability. A trusted host process performs the remote handoff after validating the local result.

## Security architecture

```text
ChatGPT -> GitHub Issue -> human Gate A -> codex-ready
                                      |
                                      v
                              Symphony scheduler
                                      |
                              trusted before_run
                                      |
                       deterministic safe-task validator
                                      |
                    persistent host claim outside workspace
                                      |
                                      v
                               Codex app-server
                          workspace-write / network off
                         no GitHub provider-native tool
                                      |
                           local edits + local checks
                                      |
                           .symphony/handoff.json
                                      |
                              trusted after_run
                                      |
                         scope + Git integrity checks
                                      |
                        host commit / host-only push
                                      |
                            Draft PR + label cleanup
                                      |
                          independent review + CI
                                      |
                             human Gate B: merge
                                      |
                         human Gate C: Production
```

The trust boundary is intentional:

- Symphony may read the raw public GitHub Issue because it is the tracker host.
- `scripts/symphony-pilot-host.mjs` is executed from a trusted control checkout outside the agent workspace.
- The host extracts only the delimited allowlist payload and writes `.symphony/task.json`.
- The Codex prompt does not interpolate Issue title, body, URL, comments, or labels.
- Codex network access is disabled.
- The patched GitHub tracker adapter advertises no provider-native `github_api` tool to Codex.
- Codex must not stage, commit, push, create PRs, mutate Issues, or change Git state.
- GitHub write credentials are used only by the trusted host finalizer after the Codex turn.

This addresses the two independent-review findings on the original PR design: raw Issue text no longer reaches Codex, and durable host state prevents repeated Codex dispatch when GitHub label cleanup fails.

## Fixed upstream Symphony revision

Do not run this pilot against arbitrary `main` or a newer binary.

Pinned upstream revision:

```text
openai/symphony
8001b52e3062495a16e520e4ceaf8f9de868c4d0
```

That revision includes the GitHub tracker credential boundary used by this pilot. The repository also carries one narrow source patch:

```text
symphony/patches/0001-disable-github-agent-tool.patch
```

The patch changes the GitHub adapter's advertised agent-tool list to `[]`. The host still uses GitHub directly; only the coding agent loses the provider-native GitHub tool.

Any Symphony upgrade is a new security-sensitive change. Re-pin, re-apply/rework the patch, rerun its upstream tests, and independently review the new exact revision before using it unattended.

## Required local components

Run only on a trusted developer machine. Symphony is an engineering preview and should not be exposed as a public service.

Required:

1. WSL2/Linux on the Windows development machine, or another supported trusted Linux/macOS host.
2. Git and Node.js/npm.
3. Codex CLI signed in with the ChatGPT account used for Codex access. No `OPENAI_API_KEY` is required by this pilot.
4. A source checkout of the pinned Symphony revision with the repository patch applied.
5. A clean Kaimono Baton control checkout containing the merged pilot files.
6. A fine-grained GitHub token in host environment variable `GITHUB_TOKEN`, restricted to `plain-relay/kaimono-baton`.
7. GitHub-side Ruleset/branch protection on `main` that blocks unattended direct pushes and preserves the normal PR path.

Minimum GitHub token repository permissions for the host flow:

- Metadata: read
- Contents: read/write
- Issues: read/write
- Pull requests: read/write

Do not grant Actions, Administration, Environments, Secrets, Variables, Pages, or unrelated organization permissions.

Do not store the token in this repository, the Symphony workspace, Git config, remote URLs, shell history, or committed files.

## Build the pinned Symphony runtime

Example:

```sh
git clone https://github.com/openai/symphony.git ~/code/openai-symphony
cd ~/code/openai-symphony
git checkout --detach 8001b52e3062495a16e520e4ceaf8f9de868c4d0

git apply --check /path/to/kaimono-baton/symphony/patches/0001-disable-github-agent-tool.patch
git apply /path/to/kaimono-baton/symphony/patches/0001-disable-github-agent-tool.patch

cd elixir
mise trust
mise install
mise exec -- mix setup
mise exec -- mix test
mise exec -- mix build
```

Before using the runtime, verify the patched source contains:

```elixir
def agent_tool_specs, do: []
```

Do not substitute an unpatched prebuilt Symphony binary for this pilot.

## Trusted control checkout

The active `WORKFLOW.md` and host script must be read from a clean control checkout that is outside all Symphony issue workspaces. This is essential: an agent must never be able to modify the script that will later run with host GitHub credentials.

Example environment:

```sh
export SYMPHONY_PILOT_CONTROL_ROOT=/path/to/clean/kaimono-baton
export SYMPHONY_PILOT_STATE_DIR="$HOME/.local/state/kaimono-baton-symphony"
export GITHUB_TOKEN='<fine-grained token supplied securely>'
```

`SYMPHONY_PILOT_STATE_DIR` is intentionally outside the disposable workspace root. Its per-Issue JSON files are the durable no-redispatch/quarantine boundary across Symphony restarts.

Before starting:

```sh
cd "$SYMPHONY_PILOT_CONTROL_ROOT"
git switch main
git pull --ff-only origin main
git status --short
codex --version
node --check scripts/symphony-pilot-host.mjs
npm test
```

Also verify the GitHub Ruleset/branch-protection rule for `main` in repository settings. The local host branch allowlist is defense in depth, not a replacement for server-side protection.

## Start and stop

Start the patched source build with the control checkout's workflow:

```sh
cd ~/code/openai-symphony/elixir
./bin/symphony "$SYMPHONY_PILOT_CONTROL_ROOT/symphony/WORKFLOW.md"
```

The service polls GitHub every 30 seconds. One agent may run at a time and each authorized execution gets one Codex turn. A single turn may contain many local tool calls, edits, and validation commands.

Stopping the Symphony process is the pilot-wide kill switch. The optional dashboard/server remains disabled.

## Gate A: executable Issue contract

`codex-ready` means only:

> The exact validated safe-task execution on this Issue may be attempted once by Codex and handed back as a Draft PR.

It does not approve merge, Production, deployment, migrations, Secrets, billing, DNS, Cloudflare, or user-data operations.

Every executable Issue must contain exactly one block of this form:

```text
<!-- symphony-safe-task:v1 -->
{
  "schemaVersion": 1,
  "executionId": 1,
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

The allowlist deliberately contains no arbitrary task prose. Product names, condition/free text, raw support text, request/response bodies, provider errors, tokens, Secrets, user data, and private operational content have no schema field and are rejected if added as extra keys.

The task must be implementable from public repository contracts identified by `referencePaths`, `scopePaths`, and optional `symbols`. If a requirement cannot be represented safely by this structure, it is not eligible for this unattended pilot.

`executionId` is a one-shot authorization sequence. Start at `1`. If an execution is blocked and a human explicitly approves another attempt, update the safe task and increment `executionId` before re-adding `codex-ready`. Re-adding the label without a larger `executionId` does not authorize another Codex run.

After a Draft PR exists, do not reuse the Issue for a second autonomous implementation execution; handle review/rework through the normal reviewed PR workflow or a new approved Issue.

## Host pre-run behavior

Before Codex launches, the trusted host:

1. fetches the exact Issue through the GitHub API;
2. verifies it is open and still has `codex-ready`;
3. extracts and strictly validates the one safe-task block;
4. checks persistent host state for the same Issue/execution;
5. refuses stale, completed, interrupted, or already-claimed executions;
6. fetches current `origin/main` and creates deterministic local branch `codex/gh-<issue-number>`;
7. rejects an unexpected pre-existing remote branch or open PR;
8. verifies all `referencePaths` exist;
9. runs `npm ci` before agent execution with a sanitized child environment that does not receive `GITHUB_TOKEN`;
10. writes `.symphony/task.json`;
11. atomically persists the execution claim outside the workspace.

A previous interrupted claimed execution is converted to `blocked` instead of being silently re-run. This intentionally favors bounded Codex usage over automatic retry.

## Codex behavior

Codex receives only:

- the generic `GH-<number>` identifier in the rendered prompt;
- `.symphony/task.json`;
- allowed public repository content.

Codex does not receive raw Issue prose through the prompt and cannot call the GitHub provider tool. Network access is disabled.

Codex may edit only task `scopePaths`, run only selected validation commands, and write `.symphony/handoff.json`.

It may not stage/commit/push, modify Git configuration/hooks/refs, change control/governance files, install dependencies, or perform external operations.

## Trusted host finalizer

After the one Codex turn, the trusted host treats agent output as untrusted until validated. It:

1. verifies `.symphony/task.json` still hashes to the persistent claim;
2. verifies `.git/config` is unchanged and `origin` is the expected public repository URL;
3. requires a schema-valid handoff and every authorized acceptance check to be reported `pass`;
4. requires Codex to have created no commit and staged no file;
5. enumerates tracked/untracked changes with rename detection disabled;
6. rejects every changed path outside `scopePaths` and every protected control/dependency path;
7. reruns `git diff --check` itself;
8. persists `finalizing` before any remote mutation;
9. stages only the validated changed paths and creates the commit as the host;
10. pushes only `refs/heads/codex/gh-<issue-number>` using an ephemeral GitHub authorization header available only to the Git subprocess;
11. creates or updates exactly one Draft PR targeting `main`;
12. persists `completed` before attempting label cleanup;
13. removes `codex-ready`.

The host never executes agent-modified application code after it starts using GitHub credentials. Test/build execution happens during the no-network Codex phase, and normal GitHub PR CI remains the independent remote verification before merge.

The host uses `git push --no-verify` intentionally because an agent-writable `.git/hooks` directory must never receive the host token environment. Remote URL and branch destination are checked independently by the host, and server-side `main` protection remains mandatory.

## Durable duplicate prevention

Symphony's scheduler state is in-memory and exact retry state is not restored after restart. This pilot therefore adds a very small durable host state outside workspaces.

Typical state progression:

```text
claimed -> finalizing -> completed
    \-> blocked
```

If GitHub label cleanup fails after PR creation, `completed` remains durable. A later poll may invoke the host pre-run hook, but it removes/repairs the stale label and refuses to start Codex again.

If a process dies after `finalizing`, the next pre-run attempts idempotent finalization recovery and does not launch another agent turn.

No database, queue, hosted control plane, or cloud VM is required.

## Protected paths

The host always rejects changes to at least:

- `.git/**`
- `.github/**`
- `.codex/**`
- `symphony/**`
- `.gitignore`
- `AGENTS.md`
- `package.json`
- `package-lock.json`
- `docs/CODEX_WORKFLOW.md`
- `docs/operations/AI_AGENT_POLICY.md`
- `docs/operations/AI_MERGE_APPROVAL.md`
- `docs/operations/SYMPHONY_PILOT.md`
- `scripts/symphony-pilot-host.mjs`

These cannot be made writable merely by placing them in an Issue safe-task scope.

## First live task

Use a small, reversible, non-Production task whose expected behavior is already represented in public repository files/tests. Do not use security/authentication, migration, dependency, workflow, billing, Secrets, external-service, or user-data work for the first live execution.

The first live run must verify:

- zero manual copy/paste;
- no manual Codex start after Gate A;
- one Codex invocation only;
- only AI-safe structured task input reaches Codex;
- no agent GitHub tool or network access;
- host-only commit/push/PR creation;
- exactly one Draft PR;
- `codex-ready` removed or safely quarantined without redispatch;
- expected CI starts on the resulting PR;
- no direct `main` or Production mutation.

## Failure and stop rules

Stop the pilot and investigate before approving another execution if any of these occur:

- raw Issue text appears in a Codex prompt/session;
- `github_api` or another tracker-write tool is exposed to Codex;
- Codex network access succeeds;
- `GITHUB_TOKEN` or another host credential appears in the Codex environment/output/workspace;
- Codex stages, commits, pushes, changes Git config, or changes protected paths;
- the host pushes any branch other than `codex/gh-*`;
- duplicate PRs appear for one Issue;
- an Issue execution is redispatched without a larger explicitly approved `executionId`;
- a Production/external operation occurs;
- required validation is skipped or falsely reported;
- abnormal Codex consumption occurs.

Do not fix a pilot failure by weakening repository policy, broadening the token, turning network on, exposing `github_api`, or raising concurrency/turn count.

## Cost boundary

The pilot uses the existing ChatGPT/Codex entitlement and trusted developer machine. It does not require an OpenAI API key, hosted Symphony server, new paid AI subscription, cloud VM, or automatic Codex credit top-up.

If included Codex usage is exhausted, stop. Purchasing credits or changing plan is a separate human approval.

## Merge and Production boundaries

The autonomous flow ends at a Draft PR. Existing repository policy remains authoritative:

- independent exact-base/head review is required;
- human exact-head merge approval is required;
- merge approval does not authorize Production;
- Production remains a separately approved operation.

## Rollback

Repository rollback is a reviewed revert/removal of:

- `symphony/WORKFLOW.md`
- `symphony/patches/0001-disable-github-agent-tool.patch`
- `scripts/symphony-pilot-host.mjs`
- `scripts/symphony-pilot-host.test.ts`
- this document

Local rollback:

1. stop Symphony;
2. confirm no needed unpushed workspace changes remain;
3. remove the patched Symphony checkout and generated issue workspaces;
4. retain or archive the host state directory until no Issue can still carry `codex-ready`, then remove it if desired;
5. revoke/delete the fine-grained GitHub token.

Product runtime and Production infrastructure are not modified by enabling or removing this pilot.
