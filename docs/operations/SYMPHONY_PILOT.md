# Symphony Pilot

Status: experimental, repository-scoped pilot

## Purpose

This pilot tests whether Kaimono Baton can remove manual copy/paste between ChatGPT planning/review and Codex implementation while preserving the repository's existing human approval, independent review, merge, Production, privacy, and data-boundary controls.

GitHub Issues remain the work contract. Symphony is only a local dispatcher/orchestrator. It does not become a source of truth for product requirements, merge approval, Production approval, private operations, or user data.

## Scope

Pilot scope is intentionally narrow:

- repository: `plain-relay/kaimono-baton` only;
- tracker: GitHub Issues;
- dispatch gate: Issue label `codex-ready`;
- one concurrent agent;
- maximum four Codex turns per dispatched run;
- model: `gpt-5.6-terra`;
- workspace-write sandbox with network access only because Git fetch/push and GitHub PR operations are required;
- Draft PR handoff only;
- no automatic merge;
- no automatic Production deploy;
- no Production workflow execution;
- no Secrets, Variables, Environments, Cloudflare, DNS, billing, migration, or user-data operation;
- no private operational repository access.

The version-controlled workflow is `symphony/WORKFLOW.md`.

## Required local components

Run Symphony only on a trusted developer machine. The upstream Elixir reference implementation is prototype software for evaluation and must not be exposed as a public service.

Required:

1. Git and repository push authentication already suitable for normal development.
2. Codex CLI installed and signed into the ChatGPT account used for Codex access. The pilot does not require an `OPENAI_API_KEY`.
3. Symphony Elixir reference implementation or its supported self-contained Linux/macOS binary.
4. A fine-grained GitHub token exported as `GITHUB_TOKEN`, restricted to `plain-relay/kaimono-baton`.
5. On Windows, WSL2/Linux for the pilot because upstream self-contained Symphony release targets are Linux/macOS rather than native Windows.

For the fine-grained GitHub token, start with only the selected Kaimono Baton repository and the repository permissions needed for this pilot: metadata read, Issues read/write, and Pull requests read/write. Do not grant Actions, Administration, Environments, Secrets, Variables, Pages, or other unrelated write permissions. Git push authentication remains the developer machine's existing Git authentication; do not embed the Symphony token into the Git remote URL.

Do not commit tokens, Codex credentials, SSH private keys, `.env` files containing credentials, or generated Symphony workspace contents.

## Approval model

The pilot has two separate human gates.

### Implementation gate

An Issue is not executable until the authorized human approves the implementation plan. After that approval, a GitHub-connected operator may add `codex-ready` to that exact Issue.

`codex-ready` means only:

> Codex may implement the currently approved Issue scope and create/update a Draft PR under the repository contract.

It does not approve merge, Production, external configuration, secrets, migrations, billing, legal publication, or user-data operations.

`codex-ready` is a one-shot execution permit, not a persistent status. A successful run removes it after the Draft PR exists and the branch is pushed. A blocked run also removes it before stopping. Re-adding the label means a human has resolved the blocker or approved another implementation attempt.

### Merge gate

The existing `AGENTS.md`, `docs/CODEX_WORKFLOW.md`, and `docs/operations/AI_MERGE_APPROVAL.md` remain authoritative. Symphony/Codex must stop at a Draft PR. Independent review and exact-head human merge approval remain separate.

## Local installation and start

Use the current upstream `openai/symphony` release or build the current Elixir reference implementation. Do not copy a binary into this repository.

Upstream source-build shape:

```sh
git clone https://github.com/openai/symphony.git ~/code/openai-symphony
cd ~/code/openai-symphony/elixir
mise trust
mise install
mise exec -- mix setup
mise exec -- mix build
```

A supported self-contained Symphony release binary can be used instead and avoids installing Elixir/Erlang. It still requires `codex`, `git`, and tracker credentials on the machine.

Before the first run, from a trusted local clone of Kaimono Baton:

```sh
git switch main
git pull --ff-only origin main
codex --version
git ls-remote --exit-code https://github.com/plain-relay/kaimono-baton.git refs/heads/main
```

