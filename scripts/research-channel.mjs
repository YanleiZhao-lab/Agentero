import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	appendFileSync,
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = join(ROOT, "research-channel.json");
const APPLICATION_PACKAGES = [
	["src-tauri/Cargo.toml", "agentero"],
	["cli/Cargo.toml", "agentero-cli"],
	["crates/agentero-core/Cargo.toml", "agentero-core"],
	["crates/agentero-mcp/Cargo.toml", "agentero-mcp"],
];

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function required(name, environment = process.env) {
	const value = environment[name];
	if (!value) {
		throw new Error(`Missing ${name}`);
	}
	return value;
}

function command(program, args, options = {}) {
	const result = spawnSync(program, args, {
		cwd: ROOT,
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
		...options,
	});
	if (result.status !== 0) {
		throw new Error(
			`${program} ${args[0] ?? ""} failed (${result.status}): ${result.stderr || result.stdout || result.error}`,
		);
	}
	return result.stdout.trim();
}

function git(args, options) {
	return command("git", args, options);
}

function output(name, value, environment = process.env) {
	if (environment.GITHUB_OUTPUT) {
		appendFileSync(environment.GITHUB_OUTPUT, `${name}=${value}\n`);
	}
}

export function channelVersion(major, runNumber, runAttempt) {
	const components = [major, Number(runNumber), Number(runAttempt)];
	if (
		components.some(
			(component) =>
				!Number.isInteger(component) || component < 1 || component > 65535,
		)
	) {
		throw new Error(
			"Channel version components must be integers from 1 to 65535",
		);
	}
	return components.join(".");
}

function versionParts(version) {
	if (!/^\d+\.\d+\.\d+$/.test(version)) {
		throw new Error(`Invalid channel version: ${version}`);
	}
	return version.split(".").map(Number);
}

export function isNewerVersion(candidate, previous) {
	const left = versionParts(candidate);
	const right = versionParts(previous);
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) {
			return left[index] > right[index];
		}
	}
	return false;
}

export function stableReleaseTag(release) {
	if (
		release.draft ||
		release.prerelease ||
		!/^v\d+\.\d+\.\d+$/.test(release.tag_name ?? "")
	) {
		throw new Error("Upstream response is not a stable versioned release");
	}
	return release.tag_name;
}

function config() {
	const value = readJson(CONFIG);
	for (const name of ["repository", "upstreamRepository"]) {
		if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value[name])) {
			throw new Error(`Invalid ${name}`);
		}
	}
	for (const name of ["displayName", "shortName"]) {
		if (
			typeof value[name] !== "string" ||
			!value[name].trim() ||
			/["$\\/\r\n]/.test(value[name])
		) {
			throw new Error(`Invalid ${name}`);
		}
	}
	if (value.branch !== "research/stable") {
		throw new Error("This channel only promotes research/stable");
	}
	if (
		process.env.GITHUB_REPOSITORY &&
		process.env.GITHUB_REPOSITORY !== value.repository
	) {
		throw new Error(
			"Refusing to run the research channel in another repository",
		);
	}
	return value;
}

