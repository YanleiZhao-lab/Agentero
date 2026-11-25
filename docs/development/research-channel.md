# AgenteroZ 定制自用版

The Fork maintains the paper-note customization on `research/stable` and builds a signed Windows x64 installer when either that source or the latest stable upstream Release changes. Official prereleases and arbitrary upstream `main` commits are excluded.

## Name, icon and project links

`research-channel.json` owns the visible name **AgenteroZ 定制自用版**, short name **AgenteroZ**, and Fork repository. `src/lib/core/branding.ts` supplies the frontend name, icon and links. The About pane lists paper-note document selection and memory, research skills, and the signed update channel. Project and feedback buttons open this Fork; the separately labelled upstream credit opens the original project.

`src/assets/agenteroz-icon.svg` is the source for the book, Z and sound-wave icon. Generate native assets with `pnpm exec tauri icon src/assets/agenteroz-icon.svg --output <temporary-directory>`, then copy `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.ico` and `icon.icns` into `src-tauri/icons/agenteroz/`.

The main caption and new-window captions use the branded title. Research builds supply a small NSIS hook header to set the Windows installed-app display name and rename shortcuts owned by this installation. The executable name, internal `productName` (`Agentero`), uninstall registry key, application identifier (`com.poco-ai.agentero`), CLI commands, user directories and Vault paths keep their existing identity. Branding therefore does not create a second installation or data location. The NSIS wizard's internal product name remains Agentero.

## Install the channel once, then update normally

Download the setup executable from this Fork's latest Release and install it once. The installed build keeps the upstream application identifier and uses the existing user configuration, but its updater verifies this Fork's public key and reads this Fork's `latest.json`.

Subsequent in-app updates install the signed customized build. Installing an official installer manually can still replace it because the application identifier is shared.

Each Release contains:

- `AgenteroZ_<version>_x64-setup.exe` and its Tauri updater signature.
- `latest.json`, containing the signed `windows-x86_64` update.
- `changelog.json`, with the same bilingual channel entry bundled in the desktop.
- `channel.json`, identifying the upstream tag/SHA, customized source, candidate base, version and workflow run.
- A matching `agentero-cli-<version>-x86_64-pc-windows-msvc.zip`, containing `agentero.exe` and `pdfium.dll`, plus its `.sha256`. The desktop's existing Install CLI entry uses this Fork's matching Release.
- `SHA256SUMS`, covering all distributed assets.

Tauri updater signatures verify update payloads. These builds do not acquire Windows Authenticode signing; Windows may therefore show the normal unsigned-publisher prompt.

## Synchronization and publication

`.github/workflows/research-channel.yml` runs twice daily, at 01:23 and 13:23 UTC, and supports manual dispatch with an optional forced rebuild.

1. `prepare` checks out the customized branch and fetches the latest upstream stable Release tag. It compares that upstream SHA and the current customized source SHA with the last published `channel.json`. Unchanged inputs skip the build.
2. It integrates the upstream tag on a unique candidate branch, keeping the Fork's existing `.github/workflows` definitions unchanged. Conflicts outside that controlled directory abort the merge and fail without publishing or moving `research/stable`. Upstream workflow additions, edits and deletions are not adopted automatically.
3. `build` checks out the exact candidate SHA, installs frozen frontend dependencies, and runs types, dependency boundaries and frontend tests. It stamps build-only application versions, stages the real upstream resources, runs the CLI-download contract test, builds the matching standalone CLI and uses the official Tauri action to build/sign the NSIS installer.
4. `publish` validates exact assets, checksums, source metadata, updater URL, the CLI archive entries and the installer with `minisign`. It creates a draft Release, downloads its assets back and verifies the transferred bytes/signature again.
5. It promotes the candidate only after these checks. Promotion first proves candidate ancestry, then uses an exact Git lease against the original `research/stable` SHA. A concurrent branch edit rejects the push; it cannot be overwritten. The verified draft becomes the latest Release only after successful promotion.

All phases are jobs of the same workflow. The design does not depend on a push made with `GITHUB_TOKEN` triggering a second workflow.

Generated Release notes present equivalent Chinese and English summaries, in that order, with links to the upstream tag and customized source commit.

## Versions and build-only configuration

Versions use `1.<github.run_number>.<github.run_attempt>`, with every component restricted to 1–65535 for Windows. A new run increases the minor number; rerunning a failed run increases the patch number. A stale run cannot publish a version older than the current channel. Before the run number reaches 65536, increment the configured major and reset/recreate the workflow's run sequence as a deliberate channel maintenance change.

`research-channel.json` owns the display names, Fork repository, upstream repository, target branch and major version. Build scripts leave the committed upstream package versions intact. Inside the disposable build checkout they stamp:

