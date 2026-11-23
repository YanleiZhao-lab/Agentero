/** Match the versioned tags published by the desktop release workflow. */
export function getUpdateReleaseUrl(version?: string): string {
	const repository =
		import.meta.env.VITE_AGENTERO_RELEASE_REPO || "poco-ai/Agentero";
	const releases = `https://github.com/${repository}/releases`;
	return version
		? `${releases}/tag/${encodeURIComponent(`v${version}`)}`
		: `${releases}/latest`;
}