async function api(path, { optional = false } = {}) {
	const response = await fetch(`https://api.github.com${path}`, {
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${required("GH_TOKEN")}`,
			"X-GitHub-Api-Version": "2022-11-28",
		},
		signal: AbortSignal.timeout(60000),
	});
	if (optional && response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new Error(`GitHub ${path}: HTTP ${response.status}`);
	}
	return response.json();
}

async function previousRelease(channel) {
	const release = await api(`/repos/${channel.repository}/releases/latest`, {
		optional: true,
	});
	if (!release) {
		return null;
	}
	const asset = release.assets.find((item) => item.name === "channel.json");
	if (!asset) {
		throw new Error(
			"Latest Fork release has no channel.json; refusing to replace it",
		);
	}
	const response = await fetch(asset.browser_download_url, {
		signal: AbortSignal.timeout(60000),
	});
	if (!response.ok) {
		throw new Error(
			`Cannot read previous channel metadata: HTTP ${response.status}`,
		);
	}
	const metadata = await response.json();
	if (
		metadata.repository !== channel.repository ||
		metadata.channel !== "research"
	) {
		throw new Error("Previous release belongs to another update channel");
	}
	return {
		...metadata,
		changelog_url: release.assets.find((item) => item.name === "changelog.json")
			?.browser_download_url,
	};
}

export function unchangedInputs(previous, sourceSha, upstreamSha) {
	return (
		previous?.source_sha === sourceSha && previous?.upstream_sha === upstreamSha
	);
}

export function integrateStable(repository, upstreamRef) {
	const base = command("git", ["rev-parse", "HEAD"], { cwd: repository });
	const result = spawnSync(
		"git",
		["merge", "--no-commit", "--no-ff", upstreamRef],
		{ cwd: repository, encoding: "utf8" },
	);
	const mergeHead = spawnSync(
		"git",
		["rev-parse", "-q", "--verify", "MERGE_HEAD"],
		{ cwd: repository },
	);
	if (result.status === 0 && mergeHead.status !== 0) {
		return;
	}
	const conflicts = command(
		"git",
		["diff", "--name-only", "--diff-filter=U", "-z"],
		{
			cwd: repository,
		},
	)
		.split("\0")
		.filter(Boolean);
	const sourceConflicts = conflicts.filter(
		(path) => !path.startsWith(".github/workflows/"),
	);
	try {
		if (
			result.status !== 0 &&
			(mergeHead.status !== 0 || sourceConflicts.length > 0)
		) {
			throw new Error(
				sourceConflicts.join("\n") || result.stderr || result.stdout,
			);
		}
		// The Fork owns its workflows; the job token cannot adopt new workflow definitions.
		command(
			"git",
			[
				"restore",
				`--source=${base}`,
				"--staged",
				"--worktree",
				"--",
				".github/workflows",
			],
			{ cwd: repository },
		);
		command("git", ["commit", "--no-edit"], { cwd: repository });
		command(
			"git",
			["diff", "--exit-code", base, "HEAD", "--", ".github/workflows"],
			{ cwd: repository },
		);
	} catch (error) {
		spawnSync("git", ["merge", "--abort"], { cwd: repository });
		throw new Error(
			`Stable integration failed. No candidate was promoted.\n${error.message}`,
		);
	}
}

async function prepare() {
	const channel = config();
	const statePath = required("RESEARCH_STATE");
	const sourceSha = git(["rev-parse", "HEAD"]);
	const upstream = await api(
		`/repos/${channel.upstreamRepository}/releases/latest`,
	);
	const upstreamTag = stableReleaseTag(upstream);
	const upstreamRef = `refs/tags/research-upstream/${upstreamTag}`;
	git([
		"fetch",
		"--no-tags",
		`https://github.com/${channel.upstreamRepository}.git`,
		`refs/tags/${upstreamTag}:${upstreamRef}`,
	]);
	const upstreamSha = git(["rev-parse", `${upstreamRef}^{commit}`]);
	const previous = await previousRelease(channel);
	if (
		process.env.RESEARCH_FORCE !== "true" &&
		unchangedInputs(previous, sourceSha, upstreamSha)
	) {
		writeJson(statePath, {
			status: "unchanged",
			source_sha: sourceSha,
			upstream_sha: upstreamSha,
			upstream_tag: upstreamTag,
		});
		output("build", "false");
		console.log(
			`No changed source or stable upstream release (${upstreamTag})`,
		);
		return;
	}
	const version = channelVersion(
		channel.versionMajor,
		required("GITHUB_RUN_NUMBER"),
		required("GITHUB_RUN_ATTEMPT"),
	);
	if (previous && !isNewerVersion(version, previous.version)) {
		throw new Error(
			`Run version ${version} is not newer than ${previous.version}`,
		);
	}
	const runId = required("GITHUB_RUN_ID");
	const attempt = required("GITHUB_RUN_ATTEMPT");
	if (!/^\d+$/.test(runId) || !/^\d+$/.test(attempt)) {
		throw new Error("Invalid GitHub run identity");
	}
	const candidateBranch = `research/candidates/${runId}-${attempt}`;
	git(["config", "user.name", "github-actions[bot]"]);
	git([
		"config",
		"user.email",
		"41898282+github-actions[bot]@users.noreply.github.com",
	]);
	git(["switch", "-c", candidateBranch]);
	integrateStable(ROOT, upstreamRef);
	const candidateSha = git(["rev-parse", "HEAD"]);
	let previousReleases = [];
	if (previous?.changelog_url) {
		const response = await fetch(previous.changelog_url, {
			signal: AbortSignal.timeout(60000),
		});
		if (!response.ok) {
			throw new Error(`Cannot read channel history: HTTP ${response.status}`);
		}
		const history = await response.json();
		if (
			history.schemaVersion !== 1 ||
			!Array.isArray(history.releases) ||
			history.releases[0]?.tag !== previous.tag
		) {
			throw new Error(
				"Published changelog does not match the previous release",
			);
		}
		previousReleases = history.releases;
	}
	const state = {
		channel: "research",
		repository: channel.repository,
		branch: channel.branch,
		version,
		tag: `v${version}`,
		base_sha: sourceSha,
		source_sha: candidateSha,
		candidate_branch: candidateBranch,
		upstream_tag: upstreamTag,
		upstream_sha: upstreamSha,
		upstream_repository: channel.upstreamRepository,
		previous_releases: previousReleases,
		run_url: `https://github.com/${channel.repository}/actions/runs/${runId}`,
	};
	writeJson(statePath, state);
	git(["push", "origin", `HEAD:refs/heads/${candidateBranch}`]);
	output("build", "true");
	output("candidate_sha", candidateSha);
	output("version", version);
	console.log(`Prepared ${version} from ${upstreamTag} at ${candidateSha}`);
}