Also confirm that normal branch push authentication works from the same WSL/Linux/macOS environment. Do not validate it by pushing to `main`.

Export `GITHUB_TOKEN` in the local shell without writing it into this repository. Then start the built reference implementation with the repository workflow, for example:

```sh
cd /path/to/kaimono-baton
/path/to/openai-symphony/elixir/bin/symphony ./symphony/WORKFLOW.md
```

For a self-contained release binary:

```sh
cd /path/to/kaimono-baton
/path/to/symphony-release-binary ./symphony/WORKFLOW.md
```

Use the current upstream Symphony README if the installed release changes its executable name or invocation. The process polls every 30 seconds. Terminating the local Symphony process is the pilot-wide kill switch.

The pilot intentionally does not start the optional web dashboard/server.

## Issue requirements

Only apply `codex-ready` when the Issue body contains, at minimum:

- objective;
- exact approved scope;
- out-of-scope items;
- acceptance criteria;
- required validation;
- risk classification or information sufficient to classify it;
- rollback;
- explicit confirmation that Production/external operations are not authorized unless separately specified for human execution.

For the first pilot run, use a small, reversible, non-Production task. Do not use privacy/security/authentication/migration/billing/Secrets changes as the first run.

The `codex-ready` label exists in this repository and is the sole Symphony dispatch label for this pilot. Do not place it on infrastructure/setup Issues that should not be executed by Symphony.

## Expected autonomous flow

```text
approved GitHub Issue
        |
        | add codex-ready
        v
     Symphony
        |
        v
isolated workspace
        |
        v
      Codex
        |
        +-- read repository contract
        +-- inspect current main
        +-- create Issue branch
        +-- implement scoped change
        +-- run required checks
        +-- commit and push
        +-- create/update one Draft PR
        +-- remove codex-ready
        v
Issue stays open without dispatch permission
        |
        v
human/independent review outside the implementation run
```

A blocker follows the same one-shot rule: write the blocker to the Issue, remove `codex-ready`, and stop. The label is only re-added after the blocker is resolved and another implementation attempt is explicitly approved.

## Failure and stop rules

Stop the pilot and investigate before another autonomous run if any of these occur:

- direct change to `main`;
- duplicate PR for one Issue;
- Production workflow/deploy triggered by the agent;
- secret, private-op, or user-data access;
- change outside Issue scope;
- `codex-ready` remains on an Issue after a successful or blocked handoff;
- repeated execution after a completed Draft PR without a justified continuation;
- required validation silently skipped;
- inability to determine exact base/head;
- abnormal Codex consumption relative to the work performed;
- Symphony repeatedly consumes turns while Codex is returning errors.

Do not solve a pilot failure by weakening repository policy.

## Pilot success criteria

Evaluate the pilot after several small real tasks. Success requires:

- zero manual copy/paste between ChatGPT and Codex;
- no manual Codex start after an approved Issue receives `codex-ready` while Symphony is running;
- successful and blocked runs both clear `codex-ready` before stopping;
- exactly one implementation branch/PR per Issue unless a documented rework reset requires otherwise;
- required validation executed and reported accurately;
- no main/Production/external-state violation;
- ChatGPT can inspect the resulting Issue/PR/CI directly from GitHub without pasted Codex output;
- Codex usage remains acceptable within the existing ChatGPT plan or an explicitly approved credit budget;
- failure state is visible enough in GitHub/Symphony logs to diagnose without relying on hidden chat history.

## Cost boundary

The pilot is designed to use the existing ChatGPT/Codex entitlement and existing developer machine. It must not require an OpenAI API key, a new paid AI subscription, a hosted Symphony server, or automatic credit top-ups.

If the included Codex allowance is exhausted, stop and evaluate usage before purchasing credits or changing plan. Additional spend is a separate human decision.

## Rollback

Repository rollback is simply removal of `symphony/WORKFLOW.md` and this document in a reviewed PR. Local rollback is stopping/removing the Symphony process and deleting its generated workspace root after confirming no needed unpushed work remains.

Removing the pilot does not change product runtime, Production infrastructure, GitHub Pages deployment, or the existing Codex/manual development workflow.
