# Multi-Agent Isolation Rulebook (4 Agents)

Use this as the **single shared contract** for all agents running at the same time.

## 0) Mission

- Work in parallel without conflicts.
- Prevent one agent from modifying or blocking another agent’s work.
- Keep changes traceable, reviewable, and easy to merge.

---

## 1) Hard Rules (Non-Negotiable)

1. **No branch switching unless explicitly assigned.**
2. **No `git stash`, no `git worktree` create/remove, no force reset** unless explicitly requested.
3. **Do not edit files owned by another active agent.**
4. **Do not run broad auto-fixes across the whole repo** (`format all`, mass refactors, global codemods).
5. **Do not commit unrelated files** (including accidental formatter churn outside your scope).
6. **No dependency/version changes** unless your task explicitly requires them.
7. **Never touch `node_modules` or generated vendor internals** for implementation work.

---

## 2) Agent Ownership Model

Each agent must have a clear ownership boundary before coding.

For each agent, define:

- **Task ID**: short name (e.g., `A1-auth-fix`)
- **Owned paths**: exact folders/files allowed to edit
- **Forbidden paths**: anything outside owned scope
- **Output**: expected files/tests/docs to produce

Template:

```md
Agent: A1
Task: <goal>
Owns:

- src/auth/\*\*
- docs/auth.md
  Must not edit:
- src/channels/\*\*
- package.json
  Deliverables:
- <specific outcomes>
```

If a needed change is outside ownership, **raise a handoff request** (do not modify directly).

---

## 3) File Lock Protocol (Lightweight)

Before editing, an agent declares a lock in chat using this format:

```text
LOCK | Agent A2 | src/routing/router.ts | reason: add allowlist check | ETA: 20m
```

After finishing:

```text
UNLOCK | Agent A2 | src/routing/router.ts | done
```

Rules:

- First lock wins.
- No parallel edits in the same file.
- If blocked >10 minutes, unlock and report status.

---

## 4) Git Safety Rules

- Pull/rebase only when requested by operator.
- Keep commits scoped to owned files only.
- Use small, focused commits.
- Before commit, verify changed files list matches your ownership.
- If unrelated changes appear, unstage/revert those before committing.

Pre-commit checklist:

1. `git status --short` only shows expected files.
2. Diff contains only task-related changes.
3. Local tests/checks relevant to touched code pass.

---

## 5) Testing Rules in Parallel

- Run **targeted tests first** (closest scope).
- Avoid long global test runs unless requested.
- Don’t modify test baselines/snapshots outside owned scope.
- Report test command + result in handoff note.

---

## 6) Shared Files Policy (High Risk)

These files are conflict hotspots and require explicit operator approval before edit:

- `package.json`
- `pnpm-lock.yaml`
- root `tsconfig*.json`
- global CI/workflow files
- global lint/format config
- top-level docs indexes/navigation

If change is necessary:

1. Propose minimal patch.
2. Wait for approval.
3. Apply in a dedicated, isolated commit.

---

## 7) Communication Contract

Each agent must post concise updates:

- **Start**: scope + owned paths
- **Mid**: blocker or cross-scope need
- **Finish**: files changed, tests run, risks

Finish template:

```text
DONE | Agent A3
Changed:
- src/commands/status.ts
- src/commands/status.test.ts
Tests:
- pnpm test src/commands/status.test.ts (pass)
Notes:
- no cross-scope edits
- no shared-file changes
```

---

## 8) Conflict Resolution

When two agents need the same file:

1. Current lock holder keeps ownership.
2. Second agent submits a patch suggestion (no direct edit).
3. Lock holder integrates or requests operator arbitration.

If conflict already happened:

- Stop both edits.
- Restore file to last clean state.
- Re-apply one change at a time with clear ownership.

---

## 9) Minimum Handoff Quality

Every agent handoff must include:

- What changed (1-3 bullets)
- Exact files touched
- Commands run + outcomes
- Any assumptions/known risks
- Next step suggestion for integrator

---

## 10) Operator Quick Start (4 Agents)

1. Split work by folder/domain, not by random tasks.
2. Assign unique ownership per agent.
3. Require lock/unlock messages for every file edit.
4. Merge in order: low-risk first, shared-file last.
5. If in doubt: stop parallelism on that file and serialize.

---

## 11) One-Line Rule

**If you don’t own it, don’t edit it. If it’s shared, ask first.**
