---
name: change-sync
description: Use for any requested project change that may affect requirements, specifications, UI/UX, architecture, implementation, tests, or documentation. Enforce change-management workflow before coding: understand the change, analyze impact, discover traceability, detect conflicts, produce a reviewable plan, synchronize affected docs such as PRD.md, SRS.md, SDS.md, DESIGN.md, and SCREEN_DESIGN.md, then implement and validate.
---

# Change Sync

This skill turns modification work into a change-management process. A user request is not merely a coding request. Treat every requested change as a possible requirement, UX, architecture, API contract, data model, QA, and documentation synchronization event.

Do not jump directly to implementation. Maintain consistency between:

- requirements
- specifications
- UI/UX
- architecture
- implementation
- tests
- documentation

## Required Output Before Implementation

For every modification request that triggers this skill, first respond with this structure:

```markdown
## Change Summary

## Requirement Interpretation

## Impact Analysis

## Traceability Mapping

## Conflict Detection

## Proposed Change Plan

## Documents To Update

## Code Areas To Modify

## Test Updates Required

## Risks

## Open Questions
```

Only after open questions are resolved and the user approves the plan should you generate patches or modify code.

If the request is documentation-only, still perform impact and traceability analysis, then update the relevant documents after approval.

## Workflow

Execute these steps in order. Do not skip steps.

### 1. Understand the Change

Interpret the request semantically. Extract:

- intent
- expected behavior
- business meaning
- UX implications
- technical implications

If ambiguity exists, ask clarification questions. Prefer clarification over inventing behavior.

### 2. Impact Analysis

Identify all potentially affected areas. For each impacted area, explain why it is impacted, estimate risk, and identify hidden dependencies.

Check at least:

- `PRD.md`
- `SRS.md`
- `SDS.md`
- `DESIGN.md`
- `SCREEN_DESIGN.md`
- UI/UX flows
- frontend routes, pages, components, hooks, utilities, and types
- smart contracts and generated contract-facing mappers
- APIs or wallet/contract interaction surfaces
- data model or schema assumptions
- tests and QA scenarios
- build, deployment, environment variables, and monitoring/logging assumptions
- permissions, security, and irreversible on-chain behavior
- localization or visible user-facing copy

If an area is clearly not applicable, say so briefly rather than ignoring it.

### 3. Traceability Discovery

Before modifying code, map the connected artifacts:

```text
Requirement -> specification -> UI/UX -> API/contract -> implementation -> tests -> documentation
```

Discover:

- source-of-truth documents
- duplicated specifications
- stale or outdated references
- conflicting definitions
- related implementation files
- existing tests that encode the current behavior

Use `rg` first. Useful repository paths:

- product docs: `PRD.md`, `SRS.md`, `SDS.md`, `DESIGN.md`, `SCREEN_DESIGN.md`
- frontend pages: `dev/src/pages/`
- shared UI: `dev/src/components/`
- hooks: `dev/src/hooks/`
- utilities: `dev/src/lib/`
- shared types: `dev/src/types/`
- styles: `dev/src/styles.css`
- routing/page selection: `dev/src/app/App.tsx`
- contracts: `dev/contracts/`
- contract tests: `dev/test/`
- scripts: `dev/scripts/`

### 4. Conflict Detection

Detect conflicts between:

- old and new requirements
- UI and backend assumptions
- documentation and implementation
- tests and expected behavior
- architectural constraints and requested changes
- contract immutability, deployed addresses, and Sepolia assumptions

If conflicts exist, report them explicitly, propose resolution options, and ask for approval when the choice affects architecture, UX, security, scalability, or maintainability. Never silently resolve major conflicts.

### 5. Change Plan Generation

Generate a reviewable execution plan before editing. Include:

- files to modify
- documents to update
- APIs/contracts to change
- migration or deployment requirements
- test updates
- rollout risks
- backward compatibility concerns
- validation commands

Respect the repository's architecture decision protocol: separate confirmed requirements, assumptions, and open questions.

### 6. Documentation Synchronization

Update all affected documents before implementation. Keep documentation aligned with the behavior being implemented.

Common rules:

- If UI or flow changes, update `SCREEN_DESIGN.md` first.
- If product behavior changes, update `PRD.md` and/or `SRS.md`.
- If architecture, module boundaries, contract interaction, or deployment assumptions change, update `SDS.md` and/or `DESIGN.md`.
- If `@Note` exists in `SCREEN_DESIGN.md`, integrate it into stable sections and remove the raw note only after applying it.
- If layout changes, update both prose rules and ASCII layout examples when present.
- If flow changes, update the relevant flow diagram or bullet list.
- Keep screen IDs stable unless the user explicitly asks to rename or restructure them.

If documentation conflicts with the requested implementation, either update the documentation first or block implementation and ask for clarification.

### 7. Implementation

Implement only after:

- change understanding
- impact analysis
- traceability discovery
- conflict detection
- change planning
- documentation synchronization
- user approval when open questions or material tradeoffs exist

Follow the updated specifications. Do not invent hidden behavior not approved by the user. Keep edits scoped to the affected modules.

Frontend implementation rules:

- Match the updated `SCREEN_DESIGN.md`.
- Preserve existing wallet, transaction, navigation, and data loading behavior unless the change requires otherwise.
- Keep controls inside the section described by the document.
- Ensure responsive behavior remains coherent.
- Avoid text overflow, cramped error messages, and incoherent overlap.
- Reflect documented step order in DOM order and visual layout.

Contract and wallet rules:

- Treat on-chain behavior, deployed addresses, and irreversible transactions as high-risk changes.
- Update tests when changing `PromiseEscrow.sol`, deployment assumptions, or contract-facing mappers.
- Never commit private keys, seed phrases, RPC secrets, or populated `.env.local` files.

### 8. Test Synchronization

Update tests and QA coverage to match the changed behavior:

- unit tests
- integration tests
- contract tests
- UI or interaction tests when present
- QA scenarios and regression cases

Consider edge cases, invalid states, migration paths, rollback scenarios, and document/implementation synchronization failures.

### 9. Final Validation

Before completion, validate:

- documentation matches implementation
- APIs/contracts match specifications
- tests match expected behavior
- UI behavior matches requirements
- no stale references remain
- no hidden assumptions remain unresolved

Run checks from `dev/` when applicable:

```bash
npm run typecheck
npm run lint
npm run build
```

For contract changes, also run:

```bash
npm run test
```

Use `npm run build` for UI/layout changes unless the user only requested documentation. Mention warnings separately from failures.

If a dev server is already running, confirm HMR received the update when useful. If no server is running and the user asked for an implemented UI, start one and provide the local URL.

## Communication Rules

Be analytical, structured, explicit, and conservative with assumptions.

Always explain:

- why something changes
- what depends on it
- what could break
- what remains uncertain

Do not:

- silently invent requirements
- skip impact analysis
- optimize prematurely
- modify unrelated systems without explanation
- leave documentation stale after implementation

Priority order:

1. correctness
2. synchronization
3. traceability
4. maintainability
5. implementation speed

## Final Response

Keep the final response concise. Include:

- documents changed
- implementation files changed
- tests or validation commands run
- warnings, blockers, or intentionally unchanged behavior
- any remaining risks or follow-up decisions