- `package.json` version.
- The `[package].version` fields of `src-tauri/Cargo.toml`, `cli/Cargo.toml`, `crates/agentero-core/Cargo.toml` and `crates/agentero-mcp/Cargo.toml`, keeping HTTP User-Agent and MCP service versions aligned with the application.
- All four corresponding local package versions in `Cargo.lock`, preserving dependency resolutions.
- `CFBundleShortVersionString` and `CFBundleVersion` in `src-tauri/ios-project.yml`.
- An external Tauri overlay with the channel version, NSIS target, public key and Fork updater endpoint.
- A generated NSIS hook header with the custom display name.
- A bilingual channel entry at the beginning of `src/lib/update/changelog.json`, including the upstream version and custom features.

Preparation carries the previously published `changelog.json` entries into the next build state. New entries keep that published history and merge upstream baseline entries by tag in descending version order. A release from before the first channel changelog asset contributes no synthetic history entry.

`configure` also writes that same overlay as compact `TAURI_CONFIG` JSON to `GITHUB_ENV`. Direct Cargo tests/builds consume it before the Tauri action runs; both `tauri-build` and Tauri code generation merge this environment configuration, including the application version and updater key. The Tauri action receives the same overlay through `--config`.

Both Cargo builds continue to use `--locked`. The workflow records the unmodified candidate commit as the source identity; generated versions and overlays are never pushed into that candidate.

`AGENTERO_RELEASE_REPO` and `VITE_AGENTERO_RELEASE_REPO` select matching CLI downloads, changelog and release-details URLs. They are set by the existing Fork workflow. Local defaults also select this Fork, and the committed Tauri configuration uses the same Fork updater endpoint and public key. The old official changelog and AtomGit fallback are removed so a channel build cannot replace its history with official-version metadata.

## Signing configuration

The repository needs:

| Type | Name | Purpose |
| --- | --- | --- |
| Actions secret | `RESEARCH_TAURI_SIGNING_PRIVATE_KEY` | Tauri signing private key |
| Actions secret | `RESEARCH_TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for that key |
| Actions variable | `RESEARCH_TAURI_PUBLIC_KEY` | Matching base64 Tauri verification public key |

The signing key is generated through Tauri and backed up outside Git. It must remain stable across updates; changing the repository variable alone does not migrate already installed clients to a new key.

Make `research/stable` the Fork default branch so GitHub can schedule this workflow. Enable this workflow explicitly and disable inherited upstream workflows in the Fork; those include unrelated platform and external publishing tasks.

The workflow uses its scoped `GITHUB_TOKEN`, with write access only in candidate preparation and final publication. This token does not provide the separate permission for arbitrary workflow-file changes. The merge therefore pauses before committing, restores `.github/workflows` from the customized base, and checks that the committed candidate has exactly the same workflow tree before pushing. These definitions already exist in the Fork; the automatic path does not need a personal access token to introduce new definitions.

Review upstream workflow changes separately and apply any relevant maintenance with an appropriately authorized account. The first hosted candidate push still has to confirm GitHub accepts the preserved workflow tree; local Git checks cannot prove remote token permissions.

This follows GitHub's [available token permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions) and [workflow scope rule](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps): identical workflow files already present on another branch in the same repository may be committed without introducing new workflow definitions.

## Failure and recovery

Failed integration, checks, builds or verification leave the last public Release and updater feed in place. Candidate branches and workflow logs retain the diagnostic state. A failed publication can leave a draft Release; it is not selected by the latest updater endpoint.

If promotion succeeds but GitHub publication fails, the last public update remains available. A subsequent scheduled run sees that the branch source differs from the last public channel metadata and builds a new version. Old drafts are diagnostic artifacts and can be reviewed separately.

Use manual dispatch with `force: true` after a transient build failure or when intentionally rebuilding the same source. “Re-run all jobs” also prepares a new attempt version. “Re-run failed jobs” can reuse the earlier preparation and version; it will refuse to replace a draft or public Release that already exists, so start a new manual run when recovering a partially uploaded draft. If a newer workflow run has already published, rerunning an older run is refused.

Resolve an upstream merge conflict on a reviewed local branch and push the repaired customized branch. The next run will validate and build it; do not resolve conflicts by replacing the customized branch with upstream.

GitHub can delay schedules and disable scheduled workflows after extended repository inactivity. Check Actions if expected checks stop arriving, and re-enable the workflow when GitHub marks it inactive. Manual dispatch remains the immediate recovery entry point.

## Verification scope

Local behavior checks exercise stable-release filtering, unchanged-input skipping, real Git merges and aborts, exact-lease promotion races, version ordering, version stamping, updater metadata and transferred-asset checks. Temporary tests follow this repository's local-only policy.

The first hosted workflow run must pass before this channel is considered delivered. That confirms runner setup, resource downloads, the signed installer and hosted publishing path. It does not replace desktop interaction verification of the note selector, nor does it install the build over the user's current application.
