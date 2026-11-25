import { APP_REPOSITORY_URL } from "@/lib/core/branding";

/** Match the versioned tags published by the desktop release workflow. */
export function getUpdateReleaseUrl(version?: string): string {
	const releases = `${APP_REPOSITORY_URL}/releases`;
	return version
		? `${releases}/tag/${encodeURIComponent(`v${version}`)}`
		: `${releases}/latest`;
}