export function updaterOverlay(channel, version, publicKey) {
	versionParts(version);
	const decoded = Buffer.from(publicKey, "base64").toString("utf8");
	const keyLine = decoded.trim().split(/\r?\n/)[1];
	if (
		!decoded.startsWith("untrusted comment:") ||
		!keyLine ||
		Buffer.from(keyLine, "base64").length !== 42
	) {
		throw new Error(
			"RESEARCH_TAURI_PUBLIC_KEY is not a Tauri signing public key",
		);
	}
	return {
		version,
		bundle: { targets: ["nsis"], createUpdaterArtifacts: true },
		plugins: {
			updater: {
				pubkey: publicKey,
				endpoints: [
					`https://github.com/${channel.repository}/releases/latest/download/latest.json`,
				],
			},
		},
	};
}

export function stampPackageVersion(text, name, version) {
	const sections = text.split(/(?=^\[)/m);
	const index = sections.findIndex((section) =>
		/^\[package\]\r?\n/.test(section),
	);
	const section = sections[index];
	if (
		!section ||
		!new RegExp(`^name = "${name}"\\r?$`, "m").test(section) ||
		!/^version = "[^"]+"\r?$/m.test(section)
	) {
		throw new Error(`Cannot locate the ${name} package section`);
	}
	sections[index] = section.replace(
		/^version = "[^"]+"\r?$/m,
		(line) => `version = "${version}"${line.endsWith("\r") ? "\r" : ""}`,
	);
	return sections.join("");
}

export function stampLockVersions(text, version) {
	const updated = new Set();
	const result = text.replace(
		/\[\[package\]\]\r?\n[\s\S]*?(?=\[\[package\]\]|$)/g,
		(block) => {
			const name = /^name = "([^"]+)"\r?$/m.exec(block)?.[1];
			if (
				!APPLICATION_PACKAGES.some(([, packageName]) => packageName === name) ||
				/^source = /m.test(block)
			) {
				return block;
			}
			if (updated.has(name)) {
				throw new Error(`Duplicate local ${name} package`);
			}
			updated.add(name);
			return block.replace(
				/^version = "[^"]+"\r?$/m,
				(line) => `version = "${version}"${line.endsWith("\r") ? "\r" : ""}`,
			);
		},
	);
	if (updated.size !== APPLICATION_PACKAGES.length) {
		throw new Error(
			"Cargo.lock does not contain all four local application packages",
		);
	}
	return result;
}

export function stampIosVersions(text, version) {
	let result = text;
	for (const field of ["CFBundleShortVersionString", "CFBundleVersion"]) {
		const pattern = new RegExp(
			`^([\\t ]*${field}:[\\t ]*)(?:"[^"\\r\\n]*"|'[^'\\r\\n]*'|[^\\s#\\r\\n]+)([\\t ]*(?:#[^\\r\\n]*)?)(\\r?)$`,
			"gm",
		);
		if ([...result.matchAll(pattern)].length !== 1) {
			throw new Error(`Expected one iOS ${field} version field`);
		}
		result = result.replace(
			pattern,
			(_, prefix, suffix, ending) => `${prefix}"${version}"${suffix}${ending}`,
		);
	}
	return result;
}

