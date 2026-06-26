# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start      # Run the CLI
npm run dev    # Run with nodemon hot-reload (watches menus/, lib/, index.js, envFiles/)
```

No build, test, or lint scripts exist.

## What This Project Does

Menu-driven CLI that automates Adobe Experience Platform (AEP) and Adobe Journey Optimizer (AJO) lab environment setup — schemas, datasets, identity namespaces, and sample data ingestion via Adobe Platform APIs. It replaces hundreds of manual API calls for training and bootcamp lab deployments.

## Architecture

```text
index.js                         ← top-level menu loop
menus/[module]/menu.js           ← sub-menu per lab pack
menus/[module]/[action].js       ← individual action handlers (thin orchestrators only)
lib/                             ← all business logic and API integrations (no prompts)
industry/telecom/                ← telco vertical: YAML-driven schema/dataset definitions
industry/telecom/lab-packs/      ← per-pack deploy.yaml + health.yaml manifests
envFiles/                        ← per-environment JSON credential files (gitignored)
```

**Lab pack modules:**

- `menus/aepFoundations/` — AEP Foundations: create profile base, load profile data, check profile health, clean sandbox
- `menus/ajoArchFoundations/` — AJO Arch Foundations: create profile base, load profile data, check profile health, create relational base, load relational data, deploy relational base & data, clean sandbox
- `menus/sandboxManagement/` — sandbox reset

## Architectural Rules

- **`lib/` is prompt-free.** No lib file may import from `lib/prompts/`. All user interaction lives in action files.
- **Actions are thin orchestrators.** They call lib functions, display results, and handle prompts — no direct API calls.
- **One API call per lib file.** Each lib file wraps exactly one endpoint. Pre-existence checks and orchestration belong in action files or orchestrator libs.
- **All menus use sentence case.** Only the first word is capitalised; acronyms (AEP, AJO, XDM) stay uppercase. The "Go back" pinned choice name must contain the word `back` (the `selection.name.includes("back")` break check depends on this). See `.claude/docs/menu-architecture.md` for the full pinned choices pattern.
- **Actions never throw exceptions.** After each async call, validate the result and `return` silently on failure: `if (!context) return;`. `process.exit(0)` is reserved for explicit user exit (`index.js`) and Ctrl+C (`promptSafe.js`) — never call it on an error.
- **Lib functions use verb-first naming:** `create*`, `delete*`, `enable*`, `lookup*`/`list*`, `check*`/`get*`, `stream*`, `patch*`. Private helpers are prefixed with `_` and never exported.
- **`envMap` is always destructured at function top:** `const { API_KEY: apiKey, IMS_ORG: imsOrg, SANDBOX_NAME: sandbox } = envMap;`
- **All create and delete API calls must be wrapped in `withRetry()`** from `lib/utils/withRetry.js`. No bare `axios.post/delete` calls. HTTP status semantics: 201 = created, 200/204 = success, 409 = idempotent success (already exists).
- **Schema `meta:altId` values must be URL-encoded** when used in URL paths: `encodeURIComponent(altId)`.
- **Orchestrators must be idempotent.** Check for pre-existing items before creating; build ID maps (`classIdMap`, `schemaIdMap`) as items are created and use them to resolve cross-step references. Adobe APIs have eventual consistency — add propagation delays between dependent steps (see `PROPAGATION_DELAY_MS`/`STEP_PAUSE_MS` in `lib/schemas/deploySchemaModel.js`).

## Standard Action Pattern

Every action follows this sequence:

```javascript
export async function myAction() {
  try {
    const context = await getValidEnvContext();        // load/cache env file, optional sandbox override
    if (!context) return;
    const { envMap } = context;
    const accessToken = await getAccessToken(envMap);  // Adobe IMS client credentials flow
    if (!accessToken) return;
    const ready = await checkSandboxReady(envMap, accessToken); // default 60 min; pass 120 for relational actions
    if (!ready) return;
    await businessLogicCall(...);
  } catch (err) {
    console.log(chalk.red("  ✗") + ` ${err.message}`);
  }
}
```

**The `try/catch` is mandatory.** Lib functions throw via `withRetry` on final failure — without the outer `try/catch`, any API error crashes the menu process. The `catch` block is the action's last line of defense; it must never be omitted. Guard checks (`if (!result) return`) handle functions that return falsy on failure; `try/catch` handles functions that throw.

`checkSandboxReady(envMap, accessToken, minMinutes = 60)` — pass `120` as the third argument for any action that touches the AJO relational store. Sandbox readiness wait: **60 min** for profile store, **120 min** for relational store.

## File Encoding

All source files must be UTF-8 without BOM. **Do not use PowerShell to write or edit files** — PowerShell 5.1 writes a BOM and corrupts multi-byte Unicode characters (✓, ✗, —, ⚠, →). Use the Edit/Write tools or Python via Bash for any byte-level file operations.

## Output Conventions

All action output uses chalk with consistent formatting:

- **Success:** `chalk.green("  ✓") + " message"`
- **Failure:** `chalk.red("  ✗") + " message"`
- **Warning:** `chalk.yellow("  !") + " message"`
- All output lines start with a 2-space indent (`"  "`)
- Wrap each output block with a leading and trailing `\n`
- Progress lines: `icon + " Item (N/total) — N skipped (already existed)"`
- Timestamps: `new Date().toISOString()` — logged at the start and end of long operations

## Prompt Conventions

Use the appropriate helper from `lib/prompts/continuePrompt.js`:

- Destructive operations → `askConfirmDestructive(name)`
- Time-gated operations → `askConfirm(mins)`
- Generic yes/no → `askConfirmGeneric(message)`
- All prompts default to `false` (require explicit confirmation)
- Ctrl+C is handled globally by `safeConfirm`/`safeInput` in `lib/prompts/promptSafe.js` — do **not** add duplicate Ctrl+C or SIGINT handlers in action files.

## Non-obvious facts

- Use `@inquirer/prompts` modern API only — not the legacy `inquirer.prompt([...])` array form.

---

## Hill-Climbing Workflow

Every feature or bug fix follows three phases — do not skip ahead:

The main thread spawns sub-agents and receives outcome reports only — it never displays raw bash output, tool-call results, or intermediate terminal output.

**One-time setup**: create `.claude/validate-config.json` with the env file and sandbox to use for all validation. Run `/cli-verify` with no spec in context and it will prompt for this on first use.

**Reactive fixes (bugs reported mid-conversation, no plan file)**
Apply the fix, then immediately run `/cli-verify` before declaring done — same as Phase 2.
No exceptions: even a one-line change requires verification.

**Phase 1 — Plan (plan mode)**
When a feature or bug request arrives, Claude Code is in plan mode. Write a plan file with:

- **Goal:** one sentence describing what done looks like
- **Affected files:** list with what changes
- **Read before coding:** relevant `.claude/docs/` files and why
- **Acceptance criteria:** numbered 1–8, each with:
  - `What:` — what the criterion checks
  - `Verify:` — exact command or API call (use `verification-catalog.md` for API checks)
  - `Pass:` — what the passing response or output looks like

Call ExitPlanMode when the plan is complete. User approval exits plan mode and triggers
Phase 2 automatically — no other action needed. Nothing executes while plan mode is active.

Once the user approves (plan mode exits), Phases 2, 3, and 4 run autonomously without
further interruption. The only pause after that is merge approval at the end of Phase 4.

**Phase 2 — Implement + Verify (sub-agent)**
If the plan identifies a new menu action is needed, run `/cli-menu` first to scaffold the
menu entry, action file, and lib stub before spawning the implementation sub-agent.

After plan approval, spawn a sub-agent that:

1. Implements each criterion (edit/write code files directly)
2. Runs `/cli-verify` after each implementation step — the skill auto-determines sandbox scope (lib/ changes fan out to both modules), runs all affected actions, and cleans both sandboxes after each run; no manual cleanup or scope decisions needed
3. Applies fixes from failures and re-verifies — loops until all criteria are PASS/SKIP/MANUAL
4. Reports back to the main context when complete

Always use `run_in_background: true` when spawning any sub-agent — without it, every sub-agent tool call streams into the user's conversation view in real-time.

If the same failure recurs after 3 fix attempts with no progress, stop and surface it to the user.

**Phase 3 — Review Gate (sub-agent)**
Immediately after Phase 2 reports all passing, spawn a sub-agent that runs `/cli-review-cycle`.
It loops internally until all review phases are clean and all checkpoints still pass.
Reports back with the PR-ready summary when done.

**Phase 4 — GitHub (sub-agent)**
Immediately after Phase 3 reports clean, spawn a sub-agent that runs `/cli-github`.
PR creation is automatic. Merge requires explicit user approval — never auto-merge.

Use `/cli-github` for PR creation, CI monitoring, review response, and merge readiness.

## Definition of Done

A change is done when ALL of the following are true:

- Every acceptance criterion from the plan file passes `/cli-verify` — including sandbox cleanup; both `standard-testing` and `relational-testing` are clean
- `simplify`, `review`, and `security-review` find no remaining issues
- DEP compliance (rules above) passes
- No regression against previously passing criteria

If any phase reveals a gap or error in a rule file, skill, or doc, flag it as a follow-up for explicit user approval — do not update it mid-task.

## Reference Docs

When working on specific areas, read the relevant doc in `.claude/docs/` before starting:

- `vertical-structure.md` — industry vertical directory layout and config file purposes
- `yaml-formats.md` — schemas.yaml, relational/schemas.yaml, deploy.yaml, audiences.yaml formats + placeholder conventions
- `deploy-flows.md` — standard XDM deploy, relational deploy, data load, HTTP streaming, sandbox cleanup flows
- `lib-reference.md` — environment setup, lib module index, prompt system
- `menu-architecture.md` — menu structure, pinned choices (c/b), dispatch loop, action.js and lib stub templates
- `verification-catalog.md` — Adobe Platform API endpoints for verifying every artifact type; used by `/cli-verify`

**Rules (canonical definitions, referenced by skills):**

- `.claude/rules/code-conventions.md` — architectural constraints, naming, timing constants, output format
- `.claude/rules/menu-conventions.md` — sentence case, action verb pattern (Create/Load/Deploy/Check/Clean), pinned choices, API rules
- `.claude/rules/module-registry.md` — module directory/label/lab-pack path mapping, sandboxManagement exceptions, lock detection rule
