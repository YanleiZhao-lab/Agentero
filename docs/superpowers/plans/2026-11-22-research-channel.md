# Research Channel Implementation Plan

> **For agentic workers:** Execute the approved plan task by task. Keep source migration and release automation in separate write areas; the primary agent owns GitHub configuration, integration, and final acceptance.

**Goal:** Maintain the paper-note customization through stable upstream updates and deliver signed Windows builds from the user's Fork.

**Architecture:** `research/stable` is the customized default branch, initially based on upstream `v0.17.0` and now integrating stable `v0.18.1`. One scheduled/manual workflow discovers stable upstream releases, integrates a candidate while retaining the Fork-owned workflows, checks it, builds and signs a Windows NSIS installer, and promotes only successful candidates. Conflicts or checks failing retain the previous release. Fork-only updater configuration is kept separate from the generic feature.

**Tech Stack:** GitHub Actions, Git/GitHub CLI, Node.js, pnpm, Rust, Tauri 2, existing React/TypeScript feature.

## Authorization and acceptance

The user approved the design on 2026-11-22. Creating the Fork, pushing the customized branch, configuring its Actions/signing secrets, and publishing its signed builds are within the approved implementation. An upstream proposal is prepared locally; posting to upstream or opening its PR remains a separate action.

- [x] Fork exists under `YanleiZhao-lab/Agentero`.
- [ ] Only the custom workflow is enabled; inherited workflows do not run unrelated release/deployment tasks.
- [x] Generic paper-note feature is migrated to the stable baseline, preserving its loading and save contracts; targeted tests, types and dependency checks pass.
- [x] Integration discovers stable releases only, skips unchanged inputs, and stops on conflicts/check failures.
- [x] Scheduled/manual execution uses the same build path without relying on a token-triggered push to start another workflow.
- [ ] Windows build uses the repository's real resource preparation and Release profile; no fake resources or disabled product features.
- [ ] Updater endpoint and verification public key point to the Fork's channel. Private signing material is kept outside Git through GitHub secrets and a protected local backup.
- [ ] Versioning is monotonic within this channel, signature/manifest/assets are checked, and the first hosted build succeeds.
- [x] Upstream proposal identifies #738 as prior work, states the incremental feature, and lists remaining real UI/demo requirements.
- [ ] Relevant commits, worktree, run/release locations and remaining limitations are delivered.

## Task 1 — Migrate the generic feature

**Owner/write area:** frontend source, existing frontend test adjustment, reading usage documentation. No release scripts, updater config, Git index, or remote mutations.

- [x] Compare `98100acf` against `v0.17.0`; bring only the generic feature and existing test-mock update, excluding personal acceptance/build documents.
- [x] Preserve the `NOTES.md` canonical paper identity, document selection, storage isolation, missing-file fallback, saved-draft refusal, HTML handling and reading-pair behavior.
- [x] Use local temporary behavior tests, then archive/remove those introduced for verification according to AGENTS.md.
- [x] Run `node node_modules/typescript/bin/tsc --noEmit`, targeted Vitest, Biome on touched source, and dependency-cruiser. Report exact commands/results.

## Task 2 — Implement candidate synchronization and signed builds

**Owner/write area:** `.github/workflows/research-channel.yml`, `scripts/research-*`, `docs/development/research-channel.md`. No frontend changes, Git index operations, secrets, or remote mutations.

- [x] Implement stable Release discovery, candidate Git integration, unchanged-input skip and conflict failure.
- [x] Keep all build phases in one workflow; scheduled and dispatch events share the same implementation.
- [ ] Reuse locked pnpm/Rust builds and official resource preparation. Publish NSIS updater artifacts only after checks and signature validation.
- [x] Keep custom version/updater settings in a Fork overlay consumed at build time. Channel metadata records upstream tag, source SHA and build identity.
- [x] Exercise the scripts with temporary local repositories and representative GitHub responses: unchanged, newer stable, prerelease, conflict, failed build, and malformed updater output.
- [x] Document workflow outputs, recovery, version comparison, signing-key ownership and first migration installation.

## Task 3 — Configure and verify the actual Fork

**Owner:** primary agent.

- [x] Create `YanleiZhao-lab/Agentero`.
- [x] Create isolated worktree on `v0.17.0`, branch `research/stable`.
- [x] Review and integrate Tasks 1–2 without unrelated source or personal paths.
- [x] Generate the channel's signing key through Tauri, protect its local backup, and upload required values through GitHub's secret interface without printing them.
- [ ] Commit verified changes, push `research/stable`, make it the Fork default, and enable only the custom workflow.
- [ ] Dispatch and follow the first run to completion, fixing actual failures at their owner.
- [ ] Validate hosted version/manifest/signatures and first installer assets. Do not install over the user's active application.
- [x] Prepare the upstream proposal as a local file and record remaining desktop UI/demo verification.

## Verification commands and completion

Use project-native commands and the dependencies already prepared in the previous worktree where package versions match; do not change lockfiles to accommodate tooling. `git diff --check` and final `git status` must cover the integrated result. Hosted Actions success is required for the automatic build delivery; local script checks alone do not prove that it works.

Commit generic behavior separately from Fork-only automation so the upstream candidate can exclude updater keys, workflow settings and personal paths.