function configure() {
	const channel = config();
	const state = readJson(required("RESEARCH_STATE"));
	if (git(["rev-parse", "HEAD"]) !== state.source_sha) {
		throw new Error("Build checkout differs from prepared candidate");
	}
	const overlay = updaterOverlay(
		channel,
		state.version,
		required("RESEARCH_TAURI_PUBLIC_KEY"),
	);
	for (const [path, name] of APPLICATION_PACKAGES) {
		const fullPath = join(ROOT, path);
		writeFileSync(
			fullPath,
			stampPackageVersion(readFileSync(fullPath, "utf8"), name, state.version),
		);
	}
	const lockPath = join(ROOT, "Cargo.lock");
	writeFileSync(
		lockPath,
		stampLockVersions(readFileSync(lockPath, "utf8"), state.version),
	);
	const packagePath = join(ROOT, "package.json");
	const packageJson = readJson(packagePath);
	packageJson.version = state.version;
	writeJson(packagePath, packageJson);
	const iosPath = join(ROOT, "src-tauri/ios-project.yml");
	writeFileSync(
		iosPath,
		stampIosVersions(readFileSync(iosPath, "utf8"), state.version),
	);
	const path = required("RESEARCH_TAURI_CONFIG");
	const hooks = join(dirname(path), "agenteroz-hooks.nsh");
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		hooks,
		`!define AGENTERO_DISPLAY_NAME "${channel.displayName}"\n` +
			`!include "${join(ROOT, "src-tauri/nsis/hooks.nsh").replaceAll("\\", "/")}"\n`,
	);
	overlay.bundle.windows = { nsis: { installerHooks: hooks } };
	writeJson(
		join(ROOT, "src/lib/update/changelog.json"),
		channelChangelog(state),
	);
	writeJson(path, overlay);
	if (process.env.GITHUB_ENV) {
		appendFileSync(
			process.env.GITHUB_ENV,
			`TAURI_CONFIG=${JSON.stringify(overlay)}\n`,
		);
	}
	output("config_path", path.replaceAll("\\", "/"));
}

export function channelChangelog(state) {
	const channel = config();
	const summaries = {};
	for (const locale of ["zh-CN", "en"]) {
		const custom = readJson(
			join(ROOT, `src/i18n/locales/${locale}/settings.json`),
		).about.custom;
		const heading = locale === "zh-CN" ? "### 定制功能" : "### Custom features";
		summaries[locale] =
			`${channel.displayName} · ${state.upstream_tag}\n\n${heading}\n\n` +
			[custom.notes, custom.skills, custom.updates]
				.map((feature) => `- ${feature}`)
				.join("\n");
	}
	const bundled = readJson(join(ROOT, "src/lib/update/changelog.json"));
	const history = new Map();
	for (const release of [
		...(state.previous_releases ?? []),
		...bundled.releases,
	]) {
		if (release.tag !== state.tag && !history.has(release.tag)) {
			history.set(release.tag, release);
		}
	}
	const olderReleases = [...history.values()].sort((left, right) =>
		isNewerVersion(left.tag.slice(1), right.tag.slice(1)) ? -1 : 1,
	);
	return {
		schemaVersion: 1,
		releases: [
			{
				tag: state.tag,
				releaseDate: new Date().toISOString().slice(0, 10),
				summary: summaries,
			},
			...olderReleases,
		],
	};
}

function sha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function insideRoot(path) {
	const result = relative(ROOT, realpathSync(path));
	if (result.startsWith("..") || isAbsolute(result)) {
		throw new Error("Build artifact lies outside the candidate checkout");
	}
	return path;
}

export function updaterManifest(state, installer, signature, date) {
	if (!/^[A-Za-z0-9_.-]+-setup\.exe$/.test(installer)) {
		throw new Error("Expected a Windows NSIS installer filename");
	}
	if (!signature || !/^[A-Za-z0-9+/=\r\n]+$/.test(signature)) {
		throw new Error("Missing or malformed Tauri updater signature");
	}
	return {
		version: state.version,
		notes:
			`${config().displayName} · ${state.upstream_tag}\n\n` +
			"论文笔记文档选择与记忆、科研阅读技能、Fork 签名更新。\n" +
			"Paper-note selection and memory, research skills, and signed Fork updates.",
		pub_date: date,
		platforms: {
			"windows-x86_64": {
				signature: signature.trim(),
				url: `https://github.com/${state.repository}/releases/download/${state.tag}/${encodeURIComponent(installer)}`,
			},
		},
	};
}

