# note-md final independent audit

You are the final independent, read-only auditor for the current `note-md` working tree.
Do not edit files, commit, push, publish, use the web, or execute destructive commands. Inspect the repository and run only safe read-only or local verification commands when useful.

## Objective

Determine whether the implementation and its roadmap have reached an ideal local release-ready state: the smallest plan flow that still gives maximum assurance, with no unnecessary phases, duplicated gates, hidden dependencies, or unresolved Critical/Major risks.

The intended execution flow is exactly three waves:

1. Freeze the product/security/release contract and close residual high-risk defects.
2. Validate one immutable working snapshot through focused tests, the canonical full gate, Extension Host tests, actual VSIX inspection, and governance checks.
3. Obtain independent signoff, record disposition, then remove temporary planning/audit scaffolding and leave only durable product documentation and implementation.

## Audit scope

Review the current working tree against `origin/main`, including untracked files. Pay particular attention to:

- `src/frontmatter.ts`, `src/validator.ts`: bounded/unterminated frontmatter, protected regions, code fences, display math, unsafe image URLs, and low-resolution diagnostics.
- `src/imageDimensions.ts`, `src/imageRefs.ts`, `src/imageProcessor.ts`: magic-number format detection, extension spoofing, bounded reads, file mutation, aggregate limits before retention, EXIF/GPS removal, cancellation, symlink/path traversal, and external URI handling.
- `src/consent.ts`, `src/services.ts`, `src/upload.ts`: workspace boundary, explicit Catbox legal/commercial consent, memory-only cache, cancellation, response limits, and browser/CORS assumptions.
- `src/render.ts`, `src/previewPanel.ts`: stable TOC shell, zero/nonzero transitions, incremental updates, stale generation handling, and offscreen copy semantics/cleanup.
- `esbuild.mjs`, `scripts/check.sh`, `.vscodeignore`, `.gitignore`: atomic build publication, stale output prevention, exactly one production package build, inspection of the actual generated VSIX, archive allow/deny rules, version/ZIP checks, and generated-artifact cleanup.
- Tests, README, architecture/security/release documentation, changelog, and package metadata for consistency with behavior.
- `plans/active/comprehensive-ideal-audit-2026-07/plan.md` and `orchestration.json` for minimality, traceability, acceptance criteria, and honest remaining status.

Existing evidence says the focused suite passed 193 tests; a later canonical `./scripts/check.sh` run passed 209 tests, lint, formatting, typecheck, npm audit, Extension Host tests, production packaging, actual VSIX inspection, ZIP/version checks, and `git diff --check`. A subsequent `tazuna check --stage pre-report --changed-from origin/main --keep-going` passed. Treat those as evidence to verify, not as a substitute for inspection.

The in-app browser is unavailable in this environment. Do not treat absence of an actual note.com paste/mobile visual check or public Marketplace publication as an implementation blocker unless the code or release documentation incorrectly claims those public/manual gates are complete.

## Required response

Use the native review schema. Return `ADOPT` only when local integration is GO and no Critical or Major finding remains; otherwise return `REVISE`. Put concise findings in the findings array, ordered by severity. Each defect finding must include a stable ID, severity, exact `path:line`, evidence, impact, and concrete disposition. Also include short entries for the three-wave roadmap verdict, coverage across product behavior / security / build / tests / documentation / governance, and correctly deferred manual or public gates.

If no Critical or Major finding remains, state that explicitly in one finding entry. Do not manufacture defects merely to populate the response.
