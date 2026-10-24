# Ultra DSH rc.3 compatibility release

> Execution: inline using executing-plans; one final independent review. User authorized adaptation and publication.

**Goal:** Publish Ultra 0.6.1, Memory 0.1.1 and Decision 0.1.1 for official DSH 0.2.1-rc.3, with a readable Chinese README based on Memory-Continuity.

**Architecture:** Keep the existing shared source and self-contained companion bundles. Add rc.3 to the explicit host compatibility set, build against its native SDK, and exercise existing persistence, archive, coordination and lifecycle contracts. Preserve earlier release evidence.

**Tech stack:** TypeScript, Node, Cordis, native DSH SDK, existing node:test and esbuild tooling.

## Constraints and review focus

- Base: public main 9de02d9, Ultra 0.6.0. Keep unrelated RP development branches intact.
- Preserve the three package identities and default-off behavior. No model calls, deployment into daily profile, data migration or automatic background work.
- Existing 0.2.0-rc.2 and 0.2.1-rc.2 compatibility must not be silently removed.
- Test actual rc.3 modules, including continuation, JSONL recovery, context archive and independent bundle ownership.
- Archive protocol labels identify the verified contract; do not change stored formats solely because the SDK patch number changes.
- Publish only tested package bytes and their source/verification records; disclose desktop UI and real-model limits.

## Tasks

- [x] 1. Capture baseline, reproduce package rejection for rc.3, extend exact compatibility and test fixture gates, build/typecheck against rc.3, run complete regression and native checks. Keep caches and temporary files on D:.
- [x] 2. Rewrite README and companion installation guidance in the selected reference's style. Update changelog/release results without importing historical success claims. Record M-C design reuse only, without plugin merger or runtime coupling.
- [ ] 3. Pack all three distributions, verify isolated native loading and package inventories, review changes, publish GitHub commit/tag/release and verify uploaded hashes. Include source and evidence archives.

## Validation

Use serial node:test execution and log exact SDK/Node versions and skip reasons. Run a full suite once per changed dependency environment; subsequent runs must address a changed implementation or a new hypothesis. Package verification must consume the packed files, not only source imports.