function packageArtifacts() {
	const state = readJson(required("RESEARCH_STATE"));
	if (required("TAURI_APP_VERSION") !== state.version) {
		throw new Error("Tauri built a different application version");
	}
	const paths = JSON.parse(required("TAURI_ARTIFACT_PATHS"));
	const installers = paths.filter((path) => /-setup\.exe$/i.test(path));
	if (installers.length !== 1) {
		throw new Error("Expected exactly one NSIS installer from tauri-action");
	}
	const installer = insideRoot(resolve(installers[0]));
	const signaturePath = insideRoot(`${installer}.sig`);
	const installerName = `${config().shortName}_${state.version}_x64-setup.exe`;
	const delivery = required("RESEARCH_DELIVERY");
	mkdirSync(delivery, { recursive: true });
	copyFileSync(installer, join(delivery, installerName));
	copyFileSync(signaturePath, join(delivery, `${installerName}.sig`));
	const cliBinary = insideRoot(join(ROOT, "target/release/agentero-cli.exe"));
	const cliVersion = command(cliBinary, ["--version"]);
	if (!cliVersion.endsWith(` ${state.version}`)) {
		throw new Error(
			`The standalone CLI version does not match ${state.version}`,
		);
	}
	const cliDirectory = mkdtempSync(join(tmpdir(), "agentero-research-cli-"));
	const archive = `agentero-cli-${state.version}-x86_64-pc-windows-msvc.zip`;
	const binaryCopy = join(cliDirectory, "agentero.exe");
	const pdfiumCopy = join(cliDirectory, "pdfium.dll");
	copyFileSync(cliBinary, binaryCopy);
	copyFileSync(
		insideRoot(join(ROOT, "src-tauri/pdfium/pdfium.dll")),
		pdfiumCopy,
	);
	command(
		"pwsh.exe",
		[
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"$ErrorActionPreference='Stop'; Compress-Archive -LiteralPath @($env:RESEARCH_CLI_BINARY, $env:RESEARCH_CLI_PDFIUM) -DestinationPath $env:RESEARCH_CLI_ARCHIVE -CompressionLevel Optimal",
		],
		{
			env: {
				...process.env,
				RESEARCH_CLI_BINARY: binaryCopy,
				RESEARCH_CLI_PDFIUM: pdfiumCopy,
				RESEARCH_CLI_ARCHIVE: join(delivery, archive),
			},
		},
	);
	writeFileSync(
		join(delivery, `${archive}.sha256`),
		`${sha256(join(delivery, archive))}  ${archive}\n`,
	);
	const signature = readFileSync(signaturePath, "utf8").trim();
	writeJson(
		join(delivery, "latest.json"),
		updaterManifest(state, installerName, signature, new Date().toISOString()),
	);
	writeJson(join(delivery, "channel.json"), state);
	copyFileSync(
		join(ROOT, "src/lib/update/changelog.json"),
		join(delivery, "changelog.json"),
	);
	const names = readdirSync(delivery).sort();
	writeFileSync(
		join(delivery, "SHA256SUMS"),
		`${names.map((name) => `${sha256(join(delivery, name))}  ${name}`).join("\n")}\n`,
	);
}

