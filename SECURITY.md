# Security Policy

## Supported state

This project is under active development. The primary user-facing supported state is the specific release or exact commit whose deployment to the public Stable Free Core environment completed successfully.

A merge or push to `main` does not automatically deploy Production. Stable Free Core Production deployment requires a human to explicitly dispatch the unique Production workflow from current `main`. The mutable `main` branch name is not itself the supported release: security reports and operational decisions must identify the exact commit or release whose deployment completed successfully.

Experimental photo, live-request, handwriting, Family Lab, Closed Alpha, and Paid Beta paths may remain disabled, invitation-only, or restricted to a separately identified deployed release. Public Release / General Availability is a separate deployed environment or release state for generally available paid or optional features and must be identified independently from the Stable Free Core.

## Reporting a vulnerability

Do not report security or privacy vulnerabilities in a public GitHub Issue, Pull Request, Discussion, commit message, or CI log.

Do not include any of the following in public content:

- API keys, Secrets, tokens, cookies, or authorization headers
- photo tokens, request tokens, edit secrets, or complete capability URLs
- real product photos or images
- user names, email addresses, phone numbers, or addresses
- real shopping-request content, product names, conditions, or free-text notes
- payment, refund, participant, or support records
- raw request or response bodies

Until a dedicated private reporting channel is published, contact Plain Relay through a private channel available from the studio's GitHub profile. Provide only the minimum information needed to establish contact. Do not send live Secrets or user data in the first message.

If no suitable private channel is available, create a public Issue containing only the title `Security contact requested` and no technical details. The repository owner will arrange a private follow-up channel. The existence of a private operations repository does not make it a public vulnerability-reporting endpoint.

## Useful report contents

After a private channel is established, include:

- affected deployed release or commit, route, or component
- whether the affected code also exists on `main`
- prerequisites and impact
- minimal reproduction steps using synthetic data
- whether the issue affects the Stable Free Core, Family Lab, Closed Alpha, Paid Beta, Public Release / General Availability, or a disabled path
- evidence that does not contain Secrets or user content
- suggested mitigation, when available

Do not test with another person's data. Do not access, retain, modify, or distribute data beyond what is strictly necessary to demonstrate the issue.

## Response process

The repository owner will:

1. acknowledge the report when reasonably possible;
2. assess severity and affected deployed environments;
3. disable or restrict an optional feature when necessary to limit impact;
4. preserve the Stable Free Core where safe;
5. prepare and test a fix;
6. coordinate disclosure after remediation when appropriate.

This is a small studio project. Immediate or 24-hour response is not guaranteed. Reports involving active Secret exposure, unauthorized data access, destructive behavior, or payment risk receive priority.

## Security boundaries

- The source repository is public. Security must not depend on hiding source code, routes, token formats, or input limits.
- Secrets belong in GitHub or Cloudflare secret stores and must never be committed.
- Capability URLs grant access to anyone who possesses the complete URL. They are not equivalent to account-authenticated confidential storage.
- Product photos and live requests use bounded retention and must not be treated as permanent storage.
- The service is not intended to make medical, allergy, or other safety-critical purchasing decisions on behalf of users.
- AI maintenance tools must not receive photos or image blobs; product names, condition text, or free text; complete shared URLs; request tokens, photo tokens, edit secrets, or Turnstile tokens; API keys, Secrets, cookies, or authorization headers.
- AI maintenance tools must not receive names, email addresses, street addresses, phone numbers, payment identifiers, raw support text, request or response bodies, raw provider errors, private Issues, private PRs, private Runbooks, or private repository search results.
- AI must not browse, search, fetch, or read any private operational repository. A convention to read only an anonymized portion is not an enforceable access boundary.
- AI maintenance tools may receive only payloads satisfying [the canonical "AI-safe export" definition](docs/operations/AI_AGENT_POLICY.md#ai-safe-export), whose full conditions are inherited. Short descriptions, checklists, Issues, runbooks, queues, or artifacts must not omit or relax those conditions. Such payloads must be explicitly exported into a defined AI-safe allowlist schema and verified by a deterministic validator before use.
- The deterministic validator must reject unknown schema fields and verify the absence of every prohibited field before export. Anonymization, pseudonymization, or removal of direct identifiers alone is not an AI-safe input condition and does not replace allowlisting, data minimization, prohibited-field validation, or prompt-injection controls.
- Any AI-specific queue or artifact may contain only schema-valid, validator-approved payloads. It must not contain free text, source records, raw logs, private links, or repository search results.

## Operational safety

When a vulnerability affects an optional feature, the preferred first response is to stop new operations for that feature and fall back to the fixed text request path.

AI may prepare investigation notes, a dedicated branch, tests, a Draft PR, a read-only review, a rollback checklist, and communication drafts. A Codex implementation or review session must not merge a PR it created, changed, or used as its required review target.

A separate GitHub-connected operator AI may merge only after an authorized human explicitly approves the exact repository, PR, base, and head SHA and every condition in [`docs/operations/AI_MERGE_APPROVAL.md`](docs/operations/AI_MERGE_APPROVAL.md) is satisfied. The operator must re-fetch base/head, Draft, mergeable, required CI, independent review, and finding state immediately before merge; reject a moved head with `expected_head_sha` or equivalent; and invalidate approval when base, head, diff, CI, or review changes. Auto-merge, merge queues, and protection/check/review bypasses are prohibited.

Merge approval is not Production approval. If a merge would itself trigger a Production action that cannot be separated, an operator AI must stop. Production deployment or workflow start/approval/rerun, external settings, Secret rotation, migrations, charges/refunds/cancellations, user-data access/deletion/recovery, customer or reporter messages, incident notification, legal publication, and Production stop/restart are separately approved and executed by a human operator.