export function validateDelivery(delivery, state) {
	const manifest = readJson(join(delivery, "latest.json"));
	const recorded = readJson(join(delivery, "channel.json"));
	if (
		manifest.version !== state.version ||
		recorded.source_sha !== state.source_sha ||
		recorded.repository !== state.repository ||
		recorded.tag !== state.tag
	) {
		throw new Error("Delivery metadata does not match the prepared candidate");
	}
	const platform = manifest.platforms?.["windows-x86_64"];
	if (!platform || Object.keys(manifest.platforms).length !== 1) {
		throw new Error("Delivery must contain exactly the Windows x64 update");
	}
	const installer = decodeURIComponent(
		new URL(platform.url).pathname.split("/").at(-1),
	);
	const expected = updaterManifest(
		state,
		installer,
		platform.signature,
		manifest.pub_date,
	);
	if (
		platform.url !== expected.platforms["windows-x86_64"].url ||
		Number.isNaN(Date.parse(manifest.pub_date))
	) {
		throw new Error("Updater URL or publication time is invalid");
	}
	const signatures = readFileSync(
		join(delivery, `${installer}.sig`),
		"utf8",
	).trim();
	if (platform.signature !== signatures) {
		throw new Error("Manifest signature differs from the installer signature");
	}
	const expectedNames = [
		installer,
		`${installer}.sig`,
		`agentero-cli-${state.version}-x86_64-pc-windows-msvc.zip`,
		`agentero-cli-${state.version}-x86_64-pc-windows-msvc.zip.sha256`,
		"channel.json",
		"changelog.json",
		"latest.json",
	].sort();
	const sumLines = readFileSync(join(delivery, "SHA256SUMS"), "utf8")
		.trim()
		.split(/\r?\n/);
	const checkedNames = [];
	for (const line of sumLines) {
		const match = /^([a-f0-9]{64}) {2}([A-Za-z0-9_.-]+)$/.exec(line);
		if (!match || !expectedNames.includes(match[2])) {
			throw new Error("Invalid checksum manifest entry");
		}
		if (sha256(join(delivery, match[2])) !== match[1]) {
			throw new Error(`Transferred asset checksum differs: ${match[2]}`);
		}
		checkedNames.push(match[2]);
	}
	if (
		JSON.stringify(checkedNames.sort()) !== JSON.stringify(expectedNames) ||
		JSON.stringify(readdirSync(delivery).sort()) !==
			JSON.stringify([...expectedNames, "SHA256SUMS"].sort())
	) {
		throw new Error("Delivery has missing, duplicate or unexpected assets");
	}
	const cliArchive = `agentero-cli-${state.version}-x86_64-pc-windows-msvc.zip`;
	const cliSum = readFileSync(join(delivery, `${cliArchive}.sha256`), "utf8");
	if (cliSum !== `${sha256(join(delivery, cliArchive))}  ${cliArchive}\n`) {
		throw new Error("Standalone CLI checksum does not match its archive");
	}
	const changelog = readJson(join(delivery, "changelog.json"));
	if (
		changelog.schemaVersion !== 1 ||
		changelog.releases?.[0]?.tag !== state.tag ||
		!changelog.releases[0].summary?.["zh-CN"]?.trim() ||
		!changelog.releases[0].summary?.en?.trim()
	) {
		throw new Error("Channel changelog does not describe this release");
	}
	return join(delivery, installer);
}

function verifySignature(delivery, state) {
	const installer = validateDelivery(delivery, state);
	const directory = mkdtempSync(join(tmpdir(), "agentero-research-signature-"));
	const key = join(directory, "public.key");
	const signature = join(directory, "installer.sig");
	writeFileSync(
		key,
		Buffer.from(required("RESEARCH_TAURI_PUBLIC_KEY"), "base64"),
	);
	writeFileSync(
		signature,
		Buffer.from(readFileSync(`${installer}.sig`, "utf8").trim(), "base64"),
	);
	command("minisign", ["-V", "-m", installer, "-p", key, "-x", signature]);
	const cliArchive = join(
		delivery,
		`agentero-cli-${state.version}-x86_64-pc-windows-msvc.zip`,
	);
	const entries = command("unzip", ["-Z1", cliArchive]).split(/\r?\n/).sort();
	if (
		JSON.stringify(entries) !== JSON.stringify(["agentero.exe", "pdfium.dll"])
	) {
		throw new Error("Standalone CLI archive has unexpected contents");
	}
	return installer;
}

export function promoteCandidate(repository, state) {
	const ancestor = spawnSync(
		"git",
		["merge-base", "--is-ancestor", state.base_sha, state.source_sha],
		{ cwd: repository },
	);
	if (ancestor.status !== 0) {
		throw new Error("Candidate does not contain the original branch head");
	}
	const result = spawnSync(
		"git",
		[
			"push",
			`--force-with-lease=refs/heads/${state.branch}:${state.base_sha}`,
			"origin",
			`${state.source_sha}:refs/heads/${state.branch}`,
		],
		{ cwd: repository, encoding: "utf8" },
	);
	if (result.status !== 0) {
		throw new Error(
			`Research branch changed or push failed; candidate was not promoted: ${result.stderr}`,
		);
	}
}

async function publish() {
	const channel = config();
	const state = readJson(required("RESEARCH_STATE"));
	const delivery = required("RESEARCH_DELIVERY");
	if (
		state.repository !== channel.repository ||
		state.branch !== channel.branch
	) {
		throw new Error(
			"Prepared candidate belongs to another repository or branch",
		);
	}
	verifySignature(delivery, state);
	const previous = await previousRelease(channel);
	if (previous && !isNewerVersion(state.version, previous.version)) {
		throw new Error("Refusing to publish an older or repeated channel version");
	}
	const existing = await api(
		`/repos/${channel.repository}/releases/tags/${state.tag}`,
		{ optional: true },
	);
	if (existing) {
		throw new Error(`Release ${state.tag} already exists`);
	}
	const notes = join(dirname(delivery), "research-release-notes.md");
	writeFileSync(
		notes,
		`## 概要\n\n${channel.displayName} ${state.version}（Windows x64），基于上游 ` +
			`[${state.upstream_tag}](https://github.com/${state.upstream_repository}/releases/tag/${state.upstream_tag})。\n\n` +
			"- 论文笔记栏支持选择文档，并按论文记住上次选择。\n" +
			"- 整合深度研究、论文精读与学术写作技能。\n" +
			"- 统一定制名称、书页声波图标和 Fork 项目与反馈入口。\n" +
			"- 后续更新通过本 Fork 的独立签名更新渠道安装。\n" +
			"- 首次从官方渠道迁移时，下载安装本页 setup 可执行文件一次；沿用原应用标识和现有用户配置。\n\n" +
			"更新签名独立于 Windows Authenticode；安装包未附带 Windows 发布者签名。\n\n" +
			`定制源码：[${state.source_sha}](https://github.com/${state.repository}/commit/${state.source_sha})。\n\n` +
			`---\n\n## Summary\n\n${channel.displayName} ${state.version} (Windows x64), based on upstream ` +
			`[${state.upstream_tag}](https://github.com/${state.upstream_repository}/releases/tag/${state.upstream_tag}).\n\n` +
			"- The paper-note pane supports document selection and remembers the last selection per paper.\n" +
			"- Integrated deep research, close paper reading and academic writing skills.\n" +
			"- Custom branding, a book-and-wave icon, and project and feedback links to this Fork.\n" +
			"- Subsequent updates use this Fork's independently signed update channel.\n" +
			"- To migrate from the official channel, install this page's setup executable once; the original application identifier and existing user configuration are retained.\n\n" +
			"The updater signature is independent of Windows Authenticode; the installer has no Windows publisher signature.\n\n" +
			`Customized source: [${state.source_sha}](https://github.com/${state.repository}/commit/${state.source_sha}).\n`,
	);
	const files = readdirSync(delivery).map((name) => join(delivery, name));
	command("gh", [
		"release",
		"create",
		state.tag,
		"--repo",
		channel.repository,
		"--target",
		state.source_sha,
		"--draft",
		"--title",
		`${channel.displayName} ${state.version}`,
		"--notes-file",
		notes,
		...files,
	]);
	const roundtrip = mkdtempSync(join(tmpdir(), "agentero-research-upload-"));
	command("gh", [
		"release",
		"download",
		state.tag,
		"--repo",
		channel.repository,
		"--dir",
		roundtrip,
	]);
	verifySignature(roundtrip, state);
	git(["fetch", "origin", state.candidate_branch]);
	if (git(["rev-parse", "FETCH_HEAD"]) !== state.source_sha) {
		throw new Error("Candidate branch changed during the build");
	}
	promoteCandidate(ROOT, state);
	command("gh", [
		"release",
		"edit",
		state.tag,
		"--repo",
		channel.repository,
		"--draft=false",
		"--latest=true",
	]);
	console.log(
		`Published https://github.com/${channel.repository}/releases/tag/${state.tag}`,
	);
	if (process.env.GITHUB_STEP_SUMMARY) {
		appendFileSync(
			process.env.GITHUB_STEP_SUMMARY,
			`## Published ${channel.displayName} ${state.version}\n\n` +
				`[Signed Windows installer](https://github.com/${channel.repository}/releases/tag/${state.tag})\n\n` +
				`Upstream ${state.upstream_tag}; source \`${state.source_sha}\`.\n`,
		);
	}
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		const operation = process.argv[2];
		if (operation === "prepare") {
			await prepare();
		} else if (operation === "configure") {
			configure();
		} else if (operation === "package") {
			packageArtifacts();
		} else if (operation === "publish") {
			await publish();
		} else {
			throw new Error("Expected prepare, configure, package or publish");
		}
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
